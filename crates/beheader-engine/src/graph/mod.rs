//! Dependency edge data and the stable key used by graph traversals.

pub mod cycles;
pub mod eval;

use crate::address::Address;
use crate::model::slot_key;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Edge {
    pub source_slot: Address,
    pub dependent_slot: Address,
}

pub fn address_key(address: &Address) -> String {
    format!("{}::{}", address.object_id, slot_key(&address.path))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_the_object_and_path_together() {
        assert_eq!(
            address_key(&Address {
                object_id: "obj_3".into(),
                path: vec!["cells".into(), "A1".into()]
            }),
            "obj_3::cells.A1"
        );
    }
}
