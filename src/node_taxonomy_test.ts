import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NodeClassContribution,
  NodeClassContributionAlias,
  NodeClassDerivation,
  NodeClassDerivationAlias,
  NodeClassEntity,
  NodeClassEntityAlias,
  NodeClassRelation,
  NodeClassRelationAlias,
  NodeClassSource,
  NodeClassSourceAlias,
  NodeSubtypeBranch,
  NodeSubtypeBranchAlias,
  NodeSubtypeBranches,
  NodeSubtypeBranchesAlias,
  NodeSubtypeContributor,
  NodeSubtypeContributorAlias,
  NodeSubtypeDiff,
  NodeSubtypeDiffAlias,
  NodeSubtypeHead,
  NodeSubtypeHeadAlias,
  nodeClassFromAlias,
  nodeClassToAlias,
  nodeSubtypeFromAlias,
  nodeSubtypeToAlias,
  validNodeClass,
} from './node_taxonomy.ts'

// Foundation unit tests for the node wire aliases (§5.1). To optimise encoding size
// the reserved vocabulary has one-character short forms, and "an alias is
// semantically identical to its long form." That holds only if the mapping is a
// bijection, aliases don't collide (a duplicate would make decoding ambiguous), and
// open-vocabulary values pass through untouched. checkAliasRoundTrip pins all three
// and is shared with the other taxonomy tests.

/**
 * checkAliasRoundTrip asserts, for a closed alias namespace: each long form maps to
 * its stated alias and back; the round-trip is identity; an open/unknown value
 * passes through both directions unchanged; and no two long forms share an alias.
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

test('node class aliases', () => {
  checkAliasRoundTrip(
    new Map([
      [NodeClassContribution, NodeClassContributionAlias],
      [NodeClassSource, NodeClassSourceAlias],
      [NodeClassDerivation, NodeClassDerivationAlias],
      [NodeClassEntity, NodeClassEntityAlias],
      [NodeClassRelation, NodeClassRelationAlias],
    ]),
    nodeClassToAlias,
    nodeClassFromAlias,
    'madeupclass',
  )
})

test('node subtype aliases', () => {
  checkAliasRoundTrip(
    new Map([
      [NodeSubtypeContributor, NodeSubtypeContributorAlias],
      [NodeSubtypeBranch, NodeSubtypeBranchAlias],
      [NodeSubtypeBranches, NodeSubtypeBranchesAlias],
      [NodeSubtypeDiff, NodeSubtypeDiffAlias],
      [NodeSubtypeHead, NodeSubtypeHeadAlias],
    ]),
    nodeSubtypeToAlias,
    nodeSubtypeFromAlias,
    'email', // open vocabulary
  )
})

test('node aliases are a single character', () => {
  checkSingleCharacter(
    [NodeClassContribution, NodeClassSource, NodeClassDerivation, NodeClassEntity, NodeClassRelation],
    nodeClassToAlias,
  )
  checkSingleCharacter(
    [
      NodeSubtypeContributor,
      NodeSubtypeBranch,
      NodeSubtypeBranches,
      NodeSubtypeDiff,
      NodeSubtypeHead,
    ],
    nodeSubtypeToAlias,
  )
})

test('validNodeClass admits the closed set and nothing else', () => {
  for (const c of [
    NodeClassContribution,
    NodeClassSource,
    NodeClassDerivation,
    NodeClassEntity,
    NodeClassRelation,
  ]) {
    assert.ok(validNodeClass(c), c)
  }
  // The aliases are a wire form, so they are not classes in their own right.
  for (const c of ['c', 's', 'd', 'e', 'r', '', 'Contribution', 'madeupclass']) {
    assert.ok(!validNodeClass(c), JSON.stringify(c))
  }
})
