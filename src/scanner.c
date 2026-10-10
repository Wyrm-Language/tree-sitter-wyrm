// External scanner for Wyrm: offside-rule layout tokens and raw strings.
//
// Emits (all layout tokens are zero-width):
//   _newline  a statement separator: the next line starts at the current
//             indentation (or, where no block can close, any indentation - the
//             brace-block case).
//   _indent   the next line is indented deeper and the grammar wants a block.
//   _dedent   the next line is indented less than the current block.
//   raw_string  R"tag( ... )tag"
//
// Whether a newline "counts" is decided by the parser's valid-symbol set: inside
// ( ) and [ ] the grammar never accepts _newline, so a line break there is
// plain whitespace, matching the real tokenizer's bracket-depth rule.

#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

enum TokenType {
  NEWLINE,
  INDENT,
  DEDENT,
  RAW_STRING,
  ERROR_SENTINEL,
};

#define MAX_DEPTH 100

typedef struct {
  uint16_t depth;               // number of entries in `stack`
  uint16_t stack[MAX_DEPTH];    // indentation columns, stack[0] is always 0
} Scanner;

void *tree_sitter_wyrm_external_scanner_create(void) {
  Scanner *s = (Scanner *)ts_calloc(1, sizeof(Scanner));
  s->depth = 1;
  s->stack[0] = 0;
  return s;
}

void tree_sitter_wyrm_external_scanner_destroy(void *payload) { ts_free(payload); }

unsigned tree_sitter_wyrm_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *s = (Scanner *)payload;
  unsigned size = 0;
  for (uint16_t i = 1; i < s->depth && size + 2 <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE; i++) {
    buffer[size++] = (char)(s->stack[i] & 0xff);
    buffer[size++] = (char)(s->stack[i] >> 8);
  }
  return size;
}

void tree_sitter_wyrm_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *s = (Scanner *)payload;
  s->depth = 1;
  s->stack[0] = 0;
  for (unsigned i = 0; i + 1 < length && s->depth < MAX_DEPTH; i += 2) {
    s->stack[s->depth++] = (uint16_t)((unsigned char)buffer[i] | ((unsigned char)buffer[i + 1] << 8));
  }
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool is_ident_char(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$' ||
         c > 127;
}

// At the first character of a line's content: is the word `else` or `elif`?
// Such a line continues the `if`/`for` above it, so it must not be preceded by
// a statement separator.  Only call this when the result is zero-width.
static bool at_else_or_elif(TSLexer *lexer) {
  if (lexer->lookahead != 'e') return false;
  advance(lexer);
  bool is_else = lexer->lookahead == 'l';
  if (!is_else) return false;
  advance(lexer);
  if (lexer->lookahead == 's') {
    advance(lexer);
    if (lexer->lookahead != 'e') return false;
  } else if (lexer->lookahead == 'i') {
    advance(lexer);
    if (lexer->lookahead != 'f') return false;
  } else {
    return false;
  }
  advance(lexer);
  return !is_ident_char(lexer->lookahead);
}

static bool scan_raw_string(TSLexer *lexer) {
  // lookahead is `R` or `r`, known to be followed by `"` only after advancing.
  advance(lexer);
  if (lexer->lookahead != '"') return false;
  advance(lexer);
  char tag[64];
  unsigned tag_len = 0;
  while ((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') || (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
         (lexer->lookahead >= '0' && lexer->lookahead <= '9') || lexer->lookahead == '_') {
    if (tag_len >= sizeof(tag)) return false;
    tag[tag_len++] = (char)lexer->lookahead;
    advance(lexer);
  }
  if (lexer->lookahead != '(') return false;
  advance(lexer);

  // Scan for `)` tag `"`.
  for (;;) {
    if (lexer->eof(lexer)) return false;
    if (lexer->lookahead == ')') {
      advance(lexer);
      unsigned matched = 0;
      while (matched < tag_len && lexer->lookahead == (unsigned char)tag[matched]) {
        advance(lexer);
        matched++;
      }
      if (matched == tag_len && lexer->lookahead == '"') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = RAW_STRING;
        return true;
      }
      continue;  // the partial match's characters are already consumed; keep going
    }
    advance(lexer);
  }
}

bool tree_sitter_wyrm_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid) {
  Scanner *s = (Scanner *)payload;

  // In error recovery every symbol is "valid"; emitting layout tokens then
  // only makes the damage worse.
  if (valid[ERROR_SENTINEL]) return false;

  lexer->mark_end(lexer);  // layout tokens are zero-width, ending here

  bool found_newline = false;
  bool at_eof = false;
  uint32_t indent = 0;

  for (;;) {
    int32_t c = lexer->lookahead;
    if (lexer->eof(lexer)) {
      at_eof = true;
      break;
    } else if (c == ' ' || c == '\t') {
      indent++;
      skip(lexer);
    } else if (c == '\r') {
      skip(lexer);
    } else if (c == '\n') {
      found_newline = true;
      indent = 0;
      skip(lexer);
    } else if (c == '#') {
      // A comment never changes layout; drop it up to the end of the line.
      while (!lexer->eof(lexer) && lexer->lookahead != '\n') skip(lexer);
    } else if (c == '\\') {
      // `\` + newline continues the line; anything else is a character literal.
      skip(lexer);
      if (lexer->lookahead == '\r') skip(lexer);
      if (lexer->lookahead == '\n') {
        skip(lexer);
        continue;
      }
      // Real content starts with the backslash we just passed; the layout
      // decision below only needs "not whitespace", so fall out.
      break;
    } else {
      break;
    }
  }

  if (found_newline || at_eof) {
    uint32_t eff = at_eof ? 0 : indent;
    uint16_t top = s->stack[s->depth - 1];

    if (eff > top) {
      if (valid[INDENT] && s->depth < MAX_DEPTH) {
        s->stack[s->depth++] = (uint16_t)eff;
        lexer->result_symbol = INDENT;
        return true;
      }
      // Deeper lines in a brace block are still separate statements.
      if (valid[NEWLINE] && !valid[DEDENT] && !at_eof && !at_else_or_elif(lexer)) {
        lexer->result_symbol = NEWLINE;
        return true;
      }
    } else if (eff == top) {
      if (valid[NEWLINE] && !at_eof && !at_else_or_elif(lexer)) {
        lexer->result_symbol = NEWLINE;
        return true;
      }
    } else {
      if (valid[DEDENT] && s->depth > 1) {
        s->depth--;
        lexer->result_symbol = DEDENT;
        return true;
      }
      if (valid[NEWLINE] && !at_eof && !at_else_or_elif(lexer)) {
        lexer->result_symbol = NEWLINE;
        return true;
      }
    }
  }

  if (valid[RAW_STRING] && (lexer->lookahead == 'R' || lexer->lookahead == 'r')) {
    return scan_raw_string(lexer);
  }

  return false;
}
