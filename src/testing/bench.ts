// package: testing / bench
// type:    tool
// job:     measures a build and a decode, printing a baseline someone can re-run
// limits:  measurement only, excluded from the published build; asserts nothing, so it is
// no part of `verify`
//
// Run it with `make bench`. The figures the perf work was judged by lived in a chat log,
// which said nothing about whether 243 us/claim was fixed or forgotten; this says.
//
// A minimum over several runs, since a host under other load only ever makes a run
// slower: the fastest run is the one least disturbed. The spread is printed too, because
// the host these figures were first taken on swung 28% between two runs of one build.

import { readFileSync } from 'node:fs'

import type { Claim, Edge } from '../claim.ts'
import { contributorFrom, newClaim, newEdge } from '../claim_builder.ts'
import {
  type EdgeRecord,
  type NodeRecord,
  claimFromRecord,
  decodeClaim,
  encodeClaim,
  encodeClaimFromNode,
  encodeEdge,
  encodeNode,
  encodeNodeWithEdges,
} from '../codec.ts'
import { hashContent, idFromBytes } from '../id.ts'
import * as fx from './fixtures.ts'

// Recorded before the perf work, on another host: the ropes-per-id build, the builder
// decoding its own bytes, and each record encoded three times over. Printed alongside
// so a run says which way the numbers went, and dated by that description rather than
// offered as a target this host should reach.
const RECORDED = {
  buildMicros: 243,
  claimBytes: 8070,
  heapMiB: 56,
  consStringMiB: 35,
  claims: 5000,
}

const RUNS = 7
const ITERATIONS = count(process.argv[2], 20000, 'iterations')
const DECODED_CLAIMS = count(process.argv[3], 5000, 'claims')

// A count reaches here from a command line, where anything at all can be typed, and a
// NaN would print as a report rather than as a mistake.
function count(arg: string | undefined, fallback: number, what: string): number {
  if (arg === undefined || arg === '') return fallback
  const n = Number(arg)
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`${what} is a whole number above zero, got ${JSON.stringify(arg)}`)
  }
  return n
}

// ─── the claim under measurement ──────────────────────────────────────

const AT_ROOT = '2026-01-02T03:04:15.123456789Z'
const AT = '2026-01-02T03:04:17.123456789Z'
const enc = new TextEncoder()

const rootBuild = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
const contributor = contributorFrom(rootBuild.claim)
const notes = [0, 1, 2].map((i) =>
  newClaim({
    type: 'source/note',
    contributor,
    createdAt: AT_ROOT,
    height: 1,
    fields: { title: `note ${i}` },
  }),
)

// Four edges: three the caller states and the contributor edge the attribution adds,
// which is the shape the recorded figure was taken on.
const input = {
  type: 'derivation/summary',
  contributor,
  createdAt: AT,
  height: 2,
  fields: { title: 'a summary', name: 'of three notes' },
  content: {
    kind: 'inline' as const,
    bytes: enc.encode('a summary of three notes, none of which say anything'),
    size: 52,
    encoding: 'text/plain',
  },
  edges: notes.map((n) => ({ reference: n.id, type: 'derivation/note' })),
}

const built = newClaim(input)
const record = asRecord(built.claim)
const edgeInputs = input.edges
const edgeBytes = (record.edges ?? []).map(encodeEdge)
const node = encodeNodeWithEdges(record, edgeBytes)

// asRecord is the record a decoded claim came from — the same reading codec_encode_test.ts
// takes to re-encode a fixture. Nothing is derived: every value came off the wire.
function asRecord(c: Claim): NodeRecord {
  return {
    typeClass: c.typeClass,
    typeSub: c.typeSub,
    createdAt: c.createdAt,
    height: c.height,
    fields: c.fields,
    content: c.content,
    edges: c.edges.map(asEdgeRecord),
  }
}

function asEdgeRecord(e: Edge): EdgeRecord {
  return {
    reference: e.reference,
    typeClass: e.typeClass,
    typeSub: e.typeSub,
    relationDirection: e.relationDirection,
    fields: e.fields,
    content: e.content,
  }
}

// ─── timing ───────────────────────────────────────────────────────────

interface Timing {
  readonly min: number
  readonly max: number
}

function micros(f: () => unknown): Timing {
  for (let i = 0; i < Math.min(ITERATIONS, 5000); i++) f()
  let min = Infinity
  let max = 0
  for (let r = 0; r < RUNS; r++) {
    const started = process.hrtime.bigint()
    for (let i = 0; i < ITERATIONS; i++) f()
    const per = Number(process.hrtime.bigint() - started) / ITERATIONS / 1000
    if (per < min) min = per
    if (per > max) max = per
  }
  return { min, max }
}

const LABEL = 46

function row(label: string, value: string, unit: string, note = ''): void {
  const line = `${label.padEnd(LABEL)}${value.padStart(9)} ${unit.padEnd(3)}  ${note}`
  console.log(line.trimEnd())
}

// Every stage reports its spread as well as its minimum, so a reader sees how much of a
// difference between two figures this host can invent on its own.
function stage(label: string, t: Timing): void {
  row(label, t.min.toFixed(1), 'us', `spread ${t.min.toFixed(0)}-${t.max.toFixed(0)}`)
}

// ─── memory ───────────────────────────────────────────────────────────

const MiB = 1024 * 1024

function collect(): boolean {
  if (globalThis.gc === undefined) return false
  globalThis.gc()
  globalThis.gc() // a second pass collects what the first made unreachable
  return true
}

interface Read {
  /** Heap a decoded claim holds on to, per claim. */
  readonly bytesPerClaim: number
  /** RSS at its highest during the read, sampled as the claims accumulate. */
  readonly peakRssMiB: number
  readonly floorRssMiB: number
  /** A run without --expose-gc measures a heap that was never settled. */
  readonly settled: boolean
}

// read decodes n claims and keeps them, which is what a browser holding a graph does.
// Each takes a fresh id, as a served sequence does, so every claim owns its id string
// rather than sharing one the caller passed in.
function read(bytes: Uint8Array, n: number): Read {
  const seed = new Uint8Array(34)
  seed[0] = 0x12 // the sha2-256 multicodec, so each id reads as the hash a claim is named by
  seed[1] = 0x20
  const settled = collect()
  const floorRssMiB = process.memoryUsage().rss / MiB
  let peakRssMiB = floorRssMiB
  const before = process.memoryUsage().heapUsed

  const kept: Claim[] = new Array<Claim>(n)
  for (let i = 0; i < n; i++) {
    seed[2] = i & 0xff
    seed[3] = (i >>> 8) & 0xff
    // A copy, since an Id keeps the payload it was given and this one moves on.
    kept[i] = decodeClaim(bytes, idFromBytes(Uint8Array.from(seed)).toString())
    if ((i & 0xff) === 0) {
      const rss = process.memoryUsage().rss / MiB
      if (rss > peakRssMiB) peakRssMiB = rss
    }
  }

  collect()
  const bytesPerClaim = (process.memoryUsage().heapUsed - before) / n
  const rss = process.memoryUsage().rss / MiB
  if (rss > peakRssMiB) peakRssMiB = rss
  // kept stays reachable to here, so what was measured is what a caller would still hold.
  if (kept.length !== n) throw new Error('unreachable')
  return { bytesPerClaim, peakRssMiB, floorRssMiB, settled }
}

// ─── provenance ───────────────────────────────────────────────────────

// rankeGoVersion reads the release tools/go.mod requires, so a baseline is attributable
// the same way a fixture is: the reference implementation it was measured against.
function rankeGoVersion(): string {
  const mod = readFileSync(new URL('../../tools/go.mod', import.meta.url), 'utf8')
  const found = /^\s*require\s+github\.com\/flocko-motion\/ranke-go\s+(v\S+)/m.exec(mod)
  return found?.[1] ?? 'unknown — tools/go.mod names no ranke-go release'
}

// ─── the report ───────────────────────────────────────────────────────

console.log('ranke-ts bench — a baseline to re-run, and no gate: it asserts nothing')
console.log(`${process.version}, ${process.platform} ${process.arch}`)
console.log(`ranke-go ${rankeGoVersion()} (tools/go.mod), fixtures from ${fx.provenance.rankeGo}`)
console.log(`${ITERATIONS} iterations x ${RUNS} runs, the minimum run reported\n`)

console.log('=== build ===========================================================')
stage('newClaim, four edges', micros(() => newClaim(input)))
console.log('  of which')
stage('    newEdge x4: encode, hash, parse reference', micros(() => edgeInputs.map(newEdge)))
stage('    S(v), each edge already encoded', micros(() => encodeNodeWithEdges(record, edgeBytes)))
stage('    H(S(v))', micros(() => hashContent(node)))
stage('    the stored record around S(v)', micros(() => encodeClaimFromNode(node)))
stage('    the claim handed back', micros(() => claimFromRecord(record, built.id)))
console.log('  and no longer on the build path')
stage('    S(v), re-encoding every edge', micros(() => encodeNode(record)))
stage('    the stored record, encoding the node again', micros(() => encodeClaim(record)))
stage('    decodeClaim of the bytes just built', micros(() => decodeClaim(built.bytes, built.id)))
console.log('Each stage is timed on its own, so the parts do not sum to the whole.\n')

console.log('=== decode ==========================================================')
const richest = fx.cborBytes(fx.relation)
stage('decodeClaim, the richest fixture', micros(() => decodeClaim(richest, fx.relation.id)))
stage(
  'decodeClaim with every edge id',
  micros(() => decodeClaim(richest, fx.relation.id, { edgeIds: true })),
)
row('the stored record it reads', String(richest.length), 'B')

const r = read(richest, DECODED_CLAIMS)
if (!r.settled) console.log('(run without --expose-gc: the heap figures include what was uncollected)')
row('retained per decoded claim', r.bytesPerClaim.toFixed(0), 'B')
row(`retained over ${DECODED_CLAIMS} claims`, ((r.bytesPerClaim * DECODED_CLAIMS) / MiB).toFixed(1), 'MiB')
row('rss before the read', r.floorRssMiB.toFixed(1), 'MiB')
row('rss at its peak during it', r.peakRssMiB.toFixed(1), 'MiB')
row('rss at its peak, whole process', (process.resourceUsage().maxRSS / 1024).toFixed(1), 'MiB')
console.log()

console.log('=== recorded before the perf work, on another host ==================')
row('build, four edges', String(RECORDED.buildMicros), 'us')
row('retained per decoded claim', String(RECORDED.claimBytes), 'B')
row(`retained over ${RECORDED.claims} claims`, String(RECORDED.heapMiB), 'MiB', `${RECORDED.consStringMiB} MiB of it concatenated strings`)
