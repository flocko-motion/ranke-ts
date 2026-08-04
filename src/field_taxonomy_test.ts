import assert from 'node:assert/strict'
import test from 'node:test'

import * as f from './field_taxonomy.ts'
import { checkAliasRoundTrip, checkSingleCharacter } from './testing/alias_check.ts'

const FIELDS: ReadonlyArray<readonly [string, string]> = [
  [f.FieldName, f.FieldNameAlias],
  [f.FieldEdges, f.FieldEdgesAlias],
  [f.FieldContent, f.FieldContentAlias],
  [f.FieldContentSize, f.FieldContentSizeAlias],
  [f.FieldContentHash, f.FieldContentHashAlias],
  [f.FieldHeight, f.FieldHeightAlias],
  [f.FieldEdgesDiffOmit, f.FieldEdgesDiffOmitAlias],
  [f.FieldFieldsDiffOmit, f.FieldFieldsDiffOmitAlias],
  [f.FieldDeleteBy, f.FieldDeleteByAlias],
  [f.FieldPubkeyValidFrom, f.FieldPubkeyValidFromAlias],
  [f.FieldPubkeyExpiresAfter, f.FieldPubkeyExpiresAfterAlias],
]

// The field-alias table is normative — a second implementation encoding the same
// claim differently would disagree on the bytes — so every entry is stated here.
test('field name aliases', () => {
  assert.equal(FIELDS.length, 11, 'the whole table, as ranke-go holds it')
  checkAliasRoundTrip(
    new Map(FIELDS),
    f.fieldNameToAlias,
    f.fieldNameFromAlias,
    'topic', // open vocabulary
  )
  checkSingleCharacter(
    FIELDS.map(([long]) => long),
    f.fieldNameToAlias,
  )
})

// height and content_hash both start with "h", so their aliases differ by case —
// the pairing most likely to be transcribed the wrong way round.
test('height and content_hash aliases differ by case', () => {
  assert.equal(f.fieldNameToAlias(f.FieldHeight), 'H')
  assert.equal(f.fieldNameToAlias(f.FieldContentHash), 'h')
  assert.equal(f.fieldNameFromAlias('H'), f.FieldHeight)
  assert.equal(f.fieldNameFromAlias('h'), f.FieldContentHash)
})

// A user field may be spelled like a structural one: structural fields live in the
// reserved "." namespace, so "content" as a user name is a different key. It still
// aliases, because the codec maps every well-known name the same way.
test('a user field named like a structural one still aliases', () => {
  assert.equal(f.fieldNameToAlias('content'), 'c')
  assert.equal(f.fieldNameFromAlias('c'), 'content')
})

test('validFieldChars enforces the plain charset', () => {
  for (const n of ['topic', 'a', 'a_b', 'x1', 'created_by_2']) {
    assert.ok(f.validFieldChars(n), n)
  }
  for (const n of ['', '_leading', 'Upper', 'has space', 'dot.name', 'dash-name', 'ümlaut']) {
    assert.ok(!f.validFieldChars(n), JSON.stringify(n))
  }
})

test('validEncodingSubtype is the liberal MIME charset', () => {
  for (const s of ['plain', 'svg+xml', 'x-tar', 'vnd.Bar', 'ld+json', 'A1']) {
    assert.ok(f.validEncodingSubtype(s), s)
  }
  for (const s of ['', '.reserved', '+leading', '-leading', 'has space']) {
    assert.ok(!f.validEncodingSubtype(s), JSON.stringify(s))
  }
})

test('splitLines reads a newline-separated list', () => {
  assert.deepEqual([...f.splitLines('a\nb\nc')], ['a', 'b', 'c'])
  assert.deepEqual([...f.splitLines('  a  \n\n b \n')], ['a', 'b'])
  assert.deepEqual([...f.splitLines('')], [])
  assert.deepEqual([...f.splitLines('a\na')], ['a'], 'a set, so repeats collapse')
})

test('the field caps match ranke-go', () => {
  assert.equal(f.maxFieldNameLen, 128)
  assert.equal(f.maxFieldValueLen, 64 * 1024)
  assert.equal(f.maxFieldsPerRecord, 256)
})
