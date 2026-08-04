// Command globoracle emits Go's path.Match verdict for a table of pattern/name
// pairs, which is what ranke-go matches type globs with (matchTypeList,
// query_walk.go). The TypeScript port is checked against this rather than against a
// reading of the documentation: ranke-go is the reference implementation, so a
// disagreement means the port is wrong.
//
// Regenerate with: go run ./globoracle > ../src/testing/glob_oracle.json
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
)

type row struct {
	Pattern string `json:"p"`
	Name    string `json:"n"`
	Matched bool   `json:"ok"`
	Errored bool   `json:"er"`
}

func main() {
	// Patterns cover the constructs a type glob uses, plus the awkward corners a
	// hand-written matcher gets wrong: a class containing the separator, "]" first
	// in a class, an open-ended range, and an escaped literal.
	patterns := []string{
		"*", "*/*", "**", "derivation/*", "*/register", "d*/r*", "contribution/contributor",
		"?", "?/?", "derivation/?", "derivation/??????",
		"[a-d]*/*", "[^a-d]*/*", "[]a]/*", "[a-]/*", "[-a]/*",
		"deriv\\ation/*", "*\\*", "derivation/[rs]*",
		"", "/", "a//b", "*/", "/*",
		"entity/pers*n", "*ion/*", "[cd]*", "[^cd]*",
	}
	names := []string{
		"derivation/register", "derivation/scan", "source/register", "entity/person",
		"contribution/contributor", "relation/family", "d", "d/r", "a/b/c", "",
		"/", "a//b", "]/x", "a/x", "-/x", "deriv\\ation/x", "x*",
	}

	rows := make([]row, 0, len(patterns)*len(names))
	for _, p := range patterns {
		for _, n := range names {
			ok, err := path.Match(p, n)
			rows = append(rows, row{Pattern: p, Name: n, Matched: ok, Errored: err != nil})
		}
	}

	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(rows); err != nil {
		panic(err)
	}
	fmt.Fprintf(os.Stderr, "%d rows\n", len(rows))
}
