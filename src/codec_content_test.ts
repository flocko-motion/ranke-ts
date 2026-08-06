import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeClaim } from './codec.ts'
import { contentSize, contentWithheld, inlineBytes } from './content.ts'
import { type Capped, capped, cborBytes } from './testing/fixtures.ts'

// A read may cap the content it inlines (R-QCONTENT), so a client receives claims whose
// content is partial or absent while content_size still states the true length. These
// bytes come from ranke-go's query encoder, the reference for that rule.
//
// Reading such a claim is the whole point: a browser client asks for ids and short
// content, then fetches the full claim only where it needs the bytes.

function find(label: string): Capped {
  const c = capped.find((x) => x.label === label)
  if (c === undefined) throw new Error(`capped fixture ${label} is missing — regenerate`)
  return c
}

test('every content option ranke-go serves decodes', () => {
  assert.ok(capped.length >= 6, 'the generator covers each option R-QCONTENT admits')
  for (const c of capped) {
    const claim = decodeClaim(cborBytes(c), c.id)
    const got = inlineBytes(claim.content)
    assert.equal(got === null ? 0 : got.length, c.inline, `${c.label}: inlined bytes`)
  }
})

// The claim declares what it holds whether or not the bytes came with it, so a client
// can tell "no content" from "content I did not receive" and ask again.
test('a capped claim still declares its true content size', () => {
  for (const c of capped) {
    const claim = decodeClaim(cborBytes(c), c.id)
    assert.equal(contentSize(claim.content), c.size, `${c.label}: content_size`)
    assert.equal(contentWithheld(claim.content), c.inline === 0, `${c.label}: withheld`)
  }
})

test('content in full is the record whose hash is the id', () => {
  const full = find('max 0, content in full')
  const claim = decodeClaim(cborBytes(full), full.id)
  assert.equal(inlineBytes(claim.content)?.length, full.size, 'every byte arrived')
  assert.equal(claim.id, full.id)
})

test('an absent content section inlines nothing', () => {
  const none = find('content absent, so none is inlined')
  assert.equal(none.inline, 0, 'ranke-go inlined none of it')
  const claim = decodeClaim(cborBytes(none), none.id)
  assert.equal(inlineBytes(claim.content), null)
  assert.ok(contentWithheld(claim.content), 'withheld, which is not the same as absent')
  assert.equal(contentSize(claim.content), none.size)
})

test('cutoff delivers a prefix of the content, omit none of the value', () => {
  const cut = find('a cap the content overruns, cut at it')
  assert.equal(cut.inline, cut.cap, 'cut exactly at the cap')
  const cutClaim = decodeClaim(cborBytes(cut), cut.id)
  assert.equal(inlineBytes(cutClaim.content)?.length, cut.cap)

  const omitted = find('a cap the content overruns, omitted whole')
  assert.equal(omitted.inline, 0)
  assert.equal(inlineBytes(decodeClaim(cborBytes(omitted), omitted.id).content), null)
})

// An absent overflow is omit (R-QCONTENT), so the two must serve the same bytes.
test('an absent overflow serves what omit serves', () => {
  assert.equal(find('an absent overflow, which is omit').cbor,
    find('a cap the content overruns, omitted whole').cbor)
})

test('a cap the content fits leaves it whole', () => {
  const fits = find('a cap the content fits')
  assert.equal(fits.inline, fits.size)
  assert.equal(fits.cbor, find('max 0, content in full').cbor,
    'a cap nothing overruns serves the record in full')
})

// The JSON projection carries the same information (R-QENCODING), so its content field
// must follow the cap exactly as the CBOR record does.
test('the JSON projection caps content alike', () => {
  for (const c of capped) {
    const m = c.json as Record<string, unknown>
    const raw = m.content
    const inlined = typeof raw === 'string' ? Buffer.from(raw, 'base64').length : 0
    assert.equal(inlined, c.inline, `${c.label}: json content`)
    assert.equal(m.content_size, c.size, `${c.label}: json content_size`)
  }
})
