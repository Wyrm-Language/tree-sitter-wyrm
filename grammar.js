/**
 * Tree-sitter grammar for Wyrm.
 *
 * Canonical language definition: doc/grammar.md in the wyrm repository. This is a
 * highlighting/navigation grammar, so it is deliberately a little more
 * tolerant than the real parser (it also accepts wypoc-era forms such as
 * `with`, `this`, `super`, and `from x import y`).
 *
 * Layout (the offside rule) is done by src/scanner.c, which emits
 * _newline / _indent / _dedent.  A newline is only a statement separator
 * where the parser can accept one, so newlines inside ( ) and [ ] never reach
 * the grammar.
 */

/* eslint-disable arrow-parens */
/* global grammar, choice, seq, repeat, repeat1, optional, prec, token, field */

const PREC = {
  catch: 1,
  or: 2,
  and: 3,
  not: 4,
  compare: 5,
  bor: 6,
  bxor: 7,
  band: 8,
  shift: 9,
  add: 10,
  mul: 11,
  unary: 12,
  power: 13,
  postfix: 14,
};

const commaSep1 = (rule) => seq(rule, repeat(seq(',', rule)));
const commaSep = (rule) => optional(commaSep1(rule));

module.exports = grammar({
  name: 'wyrm',

  word: ($) => $.identifier,

  externals: ($) => [
    $._newline,
    $._indent,
    $._dedent,
    $.raw_string,
    $._error_sentinel,
  ],

  extras: ($) => [/\s/, $.comment, /\\\r?\n/],

  supertypes: ($) => [$._expression, $._statement, $._definition],

  conflicts: ($) => [
    [$.import_path],
  ],

  rules: {
    source_file: ($) => optional($._statement_list),

    // ---- statements ------------------------------------------------------

    _statement_list: ($) =>
      seq($._statement, repeat(seq($._sep, $._statement)), optional($._sep)),

    // Never two separators in a row: the layout scanner's _newline is
    // zero-width, so two in a row could loop.  `x;` + newline is one separator.
    _sep: ($) => choice($._newline, seq(';', optional($._newline))),

    _statement: ($) =>
      choice(
        $._definition,
        $.decorated_definition,
        $.var_statement,
        $.static_statement,
        $.import_statement,
        $.from_import_statement,
        $.defer_statement,
        $.with_statement,
        $.emit_statement,
        $.assignment,
        $.expression_statement,
      ),

    expression_statement: ($) => $._expression_tuple,

    _definition: ($) =>
      choice(
        $.function_definition,
        $.coroutine_definition,
        $.class_definition,
        $.slot_definition,
        $.signal_definition,
      ),

    decorated_definition: ($) =>
      seq($.decorator, choice($._definition, $.decorated_definition)),

    decorator: ($) =>
      prec.right(
        seq(
          '@',
          field('name', $.identifier),
          optional(field('arguments', $.arguments)),
          optional($._newline),
        ),
      ),

    // ---- blocks ----------------------------------------------------------

    block: ($) =>
      choice(
        seq(':', $._indent, $._statement_list, $._dedent),
        seq(':', $._statement),
        seq('{', optional($._statement_list), '}'),
      ),

    // ---- declarations ----------------------------------------------------

    var_statement: ($) =>
      prec.right(
        seq(
          'var',
          commaSep1($.var_target),
          optional(seq('=', field('value', $._expression_tuple))),
        ),
      ),

    var_target: ($) =>
      prec.right(
        seq(
          field('name', $.identifier),
          optional(seq(':', field('type', $.type_constraint))),
        ),
      ),

    static_statement: ($) =>
      prec.right(
        seq(
          'static',
          field('name', $.identifier),
          optional(seq(':', field('type', $.type_constraint))),
          optional(seq('=', field('value', $._expression))),
        ),
      ),

    assignment: ($) =>
      prec.right(
        2,
        seq(
          field('left', $._expression_tuple),
          field('operator', choice('=', '?=', ':=')),
          field('right', $._expression_tuple),
        ),
      ),

    with_statement: ($) =>
      choice(
        seq('with', $.with_binding),
        seq(
          'with',
          ':',
          $._indent,
          $.with_binding,
          repeat(seq($._sep, $.with_binding)),
          optional($._sep),
          $._dedent,
        ),
      ),

    with_binding: ($) =>
      seq(
        field('name', $.identifier),
        optional(seq(':', field('type', $.type_constraint))),
        '=',
        field('value', $._expression),
      ),

    defer_statement: ($) =>
      seq(
        'defer',
        optional(seq('on', field('condition', $.type_constraint))),
        $.block,
      ),

    emit_statement: ($) =>
      seq('emit', field('name', $.identifier), field('arguments', $.arguments)),

    // ---- imports ---------------------------------------------------------

    import_path: ($) => seq($.identifier, repeat(seq('::', $.identifier))),

    import_statement: ($) =>
      seq('import', optional('static'), $._import_body),

    _import_body: ($) =>
      choice(
        seq(
          field('module', $.import_path),
          '::',
          '*',
          optional(seq('except', $.except_names)),
        ),
        seq(field('module', $.import_path), '::', $.import_items),
        seq(
          field('module', $.import_path),
          optional(seq('as', field('alias', $.identifier))),
        ),
      ),

    import_items: ($) => seq('(', commaSep1($.import_item), optional(','), ')'),

    import_item: ($) =>
      seq(
        field('name', $.identifier),
        optional(seq('as', field('alias', $.identifier))),
      ),

    except_names: ($) =>
      choice($.identifier, seq('(', commaSep1($.identifier), optional(','), ')')),

    from_import_statement: ($) =>
      prec.right(
        seq(
          'from',
          field('module', $.import_path),
          'import',
          commaSep1($.import_item),
        ),
      ),

    // ---- functions, coroutines, classes ---------------------------------

    function_definition: ($) =>
      seq(
        'fn',
        optional($.class_target),
        field('name', $.identifier),
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $.type_constraint))),
        field('body', $.block),
      ),

    coroutine_definition: ($) =>
      seq(
        'co',
        optional($.class_target),
        field('name', $.identifier),
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $.type_constraint))),
        field('body', $.block),
      ),

    class_target: ($) => seq('[', commaSep($.identifier), optional(','), ']'),

    parameters: ($) =>
      seq('(', optional(seq($._parameter, repeat(seq(',', $._parameter)), optional(','))), ')'),

    _parameter: ($) =>
      choice($.parameter, $.var_positional, $.var_keyword, $.send_type),

    parameter: ($) =>
      prec.right(
        seq(
          field('name', $.identifier),
          optional(seq(':', field('type', $.type_constraint))),
          optional(seq('=', field('default', $._expression))),
        ),
      ),

    var_positional: ($) => seq('*', field('name', $.identifier)),
    var_keyword: ($) => seq('**', field('name', $.identifier)),
    send_type: ($) => seq('<-', $.type_constraint),

    class_definition: ($) =>
      seq(
        'class',
        field('name', $.identifier),
        optional(field('superclasses', $.arguments)),
        field('body', $.block),
      ),

    slot_definition: ($) =>
      prec.right(
        seq(
          'slot',
          field('name', $.identifier),
          optional(seq(':', field('type', $.type_constraint))),
          optional(seq('=', field('value', $._expression))),
          optional(seq('with', $.slot_options)),
        ),
      ),

    slot_options: ($) =>
      choice(
        seq(
          ':',
          $._indent,
          repeat1(seq($.slot_option, optional($._sep))),
          $._dedent,
        ),
        seq('{', repeat(seq($.slot_option, optional(';'))), '}'),
      ),

    slot_option: ($) =>
      seq(
        field('kind', choice('setter', 'getter')),
        '=',
        field('value', $._expression),
      ),

    signal_definition: ($) =>
      seq('signal', field('name', $.identifier), field('parameters', $.parameters)),

    // ---- types -----------------------------------------------------------

    type_constraint: ($) => prec.right(20, seq($.type_atom, repeat(seq('|', $.type_atom)))),

    type_atom: ($) => choice($.qualified_name, $.identifier, $.nil),

    qualified_name: ($) => seq($.identifier, repeat1(seq('::', $.identifier))),

    // ---- expressions -----------------------------------------------------

    _expression_tuple: ($) => choice($._expression, $.tuple_expression),

    tuple_expression: ($) =>
      prec.right(1, seq($._expression, repeat1(seq(',', $._expression)), optional(','))),

    _expression: ($) =>
      choice(
        $.binary_expression,
        $.comparison,
        $.not_expression,
        $.unary_expression,
        $.try_expression,
        $.catch_expression,
        $.decorated_expression,
        $.call,
        $.attribute,
        $.subscript,
        $.message,
        $._primary,
      ),

    _primary: ($) =>
      choice(
        $.identifier,
        $.qualified_name,
        $.integer,
        $.float,
        $.string,
        $.raw_string,
        $.character,
        $.symbol,
        $.true,
        $.false,
        $.nil,
        $.undefined,
        $.ellipsis,
        $.this,
        $.parenthesized_expression,
        $.tuple,
        $.array,
        $.pair_list,
        $.dictionary,
        $.super_call,
        $.return_expression,
        $.yield_expression,
        $.break,
        $.continue,
        $.pass,
        $.if_statement,
        $.while_statement,
        $.for_statement,
        $.lambda,
        $.coroutine_lambda,
        $.anonymous_class,
        $.do_expression,
        $.task_expression,
        $.thread_expression,
        $.defined_expression,
      ),

    binary_expression: ($) => {
      const table = [
        [PREC.or, 'or'],
        [PREC.and, 'and'],
        [PREC.bor, '|'],
        [PREC.bxor, '^'],
        [PREC.band, '&'],
        [PREC.shift, choice('<<', '>>')],
        [PREC.add, choice('+', '-')],
        [PREC.mul, choice('*', '/', '%')],
      ];
      return choice(
        ...table.map(([p, op]) =>
          prec.left(
            p,
            seq(
              field('left', $._expression),
              field('operator', op),
              field('right', $._expression),
            ),
          ),
        ),
        prec.right(
          PREC.power,
          seq(
            field('left', $._expression),
            field('operator', '**'),
            field('right', $._expression),
          ),
        ),
      );
    },

    comparison: ($) =>
      choice(
        prec.left(
          PREC.compare,
          seq(
            field('left', $._expression),
            'is',
            optional('not'),
            field('type', $.type_constraint),
          ),
        ),
        prec.left(
          PREC.compare,
          seq(
            field('left', $._expression),
            field('operator', choice('<=>', '<=', '>=', '<', '>', '==', '!=', 'in', seq('not', 'in'))),
            field('right', $._expression),
          ),
        ),
      ),

    not_expression: ($) => prec(PREC.not, seq('not', $._expression)),

    unary_expression: ($) =>
      prec(PREC.unary, seq(field('operator', choice('-', '+', '~')), field('argument', $._expression))),

    try_expression: ($) => prec.right(0, seq('try', $._expression)),

    catch_expression: ($) =>
      prec.right(PREC.catch, seq($._expression, 'catch', $._expression)),

    decorated_expression: ($) =>
      prec.right(PREC.unary, seq($.decorator, $._expression)),

    call: ($) =>
      prec(
        PREC.postfix,
        seq(field('function', $._expression), field('arguments', $.arguments)),
      ),

    attribute: ($) =>
      prec(
        PREC.postfix,
        seq(field('object', $._expression), '.', field('attribute', $.identifier)),
      ),

    subscript: ($) =>
      prec(
        PREC.postfix,
        seq(field('value', $._expression), '[', field('index', $._expression_tuple), ']'),
      ),

    message: ($) =>
      prec.right(
        PREC.postfix,
        seq(
          field('receiver', $._expression),
          '!',
          field('selector', $.identifier),
          optional(field('arguments', $.arguments)),
        ),
      ),

    arguments: ($) =>
      seq('(', optional(seq($._argument, repeat(seq(',', $._argument)), optional(','))), ')'),

    _argument: ($) =>
      choice($.keyword_argument, $.splat, $.double_splat, $._expression),

    keyword_argument: ($) =>
      seq(field('name', $.identifier), '=', field('value', $._expression)),

    splat: ($) => seq('*', $._expression),
    double_splat: ($) => seq('**', $._expression),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    tuple: ($) =>
      choice(
        seq('(', ')'),
        seq('(', $._expression, ',', ')'),
        seq('(', $._expression, repeat1(seq(',', $._expression)), optional(','), ')'),
      ),

    array: ($) => seq('[', optional(seq($._expression, repeat(seq(',', $._expression)), optional(','))), ']'),

    pair_list: ($) => seq('$[', optional(seq($._expression, repeat(seq(',', $._expression)), optional(','))), ']'),

    dictionary: ($) => seq('{', commaSep($.pair), optional(','), '}'),

    pair: ($) => seq(field('key', $._expression), ':', field('value', $._expression)),

    super_call: ($) => seq('super', $.arguments),

    return_expression: ($) => prec.right(seq('return', optional($._expression_tuple))),

    yield_expression: ($) =>
      prec.right(
        choice(
          seq('yield', 'from', $._expression),
          seq('yield', optional($._expression_tuple)),
        ),
      ),

    task_expression: ($) => prec.right(PREC.unary, seq('task', $._expression)),
    thread_expression: ($) => seq('thread', $.import_path),
    defined_expression: ($) => seq('defined', $.arguments),

    // ---- control flow ----------------------------------------------------

    if_statement: ($) =>
      prec.right(
        seq(
          'if',
          field('condition', $._expression_tuple),
          field('consequence', $.block),
          repeat($.elif_clause),
          optional($.else_clause),
        ),
      ),

    elif_clause: ($) =>
      seq('elif', field('condition', $._expression_tuple), field('consequence', $.block)),

    else_clause: ($) => seq('else', field('body', $.block)),

    while_statement: ($) =>
      seq('while', field('condition', $._expression_tuple), field('body', $.block)),

    for_statement: ($) =>
      prec.right(
        seq(
          'for',
          field('variable', commaSep1($.identifier)),
          'in',
          field('iterable', $._expression_tuple),
          field('body', $.block),
          optional($.else_clause),
        ),
      ),

    lambda: ($) =>
      seq(
        'fn',
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $.type_constraint))),
        field('body', $.block),
      ),

    coroutine_lambda: ($) =>
      seq(
        'co',
        field('parameters', $.parameters),
        optional(seq('->', field('return_type', $.type_constraint))),
        field('body', $.block),
      ),

    anonymous_class: ($) =>
      seq('class', optional(field('superclasses', $.arguments)), field('body', $.block)),

    do_expression: ($) => seq('do', $.block),

    // ---- lexical ---------------------------------------------------------

    identifier: () => /[_$\p{XID_Start}][$\p{XID_Continue}]*/,

    comment: () => token(seq('#', /[^\r\n]*/)),

    integer: () =>
      token(choice(/0[xX][0-9a-fA-F][0-9a-fA-F_]*/, /0[bB][01][01_]*/, /[0-9][0-9_]*/)),

    float: () =>
      token(
        choice(
          /[0-9][0-9_]*\.([0-9][0-9_]*)?([eE][+-]?[0-9]+)?/,
          /[0-9][0-9_]*[eE][+-]?[0-9]+/,
        ),
      ),

    string: ($) =>
      choice(
        token(/"""([^"\\]|\\[\s\S]|"[^"])*"{2,3}/),
        seq(
          '"',
          repeat(choice($.string_content, $.escape_sequence)),
          token.immediate('"'),
        ),
      ),

    string_content: () => token.immediate(prec(1, /[^"\\\r\n]+/)),

    escape_sequence: () => token.immediate(seq('\\', /[\s\S]/)),

    // Clojure-style: \a  \newline  \(  ...
    character: () => token(seq('\\', choice(/[_$\p{XID_Start}][$\p{XID_Continue}]*/, /[^\s]/))),

    // 'name  or  '+ (operator symbols)
    symbol: () =>
      token(
        seq(
          "'",
          choice(
            /[_\p{XID_Start}][\p{XID_Continue}]*/,
            '<=>', '**', '==', '!=', '<=', '>=', '<<', '>>', '...',
            /[-+*\/%&|^~<>]/,
          ),
        ),
      ),

    ellipsis: () => '...',
    true: () => 'true',
    false: () => 'false',
    nil: () => 'nil',
    undefined: () => 'undefined',
    this: () => 'this',
    break: () => 'break',
    continue: () => 'continue',
    pass: () => 'pass',
  },
});
