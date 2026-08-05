# ranke-ts

TypeScript reader for the **Ranke-Graph** ADT (spec §4) — a content-addressed,
provenance-carrying graph of attributed claims.

The project home, papers, and cross-language conformance suite live at
[github.com/flocko-motion/ranke-graph](https://github.com/flocko-motion/ranke-graph).
[ranke-go](https://github.com/flocko-motion/ranke-go) is the reference
implementation; this repository mirrors the part of it a browser needs, file for
file and name for name, so the two can be read side by side.

## Scope

This library **reads** claims a server served, and **builds the queries** that
ask for them:

- decode the canonical CBOR of a claim into its node, edges, fields and content
- decode the JSON projection, arriving at the same claim
- read a result run as it streams: cbor-seq (RFC 8742) and json-seq (RFC 7464)
- build, check and encode a RankeQL query
- the closed type vocabularies and the wire alias tables
- ids: the SHA2-256 multihash framing and the multibase string form

It holds no private keys, signs nothing, and stores nothing. Two further
omissions are deliberate:

- **Diff materialisation** stays server-side. A `contribution/diff` claim
  carries a delta, and resolving it means walking the chain — work a server
  does once for every reader.
- **Query execution** is RankeDB's. A client sends queries, so the `Query` type,
  its encoder and its shape checks belong here; answering one needs the graph and
  a planner, which do not.

## Queries

`Query` is generated from ranke-graph's released `rql.schema.json` — the same
document ranke-go implements and ranke-db's `openapi.yaml` references — so
TypeScript holds no second copy of the read language.

```ts
import { EncodeQuery, ValidateQuery, type Query } from '@flocko-motion/ranke'

const q: Query = {
  select: { branch: 'project_x', path: [{ edges: ['derivation/*'], max: 3 }] },
  where: { field: 'type', test: { glob: 'source/*' } },
  output: { encoding: 'cbor' },
  limit: { results: 200, time: '5s' },
}

const body = EncodeQuery(q) // validates, then renders the canonical JSON
```

`ValidateQuery` applies the same rules ranke-go does, so both reach one verdict,
and a `RankeQueryError` carries the `code` of the rule broken — `ErrQueryHops`,
`ErrQueryWhereForm`, and the rest, named as ranke-go names them. Two of those
rules ranke-go enforces when a read runs; catching them here saves the round trip
the server would spend refusing.

Three values exist on ranke-go's side and not on the wire: `output.encoding`
`native`, and `execution.report` `error` and `warn`. The schema excludes all
three, so the generated type refuses them without a rule of its own.

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
an entry that differs from ranke-go's gives one claim two encodings.

**Reference data is generated, never transcribed.** ranke-go is the reference
implementation, so its output is the specification rather than a sample of it.
`tools/` holds Go programs that emit it — claims in both encodings, Go's
`path.Match` over 476 pattern/name pairs, and ranke-go's verdict on 43 queries.
Each records the ranke-go release it came from, and the suite refuses a set that
names no release. A hand-copied fixture is one nibble from testing the wrong
thing, which is how this rule was learnt.

**Conformance runs against the published set.** ranke-graph releases
`ranke-testdata.tar.gz`, whose manifest names 14 claim cases and 2 content blobs
and what each must do. The suite fetches it and holds this library to it, so
conformance is measured against the spec's artifact rather than against agreement
with a sibling. Thirteen of the sixteen are decidable without a key: every valid
decode, a malformed id, a height that does not follow, a reference that resolves
nowhere, an identity Sign whose signer publishes a key, and both blobs against
the hash they are filed under. The three that turn on a signature are named
individually in the test, so a case becoming undecidable for a new reason fails
rather than passes quietly. Set `RANKE_TESTDATA_DIR` to work offline.

## Development

Node 22 or newer. Node runs the TypeScript sources directly by stripping types,
so the tests need no build step.

```sh
make install
make test       # with a floor: node --test exits 0 on an empty glob
make typecheck  # sources and tests
make build      # emit dist/ with .d.ts
make verify     # the three above, as a release must pass them
```

`tsconfig.json` sets `erasableSyntaxOnly`, which holds the source to the subset
Node can strip: no `enum`, no `namespace`, no parameter properties. String
unions stand in for enums, which also keeps the emitted values identical to
ranke-go's constants.

Two steps need a toolchain beyond npm, so both are deliberate rather than part of
`verify`:

```sh
make fixtures         # regenerate the reference data (needs Go)
make pull-rql-schema  # take ranke-graph's released RQL schema
make generate         # regenerate src/query.ts from the committed schema
```

Taking a new ranke-go release means bumping `tools/go.mod` and running
`make fixtures`; a test then fails wherever the two implementations moved apart.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
