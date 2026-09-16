// Stripe からの通知で会員状態を更新する。
//
// **署名を必ず検証する。** 検証しないと、誰でも「支払った」と偽の通知を
// 送って有料会員になれてしまう。署名の計算には生のリクエストボディが要るので、
// Vercel の body パースを切って自分で読む。
import { createHmac, timingSafeEqual } from 'node:crypto'
import { configured, rest, json } from '../lib/supabase.mjs'

export const config = { api: { bodyParser: false } }

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// Stripe-Signature: t=<秒>,v1=<署名>
export function verify(raw, header, secret) {
  if (!header || !secret) return false
  const parts = Object.fromEntries(
    String(header).split(',').map((kv) => kv.split('=').map((s) => s.trim()))
  )
  if (!parts.t || !parts.v1) return false

  // 古い通知の使い回しを防ぐ。5分より古いものは受けない。
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t))
  if (!Number.isFinite(age) || age > 300) return false

  const expected = createHmac('sha256', secret).update(parts.t + '.' + raw.toString('utf8')).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(parts.v1), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

const PAID = new Set(['active', 'trialing'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  if (!configured() || !process.env.STRIPE_WEBHOOK_SECRET) return json(res, 503, { error: 'not_configured' })

  const raw = await readRaw(req)
  if (!verify(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
    return json(res, 400, { error: 'bad_signature' })
  }

  let event
  try { event = JSON.parse(raw.toString('utf8')) } catch { return json(res, 400, { error: 'bad_json' }) }

  const obj = (event.data && event.data.object) || {}
  const userId = (obj.metadata && obj.metadata.user_id) || null
  if (!userId) return json(res, 200, { ok: true, skipped: 'no_user_id' })

  // 解約・支払い失敗でも必ず状態を戻す。付けるだけにしない。
  let isPaid = null
  if (event.type === 'checkout.session.completed') isPaid = true
  else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    isPaid = PAID.has(obj.status)
  } else if (event.type === 'customer.subscription.deleted') isPaid = false
  else return json(res, 200, { ok: true, ignored: event.type })

  try {
    await rest('members?id=eq.' + userId, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        is_paid: isPaid,
        ...(obj.customer ? { stripe_customer_id: obj.customer } : {}),
        ...(obj.id && String(obj.id).startsWith('sub_') ? { stripe_subscription_id: obj.id } : {}),
        updated_at: new Date().toISOString(),
      },
    })
    return json(res, 200, { ok: true, is_paid: isPaid })
  } catch (e) {
    return json(res, 500, { error: 'upstream', detail: String(e.message || e) })
  }
}
