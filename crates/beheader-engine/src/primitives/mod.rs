//! The object kinds a document holds, and the maths each one answers with.
//!
//! The modules here are being grown out of `src/engine/primitives` under the
//! plan in `docs/RUST_PORT.md`. `edge` carries the maths of one path edge,
//! `geometry` the shapes built from them, and the table and schema modules
//! that read both arrive with the rest of `RUST-007`.

pub mod doc;
pub mod edge;
pub mod geometry;
pub mod image;
pub mod schema;
pub mod table;
pub mod text;
