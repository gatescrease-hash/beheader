//! The Beheader engine in Rust.
//!
//! The crate is being grown one package at a time out of `src/engine` in the
//! TypeScript tree, under the plan in `docs/RUST_PORT.md`. What is here is
//! what a shared conformance fixture can already ask of both engines, and the
//! `beheader-conformance` binary answers anything else with an explicit
//! unsupported result rather than a guess.
//!
//! The crate reaches no host: it opens no file, reads no clock and starts no
//! process, so the same code compiles for a native test run and for
//! `wasm32-unknown-unknown`.

#![forbid(unsafe_code)]

pub mod address;
pub mod formula;
pub mod graph;
pub mod math;
pub mod measure;
pub mod model;
pub mod number;
pub mod primitives;
pub mod script;
pub mod wire;
