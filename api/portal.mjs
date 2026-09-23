// 解約・支払い方法の変更。Stripe のカスタマーポータルへ送る。
//
// **解約の手段を用意しないまま課金を始めない。** 利用規約と特商法の表記で
// 「会員欄の『解約する』から」と書いているのは、この入口のこと。
// Stripe のダッシュボードで Customer portal を一度有効にしておく必要がある。
import { configured, userFromRequest, rest, json } from '../lib/supabase.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  if (!configured() || !process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: 'not_configured' })

  const user = await userFromRequest(req)
  if (!user) return json(res, 401, { error: 'unauthorized' })

  const origin = req.headers.origin || ('https://' + (req.headers.host || ''))

  try {
    const members = await rest('members?id=eq.' + user.id + '&select=stripe_customer_id')
    const customer = Array.isArray(members) && members[0] ? members[0].stripe_customer_id : null
    if (!customer) return json(res, 404, { error: 'no_subscription' })

    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ customer, return_url: origin + '/' }).toString(),
    })
    const data = await r.json()
    if (!r.ok) return json(res, 502, { error: 'stripe', detail: data.error ? data.error.message : 'unknown' })
    return json(res, 200, { url: data.url })
  } catch (e) {
    return json(res, 500, { error: 'upstream', detail: String(e.message || e) })
  }
}
