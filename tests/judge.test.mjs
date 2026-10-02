// 判定の検算。**公表された合格点と足切りだけで決まることを守る。**
// 本人の本試験4回ぶんの実績を使う（gyosei-weakness-note）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('scripts/build_site.mjs', 'utf8')
function pick(name) {
  const s = src.indexOf('function ' + name + '(')
  const e = src.indexOf('\nfunction ', s + 10)
  return src.slice(s, e)
}
// judge は activeSections（＝SECTION_SET の状態）に依存する。
// 科目別/形式別を切り替えて両方を検査するため、まとめて読み込む。
const M = new Function(
  'var SECTION_SET={};\n' +
  ['sectionSets', 'activeSetKey', 'activeSections', 'gapAnalysis', 'judge'].map(pick).join('\n') +
  '\nreturn { judge, gapAnalysis, activeSections, setSet: (k, v) => { SECTION_SET[k] = v } }'
)()
const judge = M.judge

const exams = JSON.parse(readFileSync('config/exams.json', 'utf8')).exams
const gyosei = exams.gyosei
const takken = exams.takken

test('公式の数値が確認済みになっている', () => {
  assert.equal(gyosei.verified, true)
  assert.equal(takken.verified, true)
  assert.equal(gyosei.passers, 7292)
  assert.equal(gyosei.applicants, 50163)
  assert.equal(takken.passers, 45821)
  assert.equal(takken.applicants, 245462)
  assert.ok(gyosei.sourceUrl.startsWith('https://gyosei-shiken.or.jp/'))
  assert.ok(takken.sourceUrl.startsWith('https://www.retio.or.jp/'))
})

test('行政書士 180点ちょうどは合格側', () => {
  const r = judge(gyosei, 180, {})
  assert.equal(r.grade, 'B')
  assert.match(r.rows[0].value, /\+0点/)
})

test('行政書士 200点はA', () => {
  assert.equal(judge(gyosei, 200, {}).grade, 'A')
})

test('行政書士 168点（令和6年度の実績）はC', () => {
  const r = judge(gyosei, 168, {})
  assert.equal(r.grade, 'C')
  assert.match(r.rows[0].value, /-12点/)
})

test('総合が足りていても基礎知識が24点未満ならE', () => {
  M.setSet('gyosei', 'format')
  const r = judge({ ...gyosei, key: 'gyosei' }, 190,
    { '法令等 択一式': 110, '法令等 多肢選択式': 20, '法令等 記述式': 40, '基礎知識': 20 })
  assert.equal(r.grade, 'E')
  assert.equal(r.blocked, '基礎知識')
  assert.match(r.gradeWhy, /総合点が何点でも不合格/)
})

// 「法令等」という名前の入力欄は存在しない。区分名を直接渡す書き方は、
// 直す前の壊れた挙動を前提にしていた。合算で判定する形に直した。
test('法令等が122点未満ならE（区分の合計で見る）', () => {
  M.setSet('gyosei', 'format')
  const r = judge({ ...gyosei, key: 'gyosei' }, 150,
    { '法令等 択一式': 80, '法令等 多肢選択式': 10, '法令等 記述式': 30, '基礎知識': 30 })
  assert.equal(r.blocked, '法令等')
  assert.equal(r.grade, 'E')
})

test('足切りを両方超えていればブロックしない', () => {
  M.setSet('gyosei', 'format')
  const r = judge({ ...gyosei, key: 'gyosei' }, 190,
    { '法令等 択一式': 110, '法令等 多肢選択式': 16, '法令等 記述式': 36, '基礎知識': 28 })
  assert.equal(r.blocked, null)
  assert.equal(r.grade, 'B')
})

test('宅建は公表された合格点だけで数える', () => {
  const marks = takken.passMarks.map((m) => m.mark)
  assert.equal(marks.length, 10)
  // 10年の合格点は 33〜38 点
  assert.equal(Math.min(...marks), 33)
  assert.equal(Math.max(...marks), 38)

  const r38 = judge(takken, 38, {})
  assert.match(r38.rows[0].value, /10年で合格ライン超え/)

  const r33 = judge(takken, 33, {})
  assert.match(r33.rows[0].value, /1年で合格ライン超え/)

  const r32 = judge(takken, 32, {})
  assert.match(r32.rows[0].value, /0年で合格ライン超え/)
})

test('繰り返し・学習時間は受け取らない', () => {
  // judge の引数は (exam, score, sectionScores) の3つだけ
  assert.equal(judge.length, 3)
  const keys = Object.keys(JSON.parse(readFileSync('config/exams.json', 'utf8')).exams.gyosei)
  for (const ng of ['repeat', 'studyHours', 'progress', 'history']) {
    assert.ok(!keys.includes(ng), `${ng} を設定に持ってはいけない`)
  }
})

// ---- 足切りは区分の合計で判定する（2026-10-02 に直した）----
// 「法令等」という入力欄は存在しない。科目別なら5科目、形式別なら
// 択一+多肢+記述の合計がそれに当たる。区分名を直接引くと一度も判定されない。

const G = { ...gyosei, key: 'gyosei' }

test('形式別：法令等の足切りを3区分の合計で判定する', () => {
  M.setSet('gyosei', 'format')
  const r = judge(G, 168, { '法令等 択一式': 104, '法令等 多肢選択式': 16, '法令等 記述式': 24, '基礎知識': 24 })
  const row = r.rows.find((x) => x.label === '法令等の足切り')
  assert.ok(row, '法令等の足切りの行が出ていない')
  assert.match(row.value, /^144 \/ 122点以上（3区分の合計）（超えています）/)
  assert.equal(r.blocked, null)
})

test('形式別：法令等の合計が122点未満ならE', () => {
  M.setSet('gyosei', 'format')
  const r = judge(G, 130, { '法令等 択一式': 70, '法令等 多肢選択式': 10, '法令等 記述式': 20, '基礎知識': 30 })
  assert.equal(r.blocked, '法令等')
  assert.equal(r.grade, 'E')
  assert.match(r.rows.find((x) => x.label === '法令等の足切り').value, /下回っています/)
})

test('科目別：法令等の足切りを5区分の合計で判定する', () => {
  M.setSet('gyosei', 'subject')
  const r = judge(G, 172, { '基礎法学': 4, '憲法': 16, '民法': 44, '行政法': 60, '商法・会社法': 28, '基礎知識': 20 })
  assert.match(r.rows.find((x) => x.label === '法令等の足切り').value, /^152 \/ 122点以上（5区分の合計）/)
  assert.equal(r.blocked, '基礎知識')
})

test('一部だけ入力したときは足切りを判定しない', () => {
  M.setSet('gyosei', 'format')
  const r = judge(G, 104, { '法令等 択一式': 104 })
  const row = r.rows.find((x) => x.label === '法令等の足切り')
  assert.match(row.value, /未判定（3区分のうち1件しか入っていません）/)
  assert.equal(r.blocked, null, '入れ忘れを足切り割れと誤報してはいけない')
})

test('差分分析が不足している形式を拾う', () => {
  M.setSet('gyosei', 'format')
  const g = M.gapAnalysis(G, 168, { '法令等 択一式': 104, '法令等 多肢選択式': 16, '法令等 記述式': 24, '基礎知識': 24 })
  assert.equal(g.short.length, 2, '記述と基礎知識の2件が不足のはず')
  assert.equal(g.short[0].name, '法令等 記述式')
  assert.equal(g.short[0].gap, 12)
  assert.equal(g.short[1].name, '基礎知識')
  assert.equal(g.short[1].gap, 9.6)
})

test('全区分が cutoffGroup を持っている', () => {
  for (const [key, set] of Object.entries(gyosei.sectionSets)) {
    const sum = {}
    for (const s of set.sections) {
      assert.ok(s.cutoffGroup, `${key}/${s.name} に cutoffGroup が無い`)
      sum[s.cutoffGroup] = (sum[s.cutoffGroup] || 0) + s.full
    }
    for (const c of gyosei.cutoffs) {
      assert.equal(sum[c.name], c.full, `${key} の ${c.name} の合計が ${c.full} にならない`)
    }
  }
})
