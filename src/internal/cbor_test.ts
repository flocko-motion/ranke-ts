import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CborReader,
  CborWriter,
  RankeCborError,
  RankeCborTruncated,
  compareBytes,
  encodeText,
  encodeUint,
} from './cbor.ts'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const bin = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'))

// Every expected value below is what ranke-go's encoder emits under
// cbor.CoreDetEncOptions() — the mode the canonical bytes are produced in. The
// reference implementation is the oracle, so a divergence in head widths, in the
// shortest form, or in map ordering shows up as unequal hex.

test('unsigned integers take ranke-go head widths', () => {
  for (const [n, want] of [
    [0n, '00'],
    [1n, '01'],
    [23n, '17'],
    [24n, '1818'],
    [255n, '18ff'],
    [256n, '190100'],
    [65535n, '19ffff'],
    [65536n, '1a00010000'],
    [4294967295n, '1affffffff'],
    [4294967296n, '1b0000000100000000'],
    [4611686018427387904n, '1b4000000000000000'],
  ] as const) {
    const w = new CborWriter()
    w.writeUint(n)
    assert.equal(hex(w.bytes()), want, `uint ${n}`)
  }
})

test('negative integers take ranke-go head widths', () => {
  for (const [n, want] of [
    [-1n, '20'],
    [-24n, '37'],
    [-25n, '3818'],
    [-256n, '38ff'],
    [-257n, '390100'],
    [-65536n, '39ffff'],
    [-65537n, '3a00010000'],
  ] as const) {
    const w = new CborWriter()
    w.writeInt(n)
    assert.equal(hex(w.bytes()), want, `int ${n}`)
  }
})

test('text and byte strings match ranke-go', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['', '60'],
    ['abc', '63616263'],
    ['aaaaaaaaaaaaaaaaaaaaaaaa', '7818616161616161616161616161616161616161616161616161'],
    ['héllo — ünïcode', '7468c3a96c6c6f20e2809420c3bc6ec3af636f6465'],
  ]
  for (const [s, want] of cases) {
    const w = new CborWriter()
    w.writeText(s)
    assert.equal(hex(w.bytes()), want, JSON.stringify(s))
  }

  const empty = new CborWriter()
  empty.writeBytes(new Uint8Array(0))
  assert.equal(hex(empty.bytes()), '40')

  const three = new CborWriter()
  three.writeBytes(Uint8Array.of(1, 2, 3))
  assert.equal(hex(three.bytes()), '43010203')
})

test('arrays match ranke-go', () => {
  const empty = new CborWriter()
  empty.writeArrayHeader(0)
  assert.equal(hex(empty.bytes()), '80')

  const three = new CborWriter()
  three.writeArrayHeader(3)
  for (const n of [1, 2, 3]) three.writeUint(n)
  assert.equal(hex(three.bytes()), '83010203')
})

// writeTextMap is how a record's field map is built: keys and values encoded, then
// ordered by the encoded key.
function writeTextMap(entries: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const w = new CborWriter()
  w.writeSortedMap(entries.map(([k, v]) => [encodeText(k), encodeText(v)] as const))
  return w.bytes()
}

// §4.2 orders map keys by their ENCODED bytes, so a text key's length leads. Plain
// lexicographic ordering would put "aa" before "b" and produce different bytes for
// the same claim.
test('map keys order by encoded bytes, so length leads', () => {
  assert.equal(
    hex(writeTextMap([
      ['aa', '1'],
      ['b', '2'],
    ])),
    'a2616261326261616131',
    '"b" precedes "aa"',
  )
  assert.equal(
    hex(writeTextMap([
      ['z', '1'],
      ['aa', '2'],
      ['a', '3'],
      ['bbb', '4'],
      ['', '5'],
    ])),
    'a560613561616133617a61316261616132636262626134',
    'shortest first, then bytewise',
  )
})

test('integer map keys order numerically', () => {
  const w = new CborWriter()
  w.writeSortedMap(
    (
      [
        [1, 'a'],
        [2, 'b'],
        [12, 'c'],
        [24, 'd'],
        [300, 'e'],
      ] as const
    ).map(([k, v]) => [encodeUint(k), encodeText(v)] as const),
  )
  assert.equal(hex(w.bytes()), 'a50161610261620c61631818616419012c6165')
})

// The record shape a node id is computed over: integer keys with gaps where a zero
// value was dropped, and one nested map of text fields.
test('a record matches ranke-go byte for byte', () => {
  const createdAt = '2026-01-01T00:00:00.000000000Z'

  const minimal = new CborWriter()
  minimal.writeSortedMap([
    [encodeUint(1), encodeText('.s')],
    [encodeUint(2), encodeText('book')],
    [encodeUint(6), encodeText(createdAt)],
  ])
  assert.equal(
    hex(minimal.bytes()),
    'a301622e730264626f6f6b06781e323032362d30312d30315430303a30303a30302e3030303030303030305a',
  )

  const full = new CborWriter()
  full.writeSortedMap([
    [encodeUint(1), encodeText('.s')],
    [encodeUint(2), encodeText('book')],
    [encodeUint(6), encodeText(createdAt)],
    [
      encodeUint(8),
      writeTextMap([
        ['b', '1'],
        ['aa', '2'],
      ]),
    ],
    [encodeUint(11), encodeUint(12)],
    [encodeUint(12), encodeUint(3)],
  ])
  assert.equal(
    hex(full.bytes()),
    'a601622e730264626f6f6b06781e323032362d30312d30315430303a30303a30302e3030303030303030305a' +
      '08a26162613162616161320b0c0c03',
  )
})

test('writeSortedMap refuses a repeated key', () => {
  assert.throws(
    () =>
      writeTextMap([
        ['a', '1'],
        ['a', '2'],
      ]),
    RankeCborError,
  )
})

// ─── Reader ───────────────────────────────────────────────────────────

test('the reader round-trips every writer fixture', () => {
  for (const n of [0n, 23n, 24n, 255n, 65536n, 4294967296n, -1n, -25n, -65537n]) {
    const w = new CborWriter()
    w.writeInt(n)
    const r = new CborReader(w.bytes())
    assert.equal(r.readInt(), n)
    r.expectEnd()
  }

  for (const s of ['', 'abc', 'héllo — ünïcode']) {
    const w = new CborWriter()
    w.writeText(s)
    assert.equal(new CborReader(w.bytes()).readText(), s)
  }

  const w = new CborWriter()
  w.writeBytes(Uint8Array.of(9, 8, 7))
  assert.deepEqual(new CborReader(w.bytes()).readBytes(), Uint8Array.of(9, 8, 7))
})

// A value that fits a narrower head must use it: otherwise one integer has several
// encodings, and a record addressed by its bytes has several ids.
test('the reader refuses an argument outside its shortest form', () => {
  for (const s of [
    '1817', // 23 in a one-byte argument
    '190017', // 23 in two
    '1900ff', // 255 in two
    '1a0000ffff', // 65535 in four
    '1b00000000ffffffff', // 4294967295 in eight
    '3817', // -24 in a one-byte argument
  ]) {
    assert.throws(() => new CborReader(bin(s)).readInt(), RankeCborError, s)
  }
})

test('the reader refuses indefinite lengths, tags and floats', () => {
  for (const s of [
    '5f', // indefinite byte string
    '7f', // indefinite text
    '9f', // indefinite array
    'bf', // indefinite map
    'c0', // tag
    'f9', // half float
    'fa', // single float
    'fb', // double
    'f7', // undefined
    'f8ff', // a simple value beyond the three admitted
    '1c', // reserved additional information
  ]) {
    assert.throws(() => new CborReader(bin(s)).skipValue(), RankeCborError, s)
  }
})

// A claim record uses no major type 7, and a result sequence also carries an execution
// report — which states whether a limit cut the read short, so it holds a boolean.
// Exactly false, true and null are admitted; every float above still is not.
test('the reader admits false, true and null, and nothing else of major type 7', () => {
  for (const [encoded, want] of [
    ['f4', false],
    ['f5', true],
    ['f6', null],
  ] as const) {
    const r = new CborReader(bin(encoded))
    assert.equal(r.readSimple(), want, encoded)
    r.expectEnd()
  }

  // skipValue must step over one too, since a report is read key by key.
  const w = new CborWriter()
  w.writeSortedMap([[encodeText('truncated'), bin('f4')]])
  const r = new CborReader(w.bytes())
  assert.equal(r.readMapHeader(), 1)
  assert.equal(r.readText(), 'truncated')
  assert.equal(hex(r.skipValue()), 'f4')
  r.expectEnd()
})

test('readSimple refuses a value that is not one', () => {
  assert.throws(() => new CborReader(bin('01')).readSimple(), RankeCborError)
  assert.throws(() => new CborReader(bin('63616263')).readSimple(), RankeCborError)
})

test('the reader refuses trailing bytes', () => {
  const r = new CborReader(bin('0101'))
  assert.equal(r.readInt(), 1n)
  assert.throws(() => r.expectEnd(), RankeCborError)
})

test('the reader refuses invalid UTF-8', () => {
  // 0x61 declares one byte of text; 0xff is no valid sequence.
  assert.throws(() => new CborReader(bin('61ff')).readText(), RankeCborError)
})

test('skipValue returns the exact stored bytes', () => {
  const w = new CborWriter()
  w.writeArrayHeader(2)
  w.writeText('first')
  w.writeText('second')
  const raw = w.bytes()

  const r = new CborReader(raw)
  assert.equal(r.readArrayHeader(), 2)
  assert.equal(hex(r.skipValue()), hex(encodeText('first')))
  assert.equal(hex(r.skipValue()), hex(encodeText('second')))
  r.expectEnd()
})

// A browser reads a stream, so incomplete bytes mean "send more" while malformed
// bytes mean "stop". Conflating the two would stall a reader on a bad record.
test('tryScanValue reports an incomplete value without consuming it', () => {
  const w = new CborWriter()
  w.writeText('a value long enough to span a chunk')
  const full = w.bytes()

  for (let n = 1; n < full.length; n++) {
    const r = new CborReader(full.subarray(0, n))
    assert.equal(r.tryScanValue(), null, `${n} of ${full.length} bytes`)
    assert.equal(r.position, 0, 'the position is left for a retry')
  }

  const r = new CborReader(full)
  assert.equal(hex(r.tryScanValue()!), hex(full))
})

test('tryScanValue still throws on malformed bytes', () => {
  assert.throws(() => new CborReader(bin('1817')).tryScanValue(), RankeCborError)
  assert.throws(() => new CborReader(bin('c001')).tryScanValue(), RankeCborError)
})

test('truncation is a distinct error class', () => {
  assert.throws(() => new CborReader(bin('')).readInt(), RankeCborTruncated)
  assert.throws(() => new CborReader(bin('63' + '6162')).readText(), RankeCborTruncated)
  // A non-shortest head is malformed, so it must NOT read as truncated.
  assert.throws(() => new CborReader(bin('1817')).readInt(), (err: unknown) => {
    assert.ok(err instanceof RankeCborError)
    assert.ok(!(err instanceof RankeCborTruncated))
    return true
  })
})

test('nested values scan as one', () => {
  const inner = new CborWriter()
  inner.writeSortedMap([[encodeText('k'), encodeText('v')]])

  const outer = new CborWriter()
  outer.writeArrayHeader(2)
  outer.writeRaw(inner.bytes())
  outer.writeUint(7)

  const r = new CborReader(outer.bytes())
  assert.equal(hex(r.tryScanValue()!), hex(outer.bytes()), 'the whole array is one value')
})

test('compareBytes orders lexicographically, shorter first on a prefix', () => {
  assert.ok(compareBytes(Uint8Array.of(1), Uint8Array.of(2)) < 0)
  assert.ok(compareBytes(Uint8Array.of(1, 2), Uint8Array.of(1)) > 0)
  assert.equal(compareBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2)), 0)
})
