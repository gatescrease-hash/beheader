//! Turns the LaTeX a math field writes into tokens, which is the first of the
//! four stages of the math language: lexer, parser, names and eval.
//!
//! This is the Rust side of `src/engine/math/lexer.ts`. The source is LaTeX
//! because that is what the editor produces, so the lexer answers to a
//! generator rather than to a person, and three of its rules follow from that.
//!
//! A subscript belongs to the name in front of it. An editor writes a value
//! named `x_ans` as `x_{ans}`, and a reader seeing two tokens there would take
//! the second for a factor, so a letter and a braced run arrive as one
//! identifier whose name is `x_ans`, which is also the spelling a port name
//! takes.
//!
//! A name of more than one letter reaches LaTeX through `\operatorname` or
//! `\mathrm`, because two bare letters beside each other mean a product.
//!
//! Some commands carry no meaning for an evaluator. `\left` and `\right` size
//! a bracket to its content, and the short commands built from a comma, a
//! colon or an exclamation mark space it. All are dropped, so the parser sees
//! the bracket alone.
//!
//! The scan runs over UTF-16 code units, for the reason `formula/lexer.rs`
//! gives: the offset a refusal carries is the offset a JavaScript string gives.

/// What a token is.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MathTokenType {
    Number,
    Identifier,
    Command,
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    Equals,
    Comma,
    Underscore,
    Bar,
    Reference,
    Solve,
    LBrace,
    RBrace,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Eof,
}

impl MathTokenType {
    pub fn as_str(self) -> &'static str {
        match self {
            MathTokenType::Number => "number",
            MathTokenType::Identifier => "identifier",
            MathTokenType::Command => "command",
            MathTokenType::Plus => "plus",
            MathTokenType::Minus => "minus",
            MathTokenType::Star => "star",
            MathTokenType::Slash => "slash",
            MathTokenType::Caret => "caret",
            MathTokenType::Equals => "equals",
            MathTokenType::Comma => "comma",
            MathTokenType::Underscore => "underscore",
            MathTokenType::Bar => "bar",
            MathTokenType::Reference => "reference",
            MathTokenType::Solve => "solve",
            MathTokenType::LBrace => "lbrace",
            MathTokenType::RBrace => "rbrace",
            MathTokenType::LParen => "lparen",
            MathTokenType::RParen => "rparen",
            MathTokenType::LBracket => "lbracket",
            MathTokenType::RBracket => "rbracket",
            MathTokenType::Eof => "eof",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MathToken {
    pub kind: MathTokenType,
    /// The source text this token covers, for a message that quotes it.
    pub text: String,
    /// Where the token starts, for a message that points at it.
    pub start: usize,
    /// The value of a number token, and zero for every other kind.
    pub value: f64,
    /// The resolved name of an identifier, with a subscript joined by a low
    /// line; the word of a command without its backslash; the address a
    /// reference wraps; or the unknown a solve names. It is empty otherwise.
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MathLexError {
    pub message: String,
    pub start: usize,
}

/// The commands that carry no meaning for an evaluator.
const IGNORED_COMMANDS: [&str; 7] = [
    "left",
    "right",
    "quad",
    "qquad",
    "displaystyle",
    "limits",
    "nolimits",
];

/// The commands that wrap a name of more than one letter.
const NAME_COMMANDS: [&str; 4] = ["operatorname", "mathrm", "text", "mathit"];

/// The command that wraps an address of the document. Its argument is taken
/// whole, so the dots and low lines in an address reach the parser as one
/// token rather than as the product of letters juxtaposition would make.
pub const MATH_REFERENCE_COMMAND: &str = "gpref";

/// The command that marks the unknown of an implicit line. Notation writes
/// `x^2+3=y` with nothing to say which letter the object solves for, and a rule
/// that worked it out from the rest of the source would change what a line
/// solves for when an unrelated line above it was edited.
pub const MATH_SOLVE_COMMAND: &str = "solve";

fn symbol_token(character: char) -> Option<MathTokenType> {
    match character {
        '+' => Some(MathTokenType::Plus),
        '-' => Some(MathTokenType::Minus),
        '*' => Some(MathTokenType::Star),
        '/' => Some(MathTokenType::Slash),
        '^' => Some(MathTokenType::Caret),
        '=' => Some(MathTokenType::Equals),
        ',' => Some(MathTokenType::Comma),
        '_' => Some(MathTokenType::Underscore),
        '|' => Some(MathTokenType::Bar),
        '{' => Some(MathTokenType::LBrace),
        '}' => Some(MathTokenType::RBrace),
        '(' => Some(MathTokenType::LParen),
        ')' => Some(MathTokenType::RParen),
        '[' => Some(MathTokenType::LBracket),
        ']' => Some(MathTokenType::RBracket),
        _ => None,
    }
}

fn unit(units: &[u16], at: usize) -> Option<char> {
    units.get(at).and_then(|&u| char::from_u32(u32::from(u)))
}

fn is_letter(character: Option<char>) -> bool {
    matches!(character, Some(c) if c.is_ascii_alphabetic())
}

fn is_digit(character: Option<char>) -> bool {
    matches!(character, Some(c) if c.is_ascii_digit())
}

fn is_name_character(character: Option<char>) -> bool {
    matches!(character, Some(c) if c.is_ascii_alphanumeric())
}

fn span(units: &[u16], from: usize, to: usize) -> String {
    String::from_utf16_lossy(&units[from..to.min(units.len())])
}

fn failure(message: String, start: usize) -> MathLexError {
    MathLexError { message, start }
}

fn token(kind: MathTokenType, text: String, start: usize) -> MathToken {
    MathToken {
        kind,
        text,
        start,
        value: 0.0,
        name: String::new(),
    }
}

/// The subscript that follows a name, as the suffix to join to it. A subscript
/// is a single character or a braced run, which is the pair of forms LaTeX
/// allows, and an empty suffix means the name carries none.
fn read_subscript(units: &[u16], from: usize) -> Result<(String, usize), MathLexError> {
    if unit(units, from) != Some('_') {
        return Ok((String::new(), from));
    }
    let mut at = from + 1;
    if unit(units, at) == Some('{') {
        at += 1;
        let mut suffix = String::new();
        while at < units.len() && unit(units, at) != Some('}') {
            let character = unit(units, at);
            if !is_name_character(character) {
                return Err(failure(
                    format!(
                        "a subscript holds letters and digits, and this one holds \"{}\"",
                        span(units, at, at + 1)
                    ),
                    at,
                ));
            }
            suffix.push(character.expect("the character is a name character"));
            at += 1;
        }
        if unit(units, at) != Some('}') {
            return Err(failure(
                "a subscript that opens with a brace needs a closing brace".to_string(),
                from,
            ));
        }
        if suffix.is_empty() {
            return Err(failure(
                "a subscript with nothing in it has no meaning".to_string(),
                from,
            ));
        }
        return Ok((suffix, at + 1));
    }
    match unit(units, at) {
        Some(single) if single.is_ascii_alphanumeric() => Ok((single.to_string(), at + 1)),
        _ => Err(failure(
            "a subscript needs a letter or a digit after the underscore".to_string(),
            from,
        )),
    }
}

/// What a braced argument is called in each of the three refusals it can
/// reach, so a caller states its own wording rather than a helper deriving it.
struct BracedWording {
    /// When no opening brace follows the command.
    needs_argument: &'static str,
    /// What the argument may hold, which a refusal completes with the
    /// character it found.
    holds: &'static str,
    /// When the argument never closes.
    needs_closing: &'static str,
    /// When the braces hold nothing.
    empty: &'static str,
}

/// The braced argument of a command, taking the characters the caller allows
/// beyond letters and digits.
fn read_braced(
    units: &[u16],
    from: usize,
    extra: &[char],
    wording: &BracedWording,
) -> Result<(String, usize), MathLexError> {
    if unit(units, from) != Some('{') {
        return Err(failure(wording.needs_argument.to_string(), from));
    }
    let mut at = from + 1;
    let mut text = String::new();
    while at < units.len() && unit(units, at) != Some('}') {
        let character = unit(units, at);
        let allowed = is_name_character(character) || character.is_some_and(|c| extra.contains(&c));
        if !allowed {
            return Err(failure(
                format!(
                    "{}, and this one holds \"{}\"",
                    wording.holds,
                    span(units, at, at + 1)
                ),
                at,
            ));
        }
        text.push(character.expect("the character is allowed"));
        at += 1;
    }
    if unit(units, at) != Some('}') {
        return Err(failure(wording.needs_closing.to_string(), from));
    }
    if text.is_empty() {
        return Err(failure(wording.empty.to_string(), from));
    }
    Ok((text, at + 1))
}

const ADDRESS_WORDING: BracedWording = BracedWording {
    needs_argument: "an address needs a braced address after it",
    holds: "an address holds letters, digits, underscores and dots",
    needs_closing: "an address needs a closing brace",
    empty: "an address with nothing in it has no meaning",
};

const NAME_WORDING: BracedWording = BracedWording {
    needs_argument: "a name command needs a braced name after it",
    holds: "a name holds letters, digits and underscores",
    needs_closing: "a name command needs a closing brace",
    empty: "a name with nothing in it has no meaning",
};

/// Turns one line of LaTeX into tokens, or reports the first place it could not
/// read. The result always ends with an end token, so the parser reads a token
/// at every position without a bounds check.
pub fn tokenize_math(source: &str) -> Result<Vec<MathToken>, MathLexError> {
    let units: Vec<u16> = source.encode_utf16().collect();
    let mut tokens = Vec::new();
    let mut at = 0;

    while at < units.len() {
        let character = unit(units.as_slice(), at);

        if matches!(character, Some(' ' | '\t' | '\r')) {
            at += 1;
            continue;
        }

        if character == Some('\\') {
            // A backslash and one of these characters is a space in LaTeX.
            if matches!(unit(&units, at + 1), Some(',' | ';' | ':' | '!' | ' ')) {
                at += 2;
                continue;
            }
            let mut end = at + 1;
            while end < units.len() && is_letter(unit(&units, end)) {
                end += 1;
            }
            let word = span(&units, at + 1, end);
            if word.is_empty() {
                return Err(failure(
                    "a backslash with no command after it has no meaning".to_string(),
                    at,
                ));
            }
            if word == MATH_REFERENCE_COMMAND {
                let (text, next) = read_braced(&units, end, &['_', '.'], &ADDRESS_WORDING)?;
                tokens.push(MathToken {
                    kind: MathTokenType::Reference,
                    text: span(&units, at, next),
                    start: at,
                    value: 0.0,
                    name: text,
                });
                at = next;
                continue;
            }
            if word == MATH_SOLVE_COMMAND {
                let (name, next) = read_braced(&units, end, &['_'], &NAME_WORDING)?;
                tokens.push(MathToken {
                    kind: MathTokenType::Solve,
                    text: span(&units, at, next),
                    start: at,
                    value: 0.0,
                    name,
                });
                at = next;
                continue;
            }
            if NAME_COMMANDS.contains(&word.as_str()) {
                let (name, next) = read_braced(&units, end, &['_'], &NAME_WORDING)?;
                let (suffix, next) = read_subscript(&units, next)?;
                let name = if suffix.is_empty() {
                    name
                } else {
                    format!("{name}_{suffix}")
                };
                tokens.push(MathToken {
                    kind: MathTokenType::Identifier,
                    text: span(&units, at, next),
                    start: at,
                    value: 0.0,
                    name,
                });
                at = next;
                continue;
            }
            if IGNORED_COMMANDS.contains(&word.as_str()) {
                at = end;
                continue;
            }
            tokens.push(MathToken {
                kind: MathTokenType::Command,
                text: span(&units, at, end),
                start: at,
                value: 0.0,
                name: word,
            });
            at = end;
            continue;
        }

        if is_digit(character) || (character == Some('.') && is_digit(unit(&units, at + 1))) {
            let mut end = at;
            while end < units.len() && is_digit(unit(&units, end)) {
                end += 1;
            }
            if unit(&units, end) == Some('.') && is_digit(unit(&units, end + 1)) {
                end += 1;
                while end < units.len() && is_digit(unit(&units, end)) {
                    end += 1;
                }
            }
            let text = span(&units, at, end);
            let value = text.parse::<f64>().ok().filter(|number| number.is_finite());
            let Some(value) = value else {
                return Err(failure(format!("\"{text}\" does not read as a number"), at));
            };
            tokens.push(MathToken {
                kind: MathTokenType::Number,
                text,
                start: at,
                value,
                name: String::new(),
            });
            at = end;
            continue;
        }

        if is_letter(character) {
            let (suffix, next) = read_subscript(&units, at + 1)?;
            let letter = character.expect("the character is a letter");
            let name = if suffix.is_empty() {
                letter.to_string()
            } else {
                format!("{letter}_{suffix}")
            };
            tokens.push(MathToken {
                kind: MathTokenType::Identifier,
                text: span(&units, at, next),
                start: at,
                value: 0.0,
                name,
            });
            at = next;
            continue;
        }

        if character == Some('.') {
            return Err(failure(
                format!(
                    "a bare dotted address has no meaning in notation, because letters beside each other multiply. Write \\{MATH_REFERENCE_COMMAND}{{...}} around it"
                ),
                at,
            ));
        }

        if let Some(symbol) = character.and_then(symbol_token) {
            tokens.push(token(symbol, span(&units, at, at + 1), at));
            at += 1;
            continue;
        }

        // The refusal names the whole code point rather than the one unit the
        // scan sits on, so a character outside the basic plane reads as itself
        // rather than as the lone surrogate that is half of it.
        let width = if (0xD800..0xDC00).contains(&units[at]) && at + 1 < units.len() {
            2
        } else {
            1
        };
        return Err(failure(
            format!(
                "\"{}\" has no meaning in a formula",
                span(&units, at, at + width)
            ),
            at,
        ));
    }

    tokens.push(token(MathTokenType::Eof, String::new(), units.len()));
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::{MathTokenType, tokenize_math};

    fn kinds(source: &str) -> Vec<&'static str> {
        tokenize_math(source)
            .expect("the source scans")
            .iter()
            .map(|token| token.kind.as_str())
            .collect()
    }

    fn names(source: &str) -> Vec<String> {
        tokenize_math(source)
            .expect("the source scans")
            .iter()
            .filter(|token| token.kind != MathTokenType::Eof)
            .map(|token| token.name.clone())
            .collect()
    }

    #[test]
    fn a_subscript_belongs_to_the_name_in_front_of_it() {
        // An editor writes x_ans as x_{ans}, and two tokens there would read
        // as a product rather than as one name.
        assert_eq!(kinds("x_{ans}"), ["identifier", "eof"]);
        assert_eq!(names("x_{ans}"), ["x_ans"]);
        assert_eq!(names("x_1"), ["x_1"]);
        assert_eq!(names("x"), ["x"]);
    }

    #[test]
    fn a_name_of_more_than_one_letter_arrives_wrapped() {
        assert_eq!(names("\\operatorname{speed}"), ["speed"]);
        assert_eq!(names("\\mathrm{speed}"), ["speed"]);
        assert_eq!(names("\\operatorname{speed}_{max}"), ["speed_max"]);
        assert_eq!(kinds("\\operatorname{speed}"), ["identifier", "eof"]);
    }

    #[test]
    fn an_address_arrives_whole_rather_than_as_a_product_of_letters() {
        let tokens = tokenize_math("\\gpref{table_x.A1}").expect("the source scans");
        assert_eq!(tokens[0].kind, MathTokenType::Reference);
        assert_eq!(tokens[0].name, "table_x.A1");
        // Written bare, the same text is letters beside each other, which
        // notation reads as a product, so the lexer refuses it.
        assert!(tokenize_math("table_x.A1").is_err());
    }

    #[test]
    fn the_unknown_of_an_implicit_line_is_written_rather_than_worked_out() {
        let tokens = tokenize_math("\\solve{x}").expect("the source scans");
        assert_eq!(tokens[0].kind, MathTokenType::Solve);
        assert_eq!(tokens[0].name, "x");
    }

    #[test]
    fn the_commands_that_only_size_or_space_are_dropped() {
        assert_eq!(
            kinds("\\left(1\\right)"),
            ["lparen", "number", "rparen", "eof"]
        );
        assert_eq!(kinds(r"1\,+\;2"), ["number", "plus", "number", "eof"]);
        assert_eq!(kinds("1\\ +2"), ["number", "plus", "number", "eof"]);
    }

    #[test]
    fn a_command_the_evaluator_knows_nothing_of_reaches_the_parser() {
        let tokens = tokenize_math("\\sin").expect("the source scans");
        assert_eq!(tokens[0].kind, MathTokenType::Command);
        assert_eq!(tokens[0].name, "sin");
    }

    #[test]
    fn a_number_takes_a_stop_only_where_a_digit_follows_it() {
        let tokens = tokenize_math("3.5").expect("the source scans");
        assert_eq!(tokens[0].value, 3.5);
        let opening = tokenize_math(".5").expect("the source scans");
        assert_eq!(opening[0].value, 0.5);
        // A stop with no digit after it is the bare address the lexer refuses.
        assert!(tokenize_math("1.").is_err());
    }

    #[test]
    fn a_refusal_points_at_the_unit_the_fault_begins_on() {
        let error = tokenize_math("1 + \u{1D518}").expect_err("the source does not scan");
        assert_eq!(error.start, 4);
        assert_eq!(error.message, "\"\u{1D518}\" has no meaning in a formula");
        assert_eq!(
            tokenize_math("x_{}")
                .expect_err("the source does not scan")
                .message,
            "a subscript with nothing in it has no meaning"
        );
        assert_eq!(
            tokenize_math("\\gpref{}")
                .expect_err("the source does not scan")
                .message,
            "an address with nothing in it has no meaning"
        );
        assert_eq!(
            tokenize_math("\\operatorname{}")
                .expect_err("the source does not scan")
                .message,
            "a name with nothing in it has no meaning"
        );
    }

    #[test]
    fn the_end_token_sits_at_the_length_in_units() {
        let tokens = tokenize_math("1+2").expect("the source scans");
        assert_eq!(tokens.last().expect("there is a last token").start, 3);
        assert_eq!(kinds(""), ["eof"]);
        assert_eq!(kinds("   "), ["eof"]);
    }
}
