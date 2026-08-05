import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

import { type ResultRecord, readClaims, readIds, readRecords } from './codec_seq.ts'

// seq_oracle.json holds framed result sequences — every payload kind against both
// encodings — with each record's bytes produced by ranke-go. The other sequence tests
// build their records with this library's own writer, so they prove it self-consistent;
// these prove it reads what the reference writes.
//
// The generator applies the framing (RFC 7464, RFC 8742) itself, RankeDB's being
// internal to its core package. Both are published standards; what these check is the
// payload encoding, where two implementations can disagree.
interface SeqStream {
  label: string
  encoding: 'json' | 'cbor'
  kinds: string[]
  ids?: string[]
  bytes: string
}

interface OracleFile {
  note: string
  rankeGo: string
  streams: SeqStream[]
}

const oracle: OracleFile = JSON.parse(
  readFileSync(new URL('./testing/seq_oracle.json', import.meta.url), 'utf8'),
)

function bytesOf(s: SeqStream): Uint8Array {
  const out = new Uint8Array(s.bytes.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(s.bytes.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

// A stream arrives in chunks the network chose, so every case is fed one byte at a
// time as well as whole: a record boundary falls wherever it falls.
function bodyOf(bytes: Uint8Array, chunk: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) {
        controller.enqueue(bytes.subarray(i, Math.min(i + chunk, bytes.length)))
      }
      controller.close()
    },
  })
}

test('the oracle comes from a released ranke-go and covers both encodings', () => {
  assert.match(oracle.rankeGo, /^v\d+\.\d+\.\d+$/, 'a released version')
  assert.equal(oracle.streams.length, 10, 'five kinds against two encodings')
  for (const encoding of ['json', 'cbor'] as const) {
    const kinds = new Set(
      oracle.streams.filter((s) => s.encoding === encoding).flatMap((s) => s.kinds),
    )
    assert.deepEqual(
      [...kinds].sort(),
      ['claim', 'claim_id', 'path_id', 'report'],
      `${encoding} exercises every record kind`,
    )
  }
})

test('every served sequence reads to the kinds the manifest names', async () => {
  for (const s of oracle.streams) {
    for (const chunk of [1, 7, Number.MAX_SAFE_INTEGER]) {
      const kinds: string[] = []
      for await (const rec of readRecords(bodyOf(bytesOf(s), chunk), s.encoding)) {
        kinds.push(rec.kind)
      }
      assert.deepEqual(kinds, s.kinds, `${s.encoding} ${s.label} at chunk ${chunk}`)
    }
  }
})

// The ids a run names must come back exactly, since an id read wrong is a claim
// fetched wrong — and a route flattens into the claims along it.
test('every id in a served sequence reads back', async () => {
  for (const s of oracle.streams) {
    if (s.ids === undefined) continue
    if (s.kinds.includes('claim')) continue // readIds refuses a claim stream, by design
    const got: string[] = []
    for await (const id of readIds(bodyOf(bytesOf(s), 5), s.encoding)) got.push(id)
    assert.deepEqual(got, s.ids, `${s.encoding} ${s.label}`)
  }
})

// A report trails the results in whichever encoding the run asked for, so a claim
// reader passes over it rather than failing at the end of every reported run.
test('a claim reader passes over the trailing report', async () => {
  for (const s of oracle.streams) {
    if (!s.kinds.includes('claim') || !s.kinds.includes('report')) continue
    const types: string[] = []
    for await (const c of readClaims(bodyOf(bytesOf(s), 3), s.encoding)) types.push(c.type)
    assert.deepEqual(types, ['source/note'], `${s.encoding} ${s.label}`)
  }
})

// The report's own fields, which had three spellings across the system before
// ranke-go tagged them. A duration says its unit, being a bare integer.
test('the report reads under wire names, in nanoseconds', async () => {
  for (const s of oracle.streams) {
    if (!s.kinds.includes('report')) continue
    const records: ResultRecord[] = []
    for await (const rec of readRecords(bodyOf(bytesOf(s), 11), s.encoding)) records.push(rec)

    const report = records.at(-1)
    assert.ok(report?.kind === 'report', `${s.encoding} ${s.label} ends with the report`)
    assert.equal(report.report.started_at, '2026-01-02T03:04:05Z')
    assert.equal(report.report.elapsed_ns, 1_500_000_000, 'nanoseconds, as the name says')
    assert.equal(report.report.results, 1)
  }
})

// The point of the fix: a CBOR sequence holds only CBOR. A JSON record in one
// mis-decodes rather than failing, since a leading '"' is a valid CBOR negative
// integer — so this asserts the bytes, not merely that reading them succeeds.
test('a cbor sequence carries no JSON', () => {
  for (const s of oracle.streams) {
    if (s.encoding !== 'cbor') continue
    const bytes = bytesOf(s)
    assert.notEqual(bytes[0], 0x22, `${s.label} opens with a JSON string`)
    assert.notEqual(bytes[0], 0x5b, `${s.label} opens with a JSON array`)
    assert.notEqual(bytes[0], 0x7b, `${s.label} opens with a JSON object`)
  }
})

// And a json sequence keeps its framing: RFC 7464 brackets each record with RS and LF.
test('a json sequence keeps its record separators', () => {
  for (const s of oracle.streams) {
    if (s.encoding !== 'json') continue
    const bytes = bytesOf(s)
    assert.equal(bytes[0], 0x1e, `${s.label} opens with a record separator`)
    assert.equal(bytes.at(-1), 0x0a, `${s.label} ends with a newline`)
    const separators = bytes.filter((b) => b === 0x1e).length
    assert.equal(separators, s.kinds.length, `${s.label} has one separator per record`)
  }
})
