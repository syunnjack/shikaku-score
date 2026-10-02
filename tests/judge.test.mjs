// 判定の検算。**公表された合格点と足切りだけで決まることを守る。**
// 本人の本試験4回ぶんの実績を使う（gyosei-weakness-note）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('scripts/build_site.mjs', 'utf8')
const start = src.indexOf('function judge(')
const end = src.indexOf('\nfunction ', start + 10)
const judge = new Function(src.slice(start, end) + '\nreturn judge')()

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
  const r = judge(gyosei, 190, { '法令等': 150, '基礎知識': 20 })
  assert.equal(r.grade, 'E')
  assert.equal(r.blocked, '基礎知識')
  assert.match(r.gradeWhy, /総合点が何点でも不合格/)
})

test('法令等122点未満でもE', () => {
  const r = judge(gyosei, 190, { '法令等': 120, '基礎知識': 30 })
  assert.equal(r.grade, 'E')
  assert.equal(r.blocked, '法令等')
})

test('足切りを両方超えていればブロックしない', () => {
  const r = judge(gyosei, 190, { '法令等': 130, '基礎知識': 28 })
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
