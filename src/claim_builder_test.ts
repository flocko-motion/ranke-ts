import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RankeBuildError,
  contributorFrom,
  edgeIdOf,
  heightOf,
  newClaim,
  newEdge,
  normalizeCreatedAt,
} from './claim_builder.ts'
import { decodeClaim } from './codec.ts'
import { parseId } from './id.ts'
import * as fx from './testing/fixtures.ts'

// An identity Sign makes the id the hash of the claim itself, so these are the cases
// a keyless implementation can reproduce whole. ranke-go built them; if this builder
// arrives at the same ids, it agrees on the type resolution, the contributor edge, the
// canonical edge order, the field ordering and every byte of S(v) at once.

const enc = new TextEncoder()

const AT_ROOT = '2026-01-02T03:04:15.123456789Z'
const AT_NOTE = '2026-01-02T03:04:16.123456789Z'
const AT_DERIVED = '2026-01-02T03:04:17.123456789Z'

test('an identity-signed root contributor matches ranke-go', () => {
  const built = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  assert.equal(built.id, fx.identityRoot.id)
  assert.equal(Buffer.from(built.bytes).toString('hex'), fx.identityRoot.cbor)
})

test('an identity-signed source matches ranke-go', () => {
  const root = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  const built = newClaim({
    type: 'source/note',
    contributor: contributorFrom(root.claim),
    content: {
      kind: 'inline',
      bytes: enc.encode('signed by nobody in particular'),
      size: 30,
      encoding: 'text/plain',
    },
    fields: { b: 'sorts first', aa: 'sorts second' },
    createdAt: AT_NOTE,
    height: heightOf(root.claim),
  })
  assert.equal(built.id, fx.identityNote.id)
  assert.equal(Buffer.from(built.bytes).toString('hex'), fx.identityNote.cbor)
})

// Two edges, so the canonical order — by raw id bytes — is exercised rather than
// assumed. Getting it wrong changes S(v) and so changes the id.
test('a claim with two edges matches ranke-go, edge order included', () => {
  const root = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  const contributor = contributorFrom(root.claim)
  const note = newClaim({
    type: 'source/note',
    contributor,
    content: {
      kind: 'inline',
      bytes: enc.encode('signed by nobody in particular'),
      size: 30,
      encoding: 'text/plain',
    },
    fields: { b: 'sorts first', aa: 'sorts second' },
    createdAt: AT_NOTE,
    height: heightOf(root.claim),
  })

  const built = newClaim({
    type: 'derivation/summary',
    contributor,
    edges: [{ reference: note.id, type: 'derivation/note' }],
    content: {
      kind: 'inline',
      bytes: enc.encode('a summary of nothing'),
      size: 20,
      encoding: 'text/plain',
    },
    createdAt: AT_DERIVED,
    height: heightOf(root.claim, note.claim),
  })
  assert.equal(built.id, fx.identityDerived.id)
  assert.equal(Buffer.from(built.bytes).toString('hex'), fx.identityDerived.cbor)
  // The edge order is part of S(v), so it must be ranke-go's and not insertion order.
  assert.deepEqual(
    built.claim.edges.map((e) => e.type),
    (fx.identityDerived.edges ?? []).map((e) => e.type),
  )
})

// The claim a builder returns is the claim a decode of its own bytes yields, so a
// caller can store the bytes and read back what it built.
test('what is built decodes to itself', () => {
  const root = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  assert.deepEqual(decodeClaim(root.bytes, root.id), root.claim)
})

// --- signing ---

test('a signer produces a multikey-framed id', () => {
  const pubkey = Uint8Array.from(Buffer.from('ed01' + '00'.repeat(32), 'hex'))
  const signature = new Uint8Array(64).fill(7)
  let signed: Uint8Array | null = null
  const built = newClaim({
    type: 'contribution/contributor',
    content: { kind: 'inline', bytes: pubkey, size: pubkey.length, encoding: 'application/octet-stream' },
    createdAt: AT_ROOT,
    signer: {
      pubkey,
      sign(message) {
        signed = message
        return signature
      },
    },
  })

  // The message signed is the 34-byte multihash of S(v), not the bare digest — which
  // is what ranke-go signs, so a client using WebCrypto must pass these bytes through.
  assert.ok(signed !== null)
  const message = signed as unknown as Uint8Array
  assert.equal(message.length, 34)
  assert.equal(message[0], 0x12, 'the sha2-256 multicodec')
  assert.equal(message[1], 0x20, 'the digest length')

  // The id is the signature under the Ed25519 multikey framing, so it reads as a
  // signature rather than a hash and carries the bytes the signer returned.
  const id = parseId(built.id)
  assert.equal(id.algorithm(), 'ed25519-pub')
  const raw = id.rawBytes()
  assert.equal(raw.length, 2 + 64)
  assert.deepEqual(Uint8Array.from(raw.subarray(2)), signature)
})

test('a claim declaring a key refuses to identity-sign', () => {
  const pubkey = Uint8Array.from(Buffer.from('ed01' + '11'.repeat(32), 'hex'))
  assert.throws(
    () =>
      newClaim({
        type: 'contribution/contributor',
        content: {
          kind: 'inline',
          bytes: pubkey,
          size: pubkey.length,
          encoding: 'application/octet-stream',
        },
        createdAt: AT_ROOT,
      }),
    RankeBuildError,
  )
})

test('a signer whose key the claim does not declare is refused', () => {
  const declared = Uint8Array.from(Buffer.from('ed01' + '11'.repeat(32), 'hex'))
  const other = Uint8Array.from(Buffer.from('ed01' + '22'.repeat(32), 'hex'))
  assert.throws(
    () =>
      newClaim({
        type: 'contribution/contributor',
        content: {
          kind: 'inline',
          bytes: declared,
          size: declared.length,
          encoding: 'application/octet-stream',
        },
        createdAt: AT_ROOT,
        signer: { pubkey: other, sign: () => new Uint8Array(64) },
      }),
    RankeBuildError,
  )
})

// --- the rules ---

function root() {
  return contributorFrom(newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT }).claim)
}

test('a claim other than a root contributor states a contributor', () => {
  assert.throws(() => newClaim({ type: 'source/note', createdAt: AT_ROOT }), RankeBuildError)
})

// §3.5: a derivation, entity or relation claim rests on stated provenance.
test('the provenance invariant is enforced', () => {
  for (const type of ['derivation/summary', 'entity/person', 'relation/family']) {
    assert.throws(
      () => newClaim({ type, contributor: root(), createdAt: AT_ROOT, height: 1 }),
      RankeBuildError,
      type,
    )
  }
  // A source rests on nothing, so it needs no derivation edge.
  newClaim({ type: 'source/note', contributor: root(), createdAt: AT_ROOT, height: 1 })
})

test('content and its encoding travel together', () => {
  const contributor = root()
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_ROOT,
        height: 1,
        content: { kind: 'inline', bytes: enc.encode('x'), size: 1, encoding: '' },
      }),
    RankeBuildError,
    'content without an encoding',
  )
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_ROOT,
        height: 1,
        content: { kind: 'inline', bytes: enc.encode('xyz'), size: 99, encoding: 'text/plain' },
      }),
    RankeBuildError,
    'a size that is not the bytes carried',
  )
})

test('an unknown class is refused', () => {
  assert.throws(() => newClaim({ type: 'nonsense/x', createdAt: AT_ROOT }), RankeBuildError)
  assert.throws(() => newEdge({ reference: fx.ids.source!, type: 'source/x' }), RankeBuildError)
})

test('a relation edge states its direction, and nothing else may', () => {
  assert.throws(
    () => newEdge({ reference: fx.ids.source!, type: 'relation/family' }),
    RankeBuildError,
    'a relation edge with no direction',
  )
  assert.throws(
    () => newEdge({ reference: fx.ids.source!, type: 'derivation/note', relationDirection: 1 }),
    RankeBuildError,
    'a direction outside relation/*',
  )
  newEdge({ reference: fx.ids.source!, type: 'relation/family', relationDirection: -1 })
})

test('a contribution/* claim takes no delete_by', () => {
  assert.throws(
    () =>
      newClaim({
        type: 'contribution/contributor',
        createdAt: AT_ROOT,
        fields: { delete_by: '2030-01-01T00:00:00.000000000Z' },
      }),
    RankeBuildError,
  )
})

// R-DELBY: the target's schedule travels with the reference, so an edge takes it from
// the claim it names.
test('an edge carries its target delete_by', () => {
  const contributor = root()
  const scheduled = newClaim({
    type: 'source/note',
    contributor,
    createdAt: AT_ROOT,
    height: 1,
    fields: { delete_by: '2030-01-01T00:00:00.000000000Z' },
  })
  const e = newEdge({
    reference: scheduled.id,
    type: 'derivation/note',
    referenced: scheduled.claim,
  })
  assert.equal(e.fields?.delete_by, '2030-01-01T00:00:00.000000000Z')
})

test('a diff claim names every edge beyond the singletons', () => {
  const contributor = root()
  const base = newClaim({ type: 'source/note', contributor, createdAt: AT_ROOT, height: 1 })
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 2,
        diffOf: base.id,
        edges: [{ reference: base.id, type: 'derivation/note' }],
      }),
    RankeBuildError,
    'an unnamed edge on a diff claim',
  )
  newClaim({
    type: 'source/note',
    contributor,
    createdAt: AT_NOTE,
    height: 2,
    diffOf: base.id,
    edges: [{ reference: base.id, type: 'derivation/note', fields: { name: 'body' } }],
  })
})

test('a claim carries one contributor edge', () => {
  const contributor = root()
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_ROOT,
        height: 1,
        edges: [{ reference: contributor.id, type: 'contribution/contributor' }],
      }),
    RankeBuildError,
  )
})

test('an invalid field name is refused', () => {
  assert.throws(
    () => newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT, fields: { Upper: 'x' } }),
    RankeBuildError,
  )
})

// --- helpers ---

test('heightOf is one above the highest it cites', () => {
  const a = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT }).claim
  assert.equal(heightOf(), 0)
  assert.equal(heightOf(a), 1)
})

test('edgeIdOf is H(S(e))', () => {
  const e = newEdge({ reference: fx.ids.source!, type: 'derivation/note' })
  assert.equal(parseId(edgeIdOf(e)).algorithm(), 'sha2-256', 'an edge id is a hash, never a signature')
  // The claim that carries it reports the same id, so the two paths agree.
  const built = newClaim({
    type: 'derivation/note',
    contributor: root(),
    createdAt: AT_ROOT,
    height: 2,
    edges: [{ reference: fx.ids.source!, type: 'derivation/note' }],
  })
  const carried = decodeClaim(built.bytes, built.id, { edgeIds: true }).edges.find(
    (x) => x.reference === fx.ids.source,
  )
  assert.equal(carried?.id, edgeIdOf(e))
})

test('normalizeCreatedAt holds the canonical timestamp form', () => {
  assert.equal(normalizeCreatedAt(new Date('2026-01-02T03:04:05.123Z')), '2026-01-02T03:04:05.123000000Z')
  assert.equal(normalizeCreatedAt(AT_ROOT), AT_ROOT)
  assert.throws(() => normalizeCreatedAt('2026-01-02T03:04:05Z'), RankeBuildError)
  assert.throws(() => normalizeCreatedAt('2026-01-02T03:04:05.123Z'), RankeBuildError)
})

// A mock graph is what this exists for: a keyless contributor and claims resting on
// each other, every id being the hash of what it contains.
test('a mock graph builds and reads back', () => {
  const rootClaim = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  const contributor = contributorFrom(rootClaim.claim)
  const sources = [0, 1, 2].map((i) =>
    newClaim({
      type: 'source/note',
      contributor,
      createdAt: AT_NOTE,
      height: 1,
      fields: { title: `note ${i}` },
    }),
  )
  const summary = newClaim({
    type: 'derivation/summary',
    contributor,
    createdAt: AT_DERIVED,
    height: 2,
    edges: sources.map((s) => ({ reference: s.id, type: 'derivation/note' })),
  })

  assert.equal(new Set(sources.map((s) => s.id)).size, 3, 'distinct claims get distinct ids')
  assert.equal(summary.claim.edges.length, 4, 'three sources plus the contributor')
  assert.equal(summary.claim.height, 2)
  for (const s of sources) {
    assert.ok(summary.claim.edges.some((e) => e.reference === s.id))
  }
})
