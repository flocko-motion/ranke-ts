#!/usr/bin/env bash
# Runs the suite and refuses a vacuous pass.
#
# `node --test` exits 0 when its glob matches nothing, so a renamed directory or a
# changed suffix would report success having run no test at all. The count is
# checked against the number of test files on disk: every one of them must have
# produced at least one test, which a silent discovery failure cannot fake.
set -euo pipefail

cd "$(dirname "$0")/.."

pattern='src/**/*_test.ts'
files=$(find src -name '*_test.ts' | wc -l | tr -d ' ')

if [ "$files" -eq 0 ]; then
	echo "no test files found under src/ — the suffix or the layout moved" >&2
	exit 1
fi

out=$(mktemp)
trap 'rm -f "$out"' EXIT
set +e
node --test "$pattern" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
set -e

ran=$(sed -n 's/^ℹ tests \([0-9]*\)$/\1/p' "$out" | tail -1)
ran=${ran:-0}

if [ "$status" -ne 0 ]; then
	exit "$status"
fi
if [ "$ran" -lt "$files" ]; then
	echo "ran $ran test(s) across $files test file(s) — discovery is incomplete" >&2
	exit 1
fi
