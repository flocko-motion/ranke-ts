# ranke-ts

TypeScript reader for the **Ranke-Graph** ADT (spec §4) — a content-addressed,
provenance-carrying graph of attributed claims.

The project home, papers, and cross-language conformance suite live at
[github.com/flocko-motion/ranke-graph](https://github.com/flocko-motion/ranke-graph).
[ranke-go](https://github.com/flocko-motion/ranke-go) is the reference
implementation; this repository mirrors the part of it a browser needs, file for
file and name for name, so the two can be read side by side.

## Scope

This library **reads** claims a server has already served:

- decode the canonical CBOR of a claim into its node, edges, fields and content
- the closed type vocabularies and the wire alias tables
- ids: the SHA2-256 multihash framing and the multibase string form

It holds no private keys, signs nothing, and stores nothing. Two further
omissions are deliberate:

- **Diff materialisation** stays server-side. A `contribution/diff` claim
  carries a delta, and resolving it means walking the chain — work a server
  does once for every reader.
- **Queries** belong to RankeDB, which publishes its own generated client.
  RankeQL is a RankeDB construct (spec §RankeQL); the ADT defines no query
  language.

## Install

```sh
npm install @flocko-motion/ranke
```

## A decoded claim is plain data

Decoding hands back a frozen data object, not an instance with accessors:

```ts
const claim = decodeClaim(bytes, id)

claim.id                  // "b5uawx4g…" — a string
claim.type                // "source/register"
claim.fields.title        // the claim's own fields, by name
claim.edges[0].reference  // also a string
claim.edges[0].fields.name
claim.createdAt           // "2026-01-01T00:00:00.000000000Z"
claim.createdAtMs         // 1767225600000, for sorting
```

Three consequences worth knowing:

**Ids are strings on a claim, and on an edge's `reference`.** They are used as
graph node keys and `Map` keys, at a few hundred thousand at a time, where peak
heap decides throughput. `Id` remains the type for parsing, framing and
`algorithm()` — reach for `parseId(claim.id)` when you want the payload rather
than the name.

**`created_at` comes back twice.** The RFC 3339 string is the value of record,
because the claim's id commits to it and a JavaScript `Date` cannot hold its
nanoseconds. `createdAtMs` is the lossy convenience for sorting and display.

**Fields are a plain record, keyed as the taxonomy names them.** The wire
aliases are resolved during decoding, so `.n` has already become `name`.

This is the one place the library departs from mirroring ranke-go, whose
`Claim`, `Node` and `Edge` are interfaces with methods. Go needs an interface to
seal a struct; TypeScript gets the same guarantee from `readonly` at no runtime
cost, and an object per accessor is a cost a browser pays for nothing.

## Design

**Zero runtime dependencies.** Everything ships in the package, including
SHA-256, so a browser pulls no supply chain to read a claim.

**Streaming is the primary path.** A result run is thousands of claims arriving
over a `ReadableStream`, so the sequence readers (cbor-seq, json-seq) yield
claims as bytes land and a whole-buffer `decodeClaim` is the special case. A
reader distinguishes an incomplete record, where it waits for the next chunk,
from a malformed one, where it stops.

**Synchronous throughout.** `crypto.subtle` would make every digest a promise
and every decode async; a hand-rolled digest keeps one code path across
browsers, Node, Deno and workers.

**Types are erased, so decoding validates.** Bytes from a server are untrusted
and an interface guarantees nothing at run time. The decoder checks CBOR
canonicity, the closed vocabularies, and the inline/external content rule
itself; the types sit on top as a convenience.

**The alias tables are normative.** Ids are computed over the aliased bytes, so
an entry that differs from ranke-go's gives one claim two encodings. The tables
here are transcribed from ranke-go and pinned by tests against reference values
it produced.

## Development

Node 22 or newer. Node runs the TypeScript sources directly by stripping types,
so the tests need no build step.

```sh
npm install
npm test          # node --test over src/**/*_test.ts
npm run typecheck # tsc over sources and tests
npm run build     # emit dist/ with .d.ts
```

`tsconfig.json` sets `erasableSyntaxOnly`, which holds the source to the subset
Node can strip: no `enum`, no `namespace`, no parameter properties. String
unions stand in for enums, which also keeps the emitted values identical to
ranke-go's constants.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
