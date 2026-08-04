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
  NodeSubtypeDelete,
  NodeSubtypeDeleteAlias,
  NodeSubtypeDiff,
  NodeSubtypeDiffAlias,
  NodeSubtypeExpiry,
  NodeSubtypeExpiryAlias,
  NodeSubtypeHead,
  NodeSubtypeHeadAlias,
  nodeClassFromAlias,
  nodeClassToAlias,
  nodeSubtypeFromAlias,
  nodeSubtypeToAlias,
  validNodeClass,
} from './node_taxonomy.ts'
import { EdgeSubtypeDelete, EdgeSubtypeExpiry, edgeSubtypeToAlias } from './edge_taxonomy.ts'
import { checkAliasRoundTrip, checkSingleCharacter } from './testing/alias_check.ts'

// Foundation unit tests for the node wire aliases (§5.1). To optimise encoding size
// the reserved vocabulary has one-character short forms, and "an alias is
// semantically identical to its long form." testing/alias_check.ts holds the
// assertions that pin it, shared with the other taxonomy tests.

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
      [NodeSubtypeDelete, NodeSubtypeDeleteAlias],
      [NodeSubtypeExpiry, NodeSubtypeExpiryAlias],
    ]),
    nodeSubtypeToAlias,
    nodeSubtypeFromAlias,
    'email', // open vocabulary
  )
})

// A limiting claim and the edge naming its target share a type string, so the two
// alias tables must abbreviate it the same way — otherwise one claim's node and
// edge disagree on what "delete" is called.
test('limiting subtypes agree across the node and edge tables', () => {
  assert.equal(nodeSubtypeToAlias(NodeSubtypeDelete), edgeSubtypeToAlias(EdgeSubtypeDelete))
  assert.equal(nodeSubtypeToAlias(NodeSubtypeExpiry), edgeSubtypeToAlias(EdgeSubtypeExpiry))
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
      NodeSubtypeDelete,
      NodeSubtypeExpiry,
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
