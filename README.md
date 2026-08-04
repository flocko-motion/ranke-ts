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

## Design

**Zero runtime dependencies.** Everything ships in the package, including
SHA-256, so a browser pulls no supply chain to read a claim.

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
