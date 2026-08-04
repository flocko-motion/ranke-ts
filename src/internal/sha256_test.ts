import { createHash, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'

import { sha256 } from './sha256.ts'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const nodeSha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

// FIPS 180-4 published vectors, so a wrong constant table fails here rather than
// only against another implementation that shares the mistake.
test('FIPS 180-4 vectors', () => {
  assert.equal(
    hex(sha256(new Uint8Array(0))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.equal(
    hex(sha256(Buffer.from('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(
    hex(sha256(Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  )
})

// The million-'a' vector: enough blocks that a bug in the message schedule or in
// the running state, rather than in padding, shows up.
test('FIPS 180-4 one million a', () => {
  assert.equal(
    hex(sha256(Buffer.alloc(1_000_000, 0x61))),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  )
})

// Padding has three regimes: the length fits beside the message (<= 55), it
// overflows into a second block (56..63), and the message ends on a block
// boundary. Every length to 135 covers each regime twice.
test('every length through 135 bytes', () => {
  for (let n = 0; n <= 135; n++) {
    const msg = Buffer.alloc(n)
    for (let i = 0; i < n; i++) msg[i] = (i * 7 + 13) & 0xff
    assert.equal(hex(sha256(msg)), nodeSha(msg), `length ${n}`)
  }
})

// A differential test is the strongest check available: node:crypto is the oracle,
// and random inputs cover shapes no hand-picked fixture would.
test('agrees with node:crypto over random inputs', () => {
  for (let i = 0; i < 2000; i++) {
    const b = randomBytes(i % 517)
    assert.equal(hex(sha256(b)), nodeSha(b))
  }
})

test('agrees with node:crypto on sizes spanning many blocks', () => {
  for (const n of [136, 511, 512, 513, 1023, 1024, 1025, 4096, 65_536, 100_003]) {
    const b = randomBytes(n)
    assert.equal(hex(sha256(b)), nodeSha(b), `length ${n}`)
  }
})

// Hashing must read only the view it was given, so a digest over a subarray
// matches the digest over an equal standalone array.
test('respects a subarray view', () => {
  const backing = randomBytes(300)
  const view = backing.subarray(37, 200)
  assert.equal(hex(sha256(view)), nodeSha(Uint8Array.from(view)))
})

test('leaves its input untouched', () => {
  const b = randomBytes(200)
  const before = Buffer.from(b)
  sha256(b)
  assert.deepEqual(Buffer.from(b), before)
})

// Byte 0x80 is the padding terminator, so a message made of it would expose any
// confusion between message bytes and padding.
test('handles messages made of the padding byte', () => {
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120]) {
    const b = Buffer.alloc(n, 0x80)
    assert.equal(hex(sha256(b)), nodeSha(b), `length ${n}`)
  }
})

test('is repeatable across calls', () => {
  const b = randomBytes(1000)
  assert.equal(hex(sha256(b)), hex(sha256(b)))
})
