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
  EdgeSubtypeDelete,
  EdgeSubtypeDeleteAlias,
  EdgeSubtypeDiff,
  EdgeSubtypeDiffAlias,
  EdgeSubtypeExpiry,
  EdgeSubtypeExpiryAlias,
  EdgeSubtypeHead,
  EdgeSubtypeHeadAlias,
  EdgeSubtypePrune,
  EdgeSubtypePruneAlias,
  EdgeTypeContributor,
  EdgeTypeDelete,
  EdgeTypeDiff,
  EdgeTypeExpiry,
  RelationFrom,
  RelationTo,
  edgeClassFromAlias,
  edgeClassToAlias,
  edgeSubtypeFromAlias,
  edgeSubtypeToAlias,
  validEdgeClass,
} from './edge_taxonomy.ts'
import { checkAliasRoundTrip, checkSingleCharacter } from './testing/alias_check.ts'

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
      [EdgeSubtypeDelete, EdgeSubtypeDeleteAlias],
      [EdgeSubtypeExpiry, EdgeSubtypeExpiryAlias],
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
      EdgeSubtypeDelete,
      EdgeSubtypeExpiry,
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
  // A limiting claim and the edge naming its target share a type string, so these
  // must equal NodeDelete / NodeExpiry once node.ts lands.
  assert.equal(EdgeTypeDelete, 'contribution/delete')
  assert.equal(EdgeTypeExpiry, 'contribution/expiry')
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
