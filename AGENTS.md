# Agent Development Guide

Tree-sitter grammar for the Wyrm language, used by the Gram extension (wyrm-gram). This is
*not* the handcrafted `wyrm` repository.

- Canonical language definition: `doc/grammar.md` and `src/embed/wyrm/tokenizer.wy` in the
  `wyrm` repository. The grammar is intentionally more permissive than the real parser.
- After editing `grammar.js`, run `npx tree-sitter generate` and commit the regenerated
  `src/` with it. Never hand-edit `src/parser.c`, `src/grammar.json` or `src/node-types.json`.
- `npx tree-sitter test` must pass before committing. Add a `test/corpus/*.txt` case for
  every rule you touch.
- `queries/highlights.scm` uses tree-sitter's standard capture names. Editor-specific
  variants live in the editor repos; keep node names in step with them when a rule changes.
- `bindings/` and the package files (`Cargo.toml`, `pyproject.toml`, `go.mod`, ...) come from
  `tree-sitter init`; refresh them with `tree-sitter init --update` rather than by hand.
- A grammar change is only picked up by an editor once its pin moves to the new commit.
