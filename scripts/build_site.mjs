// 得点を入れると、合格ラインとの距離と判定を出す。**ブラウザの中だけで動く。**
//
// ## 設計の前提
//
// **入力された得点だけで判定する。**
// 学習履歴・解答回数・教材の消化率は受け取らないし、加点もしない。
//
// 「何回やったか」を点数に混ぜると、**「できるか」と「やったか」が1つの数字になり、
// どちらがどれだけ効いているか利用者に見えない。**
// 繰り返した人が受かりやすいのは相関であって因果ではない。
//
// **推定も予測もしない。** 出すのは、入れた得点と公表値を突き合わせた結果だけ。
//
// 資格講座のAI採点・実力推定には特許が成立しているものがある。
// **このツールは解答履歴を持たず、復習の順番を決めず、将来の点数を予測しない。**
// 「AI」とも名乗らない。この範囲を出るときは、先に特許を調べる。
//
// ## 偏差値と順位を出さない理由
//
// 出すには受験者の得点分布（平均と標準偏差）が要る。
// **宅建も行政書士も、得点分布は公表されていない。**
// 合格率と合格点から逆算しようにも、式が1本で未知数が2つあり解けない。
//
// 仮定を置けば数字は作れるが、**根拠のない偏差値は嘘と同じ**なので出さない。
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
import { LEGAL, PLAN, missingLegal, billingEnabledFlag, billingReady, yen } from '../lib/legal.mjs'
import { legalPages } from './legal_pages.mjs'

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

const SUPABASE_PUBLIC = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? { url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY }
  : null

// 課金の案内を画面に出すのは、表記が揃い BILLING_ENABLED=1 のときだけ。
// 値はビルド時に埋め込むので、HTMLとして安全な形にしてから渡す。
const LEGAL_MISSING = missingLegal()
const LEGAL_READY = LEGAL_MISSING.length === 0
const BILLING_PUBLIC = billingReady()
  ? { planName: escapeHtml(PLAN.name), price: escapeHtml(yen(LEGAL.priceMonthlyYen)), features: PLAN.features.map(escapeHtml) }
  : null

const APP_JS = String.raw`
const EXAMS = __EXAMS__
const SUPABASE = __SUPABASE__
const BILLING = __BILLING__

const $ = (id) => document.getElementById(id)



// **内訳は「科目別」と「形式別」を切り替えられる。**
// 差分分析は形式別のほうが効く。科目を8点上げるのと、記述式を8点上げるのでは
// 手の打ち方がまるで違うため。設定が無い試験は、従来どおり sections をそのまま使う。
var SECTION_SET = {}

function sectionSets(exam) { return exam.sectionSets || null }

function activeSetKey(exam) {
  const sets = sectionSets(exam)
  if (!sets) return null
  const k = SECTION_SET[exam.key]
  return (k && sets[k]) ? k : (exam.defaultSectionSet || Object.keys(sets)[0])
}

function activeSections(exam) {
  const sets = sectionSets(exam)
  if (!sets) return exam.sections || []
  const k = activeSetKey(exam)
  return (sets[k] && sets[k].sections) || exam.sections || []
}

// **差分分析。** 解答した1回ぶんの得点と、合格レベルとの距離を形式ごとに出す。
//
// ## 何を「合格レベル」と置くか
//
// **形式ごとの合格者得点は公表されていない。** だから「合格者はここで何点」とは書かない。
// 代わりに、公表されている合格点から必要得点率を出し、**その率を全形式に当てた場合**を
// 基準線にする。これは仮定ではなく定義で、画面にもそう書く。
//
//   必要得点率 = 合格点 ÷ 満点        行政書士なら 180 ÷ 300 = 60.0%
//   基準線     = 各形式の満点 × 必要得点率
//   差分       = 基準線 − 得点        （プラスなら足りていない）
//
// **足切りのある形式は、基準線と足切りの高いほうを使う。**
// 基礎知識は 56×60% = 33.6点 が基準線で、足切り24点より高い。低いほうに合わせない。
//
// ## 並べる順番
//
// **差分の大きい順。** 「いちばん苦手な形式」ではなく「いちばん点が落ちている形式」を上に出す。
// 満点8点の科目を0点から満点にしても8点しか増えないが、満点60点の形式で
// 20点足りなければ20点ぶんの余地がある。**得点率ではなく点数で並べる。**
function gapAnalysis(exam, score, sectionScores) {
  if (exam.type !== 'absolute' || !exam.passMark) return null
  const sections = activeSections(exam)
  if (!sections.length) return null

  const need = exam.passMark / exam.full
  const cutMap = {}
  for (const c of exam.cutoffs || []) cutMap[c.name] = c.min

  const items = []
  for (const s of sections) {
    const got = sectionScores[s.name]
    if (got === null || got === undefined) continue
    const line = Math.max(Math.round(s.full * need * 10) / 10, cutMap[s.name] || 0)
    const gap = Math.round((line - got) * 10) / 10
    items.push({
      name: s.name,
      got: got,
      full: s.full,
      line: line,
      gap: gap,
      rate: Math.round((got / s.full) * 1000) / 10,
      byCutoff: (cutMap[s.name] || 0) > Math.round(s.full * need * 10) / 10,
    })
  }
  if (!items.length) return null

  const entered = items.reduce(function (a, i) { return a + i.got }, 0)
  const short = items.filter(function (i) { return i.gap > 0 })
  short.sort(function (a, b) { return b.gap - a.gap })

  const totalGap = Math.round(short.reduce(function (a, i) { return a + i.gap }, 0) * 10) / 10
  const totalShort = Math.round((exam.passMark - score) * 10) / 10

  // **1つだけ直して届くか。** 上位1件の差分を埋めたときに合格点に乗るかどうか。
  const top = short[0] || null
  const oneEnough = top && totalShort > 0 ? top.gap >= totalShort : false

  return {
    need: Math.round(need * 1000) / 10,
    items: items,
    short: short,
    totalGap: totalGap,
    totalShort: totalShort,
    entered: entered,
    covered: Math.round((entered / exam.full) * 1000) / 10,
    top: top,
    oneEnough: oneEnough,
  }
}

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
    ? '記述式を含んだ300点満点で入れてください（記述式を除いた240点満点の数字とは分母が違います）'
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
      '記述式を除いた240点満点の数字を入れると分母が違い、意味のない偏差値が出ます。</p></div>'
    : ''

  const gapBox = gapHtml(gapAnalysis(exam, score, sectionScores), exam)

  box.innerHTML =
    '<div class="grade grade-' + result.grade + '"><span class="letter">' + result.grade + '</span>' +
    '<span class="why">' + result.gradeWhy + '</span></div>' +
    '<div class="rows">' + rows + '</div>' + gapBox + mockHtml +
    '<p class="rate">この試験の合格率は ' + exam.passRate + '％。' +
    '受験者 ' + exam.applicants.toLocaleString('ja-JP') + '人のうち ' +
    exam.passers.toLocaleString('ja-JP') + '人が合格しています。</p>' +
    (exam.verified ? '' :
      '<p class="unverified"><strong>この数値はまだ公式で確かめていません。</strong>' +
      exam.source + 'の公表資料で確認してください。</p>')
}



// 差分分析の描画。**無料は先頭1件だけ。全形式の内訳と優先順位は有料会員。**
// 無料でも「どこが一番落ちているか」は分かる。**有料は、そこから何をどの順で
// 埋めれば合格点に届くかが全形式ぶん出る。**
function gapHtml(g, exam) {
  if (!g) return ''

  const head = '<div class="gap"><p class="gap-head">合格レベルとの差分</p>' +
    '<p class="gap-def">基準線は <b>各形式の満点 × ' + g.need + '%</b>（合格点' +
    exam.passMark + ' ÷ 満点' + exam.full + '）です。' +
    '<strong>形式ごとの合格者得点は公表されていないため、合格者の点は書きません。</strong>' +
    '足切りのある形式は、基準線と足切りの高いほうを使います。</p>'

  if (!g.short.length) {
    return head + '<p class="gap-ok"><strong>入れた形式は、すべて基準線に届いています。</strong></p></div>'
  }

  const row = function (i, rank) {
    return '<div class="gap-row"><span class="gap-rank">' + rank + '</span>' +
      '<span class="gap-name">' + i.name + (i.byCutoff ? '<em>足切り基準</em>' : '') + '</span>' +
      '<span class="gap-num"><b>' + i.gap + '</b>点 不足</span>' +
      '<span class="gap-sub">' + i.got + ' / ' + i.full + '点（' + i.rate + '%）　基準線 ' + i.line + '点</span>' +
      '<span class="gap-bar"><i style="width:' + Math.min(100, Math.round((i.got / i.line) * 100)) + '%"></i></span></div>'
  }

  const first = row(g.short[0], 1)
  const rest = g.short.slice(1).map(function (i, n) { return row(i, n + 2) }).join('')

  const verdict = g.totalShort > 0
    ? '<p class="gap-verdict">合格点まで <b>' + g.totalShort + '</b>点。' +
      (g.oneEnough
        ? '<strong>' + g.top.name + 'を基準線まで戻すだけで届きます。</strong>'
        : '<strong>1つ埋めるだけでは届きません。</strong>上から順に埋めた場合、' +
          '合計 ' + g.totalGap + '点ぶんの余地があります。') + '</p>'
    : '<p class="gap-verdict">総合では合格点を超えています。上の不足は、崩れたときに効く場所です。</p>'

  const locked = (member.isPaid || !BILLING.available)
    ? rest
    : (rest ? '<div class="gap-lock"><p><strong>残り ' + (g.short.length - 1) + ' 形式の内訳と、埋める順番は有料会員で見られます。</strong></p></div>' : '')

  return head + verdict + '<div class="gap-rows">' + first + locked + '</div>' +
    '<p class="gap-note"><strong>この分析は、入れた得点だけを使っています。</strong>' +
    '解答の回数や学習時間は受け取っていません。推定も予測もしていません。</p></div>'
}

// **会員機能。** 接続情報が無ければ、この節は何もしない。
// 未接続のうちは会員カードを出さず、判定・推移・模試分布だけが動く。
var TOKEN_KEY = 'erabiyori.token.v1'
var member = { available: false, signedIn: false, isPaid: false, email: null }

function token() { try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' } }
function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch (e) {}
}

// マジックリンクから戻ると、URLの # にトークンが乗っている。拾って消す。
function captureToken() {
  var m = location.hash && location.hash.match(/access_token=([^&]+)/)
  if (!m) return
  setToken(decodeURIComponent(m[1]))
  history.replaceState(null, '', location.pathname + location.search)
}

function authHeaders() {
  var t = token()
  return t ? { Authorization: 'Bearer ' + t } : {}
}

async function loadMember() {
  if (!SUPABASE) return
  try {
    var r = await fetch('/api/me', { headers: authHeaders() })
    if (r.status === 401) { member = { available: true, signedIn: false, isPaid: false, email: null }; return }
    var d = await r.json()
    if (!d.available) return
    member = { available: true, signedIn: true, isPaid: d.is_paid === true, email: d.email }
  } catch (e) { /* 未接続とみなす */ }
}

async function signIn(email) {
  var r = await fetch(SUPABASE.url + '/auth/v1/otp', {
    method: 'POST',
    headers: { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, options: { email_redirect_to: location.origin + '/' } }),
  })
  return r.ok
}

async function loadAverage(exam) {
  try {
    var r = await fetch('/api/average?exam=' + encodeURIComponent(exam))
    return await r.json()
  } catch (e) { return { available: false, reason: 'error' } }
}

// 会員平均との差を出す。**30人に満たないうちは平均を出さない。**
async function renderMemberAverage() {
  var box = $('member-average')
  if (!box) return
  var exam = $('exam').value
  var score = Number($('score').value)
  var d = await loadAverage(exam)

  if (!d.available && d.reason === 'not_configured') { box.innerHTML = ''; return }
  if (!d.available && d.reason === 'not_enough') {
    box.innerHTML = '<p class="mock-warn"><strong>会員平均はまだ出せません。</strong>' +
      'いまの提供者は ' + (d.n || 0) + ' 人で、' + (d.min || 30) + ' 人に達していません。' +
      '少人数の平均は数人の増減で大きく動くので、そろうまで出しません。</p>'
    return
  }
  if (!d.available) { box.innerHTML = ''; return }

  var diff = $('score').value === '' ? null : Math.round((score - d.mean) * 10) / 10
  box.innerHTML = '<div class="mock"><p class="mock-head">会員平均の中での位置</p>' +
    '<div class="mock-nums"><span><b>' + d.mean + '</b>点が会員平均</span>' +
    '<span><b>' + d.median + '</b>点が中央値</span>' +
    '<span><b>' + d.n + '</b>人</span>' +
    (diff === null ? '' : '<span><b>' + (diff >= 0 ? '+' : '') + diff + '</b>点 会員平均との差</span>') +
    '</div><p class="mock-warn"><strong>' + d.note + '</strong>自己申告なので検証はできません。' +
    '本試験の受験者全体の平均でもありません。</p></div>'
}

function renderMember() {
  var box = $('member-body')
  if (!box) return
  if (!SUPABASE) { $('member-card').hidden = true; return }
  $('member-card').hidden = false

  if (!member.signedIn) {
    box.innerHTML = '<p class="full">メールを入れると、ログイン用のリンクが届きます。パスワードはありません。</p>' +
      '<input type="email" id="email" placeholder="メールアドレス" />' +
      '<button type="button" id="signin" class="save">ログインリンクを送る</button>' +
      '<p class="full" id="signin-msg"></p>'
    $('signin').addEventListener('click', async function () {
      var v = $('email').value.trim()
      if (!v) return
      $('signin-msg').textContent = '送信中…'
      var ok = await signIn(v)
      $('signin-msg').textContent = ok ? 'メールを送りました。届いたリンクを開いてください。' : '送れませんでした。もう一度お試しください。'
    })
    return
  }

  box.innerHTML = '<p class="full">' + (member.email || '') +
    (member.isPaid ? '（有料会員）' : '（無料会員）') + '</p>' +
    '<label class="sec" style="font-weight:400"><input type="checkbox" id="share" style="width:auto" />' +
    '<span>会員平均に、自分の得点を提供する</span></label>' +
    '<p class="full">下のボタンを押したときだけ、得点がサーバに保存されます。' +
    '会員平均の集計に入るのは、提供をオンにして保存した得点だけです。</p>' +
    '<button type="button" id="push" class="save">いまの得点をアカウントに保存する</button>' +
    '<p class="full" id="push-msg"></p>' +
    (member.isPaid
      ? '<p class="full"><button type="button" id="portal" class="hdel">解約する・支払い方法を変える</button></p>'
      : upgradeHtml())

  $('push').addEventListener('click', async function () {
    if ($('score').value === '') { $('push-msg').textContent = '先に得点を入れてください。'; return }
    var sections = {}
    var inputs = document.querySelectorAll('[data-section]')
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value !== '') sections[inputs[i].dataset.section] = Number(inputs[i].value)
    }
    var r = await fetch('/api/submit', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({
        exam: $('exam').value,
        score: Number($('score').value),
        sections: sections,
        shared: $('share').checked === true,
      }),
    })
    $('push-msg').textContent = r.ok ? '保存しました。' : '保存できませんでした。'
    if (r.ok) renderMemberAverage()
  })

  var up = $('upgrade')
  if (up) up.addEventListener('click', async function () {
    var r = await fetch('/api/checkout', { method: 'POST', headers: authHeaders() })
    var d = await r.json()
    if (d.url) location.href = d.url
  })

  var portal = $('portal')
  if (portal) portal.addEventListener('click', async function () {
    var r = await fetch('/api/portal', { method: 'POST', headers: authHeaders() })
    var d = await r.json()
    if (d.url) location.href = d.url
  })
}

// 有料会員の案内。**課金の準備が整うまで、申込ボタンは出さない。**
// 出すときは、押す前に価格・更新・解約の条件を並べる（決済ページにも同じ文を出す）。
function upgradeHtml() {
  var feats = '会員平均との差を見る。端末をまたいで記録を引き継ぐ。'
  if (!BILLING) {
    return '<p class="mock-warn"><strong>有料会員は準備中です。</strong>' + feats + '<br />' +
      '始めるときは、この欄でお知らせします。いまは無料の機能だけ使えます。</p>'
  }
  return '<p class="mock-warn"><strong>' + BILLING.planName + '　月額' + BILLING.price + '（税込）</strong><br />' +
    BILLING.features.join('。') + '。<br />' +
    '申込日から1か月ごとに自動で更新し、そのつど請求します。' +
    'いつでもこの欄から解約でき、解約後も期間の終わりまで使えます。日割りの返金はありません。<br />' +
    '<a href="/terms">利用規約</a>・<a href="/tokushoho">特定商取引法に基づく表記</a>・' +
    '<a href="/privacy">プライバシーポリシー</a>に同意のうえお申し込みください。<br />' +
    '<button type="button" id="upgrade" class="save">同意して申し込む</button></p>'
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
  const sets = sectionSets(exam)
  const cur = activeSetKey(exam)

  const tabs = sets
    ? '<div class="setswitch">' + Object.keys(sets).map(function (k) {
        return '<button type="button" class="settab' + (k === cur ? ' on' : '') +
               '" data-set="' + k + '">' + sets[k].label + '</button>'
      }).join('') + '</div>'
    : ''

  wrap.innerHTML = tabs +
    '<p class="sub">' + (sets ? sets[cur].label : '科目別') +
    '（分かる範囲で。空欄でも判定は出ます）</p>' +
    activeSections(exam).map((s) =>
      '<label class="sec"><span>' + s.name +
      (warn.includes(s.name) ? '<em>足切りあり</em>' : '') + '</span>' +
      '<input type="number" data-section="' + s.name + '" min="0" max="' + s.full +
      '" placeholder="/ ' + s.full + '" /></label>').join('')
}

$('sections').addEventListener('click', function (e) {
  const k = e.target && e.target.dataset ? e.target.dataset.set : null
  if (!k) return
  SECTION_SET[$('exam').value] = k
  buildSections()
  render()
})

$('exam').addEventListener('change', () => { buildSections(); render(); renderHistory(); renderMemberAverage() })
$('save').addEventListener('click', addRecord)
document.addEventListener('input', render)
buildSections()
render()
renderHistory()
captureToken()
loadMember().then(function () { renderMember(); renderMemberAverage() })
`

const PAGE_CSS = `:root { color-scheme: light dark; }
.setswitch { display:flex; gap:6px; margin:0 0 10px; }
.settab { font:inherit; font-size:13px; padding:5px 12px; border:1px solid #d6dbe5;
          background:#fff; color:#4b5563; border-radius:99px; cursor:pointer; }
.settab.on { background:#2b4870; color:#fff; border-color:#2b4870; font-weight:700; }
.gap { margin:18px 0 0; padding:16px; background:#fff; border:1px solid #e2e6ef; border-radius:10px; }
.gap-head { margin:0 0 6px; font-weight:700; font-size:15px; }
.gap-def { margin:0 0 12px; font-size:12px; color:#6b7280; line-height:1.7; }
.gap-verdict { margin:0 0 14px; font-size:14px; padding:10px 12px; background:#f2f5fa; border-radius:6px; }
.gap-verdict b { font-size:19px; color:#8c2f39; }
.gap-rows { display:flex; flex-direction:column; gap:12px; }
.gap-row { display:grid; grid-template-columns:26px 1fr auto; gap:2px 10px; align-items:baseline; }
.gap-rank { grid-row:1/3; width:24px; height:24px; border-radius:50%; background:#2b4870; color:#fff;
            font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; }
.gap-name { font-weight:700; font-size:14px; }
.gap-name em { font-style:normal; font-size:11px; background:#fdecec; color:#8c2f39;
               padding:1px 6px; border-radius:99px; margin-left:6px; }
.gap-num { font-size:13px; color:#8c2f39; white-space:nowrap; }
.gap-num b { font-size:17px; }
.gap-sub { grid-column:2/4; font-size:12px; color:#6b7280; }
.gap-bar { grid-column:2/4; height:6px; background:#eef1f6; border-radius:99px; overflow:hidden; }
.gap-bar i { display:block; height:100%; background:#2b4870; }
.gap-ok { margin:0; font-size:14px; }
.gap-lock { margin:4px 0 0; padding:12px; background:#f7f8fb; border:1px dashed #c9d0dc;
            border-radius:8px; font-size:13px; color:#4b5563; }
.gap-lock p { margin:0; }
.gap-note { margin:14px 0 0; font-size:12px; color:#6b7280; }

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
  // **課金を有効にしたのに表記が欠けていたら、ビルドを止める。** 黙って案内を
  // 隠すだけにすると、有効にしたつもりで始まっていないことに気づけない。
  if (billingEnabledFlag() && !LEGAL_READY) {
    throw new Error('BILLING_ENABLED=1 ですが、lib/legal.mjs に空欄があります: ' + LEGAL_MISSING.join('、'))
  }

  const config = JSON.parse(await readFile(path.join(root, 'config', 'exams.json'), 'utf8'))
  const exams = config.exams
  // **切り替えのために自分の key を持たせる。** 設定側には書かない（重複するため）
  for (const k of Object.keys(exams)) exams[k].key = k

  const options = Object.entries(exams)
    .map(([key, exam]) => `<option value="${key}">${escapeHtml(exam.name)}</option>`).join('')

  // ログインが使えるようになると、得点をサーバに保存できる。
  // 「どこにも送信されません」のままにすると、既存の利用者との約束と食い違う。
  const promise = SUPABASE_PUBLIC
    ? '入力した内容は、会員欄で保存を押さない限り送信されません。'
    : '入力した内容はどこにも送信されません。'

  const footer = LEGAL_READY
    ? `<p class="note legal-links"><a href="/terms">利用規約</a>　<a href="/privacy">プライバシーポリシー</a>　<a href="/tokushoho">特定商取引法に基づく表記</a></p>`
    : ''

  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>合格ラインとの距離｜宅建・行政書士</title>
    <meta name="description" content="得点を入れると、合格ラインとの距離と判定が出ます。過去の合格点で判定しているので、根拠を1行で説明できます。${promise}" />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <div class="wrap">
      <h1>合格ラインとの距離</h1>
      <p class="lead">得点を入れると、合格ラインまでの距離と判定が出ます。<br />
        <strong>${promise}</strong></p>

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
      <div id="member-average"></div>

      <div class="card" id="member-card" hidden>
        <label>会員</label>
        <div id="member-body"></div>
      </div>

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
      ${footer}
    </div>
    <script>${APP_JS.replace('__EXAMS__', JSON.stringify(exams)).replace('__SUPABASE__', JSON.stringify(SUPABASE_PUBLIC)).replace('__BILLING__', JSON.stringify(BILLING_PUBLIC))}</script>
  </body>
</html>
`

  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'index.html'), html, 'utf8')
  if (SITE_DOMAIN) await writeFile(path.join(outDir, 'CNAME'), SITE_DOMAIN + NEWLINE, 'utf8')

  // 規約・ポリシー・特商法の表記。**空欄があるうちは書き出さない。**
  // 空欄のままの表記を公開すると、埋めたつもりの抜けに気づけない。
  if (LEGAL_READY) {
    for (const [name, html] of Object.entries(legalPages({ css: PAGE_CSS, escapeHtml }))) {
      await writeFile(path.join(outDir, name + '.html'), html, 'utf8')
    }
  }

  const unverified = Object.values(exams).filter((e) => !e.verified).map((e) => e.short)
  console.log(`${Object.keys(exams).length}試験ぶんを書き出しました。`)
  if (!LEGAL_READY) {
    console.log('規約・ポリシー・特商法の表記は書き出していません。lib/legal.mjs の空欄: ' + LEGAL_MISSING.join('、'))
    if (SUPABASE_PUBLIC) console.log('**ログインが有効なのに、プライバシーポリシーがありません。** メールアドレスを預かる前に埋めること。')
  }
  console.log(BILLING_PUBLIC ? '**有料会員の申込を受け付けます。**' : '有料会員の申込は受け付けていません（準備中と表示）。')
  if (unverified.length) {
    console.log(`**まだ公式で確かめていない試験: ${unverified.join('・')}**`)
  }
}

main()
