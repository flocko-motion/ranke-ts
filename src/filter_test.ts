import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

import { RankeTypeError, matchGlob, matchTypeList, splitType } from './filter.ts'

// glob_oracle.json holds Go's path.Match verdict for 476 pattern/name pairs,
// produced by running the reference implementation. ranke-go is right by
// definition, so this file is the specification of matchGlob rather than a sample
// of it: a disagreement means the port is wrong.
interface OracleRow {
  p: string
  n: string
  ok: boolean
  er: boolean
}

const oracle: OracleRow[] = JSON.parse(
  readFileSync(new URL('./testing/glob_oracle.json', import.meta.url), 'utf8'),
)

test('matchGlob agrees with Go path.Match on every oracle row', () => {
  assert.ok(oracle.length > 400, 'the oracle table is present')
  const disagreements: string[] = []
  for (const { p, n, ok, er } of oracle) {
    let got: boolean | 'error'
    try {
      got = matchGlob(p, n)
    } catch {
      got = 'error'
    }
    const want: boolean | 'error' = er ? 'error' : ok
    if (got !== want) {
      disagreements.push(`match(${JSON.stringify(p)}, ${JSON.stringify(n)}): want ${want}, got ${got}`)
    }
  }
  assert.deepEqual(disagreements, [])
})

// The property the type vocabulary rests on: a star selects within one class.
test('a star never crosses the separator', () => {
  assert.ok(matchGlob('derivation/*', 'derivation/register'))
  assert.ok(!matchGlob('derivation/*', 'derivation/a/b'))
  assert.ok(!matchGlob('*', 'derivation/register'))
  assert.ok(matchGlob('*/*', 'derivation/register'))
})

test('matchTypeList admits everything when empty', () => {
  assert.ok(matchTypeList([], 'derivation/register'))
  assert.ok(matchTypeList([], 'anything/at/all'))
})

test('matchTypeList requires a positive when one is present', () => {
  const list = ['derivation/*', 'relation/*']
  assert.ok(matchTypeList(list, 'derivation/register'))
  assert.ok(matchTypeList(list, 'relation/family'))
  assert.ok(!matchTypeList(list, 'source/register'))
})

// Only negatives means "match unless excluded", which is how a query says "every
// edge but the contributor one".
test('matchTypeList with only negatives excludes', () => {
  const list = ['-contribution/*']
  assert.ok(matchTypeList(list, 'derivation/register'))
  assert.ok(!matchTypeList(list, 'contribution/contributor'))
})

test('a negative overrides a positive it also matches', () => {
  const list = ['derivation/*', '-derivation/scan']
  assert.ok(matchTypeList(list, 'derivation/register'))
  assert.ok(!matchTypeList(list, 'derivation/scan'))
})

test('splitType splits at the first separator', () => {
  assert.deepEqual(splitType('source/register'), { typeClass: 'source', typeSub: 'register' })
  assert.deepEqual(splitType('a/b/c'), { typeClass: 'a', typeSub: 'b/c' })
})

// Mirrors ranke-go's splitType: a slash at either end leaves one half empty, which
// is a malformed type rather than a defaulted one.
test('splitType refuses a type missing either half', () => {
  for (const t of ['', 'source', '/register', 'source/', '/']) {
    assert.throws(() => splitType(t), RankeTypeError, JSON.stringify(t))
  }
})
