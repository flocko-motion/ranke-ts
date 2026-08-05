// package: ranke / claim_builder
// type:    logic
// job:     assembles, validates, attributes and signs a claim into a Claim
// limits:  builds claims; the canonical bytes are codec.ts's and no key material is held here
//
// Mirrors ranke-go's claim_builder.go. Signing is injected: a Signer is whatever can
// turn a message into a signature, so an application's key stays in the application.
// Without one a claim is identity-signed, id = H(S(v)), which is what a mock graph
// needs and what §5.7 admits wherever the contributor publishes no key.

import type { Claim, Edge } from './claim.ts'
import {
  type EdgeRecord,
  type NodeRecord,
  decodeClaim,
  encodeClaim,
  encodeEdge,
  encodeNode,
} from './codec.ts'
import { type ContentRef, contentSize } from './content.ts'
import {
  EdgeClassContribution,
  EdgeClassDerivation,
  EdgeSubtypeContributor,
  EdgeSubtypeDiff,
  type RelationDirection,
  validEdgeClass,
} from './edge_taxonomy.ts'
import {
  FieldDeleteBy,
  FieldName,
  maxFieldsPerRecord,
  maxFieldValueLen,
  validEncodingSubtype,
  validFieldChars,
  validSubtype,
} from './field_taxonomy.ts'
import { splitType } from './filter.ts'
import { type Id, hashContent, idFromBytes, parseId } from './id.ts'
import {
  NodeClassContribution,
  NodeClassDerivation,
  NodeClassEntity,
  NodeClassRelation,
  NodeSubtypeContributor,
  validNodeClass,
} from './node_taxonomy.ts'
import { compareBytes } from './internal/cbor.ts'

/** RankeBuildError reports a claim that cannot be built. */
export class RankeBuildError extends Error {
  override readonly name: string = 'RankeBuildError'
}

/** maxInlineContent caps inline content at construction; larger blobs go external. */
export const maxInlineContent = 1 << 20 // 1 MiB

/**
 * Signer turns the hash of a claim into a signature. The library never sees a private
 * key: an application holds one and passes this, so what ships here cannot leak it.
 *
 * `message` is the 34-byte SHA2-256 multihash of S(v) — the multihash, not the bare
 * digest, since that is what ranke-go signs.
 */
export interface Signer {
  /** pubkey is the multikey encoding of the matching public key. */
  readonly pubkey: Uint8Array
  sign(message: Uint8Array): Uint8Array
}

/**
 * Contributor is the claim a signature is attributed to: its id, and the key it
 * publishes. An empty pubkey is a keyless contributor, which may only identity-sign.
 */
export interface Contributor {
  readonly id: string
  readonly pubkey: Uint8Array
}

/** EdgeInput is the data a caller supplies for one edge. */
export interface EdgeInput {
  /** The claim this edge cites. */
  readonly reference: string
  /** "class/sub"; TypeClass and TypeSub are the split form. */
  readonly type?: string
  readonly typeClass?: string
  readonly typeSub?: string
  readonly relationDirection?: RelationDirection
  readonly fields?: Readonly<Record<string, string>>
  readonly content?: ContentRef
  /**
   * referenced is the claim `reference` names, for the fields an edge takes from its
   * target: the delete_by every edge must carry (R-DELBY). Supply it wherever the
   * target is in hand, since an edge cannot learn this after it is built.
   */
  readonly referenced?: Claim
}

/** ClaimInput is the data a caller supplies for one claim. */
export interface ClaimInput {
  /** "class/sub"; required. */
  readonly type: string
  /** The contributor, except on a root contributor claim (§4.3). */
  readonly contributor?: Contributor
  readonly encoding?: string
  readonly content?: ContentRef
  /** RFC 3339; the encoder needs fixed-width nanoseconds, so a Date is normalised. */
  readonly createdAt?: string | Date
  readonly height?: number
  readonly fields?: Readonly<Record<string, string>>
  readonly edges?: readonly EdgeInput[]
  /** diffOf makes this claim a diff over the predecessor it names. */
  readonly diffOf?: string
  /** signer signs the id; absent means identity Sign (§5.7). */
  readonly signer?: Signer
}

/** BuiltEdge is an edge with the bytes and id its record yields. */
interface BuiltEdge {
  record: EdgeRecord
  raw: Uint8Array
  id: Id
}

/**
 * newEdge validates one edge and computes its id, H(S(e)). Exported because a caller
 * assembles edges before the claim that carries them.
 */
export function newEdge(input: EdgeInput): EdgeRecord {
  return buildEdge(input).record
}

function buildEdge(input: EdgeInput): BuiltEdge {
  if (input.reference === '') throw new RankeBuildError('an edge states no reference')
  parseId(input.reference) // a malformed reference is refused here, not on the wire

  const { typeClass, typeSub } = resolveType(input.type, input.typeClass, input.typeSub, 'edge')
  if (!validEdgeClass(typeClass)) {
    throw new RankeBuildError(`unknown edge class ${JSON.stringify(typeClass)}`)
  }
  if (!validSubtype(typeSub)) {
    throw new RankeBuildError(`invalid edge subtype ${JSON.stringify(typeSub)}`)
  }

  // A relation edge states its direction and nothing else does (§4.7).
  const dir = input.relationDirection ?? 0
  if (typeClass === 'relation') {
    if (dir !== 1 && dir !== -1) {
      throw new RankeBuildError('a relation/* edge states relation_direction (+1 or -1)')
    }
  } else if (dir !== 0) {
    throw new RankeBuildError(`relation_direction has no place on ${typeClass}/*`)
  }

  checkContent(input.content)
  let fields = input.fields

  // The target's schedule travels with the reference (R-DELBY), so it is part of the
  // edge from the start; an edge stating one keeps what it states.
  if (input.referenced !== undefined) {
    const due = input.referenced.fields[FieldDeleteBy]
    if (due !== undefined && (fields === undefined || fields[FieldDeleteBy] === undefined)) {
      fields = { ...(fields ?? {}), [FieldDeleteBy]: due }
    }
  }
  checkFields(fields)

  const record: EdgeRecord = {
    reference: input.reference,
    typeClass,
    typeSub,
    relationDirection: dir,
    ...(fields === undefined ? {} : { fields }),
    ...(input.content === undefined ? {} : { content: input.content }),
  }
  const raw = encodeEdge(record)
  return { record, raw, id: hashContent(raw) }
}

/**
 * newClaim assembles and signs a claim: it resolves the type, content and encoding,
 * builds the edge set with the contributor edge the attribution requires, orders the
 * edges canonically, and computes the id over the canonical bytes.
 *
 * Returns the decoded claim alongside those bytes, so a caller can store or send
 * exactly what the id commits to.
 */
export function newClaim(input: ClaimInput): { claim: Claim; bytes: Uint8Array; id: string } {
  const { typeClass, typeSub } = resolveType(input.type, undefined, undefined, 'claim')
  if (!validNodeClass(typeClass)) {
    throw new RankeBuildError(`unknown node class ${JSON.stringify(typeClass)}`)
  }
  if (!validSubtype(typeSub)) {
    throw new RankeBuildError(`invalid node subtype ${JSON.stringify(typeSub)}`)
  }
  checkContent(input.content)
  checkFields(input.fields)

  // A contribution/* claim is the structure a read walks, so none of it schedules its
  // own removal (R-DELBY scaffolding rule).
  if (typeClass === NodeClassContribution && input.fields?.[FieldDeleteBy] !== undefined) {
    throw new RankeBuildError(`a ${typeClass}/* claim takes no ${FieldDeleteBy}`)
  }

  // The one claim that stands alone: a contributor claim with nothing to attribute to
  // (§4.3), which is where a graph begins.
  const isRootContributor =
    typeClass === NodeClassContribution &&
    typeSub === NodeSubtypeContributor &&
    input.contributor === undefined
  if (!isRootContributor && input.contributor === undefined) {
    throw new RankeBuildError('a contributor is required, except on the root contributor claim')
  }

  const signerPubkey = input.signer?.pubkey ?? new Uint8Array(0)
  const declared = isRootContributor
    ? inlineOf(input.content)
    : (input.contributor?.pubkey ?? new Uint8Array(0))
  checkSigningConsistency(signerPubkey, declared)

  const edges = assembleEdges(input, isRootContributor, typeClass)

  const record: NodeRecord = {
    typeClass,
    typeSub,
    createdAt: normalizeCreatedAt(input.createdAt),
    height: input.height ?? 0,
    ...(input.fields === undefined ? {} : { fields: input.fields }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(edges.length === 0 ? {} : { edges: edges.map((e) => e.record) }),
  }

  const hash = hashContent(encodeNode(record))
  const id =
    input.signer === undefined
      ? hash
      : idFromBytes(multikey(input.signer.sign(hash.rawBytes())))

  const bytes = encodeClaim(record)
  return { claim: decodeClaim(bytes, id.toString()), bytes, id: id.toString() }
}

// assembleEdges builds the edge set, adds the contributor and diff edges the claim
// implies, enforces the cardinality and provenance rules, and returns the edges in
// canonical order — by raw id bytes, which is what makes S(v) reproducible.
function assembleEdges(
  input: ClaimInput,
  isRootContributor: boolean,
  typeClass: string,
): BuiltEdge[] {
  const edges = (input.edges ?? []).map(buildEdge)

  if (!isRootContributor) {
    edges.push(
      buildEdge({
        reference: input.contributor!.id,
        typeClass: EdgeClassContribution,
        typeSub: EdgeSubtypeContributor,
      }),
    )
  }
  if (input.diffOf !== undefined) {
    edges.push({
      ...buildEdge({
        reference: input.diffOf,
        typeClass: EdgeClassContribution,
        typeSub: EdgeSubtypeDiff,
      }),
    })
    checkDiffEdgeNames(edges)
  }

  checkEdgeCardinality(edges)
  // §3.5: a claim of these classes rests on stated provenance.
  if (requiresProvenance(typeClass) && !edges.some((e) => e.record.typeClass === EdgeClassDerivation)) {
    throw new RankeBuildError(`a ${typeClass}/* claim carries at least one derivation/* edge`)
  }

  edges.sort((a, b) => compareBytes(a.id.rawBytes(), b.id.rawBytes()))
  return edges
}

function requiresProvenance(typeClass: string): boolean {
  return (
    typeClass === NodeClassDerivation ||
    typeClass === NodeClassEntity ||
    typeClass === NodeClassRelation
  )
}

// checkDiffEdgeNames requires a unique, non-empty name on every edge of a diff claim
// beyond the singletons, since the overlay is name-keyed.
function checkDiffEdgeNames(edges: readonly BuiltEdge[]): void {
  const seen = new Set<string>()
  for (const { record } of edges) {
    if (
      record.typeClass === EdgeClassContribution &&
      (record.typeSub === EdgeSubtypeContributor || record.typeSub === EdgeSubtypeDiff)
    ) {
      continue
    }
    const name = record.fields?.[FieldName]
    if (name === undefined || name === '') {
      throw new RankeBuildError("every edge of a diff claim carries a 'name'")
    }
    if (seen.has(name)) {
      throw new RankeBuildError(`two edges of a diff claim are named ${JSON.stringify(name)}`)
    }
    seen.add(name)
  }
}

// checkEdgeCardinality enforces the per-claim singletons.
function checkEdgeCardinality(edges: readonly BuiltEdge[]): void {
  let contributors = 0
  let diffs = 0
  for (const { record } of edges) {
    if (record.typeClass !== EdgeClassContribution) continue
    if (record.typeSub === EdgeSubtypeContributor) contributors++
    if (record.typeSub === EdgeSubtypeDiff) diffs++
  }
  if (contributors > 1) throw new RankeBuildError('a claim carries one contribution/contributor edge')
  if (diffs > 1) throw new RankeBuildError('a claim carries one contribution/diff edge')
}

// checkSigningConsistency matches the signer against the key the claim declares.
// Neither present is identity Sign; one alone is an error (§5.7).
function checkSigningConsistency(signer: Uint8Array, declared: Uint8Array): void {
  const hasSigner = signer.length > 0
  const hasPubkey = declared.length > 0
  if (!hasSigner && !hasPubkey) return // identity Sign
  if (hasSigner && !hasPubkey) {
    throw new RankeBuildError('a signer was given but the claim declares no public key')
  }
  if (!hasSigner && hasPubkey) {
    throw new RankeBuildError(
      'the claim declares a public key, so identity Sign will not verify — pass a signer',
    )
  }
  if (compareBytes(signer, declared) !== 0) {
    throw new RankeBuildError("the signer's public key is not the one the claim declares")
  }
}

// multikey frames a signature as ranke-go does: the Ed25519 multicodec as a varint,
// which is two bytes, then the signature.
function multikey(signature: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + signature.length)
  out[0] = 0xed
  out[1] = 0x01
  out.set(signature, 2)
  return out
}

function inlineOf(content: ContentRef | undefined): Uint8Array {
  return content !== undefined && content.kind === 'inline' ? content.bytes : new Uint8Array(0)
}

function resolveType(
  combined: string | undefined,
  typeClass: string | undefined,
  typeSub: string | undefined,
  what: string,
): { typeClass: string; typeSub: string } {
  if (combined !== undefined && combined !== '') return splitType(combined)
  if (typeClass === undefined || typeClass === '' || typeSub === undefined || typeSub === '') {
    throw new RankeBuildError(`a ${what} states a type`)
  }
  return { typeClass, typeSub }
}

// checkContent holds a declaration to §Content: an encoding wherever content is
// present, and inline bytes within the construction cap.
function checkContent(content: ContentRef | undefined): void {
  if (content === undefined || content.kind === 'none') return
  if (content.encoding === '') {
    throw new RankeBuildError('a record carrying content declares an encoding')
  }
  const { typeSub } = splitType(content.encoding)
  if (!validEncodingSubtype(typeSub)) {
    throw new RankeBuildError(`invalid encoding subtype ${JSON.stringify(typeSub)}`)
  }
  if (content.kind === 'inline') {
    if (content.bytes.length > maxInlineContent) {
      throw new RankeBuildError(
        `inline content is at most ${maxInlineContent} bytes; larger belongs in external content`,
      )
    }
    if (content.size !== content.bytes.length) {
      throw new RankeBuildError(
        `content_size ${content.size} is not the ${content.bytes.length} bytes carried`,
      )
    }
    return
  }
  parseId(content.hash)
  if (contentSize(content) === 0) {
    throw new RankeBuildError('external content states its size')
  }
}

function checkFields(fields: Readonly<Record<string, string>> | undefined): void {
  if (fields === undefined) return
  const names = Object.keys(fields)
  if (names.length > maxFieldsPerRecord) {
    throw new RankeBuildError(`at most ${maxFieldsPerRecord} fields on one record`)
  }
  for (const name of names) {
    if (!validFieldChars(name)) {
      throw new RankeBuildError(`invalid field name ${JSON.stringify(name)}`)
    }
    if (fields[name]!.length > maxFieldValueLen) {
      throw new RankeBuildError(`field ${name} exceeds ${maxFieldValueLen} bytes`)
    }
  }
}

/**
 * normalizeCreatedAt renders a timestamp the way the canonical encoding needs it:
 * fixed-width nanoseconds in UTC. A Date holds milliseconds, so the remaining digits
 * are zeros — pass a string to state nanoseconds exactly.
 */
export function normalizeCreatedAt(at: string | Date | undefined): string {
  if (typeof at === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/.test(at)) {
      throw new RankeBuildError(
        `created_at is fixed-width nanoseconds in UTC (2026-01-02T03:04:05.123456789Z), got ${JSON.stringify(at)}`,
      )
    }
    return at
  }
  const d = at ?? new Date()
  const ms = d.toISOString() // ...THH:MM:SS.mmmZ
  return `${ms.slice(0, -1)}000000Z`
}

/** heightOf is 1 + the highest height among refs, and 0 with none (§4.1). */
export function heightOf(...refs: readonly Claim[]): number {
  if (refs.length === 0) return 0
  return 1 + refs.reduce((max, c) => (c.height > max ? c.height : max), 0)
}

/** edgeIdOf returns H(S(e)) for a built edge record. */
export function edgeIdOf(e: EdgeRecord): string {
  return hashContent(encodeEdge(e)).toString()
}

/** contributorOfClaim reads a built contributor claim back as a Contributor. */
export function contributorFrom(claim: Claim): Contributor {
  return { id: claim.id, pubkey: inlineOf(claim.content) }
}

// Re-exported so a caller building a graph needs one import.
export type { Claim, Edge }
