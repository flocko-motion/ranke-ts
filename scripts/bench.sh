#!/usr/bin/env bash
# Records a performance baseline: us per claim for a build, broken down by stage, and
# bytes and peak RSS for a decode.
#
# No part of `verify`. A timing assertion would be flaky — the host these figures were
# first taken on swung 28% between two runs of one build — so this prints a baseline to
# re-run and compare by hand, and asserts nothing.
#
# --expose-gc so the heap settles before and after the retained-claim measurement; the
# bench says so when it runs without it.
#
# Usage: scripts/bench.sh [iterations] [claims]
set -euo pipefail

cd "$(dirname "$0")/.."

exec node --expose-gc src/testing/bench.ts "$@"
