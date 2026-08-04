// package: testing / alias_check
// type:    logic
// job:     the shared alias-table assertions every taxonomy test runs
// limits:  test support, excluded from the published build
//
// ranke-go keeps these in node_taxonomy_test.go and shares them by package. Node
// runs each test file in its own process, so importing them from a test file would
// re-run that file's tests once per importer — hence a module of their own.

import assert from 'node:assert/strict'

/**
 * checkAliasRoundTrip asserts, for a closed alias namespace: each long form maps to
 * its stated alias and back; the round-trip is identity; an open/unknown value
 * passes through both directions unchanged; and no two long forms share an alias.
 *
 * An alias is semantically identical to its long form (§5.1), which holds only if
 * the mapping is a bijection — a duplicate would make decoding ambiguous.
 */
export function checkAliasRoundTrip(
  pairs: ReadonlyMap<string, string>,
  toAlias: (v: string) => string,
  fromAlias: (v: string) => string,
  openValue: string,
): void {
  const seen = new Map<string, string>()
  for (const [long, short] of pairs) {
    assert.equal(toAlias(long), short, `toAlias(${long})`)
    assert.equal(fromAlias(short), long, `fromAlias(${short})`)
    assert.equal(fromAlias(toAlias(long)), long, `round-trip of ${long}`)

    assert.notEqual(long, short, `alias must differ from the long form for ${long}`)
    const prev = seen.get(short)
    if (prev !== undefined) {
      assert.fail(`alias ${short} is shared by ${prev} and ${long} — decoding would be ambiguous`)
    }
    seen.set(short, long)
  }
  assert.equal(toAlias(openValue), openValue, 'open value passes through toAlias')
  assert.equal(fromAlias(openValue), openValue, 'open value passes through fromAlias')
}

/** checkSingleCharacter holds every alias to "the dot and one character" (§5.1). */
export function checkSingleCharacter(
  longs: readonly string[],
  toAlias: (v: string) => string,
): void {
  for (const long of longs) {
    assert.equal(toAlias(long).length, 1, `alias for ${long}`)
  }
}
