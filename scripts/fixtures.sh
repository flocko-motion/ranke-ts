#!/usr/bin/env bash
# Regenerates the reference data the tests check against, from Go programs importing
# ranke-go. ranke-go is the reference implementation, so its output is the
# specification of a decode rather than a sample of it.
#
# Run after the record layout, the alias tables, or the JSON projection move. A test
# failing afterwards is the point: it says the two implementations diverged.
set -euo pipefail

cd "$(dirname "$0")/.."

echo ">> claims (tools/fixtures)"
(cd tools && go run ./fixtures) > src/testing/claim_fixtures.json

echo ">> path.Match table (tools/globoracle)"
(cd tools && go run ./globoracle) > src/testing/glob_oracle.json

echo ">> regenerated; run 'make test' to see whether anything moved"
