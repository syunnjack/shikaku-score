// 画面側の検算。**判定が正しくても、描画が例外で止まれば画面には出ない。**
// 2026-10-02 に gapHtml が BILLING.available を読んで例外を投げ、
// render() ごと止まっていた。足切りの行も差分分析も画面に出ていなかった。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('scripts/build_site.mjs', 'utf8')
function pick(name) {
  const s = src.indexOf('function ' + name + '(')
  const e = src.indexOf('\nfunction ', s + 10)
  return src.slice(s, e)
}
const exams = JSON.parse(readFileSync('config/exams.json', 'utf8')).exams
const gyosei = { ...exams.gyosei, key: 'gyosei' }

// BILLING と member の状態を変えて、描画を通す。
function build(billing) {
  return new Function(
    'var SECTION_SET={};\n' +
    'var BILLING=' + JSON.stringify(billing) + ';\n' +
    'var member={available:false,signedIn:false,isPaid:false,email:null};\n' +
    ['sectionSets', 'activeSetKey', 'activeSections', 'gapAnalysis', 'judge', 'gapHtml'].map(pick).join('\n') +
    '\nreturn { gapAnalysis, gapHtml, judge, setSet:(k,v)=>{SECTION_SET[k]=v}, setMember:(m)=>{member=m} }'
  )()
}

const SCORES = { '法令等 択一式': 104, '法令等 多肢選択式': 16, '法令等 記述式': 24, '基礎知識': 24 }

test('課金を開いていない（BILLING=null）ときも描画が例外を投げない', () => {
  const M = build(null)
  M.setSet('gyosei', 'format')
  const g = M.gapAnalysis(gyosei, 168, SCORES)
  let html
  assert.doesNotThrow(() => { html = M.gapHtml(g, gyosei) })
  assert.match(html, /合格レベルとの差分/)
})

test('課金を開いていないときは、全形式の内訳を出す（囲いを出さない）', () => {
  const M = build(null)
  M.setSet('gyosei', 'format')
  const html = M.gapHtml(M.gapAnalysis(gyosei, 168, SCORES), gyosei)
  assert.match(html, /法令等 記述式/)
  assert.match(html, /基礎知識/)
  assert.ok(!/有料会員で見られます/.test(html), '課金を開いていないのに囲いが出ている')
})

test('課金を開いたら、2件目以降を囲う', () => {
  const M = build({ planName: '有料会員（月額）', price: '980円', features: ['a', 'b'] })
  M.setSet('gyosei', 'format')
  const html = M.gapHtml(M.gapAnalysis(gyosei, 168, SCORES), gyosei)
  assert.match(html, /法令等 記述式/, '先頭1件は無料で出す')
  assert.match(html, /有料会員で見られます/, '2件目以降が囲われていない')
})

test('有料会員なら、開いていても全部見える', () => {
  const M = build({ planName: 'x', price: 'y', features: [] })
  M.setMember({ available: true, signedIn: true, isPaid: true, email: 'a@b.c' })
  M.setSet('gyosei', 'format')
  const html = M.gapHtml(M.gapAnalysis(gyosei, 168, SCORES), gyosei)
  assert.ok(!/有料会員で見られます/.test(html))
  assert.match(html, /基礎知識/)
})

test('差分が無いときも例外を投げない', () => {
  const M = build(null)
  M.setSet('gyosei', 'format')
  const g = M.gapAnalysis(gyosei, 220, { '法令等 択一式': 130, '法令等 多肢選択式': 20, '法令等 記述式': 40, '基礎知識': 40 })
  let html
  assert.doesNotThrow(() => { html = M.gapHtml(g, gyosei) })
  assert.match(html, /すべて基準線に届いています/)
})

test('セクション未入力なら差分分析は出ない', () => {
  const M = build(null)
  M.setSet('gyosei', 'format')
  assert.equal(M.gapAnalysis(gyosei, 168, {}), null)
  assert.equal(M.gapHtml(null, gyosei), '')
})
