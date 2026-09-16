// 得点を保存する。**本人の分だけ。提供はオプトイン。**
//
// shared を true にできるのは、画面で明示的にオンにした場合だけ。
// 既定は false で、false のまま保存された行は会員平均に入らない。
import { configured, userFromRequest, rest, json } from '../lib/supabase.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  if (!configured()) return json(res, 503, { error: 'not_configured' })

  const user = await userFromRequest(req)
  if (!user) return json(res, 401, { error: 'unauthorized' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const exam = String(body.exam || '')
  const score = Number(body.score)
  const shared = body.shared === true
  const takenOn = typeof body.taken_on === 'string' ? body.taken_on : undefined

  if (exam !== 'takken' && exam !== 'gyosei') return json(res, 400, { error: 'bad_exam' })
  if (!Number.isFinite(score) || score < 0 || score > 300) return json(res, 400, { error: 'bad_score' })

  try {
    const rows = await rest('scores', {
      method: 'POST',
      prefer: 'return=representation',
      body: [{
        user_id: user.id,
        exam,
        score: Math.round(score),
        sections: body.sections && typeof body.sections === 'object' ? body.sections : null,
        shared,
        ...(takenOn ? { taken_on: takenOn } : {}),
      }],
    })
    return json(res, 200, { ok: true, id: Array.isArray(rows) && rows[0] ? rows[0].id : null, shared })
  } catch (e) {
    return json(res, 500, { error: 'upstream', detail: String(e.message || e) })
  }
}
