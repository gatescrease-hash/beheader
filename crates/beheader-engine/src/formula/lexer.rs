//! Turns formula source text into tokens, which is the first of the four
//! stages a formula passes through: lexer, parser, deps and eval.
//!
//! This is the Rust side of `src/engine/formula/lexer.ts`. A numeric path
//! segment scans as a number token, so the 0 in `vertex.0.x` reaches the parser
//! as a number rather than as part of a name, and the parser joins the pieces
//! back into a path.
//!
//! The scan runs over UTF-16 code units rather than over characters or bytes,
//! because the offset a token carries is the offset a JavaScript string gives,
//! and the command line marks the faulty field of a formula by that offset. A
//! character outside the basic plane counts as the two units JavaScript counts
//! it as. The source arrives as a Rust `String`, so every surrogate in it is
//! half of a pair and the text a token holds converts back whole, which is the
//! boundary rule `D-005` settles.

use std::fmt;

/// What a token is, with the value a literal carries held beside it.
#[derive(Clone, Debug, PartialEq)]
pub enum TokenKind {
    Identifier,
    Number(f64),
    Text(String),
    Boolean(bool),
    And,
    Or,
    Not,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Caret,
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
    LParen,
    RParen,
    Comma,
    Dot,
    Colon,
    Eof,
}

impl TokenKind {
    /// The spelling the TypeScript lexer gives this kind, which is the tag a
    /// fixture compares and the word a parser refusal names.
    pub fn as_str(&self) -> &'static str {
        match self {
            TokenKind::Identifier => "identifier",
            TokenKind::Number(_) => "number",
            TokenKind::Text(_) => "string",
            TokenKind::Boolean(_) => "boolean",
            TokenKind::And => "and",
            TokenKind::Or => "or",
            TokenKind::Not => "not",
            TokenKind::Plus => "plus",
            TokenKind::Minus => "minus",
            TokenKind::Star => "star",
            TokenKind::Slash => "slash",
            TokenKind::Percent => "percent",
            TokenKind::Caret => "caret",
            TokenKind::Eq => "eq",
            TokenKind::Ne => "ne",
            TokenKind::Lt => "lt",
            TokenKind::Gt => "gt",
            TokenKind::Le => "le",
            TokenKind::Ge => "ge",
            TokenKind::LParen => "lparen",
            TokenKind::RParen => "rparen",
            TokenKind::Comma => "comma",
            TokenKind::Dot => "dot",
            TokenKind::Colon => "colon",
            TokenKind::Eof => "eof",
        }
    }
}

impl fmt::Display for TokenKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One token, with the source text it covers and the offset it begins at.
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    pub start: usize,
}

/// Why the source does not scan, with the offset the fault begins at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LexError {
    pub message: String,
    pub start: usize,
}

/// The three words the formula language reads as operators, and the two it
/// reads as boolean literals. An object named one of these could not be
/// referenced, so `checkNameAvailable` in `src/engine/address.ts` refuses them.
pub const RESERVED_WORDS: [&str; 5] = ["AND", "OR", "NOT", "TRUE", "FALSE"];

fn keyword(text: &str) -> Option<TokenKind> {
    match text {
        "AND" => Some(TokenKind::And),
        "OR" => Some(TokenKind::Or),
        "NOT" => Some(TokenKind::Not),
        _ => None,
    }
}

fn single_character(unit: u16) -> Option<TokenKind> {
    match char::from_u32(u32::from(unit))? {
        '+' => Some(TokenKind::Plus),
        '-' => Some(TokenKind::Minus),
        '*' => Some(TokenKind::Star),
        '/' => Some(TokenKind::Slash),
        '%' => Some(TokenKind::Percent),
        '^' => Some(TokenKind::Caret),
        '=' => Some(TokenKind::Eq),
        '(' => Some(TokenKind::LParen),
        ')' => Some(TokenKind::RParen),
        ',' => Some(TokenKind::Comma),
        '.' => Some(TokenKind::Dot),
        ':' => Some(TokenKind::Colon),
        _ => None,
    }
}

/// The byte a unit stands for, where the unit is one an ASCII byte spells. A
/// unit above the ASCII range answers `None`, so no test below reads the low
/// half of a character outside it.
fn ascii(unit: Option<&u16>) -> Option<u8> {
    match unit {
        Some(&unit) if unit < 128 => Some(unit as u8),
        _ => None,
    }
}

fn is_digit(unit: Option<&u16>) -> bool {
    ascii(unit).is_some_and(|byte| byte.is_ascii_digit())
}

fn is_identifier_start(unit: Option<&u16>) -> bool {
    ascii(unit).is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
}

fn is_identifier_part(unit: Option<&u16>) -> bool {
    is_identifier_start(unit) || is_digit(unit)
}

/// The text of one span of the source, which is whole because every surrogate
/// in a Rust string is half of a pair and a span never splits one: a span ends
/// where a unit outside the basic plane is not part of the token.
fn span(units: &[u16], start: usize, end: usize) -> String {
    String::from_utf16_lossy(&units[start..end])
}

pub fn lex(source: &str) -> Result<Vec<Token>, LexError> {
    let units: Vec<u16> = source.encode_utf16().collect();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < units.len() {
        let unit = units[index];
        let character = char::from_u32(u32::from(unit));

        if matches!(character, Some(' ' | '\t' | '\r' | '\n')) {
            index += 1;
            continue;
        }

        if is_digit(units.get(index)) {
            let start = index;
            while is_digit(units.get(index)) {
                index += 1;
            }
            if units.get(index) == Some(&u16::from(b'.')) && is_digit(units.get(index + 1)) {
                index += 1;
                while is_digit(units.get(index)) {
                    index += 1;
                }
            }
            let text = span(&units, start, index);
            let value = text.parse::<f64>().map_err(|_| LexError {
                message: format!("unrecognised number \"{text}\" at offset {start}"),
                start,
            })?;
            tokens.push(Token {
                kind: TokenKind::Number(value),
                text,
                start,
            });
            continue;
        }

        if character == Some('"') {
            let start = index;
            index += 1;
            let mut value: Vec<u16> = Vec::new();
            let mut closed = false;
            while index < units.len() {
                let held = units[index];
                if held == u16::from(b'"') {
                    index += 1;
                    closed = true;
                    break;
                }
                if held == u16::from(b'\\') && units.get(index + 1) == Some(&u16::from(b'"')) {
                    value.push(u16::from(b'"'));
                    index += 2;
                    continue;
                }
                value.push(held);
                index += 1;
            }
            if !closed {
                return Err(LexError {
                    message: format!("unterminated string literal starting at offset {start}"),
                    start,
                });
            }
            tokens.push(Token {
                kind: TokenKind::Text(String::from_utf16_lossy(&value)),
                text: span(&units, start, index),
                start,
            });
            continue;
        }

        if is_identifier_start(units.get(index)) {
            let start = index;
            while is_identifier_part(units.get(index)) {
                index += 1;
            }
            let text = span(&units, start, index);
            let kind = match text.as_str() {
                "TRUE" => TokenKind::Boolean(true),
                "FALSE" => TokenKind::Boolean(false),
                other => keyword(other).unwrap_or(TokenKind::Identifier),
            };
            tokens.push(Token { kind, text, start });
            continue;
        }

        if character == Some('<') {
            let (kind, width) = match units.get(index + 1).and_then(|&u| char::from_u32(u.into())) {
                Some('=') => (TokenKind::Le, 2),
                Some('>') => (TokenKind::Ne, 2),
                _ => (TokenKind::Lt, 1),
            };
            tokens.push(Token {
                text: span(&units, index, index + width),
                kind,
                start: index,
            });
            index += width;
            continue;
        }

        if character == Some('>') {
            let (kind, width) = match units.get(index + 1).and_then(|&u| char::from_u32(u.into())) {
                Some('=') => (TokenKind::Ge, 2),
                _ => (TokenKind::Gt, 1),
            };
            tokens.push(Token {
                text: span(&units, index, index + width),
                kind,
                start: index,
            });
            index += width;
            continue;
        }

        if let Some(kind) = single_character(unit) {
            tokens.push(Token {
                kind,
                text: span(&units, index, index + 1),
                start: index,
            });
            index += 1;
            continue;
        }

        // The refusal names the character the way the source spells it, which
        // for a character outside the basic plane is the pair of units rather
        // than the leading one on its own.
        let width = if (0xD800..0xDC00).contains(&unit) && index + 1 < units.len() {
            2
        } else {
            1
        };
        return Err(LexError {
            message: format!(
                "unrecognised character \"{}\" at offset {index}",
                span(&units, index, index + width)
            ),
            start: index,
        });
    }

    tokens.push(Token {
        kind: TokenKind::Eof,
        text: String::new(),
        start: units.len(),
    });
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::{LexError, TokenKind, lex};

    fn kinds(source: &str) -> Vec<String> {
        lex(source)
            .expect("the source scans")
            .iter()
            .map(|token| token.kind.as_str().to_string())
            .collect()
    }

    #[test]
    fn scans_the_shapes_a_formula_is_built_from() {
        assert_eq!(
            kinds("1 + 2.5 * (a.b - 3)"),
            [
                "number",
                "plus",
                "number",
                "star",
                "lparen",
                "identifier",
                "dot",
                "identifier",
                "minus",
                "number",
                "rparen",
                "eof"
            ]
        );
        assert_eq!(
            kinds("a <= b AND NOT c <> d OR TRUE"),
            [
                "identifier",
                "le",
                "identifier",
                "and",
                "not",
                "identifier",
                "ne",
                "identifier",
                "or",
                "boolean",
                "eof"
            ]
        );
    }

    #[test]
    fn a_numeric_path_segment_scans_as_a_number() {
        assert_eq!(
            kinds("vertex.0.x"),
            ["identifier", "dot", "number", "dot", "identifier", "eof"]
        );
    }

    #[test]
    fn a_trailing_stop_is_not_part_of_a_number() {
        // A number takes a stop only where a digit follows it, so the stop in
        // `1.x` stays the path separator it is.
        assert_eq!(kinds("1.x"), ["number", "dot", "identifier", "eof"]);
        let tokens = lex("1.5").expect("the source scans");
        assert_eq!(tokens[0].kind, TokenKind::Number(1.5));
    }

    #[test]
    fn a_string_keeps_its_escaped_quote_and_its_offsets() {
        let tokens = lex(r#" "a\"b" "#).expect("the source scans");
        assert_eq!(tokens[0].kind, TokenKind::Text("a\"b".to_string()));
        assert_eq!(tokens[0].start, 1);
        assert_eq!(tokens[0].text, r#""a\"b""#);
    }

    #[test]
    fn an_offset_counts_the_units_a_javascript_string_counts() {
        // The character before the fault is one Rust character and two UTF-16
        // units, so an offset that counted characters would name 3 here.
        let error = lex("\u{1D518} @").expect_err("the source does not scan");
        assert_eq!(
            error,
            LexError {
                message: "unrecognised character \"\u{1D518}\" at offset 0".to_string(),
                start: 0,
            }
        );
        // The quotes and the two units of the character put the `@` at 5.
        let after = lex("\"\u{1D518}\" @").expect_err("the source does not scan");
        assert_eq!(after.start, 5);
    }

    #[test]
    fn an_unterminated_string_names_where_it_opened() {
        assert_eq!(
            lex("1 + \"abc").expect_err("the source does not scan"),
            LexError {
                message: "unterminated string literal starting at offset 4".to_string(),
                start: 4,
            }
        );
    }

    #[test]
    fn malformed_input_is_refused_rather_than_ending_the_process() {
        for source in [
            "#",
            "@",
            "$",
            "[",
            "]",
            "{",
            "}",
            "`",
            "~",
            "\"unterminated",
            "\\",
            "\u{1D518}",
        ] {
            assert!(lex(source).is_err(), "{source} scans when it should not");
        }
    }

    #[test]
    fn the_end_token_sits_at_the_length_in_units() {
        let tokens =
            lex("\u{1D518}x".replace('\u{1D518}', "ab").as_str()).expect("the source scans");
        assert_eq!(tokens.last().expect("there is a last token").start, 3);
        let astral = lex("\"\u{1D518}\"").expect("the source scans");
        assert_eq!(astral.last().expect("there is a last token").start, 4);
    }
}
