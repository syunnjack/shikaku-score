// 予想問題の検算。**根拠を書けない問題を混ぜない。**
// 条文そのものは e-Gov の原文で確かめる（scratchpad の arts.py）。ここでは
// データとして壊れていないことと、方針から外れていないことを守る。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = 'config/questions'
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

test('問題ファイルが1つ以上ある', () => {
  assert.ok(files.length > 0)
})

for (const f of files) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))

  test(`${f}: 配点が本試験と同じ300点になる`, () => {
    const total = d.scoring.formats.reduce((a, x) => a + x.full, 0)
    assert.equal(total, 300, '分母がずれると判定の意味が無くなる')
  })

  test(`${f}: 記述式は自動採点しない`, () => {
    const k = d.scoring.formats.find((x) => x.key === 'kijutsu')
    assert.equal(k.auto, false, '40字記述を機械で採点してはいけない')
  })

  test(`${f}: すべての問題に根拠がある`, () => {
    for (const q of d.questions) {
      assert.ok(q.source && q.source.trim(), `${q.id} に根拠が無い`)
      assert.match(q.source, /条|憲法|判例/, `${q.id} の根拠が条文番号の形でない: ${q.source}`)
      assert.ok(q.explain && q.explain.length >= 40, `${q.id} の解説が短い`)
    }
  })

  test(`${f}: 正解が選択肢の範囲に入っている`, () => {
    for (const q of d.questions) {
      assert.ok(Array.isArray(q.choices) && q.choices.length >= 4, `${q.id} の選択肢が少ない`)
      assert.ok(Number.isInteger(q.answer), `${q.id} の正解が整数でない`)
      assert.ok(q.answer >= 1 && q.answer <= q.choices.length, `${q.id} の正解が範囲外`)
    }
  })

  test(`${f}: idが重複していない`, () => {
    const ids = d.questions.map((q) => q.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  test(`${f}: 選択肢が重複していない`, () => {
    for (const q of d.questions) {
      assert.equal(new Set(q.choices).size, q.choices.length, `${q.id} に同じ選択肢がある`)
    }
  })

  test(`${f}: cutoffGroup が法令等か基礎知識のどちらか`, () => {
    for (const q of d.questions) {
      assert.ok(['法令等', '基礎知識'].includes(q.cutoffGroup), `${q.id}: ${q.cutoffGroup}`)
    }
  })

  test(`${f}: 繰り返し・学習時間に関する項目を持たない`, () => {
    const s = readFileSync(`${dir}/${f}`, 'utf8')
    for (const ng of ['"repeat"', '"studyHours"', '"progress"', '"history"', '"streak"']) {
      assert.ok(!s.includes(ng), `${ng} を持ってはいけない`)
    }
  })
}
