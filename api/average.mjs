// 会員平均を返す。**個票は返さない。集計値だけ。**
//
// 人数が30人未満のときは平均を返さない。少人数の自己申告平均は、
// 数人の増減で大きく動くうえ検証できない。**根拠のない数字は出さない**という
// このサイトの方針に、会員平均も従わせる。判定はSQL関数側でも二重に止めてある。
import { configured, rest, json } from '../lib/supabase.mjs'

const MIN_N = 30

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' })

  const exam = String(req.query.exam || '')
  if (exam !== 'takken' && exam !== 'gyosei') return json(res, 400, { error: 'bad_exam' })

  // 未接続のうちは、機能が無いものとして扱う。嘘の数字は返さない。
  if (!configured()) return json(res, 200, { available: false, reason: 'not_configured' })

  try {
    const rows = await rest('rpc/member_average', { method: 'POST', body: { target_exam: exam } })
    const row = Array.isArray(rows) ? rows[0] : rows
    const n = Number(row && row.n) || 0
    if (n < MIN_N) {
      return json(res, 200, { available: false, reason: 'not_enough', n, min: MIN_N })
    }
    return json(res, 200, {
      available: true,
      n,
      mean: Number(row.mean),
      median: Number(row.median),
      note: '会員が自己申告した得点の平均です。本試験の受験者全体の平均ではありません。',
    })
  } catch (e) {
    return json(res, 500, { error: 'upstream', detail: String(e.message || e) })
  }
}
