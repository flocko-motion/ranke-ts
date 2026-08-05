#!/usr/bin/env bash
# Runs the suite and refuses a vacuous pass.
#
# `node --test` exits 0 when its glob matches nothing, so a renamed directory or a
# changed suffix would report success having run no test at all. Every test file must
# therefore account for at least one test.
#
# The reporter is pinned: node picks spec for a TTY and tap otherwise, and the two
# spell the total differently. An unparseable total fails — reading it as zero is the
# same mistake as trusting the exit code.
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
node --test --test-reporter=spec "$pattern" 2>&1 | tee "$out"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
	exit "$status"
fi

# "ℹ tests N" from the spec reporter; "# tests N" from tap, in case the pin is ever
# dropped.
ran=$(sed -n -E 's/^(ℹ|#) tests ([0-9]+)$/\2/p' "$out" | tail -1)
if [ -z "$ran" ]; then
	echo "the suite reported no total — the reporter's format moved, so the floor is blind" >&2
	exit 1
fi
if [ "$ran" -lt "$files" ]; then
	echo "ran $ran test(s) across $files test file(s) — discovery is incomplete" >&2
	exit 1
fi
echo ">> $ran test(s) across $files file(s)"
