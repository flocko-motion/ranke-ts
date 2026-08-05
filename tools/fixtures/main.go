package main

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime/debug"
	"time"

	ranke "github.com/flocko-motion/ranke-go"
)

const rankeGoModule = "github.com/flocko-motion/ranke-go"

// provenance records which ranke-go produced these bytes, so an artifact traces to
// a version rather than to whatever was checked out at the time.
type provenance struct {
	// RankeGo is the module version, e.g. "v0.15.0".
	RankeGo string `json:"rankeGo"`
	// Substituted names a path that stood in for the released module. Its presence
	// means the fixtures reproduce nothing, and the test suite refuses them.
	Substituted string `json:"substituted,omitempty"`
}

func readProvenance() provenance {
	p := provenance{RankeGo: "unknown"}
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return p
	}
	for _, d := range bi.Deps {
		if d.Path != rankeGoModule {
			continue
		}
		p.RankeGo = d.Version
		if d.Replace != nil {
			p.Substituted = d.Replace.Path
		}
		break
	}
	return p
}

// Writes reference claims, in both encodings, as JSON on stdout. The TypeScript
// tests read this file, so nothing is transcribed by hand: ranke-go is the reference
// implementation, and these are its output.

type edgeRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type fixture struct {
	Label string    `json:"label"`
	ID    string    `json:"id"`
	CBOR  string    `json:"cbor"`
	JSON  any       `json:"json"`
	Edges []edgeRef `json:"edges"`
}

func main() {
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pubkey, err := ranke.EncodePublicKey(priv.Public())
	must(err)

	at := time.Date(2026, 1, 2, 3, 4, 5, 123456789, time.UTC)

	root, err := ranke.NewClaim(ranke.NodeContributor, nil).
		WithInlineContent(pubkey).
		WithEncoding(ranke.EncodingOctetStream).
		WithCreatedAt(at).
		Sign(priv)
	must(err)
	alice, err := root.AsContributor(context.Background(), nil, priv)
	must(err)

	src, err := ranke.NewClaim(ranke.TypeSource("register"), alice).
		WithInlineContent([]byte("a parish register")).
		WithEncoding(ranke.EncodingPlain).
		WithField("title", "Register of 1834").
		WithField("aa", "length-first ordering").
		WithField("b", "sorts before aa").
		WithCreatedAt(at.Add(time.Second)).
		WithHeight(ranke.HeightOf(alice)).
		Sign()
	must(err)

	prov, err := ranke.NewEdge(ranke.EdgeConfig{Reference: src.ID(), Type: ranke.TypeDerivation("register")})
	must(err)
	person, err := ranke.NewClaim(ranke.TypeEntity("person"), alice).
		WithEdges(prov).
		WithField("name", "Anna Weber").
		WithCreatedAt(at.Add(2 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src)).
		Sign()
	must(err)

	rel, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference:         person.ID(),
		TypeClass:         ranke.EdgeClassRelation,
		TypeSub:           "family",
		RelationDirection: ranke.RelationFrom,
		Fields:            map[string]string{ranke.FieldName: "mother", "certainty": "high"},
		InlineContent:     []byte("stated in the register"),
		Encoding:          ranke.EncodingPlain,
	})
	must(err)
	scanHash, err := ranke.HashContent([]byte("a scan of the page"))
	must(err)
	extEdge, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference:   src.ID(),
		Type:        ranke.TypeDerivation("scan"),
		ContentHash: scanHash,
		ContentSize: 18,
		Encoding:    ranke.EncodingPNG,
	})
	must(err)
	family, err := ranke.NewClaim(ranke.TypeRelation("family"), alice).
		WithEdges(prov, rel, extEdge).
		WithCreatedAt(at.Add(3 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src, person)).
		Sign()
	must(err)

	// A limiting claim, so the fixtures exercise the newly aliased subtypes.
	delEdge, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference:  src.ID(),
		Type:       ranke.EdgeTypeDelete,
		Referenced: src,
	})
	must(err)
	deletion, err := ranke.NewClaim(ranke.NodeDelete, alice).
		WithEdges(delEdge).
		WithCreatedAt(at.Add(4 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src)).
		Sign()
	must(err)

	// Identity-signed claims, where id = H(S(v)) and no key is involved (§5.7). These
	// are the cases a keyless implementation can reproduce whole, id included, so they
	// are what proves a builder rather than only an encoder.
	idRoot, err := ranke.NewClaim(ranke.NodeContributor, nil).
		WithCreatedAt(at.Add(10 * time.Second)).
		Sign()
	must(err)
	idContributor, err := idRoot.AsContributor(context.Background(), nil)
	must(err)

	idNote, err := ranke.NewClaim(ranke.TypeSource("note"), idContributor).
		WithInlineContent([]byte("signed by nobody in particular")).
		WithEncoding(ranke.EncodingPlain).
		WithField("b", "sorts first").
		WithField("aa", "sorts second").
		WithCreatedAt(at.Add(11 * time.Second)).
		WithHeight(ranke.HeightOf(idContributor)).
		Sign()
	must(err)

	// Two edges, so the canonical edge order is exercised rather than assumed.
	idProv, err := ranke.NewEdge(ranke.EdgeConfig{Reference: idNote.ID(), Type: ranke.TypeDerivation("note")})
	must(err)
	idDerived, err := ranke.NewClaim(ranke.TypeDerivation("summary"), idContributor).
		WithEdges(idProv).
		WithInlineContent([]byte("a summary of nothing")).
		WithEncoding(ranke.EncodingPlain).
		WithCreatedAt(at.Add(12 * time.Second)).
		WithHeight(ranke.HeightOf(idContributor, idNote)).
		Sign()
	must(err)

	out := struct {
		Note       string            `json:"note"`
		Provenance provenance        `json:"provenance"`
		Ids        map[string]string `json:"ids"`
		Fixtures   []fixture         `json:"fixtures"`
	}{
		Note: "Generated by tools/fixtures, importing ranke-go — the reference " +
			"implementation, so these are the specification of a decode. Regenerate with " +
			"scripts/fixtures.sh when the record layout, the alias tables or the JSON " +
			"projection move; a test failing afterwards says the encodings diverged.",
		Provenance: readProvenance(),
		Ids: map[string]string{
			"contributor":     root.ID().String(),
			"source":          src.ID().String(),
			"entity":          person.ID().String(),
			"relation":        family.ID().String(),
			"deletion":        deletion.ID().String(),
			"scanHash":        scanHash.String(),
			"identityRoot":    idRoot.ID().String(),
			"identityNote":    idNote.ID().String(),
			"identityDerived": idDerived.ID().String(),
		},
	}

	for _, c := range []struct {
		label string
		claim ranke.Claim
	}{
		{"contributor", root},
		{"source", src},
		{"entity", person},
		{"relation", family},
		{"deletion", deletion},
		{"identity-root", idRoot},
		{"identity-note", idNote},
		{"identity-derived", idDerived},
	} {
		cborBytes, err := c.claim.EncodeCBOR(ranke.FormOriginal)
		must(err)
		jsonBytes, err := c.claim.EncodeJSON(ranke.FormOriginal)
		must(err)
		var projected any
		must(json.Unmarshal(jsonBytes, &projected))

		f := fixture{Label: c.label, ID: c.claim.ID().String(), CBOR: hex.EncodeToString(cborBytes), JSON: projected}
		for _, e := range c.claim.Edges() {
			f.Edges = append(f.Edges, edgeRef{Type: e.Type(), ID: e.ID().String()})
		}
		out.Fixtures = append(out.Fixtures, f)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(out))
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
