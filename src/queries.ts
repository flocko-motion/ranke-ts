// package: ranke / queries
// type:    logic
// job:     the named reads a caller needs before it can write anything — a branch's
// contributors, and which of them carry a given public key
// limits:  states the query and reads the answer back; sending it is the caller's transport
//
// Mirrors ranke-go's queries package, which runs each read against an Archive. There is no
// Archive here (see README), so a helper states the Query and the caller sends it — the same
// split query_codec.ts makes. Ordinary RQL either way, so a worked example as much as code.

import type { Claim } from './claim.ts'
import { contentComplete, contentHeld, contentSize, inlineBytes } from './content.ts'
import { NodeTypeContributor } from './node_taxonomy.ts'
import type { Query } from './query.ts'

/**
 * BranchArchive scopes a read to the archive entire, where a branch name confines to one.
 * ranke-go declares it in query.go; src/query.ts is generated and holds no constants.
 */
export const BranchArchive = '$archive'

/**
 * contributorsQuery asks for every `contribution/contributor` claim branch reaches, in
 * whatever order the engine yields them. Pass `BranchArchive` for the archive entire.
 */
export function contributorsQuery(branch: string): Query {
  return {
    select: { branch },
    where: { field: 'type', test: { eq: NodeTypeContributor } },
  }
}

/**
 * contributorsByKeyQuery is contributorsQuery asking for content too: a contributor's
 * pubkey IS its content. `max: 0` inlines it whole (`R-QCONTENT`), where ranke-go pays a
 * fetch per claim.
 */
export function contributorsByKeyQuery(branch: string): Query {
  return { ...contributorsQuery(branch), output: { content: { max: 0 } } }
}

/**
 * contributorsByKey selects the contributor claims carrying pubkey, one of whose ids its
 * holder must reference to sign (`V-SIG`). Several can match, no rule making a `pubkey`
 * unique, so choosing between two identities is the caller's (README). A pass over the
 * answer, RQL filtering on a claim's shape rather than its content.
 */
export function contributorsByKey(claims: readonly Claim[], pubkey: Uint8Array): Claim[] {
  const out: Claim[] = []
  for (const c of claims) {
    if (c.content.kind === 'external') {
      throw new RankeQueriesError(
        `${c.id} addresses its pubkey as external content (${c.content.hash}) — ` +
          'fetch those bytes and compare them yourself; this library fetches nothing',
      )
    }
    if (!contentComplete(c.content)) {
      throw new RankeQueriesError(
        `${c.id} holds ${contentHeld(c.content)} of the ${contentSize(c.content)} bytes it ` +
          'declares, so its pubkey is cut short — ask with contributorsByKeyQuery',
      )
    }
    // A claim declaring no content carries no key, which is an answer rather than a gap.
    // `V-SIG` makes that a malformed contributor, and judging validity is another layer's.
    const held = inlineBytes(c.content)
    if (held !== null && equal(held, pubkey)) out.push(c)
  }
  return out
}

/** RankeQueriesError reports an answer a named read cannot be applied to. */
export class RankeQueriesError extends Error {
  override readonly name: string = 'RankeQueriesError'
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
