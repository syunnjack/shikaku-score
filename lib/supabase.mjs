// Supabase への最小限の呼び出し。依存を増やさないため fetch で直接叩く。
//
// **SUPABASE_SERVICE_ROLE_KEY はサーバ側だけで使う。** ブラウザに出したら
// 全行が読み書きできてしまう。api/ 配下からしか読み込まないこと。

const URL_ = () => process.env.SUPABASE_URL
const ANON = () => process.env.SUPABASE_ANON_KEY
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY

export function configured() {
  return Boolean(URL_() && ANON() && SERVICE())
}

// Authorization ヘッダのJWTから、本人のユーザーIDを取り出す。
// **クライアントの申告を信じない。** Supabase に問い合わせて検証する。
export async function userFromRequest(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const res = await fetch(URL_() + '/auth/v1/user', {
    headers: { apikey: ANON(), Authorization: 'Bearer ' + token },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user && user.id ? user : null
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: SERVICE(),
    Authorization: 'Bearer ' + SERVICE(),
    'Content-Type': 'application/json',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(URL_() + '/rest/v1/' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error('supabase ' + res.status + ' ' + text)
  return data
}

export function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).send(JSON.stringify(payload))
}
