package tree_sitter_wyrm_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_wyrm "github.com/wyrm-language/tree-sitter-wyrm/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_wyrm.Language())
	if language == nil {
		t.Errorf("Error loading Wyrm grammar")
	}
}
