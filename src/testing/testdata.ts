// package: testing / testdata
// type:    io
// job:     resolving ranke-graph's published reference-artifact set — fetch, unpack, read the
// manifest
// limits:  transport and schema; running the cases is vectors_test.ts's
//
// Mirrors ranke-go's internal/vectors. The set is the spec's artifact rather than
// either implementation's, so running it is what lets ranke-ts fail conformance —
// and it is the only reference data here carrying cases that must be REFUSED.

import { gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** LatestURL serves the newest published artifact set. */
export const LatestURL =
  'https://github.com/flocko-motion/ranke-graph/releases/latest/download/ranke-testdata.tar.gz'

/** MANIFEST is the manifest's filename inside a set. */
export const MANIFEST = 'manifest.json'

// Reason codes, so a test asserts the outcome it expected rather than any refusal.
export const ReasonOK = 'ok'
export const ReasonIDMismatch = 'id_mismatch'
export const ReasonWrongMessage = 'wrong_message'
export const ReasonMalformedID = 'malformed_id'
export const ReasonIdentitySign = 'identity_sign_mismatch'
export const ReasonNoContributor = 'unresolvable_contributor'
export const ReasonHeightWrong = 'height_wrong'
export const ReasonContentMismatch = 'content_hash_mismatch'

/**
 * ClaimCase is one claim record under the id it is offered as. The id is not part of
 * the record, so the pairing is what a case asserts.
 */
export interface ClaimCase {
  readonly file: string
  readonly id: string
  readonly verify: boolean
  readonly reason: string
  readonly why: string
}

/** ContentCase is one content blob under the hash it is offered as. */
export interface ContentCase {
  readonly file: string
  readonly hash: string
  readonly verify: boolean
  readonly reason: string
  readonly why: string
}

export interface Provenance {
  readonly generator: string
  readonly version: string
  readonly generated_at: string
}

/** Manifest names every artifact and the outcome an implementation must reach. */
export interface Manifest {
  readonly note: string
  readonly provenance: Provenance
  readonly claims: readonly ClaimCase[]
  readonly content: readonly ContentCase[]
}

/** ArtifactSet is a resolved set: where it lives, and what it expects. */
export interface ArtifactSet {
  readonly root: string
  readonly manifest: Manifest
  /** origin says where the set came from, for a test to report. */
  readonly origin: string
}

// TESTDATA_DIR names an already-extracted set, for working offline or against one
// not yet published. TESTDATA_URL overrides the source, for a fork or a staged
// release.
const DIR_ENV = 'RANKE_TESTDATA_DIR'
const URL_ENV = 'RANKE_TESTDATA_URL'

const cacheRoot = new URL('../../testdata/', import.meta.url).pathname

/**
 * resolveArtifacts returns the set: the directory RANKE_TESTDATA_DIR names, else the
 * published bundle, downloaded once and cached.
 *
 * An unreachable set is an error and never a skip: silently not checking conformance
 * is the one outcome worse than a red run.
 */
export async function resolveArtifacts(): Promise<ArtifactSet> {
  const named = process.env[DIR_ENV]
  if (named !== undefined && named !== '') {
    return { root: named, manifest: loadManifest(named), origin: `${DIR_ENV}=${named}` }
  }

  const url = process.env[URL_ENV] ?? LatestURL
  const extracted = join(cacheRoot, 'vectors')
  if (existsSync(join(extracted, MANIFEST))) {
    return { root: extracted, manifest: loadManifest(extracted), origin: `cache of ${url}` }
  }

  const tarball = join(cacheRoot, 'ranke-testdata.tar.gz')
  let gz: Uint8Array
  if (existsSync(tarball)) {
    gz = readFileSync(tarball)
  } else {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        `fetch ${url}: ${res.status} ${res.statusText} — point ${DIR_ENV} at an extracted set to work offline`,
      )
    }
    gz = new Uint8Array(await res.arrayBuffer())
    mkdirSync(dirname(tarball), { recursive: true })
    writeFileSync(tarball, gz)
  }

  const root = unpack(gz, extracted)
  return { root, manifest: loadManifest(root), origin: url }
}

function loadManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Manifest
}

/** readArtifact returns one file's bytes, named as the manifest names it. */
export function readArtifact(root: string, file: string): Uint8Array {
  return readFileSync(join(root, file))
}

// unpack extracts a gzipped ustar archive into dest and returns the directory holding
// the manifest. Hand-rolled: the format is 512-byte headers and padded bodies, and a
// tar dependency for a test fixture is not worth the supply chain.
function unpack(gz: Uint8Array, dest: string): string {
  const tar = new Uint8Array(gunzipSync(gz))
  let manifestDir = dest
  let at = 0

  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512)
    // Two zero blocks end the archive; one is enough to stop reading.
    if (header.every((b) => b === 0)) break
    at += 512

    const name = cstr(header.subarray(0, 100))
    const prefix = cstr(header.subarray(345, 500))
    const path = prefix === '' ? name : `${prefix}/${name}`
    const size = octal(header.subarray(124, 136))
    const kind = header[156] ?? 0

    const target = join(dest, stripLeadingDir(path))
    if (kind === 0x35 /* '5' */ || path.endsWith('/')) {
      mkdirSync(target, { recursive: true })
    } else {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, tar.subarray(at, at + size))
      if (stripLeadingDir(path) === MANIFEST) manifestDir = dest
    }
    // Bodies are padded to a 512-byte boundary.
    at += Math.ceil(size / 512) * 512
  }
  return manifestDir
}

// The bundle wraps everything in one directory, which the manifest's own paths do not
// include, so it is dropped.
function stripLeadingDir(path: string): string {
  const slash = path.indexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

function cstr(b: Uint8Array): string {
  const end = b.indexOf(0)
  return new TextDecoder().decode(end < 0 ? b : b.subarray(0, end)).trim()
}

function octal(b: Uint8Array): number {
  const text = cstr(b).replace(/\0/g, '').trim()
  return text === '' ? 0 : Number.parseInt(text, 8)
}
