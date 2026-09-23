// 有料会員を始めるのに要る、運営者と価格の情報。**ここ1箇所だけで決める。**
//
// 特定商取引法に基づく表記・利用規約・プライバシーポリシーは、この値から
// ビルドで書き出す。画面の申込ボタン横の表示と、api/checkout.mjs も同じ値を読む。
//
// ## 課金を始める条件
//
// 1. 下の空欄がすべて埋まっている（missingLegal() が空）
// 2. Vercel の環境変数 BILLING_ENABLED が 1
//
// **どちらか欠けていれば、申込ボタンは出ず、api/checkout も 503 を返す。**
// 表記が揃わないまま課金が始まる事故を、コードで止めるため。
//
// **推測で埋めない。** 空欄は空欄のまま置いておく。

export const LEGAL = {
  // 販売事業者名。個人なら氏名、屋号があれば併記する。
  seller: '',
  // 運営統括責任者。個人なら seller と同じでよい。
  manager: '',
  // 所在地と電話番号。
  // 個人で公開しない場合は discloseOnRequest を true にすると、
  // 「請求があった場合は遅滞なく開示します」と表示する（特商法の省略の扱い）。
  address: '',
  phone: '',
  discloseOnRequest: false,
  // 問い合わせ先。表記・規約・ポリシーすべてに出る。
  email: '',
  // 月額の税込価格（円）。**Stripe の price と必ず一致させる。**
  priceMonthlyYen: null,
  // 利用規約・プライバシーポリシーの施行日（YYYY-MM-DD）。
  effectiveDate: '',
}

export const PLAN = {
  name: '有料会員（月額）',
  features: ['合格レベルとの差分を全形式ぶん見る', '埋める順番を点数の大きい順に出す', '会員平均との差を見る', '端末をまたいで記録を引き継ぐ'],
}

// 埋まっていない項目の名前を返す。空なら課金を始められる。
export function missingLegal(l = LEGAL) {
  const miss = []
  if (!l.seller) miss.push('販売事業者名（seller）')
  if (!l.manager) miss.push('運営統括責任者（manager）')
  if (!l.discloseOnRequest && !l.address) miss.push('所在地（address）')
  if (!l.discloseOnRequest && !l.phone) miss.push('電話番号（phone）')
  if (!l.email) miss.push('メールアドレス（email）')
  if (!Number.isInteger(l.priceMonthlyYen) || l.priceMonthlyYen <= 0) miss.push('月額の税込価格（priceMonthlyYen）')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.effectiveDate || '')) miss.push('施行日（effectiveDate）')
  return miss
}

export function billingEnabledFlag(env = process.env) {
  return env.BILLING_ENABLED === '1'
}

// **課金を受け付けてよいか。** 環境変数と表記の両方が揃ったときだけ true。
export function billingReady(env = process.env) {
  return billingEnabledFlag(env) && missingLegal().length === 0
}

export function yen(n) {
  return Number(n).toLocaleString('ja-JP') + '円'
}
