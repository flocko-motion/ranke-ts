import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EdgeClassContribution,
  EdgeClassContributionAlias,
  EdgeClassDerivation,
  EdgeClassDerivationAlias,
  EdgeClassRelation,
  EdgeClassRelationAlias,
  EdgeSubtypeBranch,
  EdgeSubtypeBranchAlias,
  EdgeSubtypeBranches,
  EdgeSubtypeBranchesAlias,
  EdgeSubtypeContributor,
  EdgeSubtypeContributorAlias,
  EdgeSubtypeDiff,
  EdgeSubtypeDiffAlias,
  EdgeSubtypeHead,
  EdgeSubtypeHeadAlias,
  EdgeSubtypePrune,
  EdgeSubtypePruneAlias,
  EdgeTypeContributor,
  EdgeTypeDiff,
  RelationFrom,
  RelationTo,
  edgeClassFromAlias,
  edgeClassToAlias,
  edgeSubtypeFromAlias,
  edgeSubtypeToAlias,
  validEdgeClass,
} from './edge_taxonomy.ts'
import { checkAliasRoundTrip, checkSingleCharacter } from './node_taxonomy_test.ts'

test('edge class aliases', () => {
  checkAliasRoundTrip(
    new Map([
      [EdgeClassContribution, EdgeClassContributionAlias],
      [EdgeClassDerivation, EdgeClassDerivationAlias],
      [EdgeClassRelation, EdgeClassRelationAlias],
    ]),
    edgeClassToAlias,
    edgeClassFromAlias,
    'madeupclass',
  )
})

test('edge subtype aliases', () => {
  checkAliasRoundTrip(
    new Map([
      [EdgeSubtypeContributor, EdgeSubtypeContributorAlias],
      [EdgeSubtypeHead, EdgeSubtypeHeadAlias],
      [EdgeSubtypeBranches, EdgeSubtypeBranchesAlias],
      [EdgeSubtypeBranch, EdgeSubtypeBranchAlias],
      [EdgeSubtypePrune, EdgeSubtypePruneAlias],
      [EdgeSubtypeDiff, EdgeSubtypeDiffAlias],
    ]),
    edgeSubtypeToAlias,
    edgeSubtypeFromAlias,
    'cites', // open vocabulary
  )
})

test('edge aliases are a single character', () => {
  checkSingleCharacter(
    [EdgeClassContribution, EdgeClassDerivation, EdgeClassRelation],
    edgeClassToAlias,
  )
  checkSingleCharacter(
    [
      EdgeSubtypeContributor,
      EdgeSubtypeHead,
      EdgeSubtypeBranches,
      EdgeSubtypeBranch,
      EdgeSubtypePrune,
      EdgeSubtypeDiff,
    ],
    edgeSubtypeToAlias,
  )
})

// Branch and branches differ only by case in their aliases, which is the pairing
// most likely to be transcribed the wrong way round.
test('branch and branches aliases differ by case', () => {
  assert.equal(edgeSubtypeToAlias(EdgeSubtypeBranch), 'b')
  assert.equal(edgeSubtypeToAlias(EdgeSubtypeBranches), 'B')
  assert.equal(edgeSubtypeFromAlias('b'), EdgeSubtypeBranch)
  assert.equal(edgeSubtypeFromAlias('B'), EdgeSubtypeBranches)
})

test('the closed edge type strings compose class and subtype', () => {
  assert.equal(EdgeTypeContributor, 'contribution/contributor')
  assert.equal(EdgeTypeDiff, 'contribution/diff')
})

test('validEdgeClass admits the closed set and nothing else', () => {
  for (const c of [EdgeClassContribution, EdgeClassDerivation, EdgeClassRelation]) {
    assert.ok(validEdgeClass(c), c)
  }
  // source and entity are node classes; no edge carries them.
  for (const c of ['source', 'entity', 'c', 'd', 'r', '']) {
    assert.ok(!validEdgeClass(c), JSON.stringify(c))
  }
})

test('relation directions are the signed pair', () => {
  assert.equal(RelationFrom, 1)
  assert.equal(RelationTo, -1)
})
