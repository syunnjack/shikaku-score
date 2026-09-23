// Stripe の決済ページへ送る。サブスクリプション1本だけ。
// 依存を増やさないため、Stripe SDK は使わず REST を直接叩く。
import { configured, userFromRequest, rest, json } from '../lib/supabase.mjs'
import { LEGAL, billingReady, yen } from '../lib/legal.mjs'

const form = (obj) => new URLSearchParams(obj).toString()

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  // **表記が揃い、BILLING_ENABLED=1 になるまで課金を受け付けない。** 画面で
  // ボタンを隠すだけだと、APIを直接叩かれたら決済ページに進めてしまう。
  if (!billingReady()) return json(res, 503, { error: 'billing_not_started' })
  if (!configured() || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return json(res, 503, { error: 'not_configured' })
  }

  const user = await userFromRequest(req)
  if (!user) return json(res, 401, { error: 'unauthorized' })

  const origin = req.headers.origin || ('https://' + (req.headers.host || ''))

  try {
    // 既存の顧客IDがあれば使い回す。無ければ Stripe 側で作らせる。
    const members = await rest('members?id=eq.' + user.id + '&select=stripe_customer_id')
    const customer = Array.isArray(members) && members[0] ? members[0].stripe_customer_id : null

    const params = {
      mode: 'subscription',
      'line_items[0][price]': process.env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      success_url: origin + '/?checkout=done',
      cancel_url: origin + '/?checkout=cancel',
      // Webhook で誰の支払いか照合するために、こちらのユーザーIDを載せる。
      'metadata[user_id]': user.id,
      'subscription_data[metadata][user_id]': user.id,
      // 決済ページが最終確認画面になるので、そこに解約の条件を出す（特商法12条の6）。
      'custom_text[submit][message]':
        '月額' + yen(LEGAL.priceMonthlyYen) + '（税込）。申込日から1か月ごとに自動で更新し、そのつど請求します。' +
        'いつでも会員欄の「解約する」から解約でき、解約後も期間の終わりまで使えます。日割りの返金はありません。',
      ...(customer ? { customer } : { customer_email: user.email || '' }),
    }

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form(params),
    })
    const data = await r.json()
    if (!r.ok) return json(res, 502, { error: 'stripe', detail: data.error ? data.error.message : 'unknown' })
    return json(res, 200, { url: data.url })
  } catch (e) {
    return json(res, 500, { error: 'upstream', detail: String(e.message || e) })
  }
}
