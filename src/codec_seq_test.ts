import assert from 'node:assert/strict'
import test from 'node:test'

import { RankeDecodeError } from './codec.ts'
import { newSeqReader, readClaims } from './codec_seq.ts'
import * as fx from './testing/fixtures.ts'

// A result run is thousands of claims arriving over a stream, so the reader is fed
// chunks that fall wherever the network puts them. Every case here checks the same
// property: the claims read are the same however the bytes were split.

const LABELS = fx.all.map((f) => f.label)

function cborStream(): Uint8Array {
  const parts = fx.all.map(fx.cborBytes)
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function jsonSeqStream(): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const f of fx.all) {
    parts.push(Uint8Array.of(0x1e), enc.encode(JSON.stringify(f.json)), Uint8Array.of(0x0a))
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// feed pushes the stream in chunks of the given size and returns every claim read.
function feed(encoding: 'cbor' | 'json', stream: Uint8Array, chunk: number): string[] {
  const r = newSeqReader(encoding)
  const labels: string[] = []
  for (let i = 0; i < stream.length; i += chunk) {
    for (const c of r.push(stream.subarray(i, Math.min(i + chunk, stream.length)))) {
      labels.push(c.type)
    }
  }
  for (const c of r.end()) labels.push(c.type)
  return labels
}

const TYPES = fx.all.map((f) => (f.json as { type: string }).type)

test('a cbor sequence reads whole', () => {
  assert.deepEqual(feed('cbor', cborStream(), Number.MAX_SAFE_INTEGER), TYPES)
})

// One byte at a time is the worst case: every record boundary falls inside a chunk,
// so the reader must hold a partial value across every single push.
test('a cbor sequence reads one byte at a time', () => {
  assert.deepEqual(feed('cbor', cborStream(), 1), TYPES)
})

test('a cbor sequence reads at every chunk size', () => {
  const stream = cborStream()
  for (const size of [2, 3, 7, 16, 31, 64, 97, 256, 1024]) {
    assert.deepEqual(feed('cbor', stream, size), TYPES, `chunk ${size}`)
  }
})

test('a json sequence reads at every chunk size', () => {
  const stream = jsonSeqStream()
  for (const size of [1, 2, 5, 13, 64, 200, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(feed('json', stream, size), TYPES, `chunk ${size}`)
  }
})

// A truncated result is not an empty one, so the reader must say so rather than
// report the claims it did manage.
test('a cbor stream cut mid-record fails at end', () => {
  const stream = cborStream()
  const r = newSeqReader('cbor')
  const read = r.push(stream.subarray(0, stream.length - 4))
  assert.ok(read.length < fx.all.length, 'the last record is incomplete')
  assert.throws(() => r.end(), RankeDecodeError)
})

test('bytesRead counts what was fed', () => {
  const stream = cborStream()
  const r = newSeqReader('cbor')
  r.push(stream.subarray(0, 10))
  assert.equal(r.bytesRead, 10)
  r.push(stream.subarray(10))
  assert.equal(r.bytesRead, stream.length)
})

test('malformed bytes stop the stream rather than stalling it', () => {
  const r = newSeqReader('cbor')
  // A head outside its shortest form: no further chunk can make it canonical.
  assert.throws(() => r.push(Uint8Array.of(0x18, 0x17)), Error)
})

test('the claims a stream yields carry their fields', () => {
  const r = newSeqReader('cbor')
  const claims = [...r.push(cborStream()), ...r.end()]
  const src = claims.find((c) => c.type === 'source/register')
  assert.ok(src)
  assert.equal(src.fields.title, 'Register of 1834')
  assert.equal(src.content.kind, 'inline')
})

// readClaims is the wrapper a caller reaches for over a fetch body.
test('readClaims iterates a ReadableStream', async () => {
  const stream = cborStream()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < stream.length; i += 11) {
        controller.enqueue(stream.subarray(i, Math.min(i + 11, stream.length)))
      }
      controller.close()
    },
  })
  const got: string[] = []
  for await (const claim of readClaims(body, 'cbor')) got.push(claim.type)
  assert.deepEqual(got, TYPES)
})

test('readClaims iterates a json sequence', async () => {
  const stream = jsonSeqStream()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(stream.subarray(0, 3))
      controller.enqueue(stream.subarray(3))
      controller.close()
    },
  })
  const got: string[] = []
  for await (const claim of readClaims(body, 'json')) got.push(claim.type)
  assert.deepEqual(got, TYPES)
})

test('an empty stream yields nothing', () => {
  for (const encoding of ['cbor', 'json'] as const) {
    const r = newSeqReader(encoding)
    assert.deepEqual(r.push(new Uint8Array(0)), [])
    assert.deepEqual(r.end(), [])
  }
})

test('the fixture labels are all present, so the stream covers each shape', () => {
  assert.deepEqual(LABELS, [
    'contributor',
    'source',
    'entity',
    'relation',
    'deletion',
    'identity-root',
    'identity-note',
    'identity-derived',
  ])
})
