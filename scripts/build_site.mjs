// 得点を入れると、合格ラインとの距離と判定を出す。**ブラウザの中だけで動く。**
//
// ## スタディングの作りと、どこを変えたか
//
// スタディングのAI実力スコアは「**繰り返し学習した場合**にスコアが高くなる」と
// 明記されている。つまり「できるか」と「やったか」が1つの数字に混ざっていて、
// どちらがどれだけ効いているか利用者に見えない。
//
// 繰り返した人が受かりやすいのは事実だろうが、それは相関であって因果ではない。
// しかも**教材を使うほど数字が上がる**のは、教材提供者に都合がよい。
//
// ここでは**繰り返しを一切加点しない。** 入れた得点だけで判定する。
//
// ## 偏差値と順位を出さない理由
//
// 出すには受験者の得点分布（平均と標準偏差）が要る。
// **宅建も行政書士も、得点分布は公表されていない。**
// 合格率と合格点から逆算しようにも、式が1本で未知数が2つあり解けない。
//
// 仮定を置けば数字は作れるが、**根拠のない偏差値は嘘と同じ**なので出さない。
// 代わりに、仮定なしで言えることだけを出す。
//
//   ・合格点との差              公表された合格点だけで出る
//   ・過去N年で何年合格していたか  同上
//   ・ABCDE                    上の年数で定義する。根拠を1行で説明できる
//   ・合格ラインは上位◯%        公表された合格率そのもの
//
// ## 資格で合格基準の性質が違う
//
//   宅建     相対基準。合格点が毎年動く（31〜38点）
//            → 「過去10年なら何年で合格していたか」が効く
//   行政書士  絶対基準。180点固定。しかも足切りがある
//            → 「180点まであと◯点」と「足切りを超えているか」
//
// **同じ見せ方はできない。** 切り替えられるようにしてある。
//
// 使い方: node scripts/build_site.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, 'dist')
const NEWLINE = String.fromCharCode(10)

// **ドメインはここ1箇所だけで決める。**
const SITE_DOMAIN = process.env.SITE_DOMAIN || ''

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const APP_JS = String.raw`
const EXAMS = __EXAMS__

const $ = (id) => document.getElementById(id)

function judge(exam, score, sectionScores) {
  const out = { rows: [], grade: null, gradeWhy: '', blocked: null }

  if (exam.type === 'absolute') {
    const diff = score - exam.passMark
    out.rows.push({
      label: '合格点との差',
      value: diff >= 0 ? '+' + diff + '点（超えています）' : diff + '点',
      tone: diff >= 0 ? 'good' : 'bad',
    })

    // **足切りは総合点に埋めない。** 総合が足りていても、ここで落ちる。
    for (const cut of exam.cutoffs || []) {
      const got = sectionScores[cut.name]
      if (got === null || got === undefined) continue
      const ok = got >= cut.min
      if (!ok) out.blocked = cut.name
      out.rows.push({
        label: cut.name + 'の足切り',
        value: got + ' / ' + cut.min + '点以上' + (ok ? '（超えています）' : '（**下回っています**）'),
        tone: ok ? 'good' : 'bad',
      })
    }

    if (out.blocked) {
      out.grade = 'E'
      out.gradeWhy = out.blocked + 'が足切りを下回っています。ここを超えないと、総合点が何点でも不合格です。'
    } else if (diff >= 20) { out.grade = 'A'; out.gradeWhy = '合格点を20点以上超えています。' }
    else if (diff >= 0) { out.grade = 'B'; out.gradeWhy = '合格点を超えていますが、余裕は20点未満です。' }
    else if (diff >= -20) { out.grade = 'C'; out.gradeWhy = '合格点まで20点以内です。' }
    else if (diff >= -50) { out.grade = 'D'; out.gradeWhy = '合格点まで20点より離れています。' }
    else { out.grade = 'E'; out.gradeWhy = '合格点まで50点より離れています。' }

    return out
  }

  // 相対基準（宅建）。**公表された合格点だけで判定する。仮定を置かない。**
  const marks = exam.passMarks || []
  const passed = marks.filter((m) => score >= m.mark)
  const years = marks.length

  out.rows.push({
    label: '過去' + years + '年での合否',
    value: passed.length + '年で合格ライン超え（' + years + '年中）',
    tone: passed.length >= years * 0.8 ? 'good' : passed.length ? 'warn' : 'bad',
  })

  const highest = Math.max(...marks.map((m) => m.mark))
  const lowest = Math.min(...marks.map((m) => m.mark))
  out.rows.push({
    label: '合格点の幅',
    value: lowest + '〜' + highest + '点（年によって動きます）',
    tone: '',
  })
  out.rows.push({
    label: 'いちばん高かった年との差',
    value: (score - highest >= 0 ? '+' : '') + (score - highest) + '点（' + highest + '点）',
    tone: score >= highest ? 'good' : 'warn',
  })

  const ratio = years ? passed.length / years : 0
  if (ratio === 1) { out.grade = 'A'; out.gradeWhy = '過去' + years + '年すべてで合格ラインを超えています。' }
  else if (ratio >= 0.8) { out.grade = 'B'; out.gradeWhy = passed.length + '年で合格ラインを超えています。' }
  else if (ratio >= 0.5) { out.grade = 'C'; out.gradeWhy = '半分以上の年で合格ラインを超えています。' }
  else if (ratio > 0) { out.grade = 'D'; out.gradeWhy = passed.length + '年でしか合格ラインを超えていません。' }
  else { out.grade = 'E'; out.gradeWhy = 'どの年でも合格ラインに届いていません。' }

  return out
}

// **模試の分布から偏差値と順位を出す。**
//
// 本試験の得点分布は公表されていないので、本試験での偏差値は出せない。
// ここで出るのは「その模試を受けた人たちの中での位置」だけ。
//
// しかもこの模試は181点以上が27.9%で、本試験の合格率14.54%の約2倍。
// **母集団が本試験受験者より上位に偏っている。** 混同しないよう画面に明記する。
function mockPosition(mock, score) {
  if (!mock || !mock.distribution) return null

  let n = 0
  let sum = 0
  for (const [lo, hi, count] of mock.distribution) {
    n += count
    sum += ((lo + hi) / 2) * count
  }
  if (!n) return null

  const mean = sum / n
  let variance = 0
  for (const [lo, hi, count] of mock.distribution) {
    variance += count * Math.pow((lo + hi) / 2 - mean, 2)
  }
  const sd = Math.sqrt(variance / n)
  if (!sd) return null

  // 順位は、同じ階級に入る人を半分ずつに割って数える。
  let above = 0
  let inside = 0
  for (const [lo, hi, count] of mock.distribution) {
    if (lo > score) above += count
    else if (score >= lo && score <= hi) inside += count
  }
  const rank = Math.max(1, Math.round(above + inside / 2))

  return {
    label: mock.label,
    n,
    mean: Math.round(mean * 10) / 10,
    sd: Math.round(sd * 10) / 10,
    hensachi: Math.round((50 + (10 * (score - mean)) / sd) * 10) / 10,
    rank,
  }
}

function render() {
  const key = $('exam').value
  const exam = EXAMS[key]
  const score = Number($('score').value)
  const box = $('result')

  $('full').textContent = exam.full + exam.unit + '満点'
  $('warnline').textContent = exam.mock
    ? '記述式を含んだ300点満点で入れてください（AI実力スコアの240点満点とは分母が違います）'
    : ''
  $('score').max = exam.full

  if (!$('score').value) {
    box.innerHTML = '<p class="empty">得点を入れると判定が出ます。</p>'
    return
  }
  if (score < 0 || score > exam.full) {
    box.innerHTML = '<p class="empty">0〜' + exam.full + 'の間で入れてください。</p>'
    return
  }

  const sectionScores = {}
  for (const input of document.querySelectorAll('[data-section]')) {
    if (input.value !== '') sectionScores[input.dataset.section] = Number(input.value)
  }

  const result = judge(exam, score, sectionScores)

  const rows = result.rows.map((row) =>
    '<div class="row ' + (row.tone || '') + '"><span class="k">' + row.label + '</span>' +
    '<span class="v">' + row.value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</span></div>').join('')

  const pos = mockPosition(exam.mock, score)
  const mockHtml = pos
    ? '<div class="mock"><p class="mock-head">' + pos.label + 'の中での位置</p>' +
      '<div class="mock-nums"><span><b>' + pos.hensachi + '</b>偏差値</span>' +
      '<span><b>' + pos.rank + '</b>位 / ' + pos.n + '人</span>' +
      '<span><b>' + pos.mean + '</b>点が平均</span>' +
      '<span><b>' + (score - pos.mean >= 0 ? '+' : '') + (Math.round((score - pos.mean) * 10) / 10) +
      '</b>点 平均との差</span></div>' +
      '<p class="mock-warn"><strong>これは本試験での位置ではありません。</strong>' +
      'この模試は181点以上が27.9%で、本試験の合格率14.54%の約2倍です。' +
      '本気の受験生だけが受けている、上位に偏った集団です。</p>' +
      '<p class="mock-warn"><strong>記述式60点を含んだ300点満点で入れてください。</strong>' +
      'スタディングのAI実力スコアは記述式を除いた240点満点なので、' +
      'その数字をそのまま入れると分母が違い、意味のない偏差値が出ます。</p></div>'
    : ''

  box.innerHTML =
    '<div class="grade grade-' + result.grade + '"><span class="letter">' + result.grade + '</span>' +
    '<span class="why">' + result.gradeWhy + '</span></div>' +
    '<div class="rows">' + rows + '</div>' + mockHtml +
    '<p class="rate">この試験の合格率は ' + exam.passRate + '％。' +
    '受験者 ' + exam.applicants.toLocaleString('ja-JP') + '人のうち ' +
    exam.passers.toLocaleString('ja-JP') + '人が合格しています。</p>' +
    (exam.verified ? '' :
      '<p class="unverified"><strong>この数値はまだ公式で確かめていません。</strong>' +
      exam.source + 'の公表資料で確認してください。</p>')
}

// **スコアの推移。** 端末のlocalStorageにだけ置く。サーバには送らない。
// 送らない代わりに、ブラウザを変えると引き継げない。そのことも画面に書く。
var HKEY = 'erabiyori.history.v1'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HKEY) || '[]') } catch (e) { return [] }
}

function saveHistory(list) {
  try { localStorage.setItem(HKEY, JSON.stringify(list)) } catch (e) {}
}

function passLineOf(exam) {
  if (exam.type === 'absolute') return exam.passMark
  var marks = (exam.passMarks || []).map(function (m) { return m.mark })
  return marks.length ? Math.max.apply(null, marks) : null
}

function addRecord() {
  var key = $('exam').value
  if ($('score').value === '') return
  var list = loadHistory()
  list.push({ t: new Date().toISOString().slice(0, 10), exam: key, score: Number($('score').value) })
  saveHistory(list)
  renderHistory()
}

function removeRecord(i) {
  var list = loadHistory()
  var key = $('exam').value
  var nth = -1
  for (var j = 0; j < list.length; j++) {
    if (list[j].exam === key) { nth++; if (nth === i) { list.splice(j, 1); break } }
  }
  saveHistory(list)
  renderHistory()
}

function renderHistory() {
  var key = $('exam').value
  var exam = EXAMS[key]
  var box = $('history-body')
  var list = loadHistory().filter(function (r) { return r.exam === key })

  if (!list.length) {
    box.innerHTML = '<p class="empty">まだ記録がありません。得点を入れて「この端末に記録する」を押すと、ここに推移が出ます。</p>'
    return
  }

  var line = passLineOf(exam)
  var vals = list.map(function (r) { return r.score })
  if (line !== null) vals = vals.concat([line])
  var min = Math.min.apply(null, vals)
  var max = Math.max.apply(null, vals)
  var pad = Math.max(3, (max - min) * 0.15)
  var lo = Math.floor(min - pad)
  var hi = Math.ceil(max + pad)
  var W = 640, H = 210, L = 46, R = 16, T = 18, B = 30
  var x = function (i) { return list.length < 2 ? L : L + ((W - L - R) * i) / (list.length - 1) }
  var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1)) }

  var svg = '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="記録した得点の推移">'
  svg += '<line x1="' + L + '" y1="' + y(lo) + '" x2="' + (W - R) + '" y2="' + y(lo) + '" stroke="#e2e6ef"/>'
  svg += '<line x1="' + L + '" y1="' + y(hi) + '" x2="' + (W - R) + '" y2="' + y(hi) + '" stroke="#e2e6ef"/>'
  svg += '<text x="' + (L - 8) + '" y="' + y(hi) + '" text-anchor="end" dominant-baseline="middle" font-size="10" fill="#9aa2b1">' + hi + '</text>'
  svg += '<text x="' + (L - 8) + '" y="' + y(lo) + '" text-anchor="end" dominant-baseline="middle" font-size="10" fill="#9aa2b1">' + lo + '</text>'
  if (line !== null && line >= lo && line <= hi) {
    svg += '<line x1="' + L + '" y1="' + y(line) + '" x2="' + (W - R) + '" y2="' + y(line) + '" stroke="#b4232c" stroke-dasharray="4 4"/>'
    svg += '<text x="' + (W - R) + '" y="' + (y(line) - 6) + '" text-anchor="end" font-size="10" fill="#b4232c">合格ライン ' + line + '</text>'
  }
  var pts = list.map(function (r, i) { return x(i) + ',' + y(r.score) }).join(' ')
  svg += '<polyline points="' + pts + '" fill="none" stroke="#2b4d7e" stroke-width="2"/>'
  list.forEach(function (r, i) {
    svg += '<circle cx="' + x(i) + '" cy="' + y(r.score) + '" r="4" fill="#2b4d7e"/>'
    svg += '<text x="' + x(i) + '" y="' + (y(r.score) - 11) + '" text-anchor="middle" font-size="11" fill="#1b1f2a">' + r.score + '</text>'
    var anchorX = i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle'
    svg += '<text x="' + x(i) + '" y="' + (H - 9) + '" text-anchor="' + anchorX + '" font-size="10" fill="#9aa2b1">' + r.t + '</text>'
  })
  svg += '</svg>'

  var rows = list.map(function (r, i) {
    var d = line === null ? null : r.score - line
    return '<div class="hrow"><span class="ht">' + r.t + '</span>' +
      '<span class="hs">' + r.score + exam.unit + '</span>' +
      '<span class="hd ' + (d === null ? '' : d >= 0 ? 'good' : 'bad') + '">' +
      (d === null ? '—' : '合格ラインと ' + (d >= 0 ? '+' : '') + d + exam.unit) + '</span>' +
      '<button type="button" class="hdel" data-i="' + i + '">削除</button></div>'
  }).join('')

  var first = list[0].score
  var last = list[list.length - 1].score
  var move = list.length > 1
    ? '<p class="note">最初の記録から <strong>' + (last - first >= 0 ? '+' : '') + (last - first) + exam.unit + '</strong>。'
      + (line === null ? '' : '合格ラインまで残り <strong>' + Math.max(0, line - last) + exam.unit + '</strong>。') + '</p>'
    : ''

  box.innerHTML = svg + '<div class="hlist">' + rows + '</div>' + move

  var dels = box.querySelectorAll('.hdel')
  for (var k = 0; k < dels.length; k++) {
    dels[k].addEventListener('click', function (e) { removeRecord(Number(e.target.dataset.i)) })
  }
}

function buildSections() {
  const exam = EXAMS[$('exam').value]
  const wrap = $('sections')
  const warn = (exam.cutoffs || []).map((c) => c.name)

  wrap.innerHTML = '<p class="sub">科目別（分かる範囲で。空欄でも判定は出ます）</p>' +
    exam.sections.map((s) =>
      '<label class="sec"><span>' + s.name +
      (warn.includes(s.name) ? '<em>足切りあり</em>' : '') + '</span>' +
      '<input type="number" data-section="' + s.name + '" min="0" max="' + s.full +
      '" placeholder="/ ' + s.full + '" /></label>').join('')
}

$('exam').addEventListener('change', () => { buildSections(); render(); renderHistory() })
$('save').addEventListener('click', addRecord)
document.addEventListener('input', render)
buildSections()
render()
renderHistory()
`

const PAGE_CSS = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin:0; font-family:"Hiragino Sans","Yu Gothic",system-ui,sans-serif;
       color:#1b1f2a; background:#f7f8fb; line-height:1.8; }
.wrap { max-width:720px; margin:0 auto; padding:30px 20px 72px; }
h1 { font-size:clamp(21px,4vw,28px); margin:0 0 8px; }
.lead { color:#4b5563; font-size:14px; margin:0 0 24px; }
.card { background:#fff; border:1px solid #e2e6ef; border-radius:10px; padding:20px; margin:0 0 20px; }
label { display:block; font-weight:600; font-size:14px; margin:0 0 8px; }
select, input[type=number] { font:inherit; font-size:16px; padding:10px 12px;
  border:1px solid #d6dbe5; border-radius:8px; background:#fff; color:inherit; width:100%; }
.full { font-size:12px; color:#9aa2b1; margin:6px 0 0; }
.warnline { font-size:12px; color:#b8860b; margin:8px 0 0; font-weight:600; }
.sub { font-size:13px; color:#4b5563; font-weight:600; margin:20px 0 10px; }
.sec { display:flex; align-items:center; gap:10px; margin:0 0 8px; font-weight:400; }
.sec span { flex:1; font-size:14px; }
.sec em { font-style:normal; font-size:11px; color:#b4232c; margin-left:6px; font-weight:600; }
.sec input { width:110px; flex:0 0 auto; }
.grade { display:flex; align-items:center; gap:16px; padding:18px 20px;
         border-radius:10px; margin:0 0 16px; background:#f2f5fa; border:1px solid #e2e6ef; }
.letter { font-size:44px; font-weight:800; line-height:1; }
.why { font-size:14px; color:#4b5563; }
.grade-A .letter { color:#1a7f4b; } .grade-B .letter { color:#2b6cb0; }
.grade-C .letter { color:#b8860b; } .grade-D .letter { color:#c2632b; }
.grade-E .letter { color:#b4232c; }
.rows { border:1px solid #e2e6ef; border-radius:8px; overflow:hidden; background:#fff; }
.row { display:flex; gap:12px; padding:11px 14px; border-bottom:1px solid #eceff5; font-size:14px; }
.row:last-child { border-bottom:0; }
.row .k { color:#4b5563; flex:0 0 42%; }
.row .v { font-weight:600; }
.row.good .v { color:#1a7f4b; } .row.warn .v { color:#b8860b; } .row.bad .v { color:#b4232c; }
.rate { font-size:13px; color:#6b7280; margin:14px 0 0; }
.unverified { font-size:13px; color:#b4232c; margin:10px 0 0;
              border-left:3px solid #b4232c; padding-left:12px; }
.mock { margin:16px 0 0; border:1px solid #e2e6ef; border-radius:8px; background:#fff; padding:16px; }
.mock-head { font-size:13px; font-weight:600; color:#4b5563; margin:0 0 12px; }
.mock-nums { display:flex; gap:22px; flex-wrap:wrap; }
.mock-nums span { font-size:12px; color:#6b7280; display:flex; align-items:baseline; gap:5px; }
.mock-nums b { font-size:26px; color:#2b4d7e; font-weight:800; }
.mock-warn { font-size:12px; color:#6b7280; margin:14px 0 0;
             border-left:3px solid #b8860b; padding-left:11px; line-height:1.7; }
.mock-warn strong { color:#1b1f2a; }
.save { font:inherit; font-size:14px; font-weight:600; padding:10px 16px; margin:12px 0 4px;
        border:1px solid #2b4d7e; border-radius:8px; background:#2b4d7e; color:#fff; cursor:pointer; }
.save:hover { background:#24416c; }
.trend { width:100%; height:auto; margin:14px 0 6px; }
.hlist { border:1px solid #e2e6ef; border-radius:8px; overflow:hidden; background:#fff; }
.hrow { display:flex; align-items:center; gap:12px; padding:9px 12px;
        border-bottom:1px solid #eceff5; font-size:13px; }
.hrow:last-child { border-bottom:0; }
.ht { color:#6b7280; flex:0 0 92px; font-variant-numeric:tabular-nums; }
.hs { font-weight:700; flex:0 0 74px; }
.hd { flex:1; font-size:12px; color:#6b7280; }
.hd.good { color:#1a7f4b; } .hd.bad { color:#b4232c; }
.hdel { font:inherit; font-size:11px; padding:4px 9px; border:1px solid #d6dbe5;
        border-radius:6px; background:#fff; color:#6b7280; cursor:pointer; }
.empty { color:#9aa2b1; font-size:14px; margin:0; }
.note { font-size:13px; color:#6b7280; margin:18px 0 0; }
.note strong { color:#1b1f2a; }`

async function main() {
  const config = JSON.parse(await readFile(path.join(root, 'config', 'exams.json'), 'utf8'))
  const exams = config.exams

  const options = Object.entries(exams)
    .map(([key, exam]) => `<option value="${key}">${escapeHtml(exam.name)}</option>`).join('')

  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>合格ラインとの距離｜宅建・行政書士</title>
    <meta name="description" content="得点を入れると、合格ラインとの距離と判定が出ます。過去の合格点で判定しているので、根拠を1行で説明できます。入力した内容はどこにも送信されません。" />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <h1>合格ラインとの距離</h1>
      <p class="lead">得点を入れると、合格ラインまでの距離と判定が出ます。<br />
        <strong>入力した内容はどこにも送信されません。</strong></p>

      <div class="card">
        <label for="exam">試験</label>
        <select id="exam">${options}</select>

        <label for="score" style="margin-top:18px">いまの得点</label>
        <p class="warnline" id="warnline"></p>
        <input type="number" id="score" min="0" placeholder="点数を入れてください" />
        <p class="full" id="full"></p>

        <div id="sections"></div>
      </div>

      <div id="result"></div>

      <div class="card">
        <label>スコアの推移</label>
        <p class="full">記録は<strong>この端末の中だけ</strong>に残ります。サーバには送りません。
          そのぶん、ブラウザを変えると引き継げません。</p>
        <button type="button" id="save" class="save">この端末に記録する</button>
        <div id="history-body"></div>
      </div>

      <p class="note"><strong>繰り返し解いた回数は、一切加点していません。</strong>
        「何度も繰り返すとスコアが上がる」作りにすると、
        <strong>実力ではなく学習量を測ることになります</strong>。
        ここでは入れた得点だけで判定します。</p>

      <p class="note"><strong>本試験での偏差値と順位は出せません。</strong>
        出すには受験者の得点分布が要りますが、宅建も行政書士も
        <strong>得点分布は公表されていません</strong>。合格率と合格点から逆算しようにも、
        式が1本で未知数が2つあり解けません。根拠のない偏差値は出しません。</p>

      <p class="note">行政書士だけ、<strong>実際の模試の得点分布</strong>を持っているので、
        その中での偏差値と順位を出しています。<strong>ただしその模試は181点以上が27.9%で、
        本試験の合格率14.54%の約2倍です。</strong>母集団が本試験受験者より上位に偏っているので、
        本試験での位置とは別物です。</p>

      <p class="note">代わりに、<strong>公表されている合格点だけで言えること</strong>を出しています。
        判定の根拠は「過去◯年のうち何年で合格ラインを超えたか」で、1行で説明できます。</p>
    </div>
    <script>${APP_JS.replace('__EXAMS__', JSON.stringify(exams))}</script>
  </body>
</html>
`

  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8')
  if (SITE_DOMAIN) await writeFile(path.join(outDir, 'CNAME'), SITE_DOMAIN + NEWLINE, 'utf8')

  const unverified = Object.values(exams).filter((e) => !e.verified).map((e) => e.short)
  console.log(`${Object.keys(exams).length}試験ぶんを書き出しました。`)
  if (unverified.length) {
    console.log(`**まだ公式で確かめていない試験: ${unverified.join('・')}**`)
  }
}

main()
