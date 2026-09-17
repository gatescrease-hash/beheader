//! The math language, which a math object holds one equation per line of.
//!
//! This is the Rust side of `src/engine/math/`. It is a separate family from
//! the formula language in `formula/`, and the two meet at a compute function
//! on a derived slot and nowhere else.

pub mod ast;
pub mod lexer;
pub mod parser;
