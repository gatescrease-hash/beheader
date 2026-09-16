//! The formula language: the stages a piece of formula source passes through
//! on its way to a value, and the rewrites a resize asks of one.
//!
//! This is the Rust side of `src/engine/formula/`. The stages arrive in the
//! order a formula meets them, so a stage is testable against the TypeScript
//! one before the stage after it exists.

pub mod ast;
pub mod lexer;
