import assert from 'node:assert/strict'
import test from 'node:test'

import * as enc from './encoding_taxonomy.ts'
import { checkAliasRoundTrip, checkSingleCharacter } from './node_taxonomy_test.ts'

const CLASSES: ReadonlyArray<readonly [string, string]> = [
  [enc.encApplication, enc.encApplicationAlias],
  [enc.encAudio, enc.encAudioAlias],
  [enc.encExample, enc.encExampleAlias],
  [enc.encFont, enc.encFontAlias],
  [enc.encImage, enc.encImageAlias],
  [enc.encMessage, enc.encMessageAlias],
  [enc.encModel, enc.encModelAlias],
  [enc.encMultipart, enc.encMultipartAlias],
  [enc.encText, enc.encTextAlias],
  [enc.encVideo, enc.encVideoAlias],
]

test('encoding class aliases', () => {
  checkAliasRoundTrip(
    new Map(CLASSES),
    enc.encodingClassToAlias,
    enc.encodingClassFromAlias,
    'chemical', // not a registered top-level type
  )
  checkSingleCharacter(
    CLASSES.map(([long]) => long),
    enc.encodingClassToAlias,
  )
})

// Every named media-type constant this module exports must have its subtype in the
// alias table: a predefined type earns its keep by encoding compactly, so one
// missing from the table would encode long while ranke-go encodes it short.
test('every named media type has a subtype alias', () => {
  const named = Object.entries(enc).filter(
    (e): e is [string, string] =>
      e[0].startsWith('Encoding') && typeof e[1] === 'string' && e[1].includes('/'),
  )
  assert.ok(named.length >= 56, `expected the full constant set, got ${named.length}`)
  for (const [name, media] of named) {
    const sub = media.slice(media.indexOf('/') + 1)
    assert.notEqual(
      enc.encodingSubToAlias(sub),
      sub,
      `${name} (${media}) has no alias for subtype ${sub}`,
    )
  }
})

test('subtype aliases are a bijection of single characters', () => {
  const seen = new Map<string, string>()
  const named = Object.entries(enc).filter(
    (e): e is [string, string] =>
      e[0].startsWith('Encoding') && typeof e[1] === 'string' && e[1].includes('/'),
  )
  for (const [, media] of named) {
    const sub = media.slice(media.indexOf('/') + 1)
    const alias = enc.encodingSubToAlias(sub)
    assert.equal(alias.length, 1, `alias for ${sub}`)
    assert.equal(enc.encodingSubFromAlias(alias), sub, `round-trip of ${sub}`)
    const prev = seen.get(alias)
    if (prev !== undefined && prev !== sub) {
      assert.fail(`alias ${alias} is shared by ${prev} and ${sub}`)
    }
    seen.set(alias, sub)
  }
})

// A single character from [a-zA-Z0-9] caps the table at 62 entries; ranke-go
// records 56 used, and the two tables must hold the same entries.
test('the subtype table matches ranke-go in size', () => {
  assert.equal(enc.encodingSubAliasCount, 56)
  assert.ok(enc.encodingSubAliasCount <= 62, 'the single-character space is exhausted')
})

test('an unknown subtype passes through both directions', () => {
  assert.equal(enc.encodingSubToAlias('vnd.custom+json'), 'vnd.custom+json')
  assert.equal(enc.encodingSubFromAlias('vnd.custom+json'), 'vnd.custom+json')
})

// mpeg, ogg and webm are shared between audio/* and video/*, so the subtype table
// holds one entry each and the class alias distinguishes them.
test('subtypes shared between audio and video have one alias', () => {
  assert.equal(enc.EncodingMP3, 'audio/mpeg')
  assert.equal(enc.EncodingMPEG, 'video/mpeg')
  assert.equal(enc.encodingSubToAlias('mpeg'), 'q')
  assert.equal(enc.encodingSubToAlias('ogg'), 'O')
  assert.equal(enc.encodingSubToAlias('webm'), 'K')
})

test('class constructors compose the media type', () => {
  assert.equal(enc.EncodingApplication('json'), enc.EncodingJSON)
  assert.equal(enc.EncodingText('plain'), enc.EncodingPlain)
  assert.equal(enc.EncodingImage('svg+xml'), enc.EncodingSVG)
  assert.equal(enc.EncodingApplication('vnd.custom+json'), 'application/vnd.custom+json')
})

test('validEncodingClass admits the closed set and nothing else', () => {
  for (const [long] of CLASSES) assert.ok(enc.validEncodingClass(long), long)
  for (const c of ['a', 't', '', 'chemical', 'Text']) {
    assert.ok(!enc.validEncodingClass(c), JSON.stringify(c))
  }
})

test('IsTextEncoding classifies by class and suffix', () => {
  for (const e of [
    enc.EncodingPlain,
    enc.EncodingHTML,
    enc.EncodingMarkdown,
    enc.EncodingJSON,
    enc.EncodingXML,
    enc.EncodingJSONLD,
    enc.EncodingSVG,
    'message/rfc822',
    'application/vnd.custom+json',
  ]) {
    assert.ok(enc.IsTextEncoding(e), e)
  }
  for (const e of [
    '',
    enc.EncodingOctetStream,
    enc.EncodingPNG,
    enc.EncodingMP3,
    enc.EncodingMP4,
    enc.EncodingWOFF,
    enc.EncodingPDF,
  ]) {
    assert.ok(!enc.IsTextEncoding(e), e)
  }
})
