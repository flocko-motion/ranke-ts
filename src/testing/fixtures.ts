// package: testing / fixtures
// type:    data
// job:     the reference claims a decode is checked against, read from the generated file
// limits:  test support, excluded from the published build
//
// claim_fixtures.json is written by tools/fixtures, a Go program importing ranke-go.
// Nothing here is transcribed: a hand-copied record is one nibble away from testing
// the wrong thing, and this file exists because that happened.
//
// Regenerate with `scripts/fixtures.sh` whenever the record layout or the alias
// tables move. These are only the valid cases; the negative cases live in
// ranke-graph's published testdata (see vectors_test.ts).

import { readFileSync } from 'node:fs'

export interface Fixture {
  readonly label: string
  readonly id: string
  /** EncodeCBOR(FormOriginal), hex. */
  readonly cbor: string
  /** EncodeJSON(FormOriginal). */
  readonly json: unknown
  /** Each edge's type and id, in the claim's canonical edge order. */
  readonly edges: ReadonlyArray<{ readonly type: string; readonly id: string }>
}

interface FixtureFile {
  readonly note: string
  readonly ids: Readonly<Record<string, string>>
  readonly fixtures: readonly Fixture[]
}

const file: FixtureFile = JSON.parse(
  readFileSync(new URL('./claim_fixtures.json', import.meta.url), 'utf8'),
)

/** ids names each fixture claim, plus the external content hash one edge carries. */
export const ids = file.ids

export const all: readonly Fixture[] = file.fixtures

function byLabel(label: string): Fixture {
  const f = all.find((x) => x.label === label)
  if (f === undefined) throw new Error(`fixture ${label} is missing — regenerate the file`)
  return f
}

/** An initial node: a contributor claim whose content is its multikey pubkey. */
export const contributor = byLabel('contributor')
/** A source with inline content and three fields, two of which pin key ordering. */
export const source = byLabel('source')
/** An entity resting on the source it was read from. */
export const entity = byLabel('entity')
/**
 * The rich one: a relation claim whose edges carry a direction, their own fields,
 * inline content, and an external content address — every slot an edge holds.
 */
export const relation = byLabel('relation')
/** A limiting claim, which exercises the newly aliased contribution/delete subtype. */
export const deletion = byLabel('deletion')

/** cborBytes decodes a fixture's hex. */
export function cborBytes(f: Fixture): Uint8Array {
  const out = new Uint8Array(f.cbor.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(f.cbor.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
