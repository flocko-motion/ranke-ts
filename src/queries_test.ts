import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

import type { Claim } from './claim.ts'
import { decodeClaim } from './codec.ts'
import { contentNone, inlineBytes } from './content.ts'
import { NodeTypeContributor } from './node_taxonomy.ts'
import {
  BranchArchive,
  RankeQueriesError,
  contributorsByKey,
  contributorsByKeyQuery,
  contributorsQuery,
} from './queries.ts'
import { EncodeQuery, ValidateQuery } from './query_codec.ts'
import * as fx from './testing/fixtures.ts'

// The builders are checked against ranke-go's verdicts rather than against themselves:
// each query below is an accepted case in query_oracle.json, so what this library emits
// is a query the reference implementation took.
const oracle: { verdicts: { label: string; query: unknown; accepted: boolean }[] } = JSON.parse(
  readFileSync(new URL('./testing/query_oracle.json', import.meta.url), 'utf8'),
)

function accepted(label: string): unknown {
  const v = oracle.verdicts.find((x) => x.label === label)
  assert.ok(v !== undefined, `${label} is missing from the oracle — add it to tools/queryoracle`)
  assert.equal(v.accepted, true, `ranke-go refuses ${label}`)
  return v.query
}

test('contributorsQuery is the query ranke-go accepted', () => {
  assert.deepEqual(
    JSON.parse(EncodeQuery(contributorsQuery('main'))),
    accepted("queries.Contributors: a branch's contributor claims"),
  )
  assert.deepEqual(
    JSON.parse(EncodeQuery(contributorsQuery(BranchArchive))),
    accepted('queries.Contributors over the archive entire'),
  )
})

test('contributorsByKeyQuery is the query ranke-go accepted', () => {
  assert.deepEqual(
    JSON.parse(EncodeQuery(contributorsByKeyQuery('main'))),
    accepted('queries.ContributorsByKey: the same read with content inlined'),
  )
})

// EncodeQuery validates before it renders, so the assertions above already cover this.
// Stated separately so a change to either side has to answer for it by name.
test('both builders emit a query this library would send', () => {
  for (const q of [contributorsQuery('main'), contributorsByKeyQuery('main')]) {
    assert.doesNotThrow(() => ValidateQuery(q))
  }
})

// A contributor's pubkey is its own content (§5.7), so the filter is exercised over a
// claim that really came off the wire — ranke-go built and encoded this one.
const wire = decodeClaim(fx.cborBytes(fx.contributor), fx.ids.contributor)
const pubkey = inlineBytes(wire.content)

test('the fixture contributor carries a pubkey to select on', () => {
  assert.equal(wire.type, NodeTypeContributor)
  assert.ok(pubkey !== null && pubkey.length > 0, 'its content is the key')
})

test('contributorsByKey selects on the pubkey a claim carries', () => {
  assert.deepEqual(contributorsByKey([wire], pubkey!), [wire])
  const other = Uint8Array.from(pubkey!, (b, i) => (i === pubkey!.length - 1 ? b ^ 0xff : b))
  assert.deepEqual(contributorsByKey([wire], other), [])
})

// A decoded claim is plain data (README), so a second identity under one key is stated
// directly rather than built: what the filter reads is the content and nothing else.
function alias(id: string): Claim {
  return Object.freeze({ ...wire, id })
}

// No rule makes a pubkey unique, so one key registered twice is two identities carrying
// different provenance — and a caller has to be told about both, never handed one.
test('contributorsByKey returns every identity a key is registered under', () => {
  const twice = [wire, alias('bciqtwiceunderonekey')]
  const found = contributorsByKey(twice, pubkey!)
  assert.equal(found.length, 2)
  assert.deepEqual(
    found.map((c) => c.id),
    twice.map((c) => c.id),
  )
})

// A read that capped content leaves a prefix to match on, and answering "no contributor
// holds this key" off a prefix would be a wrong answer rather than an empty one. This is
// the state a query with no `output.content` yields (README, Content a read withheld).
test('a contributor whose pubkey the read cut short is refused, not skipped', () => {
  const withheld: Claim = Object.freeze({
    ...wire,
    content: { kind: 'inline' as const, bytes: new Uint8Array(0), size: pubkey!.length, encoding: 'application/octet-stream' },
  })
  assert.throws(
    () => contributorsByKey([withheld], pubkey!),
    (e: unknown) =>
      e instanceof RankeQueriesError && /contributorsByKeyQuery/.test((e as Error).message),
  )
})

// External content is addressed rather than carried, and fetching it is the caller's:
// this library holds no transport, so it says so instead of reporting no match.
test('a contributor addressing its pubkey externally is refused', () => {
  const addressed: Claim = Object.freeze({
    ...wire,
    content: {
      kind: 'external' as const,
      hash: wire.id,
      size: pubkey!.length,
      encoding: 'application/octet-stream',
    },
  })
  assert.throws(
    () => contributorsByKey([addressed], pubkey!),
    (e: unknown) => e instanceof RankeQueriesError && /fetches nothing/.test((e as Error).message),
  )
})

// A claim declaring no content carries no key, which is an answer rather than a gap — and
// the one case that must not throw, or a mixed set could never be filtered.
test('a claim with no content simply does not match', () => {
  const empty: Claim = Object.freeze({ ...wire, content: contentNone })
  assert.deepEqual(contributorsByKey([empty], pubkey!), [])
})
