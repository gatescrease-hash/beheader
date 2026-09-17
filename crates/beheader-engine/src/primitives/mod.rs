//! The object kinds a document holds, and the maths each one answers with.
//!
//! The modules here are being grown out of `src/engine/primitives` under the
//! plan in `docs/RUST_PORT.md`. `edge` carries the maths of one path edge, and
//! the shape, table and schema modules that read it arrive with the rest of
//! `RUST-007`.

pub mod edge;
