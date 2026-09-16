import { createHmac } from 'node:crypto'
import { verify } from '../api/stripe-webhook.mjs'
const secret = 'whsec_test'
const raw = Buffer.from(JSON.stringify({ type: 'checkout.session.completed' }))
const sign = (t, body, sec) => 't=' + t + ',v1=' + createHmac('sha256', sec).update(t + '.' + body.toString('utf8')).digest('hex')
const now = Math.floor(Date.now() / 1000)
const cases = [
  ['正しい署名', verify(raw, sign(now, raw, secret), secret), true],
  ['本文を改ざん', verify(Buffer.from('{"type":"x"}'), sign(now, raw, secret), secret), false],
  ['別のシークレット', verify(raw, sign(now, raw, 'whsec_other'), secret), false],
  ['6分前の署名', verify(raw, sign(now - 360, raw, secret), secret), false],
  ['署名ヘッダなし', verify(raw, '', secret), false],
  ['v1が欠けている', verify(raw, 't=' + now, secret), false],
]
let ng = 0
for (const [name, got, want] of cases) {
  const ok = got === want
  if (!ok) ng++
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + ' → ' + got + '（期待 ' + want + '）')
}
process.exit(ng ? 1 : 0)
