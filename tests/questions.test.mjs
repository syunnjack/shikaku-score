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
      // 根拠は条文番号が原則。条文を持たない分野（情報通信・一般知識）は
      // 「一般的な〜」の形で、何に基づくかを明示する。**空は許さない。**
      assert.match(q.source, /条|憲法|判例|一般的な|法令の/, `${q.id} の根拠が形式外: ${q.source}`)
      assert.ok(q.explain && q.explain.length >= 40, `${q.id} の解説が短い`)
    }
  })

  test(`${f}: 正解が選択肢の範囲に入っている`, () => {
    for (const q of d.questions.filter((x) => x.format === 'takuitsu')) {
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
    for (const q of d.questions.filter((x) => x.format === 'takuitsu')) {
      assert.equal(new Set(q.choices).size, q.choices.length, `${q.id} に同じ選択肢がある`)
    }
  })

  test(`${f}: cutoffGroup が法令等か基礎知識のどちらか`, () => {
    for (const q of d.questions) {
      assert.ok(['法令等', '基礎知識'].includes(q.cutoffGroup), `${q.id}: ${q.cutoffGroup}`)
    }
  })


  test(`${f}: 形式ごとの合計が配点と一致する`, () => {
    // 択一式は法令等と基礎知識の両方にある。**混ぜて数えない。**
    // 法令等の択一40問×4=160、基礎知識14問×4=56。
    const sum = (fn) => d.questions.filter(fn).reduce((a, q) => a + q.points, 0)
    assert.equal(sum((q) => q.format === 'takuitsu' && q.cutoffGroup === '法令等'), 160)
    assert.equal(sum((q) => q.format === 'tashi'), 24)
    assert.equal(sum((q) => q.format === 'kijutsu'), 60)
    const kiso = d.questions.filter((q) => q.cutoffGroup === '基礎知識')
      .reduce((a, q) => a + q.points, 0)
    assert.equal(kiso, 56)
    const hou = d.questions.filter((q) => q.cutoffGroup === '法令等')
      .reduce((a, q) => a + q.points, 0)
    assert.equal(hou, 244, '法令等の合計が足切りの分母244にならない')
  })

  test(`${f}: 多肢選択式は空欄4つ×2点`, () => {
    for (const q of d.questions.filter((x) => x.format === 'tashi')) {
      assert.equal(q.blanks.length, 4, `${q.id} の空欄が4つでない`)
      assert.equal(q.points, 8)
      for (const b of q.blanks) {
        assert.ok(b.answer >= 1 && b.answer <= b.choices.length, `${q.id}/${b.label} の正解が範囲外`)
        assert.equal(new Set(b.choices).size, b.choices.length, `${q.id}/${b.label} に同じ選択肢`)
      }
    }
  })

  test(`${f}: 記述式は自動採点せず、模範解答を持つ`, () => {
    const ks = d.questions.filter((x) => x.format === 'kijutsu')
    assert.equal(ks.length, 3)
    for (const q of ks) {
      assert.equal(q.auto, false, `${q.id} を自動採点してはいけない`)
      assert.ok(q.modelAnswer && q.modelAnswer.length >= 20, `${q.id} に模範解答が無い`)
      assert.ok(!q.choices, `${q.id} に選択肢があってはいけない`)
    }
  })

  test(`${f}: 繰り返し・学習時間に関する項目を持たない`, () => {
    const s = readFileSync(`${dir}/${f}`, 'utf8')
    for (const ng of ['"repeat"', '"studyHours"', '"progress"', '"history"', '"streak"']) {
      assert.ok(!s.includes(ng), `${ng} を持ってはいけない`)
    }
  })
}
