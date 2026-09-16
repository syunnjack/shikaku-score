// いまログインしている人の会員状態と、保存してある得点を返す。
// **端末をまたぐ記録の引き継ぎは、有料会員の機能。**
import { configured, userFromRequest, rest, json } from '../lib/supabase.mjs'

export default async function handler(req, res) {
  if (!configured()) return json(res, 200, { available: false, reason: 'not_configured' })

  const user = await userFromRequest(req)
  if (!user) return json(res, 401, { error: 'unauthorized' })

  try {
    const members = await rest('members?id=eq.' + user.id + '&select=is_paid')
    const isPaid = Array.isArray(members) && members[0] ? members[0].is_paid === true : false

    // 無料会員には端末をまたぐ記録を返さない。端末内のlocalStorageだけで使ってもらう。
    const scores = isPaid
      ? await rest('scores?user_id=eq.' + user.id + '&select=exam,score,taken_on,shared&order=taken_on.asc')
      : []

    return json(res, 200, { available: true, email: user.email || null, is_paid: isPaid, scores })
  } catch (e) {
    return json(res, 500, { error: 'upstream', detail: String(e.message || e) })
  }
}
