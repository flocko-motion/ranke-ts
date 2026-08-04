import { createHash, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'

import { RankeIdError, hashContent, hashFromMultihashBytes, idFromBytes, parseId } from './id.ts'

// Ids produced by ranke-go's HashContent — the reference implementation is the
// oracle, so a divergence in the digest, the multihash framing, or the base32
// alphabet shows up as an unequal string rather than as agreeing mistakes.
const GO_IDS: ReadonlyArray<readonly [string, string]> = [
  ['', 'bciqohmgeikmpyhautl57jsezn64sij5oihsgjg4tjssjlgi3pbjlqvi'],
  ['abc', 'bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli'],
  ['hello world', 'bciqlstjhxgju2pqiuuxffv62pwv7vree57rxuu4a52iir55m4lx432i'],
  [
    'a large external node payload',
    'bciqkyij3v6b4hjf32ooztgnwyqa7ddebmwbau2d5sbgz6m6wcxgdgwq',
  ],
]

test('hashContent matches ranke-go', () => {
  for (const [input, want] of GO_IDS) {
    assert.equal(hashContent(Buffer.from(input)).toString(), want, JSON.stringify(input))
  }
})

// A thousand bytes, so the base32 encoding of the id is unaffected but the hashed
// input spans several blocks.
test('hashContent matches ranke-go over a multi-block input', () => {
  const big = new Uint8Array(1000)
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251
  assert.equal(
    hashContent(big).toString(),
    'bciqfsqs6iqjoffx4orzwm46oazycp44eea7vtqgsyptl46ytgr5t77a',
  )
})

test('an id frames a SHA2-256 multihash', () => {
  const raw = hashContent(Buffer.from('abc')).rawBytes()
  assert.equal(raw.length, 34)
  assert.equal(raw[0], 0x12, 'multicodec sha2-256')
  assert.equal(raw[1], 0x20, 'digest length')
  assert.equal(
    Buffer.from(raw.subarray(2)).toString('hex'),
    createHash('sha256').update('abc').digest('hex'),
  )
})

test('parseId round-trips every id form', () => {
  for (const [input] of GO_IDS) {
    const id = hashContent(Buffer.from(input))
    const back = parseId(id.toString())
    assert.equal(back.toString(), id.toString())
    assert.ok(back.equal(id))
  }
})

test('parseId round-trips random payloads', () => {
  for (let i = 0; i < 500; i++) {
    const raw = randomBytes(1 + (i % 40))
    const id = idFromBytes(raw)
    assert.deepEqual(parseId(id.toString()).rawBytes(), Uint8Array.from(raw))
  }
})

test('equal compares by payload, not identity', () => {
  const a = hashContent(Buffer.from('abc'))
  const b = parseId(a.toString())
  assert.ok(a.equal(b))
  assert.ok(!a.equal(hashContent(Buffer.from('abd'))))
  assert.ok(!a.equal(null))
})

// A node id is a signature, so it frames no multihash and the multicodec reading
// names it. This one is a contributor claim id from ranke-go, built over a fixed
// seed and timestamp.
const GO_SIGNATURE_ID =
  'b5uawx4g6p24fbzstte4xxtjbcuorbusy4ohvvuowc5cirr3otq5ipqbp66jlje4yshcqycpbjyrcre2pfw54stffl5tbfm2y4sstzffrb4'

test('algorithm names the scheme', () => {
  assert.equal(hashContent(Buffer.from('abc')).algorithm(), 'sha2-256')
  assert.equal(parseId(GO_SIGNATURE_ID).algorithm(), 'ed25519-pub')
})

// The multicodec is a varint, so Ed25519 (0xed) occupies two bytes — a reader
// treating it as one would stop mid-code and mis-frame every signature.
test('a signature id carries the two-byte Ed25519 varint', () => {
  const raw = parseId(GO_SIGNATURE_ID).rawBytes()
  assert.equal(raw[0], 0xed)
  assert.equal(raw[1], 0x01)
  assert.equal(raw.length, 2 + 64, 'varint plus an Ed25519 signature')
})

// The same framing carries a public key, which is how a contributor claim's
// content is encoded (ranke-go EncodePublicKey).
test('the multikey framing round-trips through parseId', () => {
  const pubkey = Buffer.from(
    'ed0103a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8',
    'hex',
  )
  const id = idFromBytes(pubkey)
  assert.equal(id.algorithm(), 'ed25519-pub')
  assert.deepEqual(parseId(id.toString()).rawBytes(), Uint8Array.from(pubkey))
})

test('parseId refuses a non-base32 multibase', () => {
  assert.throws(() => parseId('zQ3shokFTS3brHcDQrn82RUDfCZTfKvS'), RankeIdError)
  assert.throws(() => parseId(''), RankeIdError)
})

test('parseId refuses characters outside the alphabet', () => {
  // "1", "0", "8" and "9" are excluded from RFC 4648 base32, and uppercase is
  // a different multibase entirely.
  for (const s of ['bciq1', 'bciq0', 'bciq8', 'bCIQ']) {
    assert.throws(() => parseId(s), RankeIdError, s)
  }
})

test('parseId refuses non-zero padding bits', () => {
  // "bcp" carries 10 bits for one byte, and the two spare bits are set — a string
  // no byte sequence encodes to, so accepting it would give one id two forms.
  assert.throws(() => parseId('bcp'), RankeIdError)
})

test('hashFromMultihashBytes validates the framing', () => {
  const good = hashContent(Buffer.from('abc')).rawBytes()
  assert.ok(hashFromMultihashBytes(good).equal(hashContent(Buffer.from('abc'))))

  const shortDigest = Uint8Array.of(0x12, 0x20, 1, 2, 3)
  assert.throws(() => hashFromMultihashBytes(shortDigest), RankeIdError, 'declared length unmet')

  const wrongCode = Uint8Array.from(good)
  wrongCode[0] = 0x13
  assert.throws(() => hashFromMultihashBytes(wrongCode), RankeIdError, 'not sha2-256')

  const trailing = new Uint8Array(good.length + 1)
  trailing.set(good)
  assert.throws(() => hashFromMultihashBytes(trailing), RankeIdError, 'trailing bytes')
})

test('toString is stable across calls', () => {
  const id = hashContent(Buffer.from('hello world'))
  assert.equal(id.toString(), id.toString())
  assert.equal(`${id}`, id.toString())
})
