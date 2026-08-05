#!/usr/bin/env bash
# Generates src/query.ts from the committed rql.schema.json.
#
# The Query type is generated, never written: the schema is the read language's one
# definition, and a hand-written type would be a second. The schema's enums carry
# type: string, so they emit as string-literal unions — which is also the house rule.
#
# Two consequences worth knowing. The schema excludes three values only a Go caller
# may set — output.encoding "native", and execution.report "error" and "warn" — so the
# generated type refuses them for free; never add them back. And the generated file is
# committed, so the build needs no generator at install time.
set -euo pipefail

cd "$(dirname "$0")/.."

SCHEMA=schema/rql.schema.json
DEST=src/query.ts

if [ ! -f "$SCHEMA" ]; then
	echo "$SCHEMA is missing — run scripts/pull-rql-schema.sh" >&2
	exit 1
fi

tmp=$(mktemp)
flat=$(mktemp --suffix=.json)
trap 'rm -f "$tmp" "$flat"' EXIT

# Two adjustments to a working copy of the schema, never to the schema itself:
#
#   - its root is a $ref into $defs, which the generator cannot resolve there, so the
#     Query definition is lifted to the root with $defs kept for the rest;
#   - a definition that constrains nothing means any JSON value, which the generator
#     would otherwise emit as an object with an index signature. tsType is its own
#     escape hatch, and `unknown` is what an unconstrained schema is in TypeScript.
node -e '
const fs = require("node:fs")
const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const shaping = ["type", "enum", "const", "$ref", "oneOf", "anyOf", "allOf", "properties", "items"]
const defs = {}
for (const [name, def] of Object.entries(s.$defs)) {
  defs[name] = shaping.some((k) => k in def) ? def : { ...def, tsType: "unknown" }
}
const { $ref, ...rest } = s
fs.writeFileSync(
  process.argv[2],
  JSON.stringify({ ...rest, ...defs.Query, title: "Query", $defs: defs }),
)
' "$SCHEMA" "$flat"

npx json2ts \
	--input "$flat" \
	--output "$tmp" \
	--bannerComment '' \
	--additionalProperties false \
	--enableConstEnums false

{
	cat <<'HEADER'
// package: ranke / query
// type:    data
// job:     the RankeQL query type — a read, stated declaratively
// limits:  the type only; encoding and the shape checks are query_codec.ts's, and executing
// a query needs the graph, which is RankeDB's (ranke-go -> query_default.go)
//
// GENERATED from schema/rql.schema.json by scripts/generate.sh. Do not edit: the
// schema is the read language's one definition, which ranke-go implements and
// ranke-db's openapi.yaml $refs. Take a new release with scripts/pull-rql-schema.sh,
// regenerate, and review the diff.

HEADER
	cat "$tmp"
} > "$DEST"

npx tsc -p tsconfig.json --noEmit
echo ">> generated $DEST"
