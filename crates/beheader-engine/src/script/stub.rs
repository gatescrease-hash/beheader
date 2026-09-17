//! The script node: a real participant in the graph with a placeholder body. It
//! exists so that the surrounding machinery is built and tested before any
//! scripting language arrives.
//!
//! Its ports are ordinary slots, so the rest of the engine treats it like any
//! other object. An `in.<port>` slot is a formula slot, so it binds to some
//! upstream address. An `out.<port>` slot is a derived slot whose schema names
//! every `in.*` slot on the node. The source slot is a literal that nothing
//! reads, so editing the script text triggers no recompute.
//!
//! Adding a port is two operations that have to land in one batch: the name and
//! the value. The moment an `out.*` port exists, the integrity check demands
//! that every address it declares resolves to a real slot, so adding a port on
//! its own fails.
//!
//! [`evaluate_script_output`] returns the placeholder. When a real language
//! arrives, that one function body is what changes.
//!
//! The port of `src/engine/script/stub.ts`.

use std::collections::BTreeMap;

use crate::address::Address;
use crate::model::{ErrorCode, ErrorValue, GraphObject, Value};
use crate::primitives::schema::{
    DerivedSlotCompute, DerivedSlotDependencies, DerivedSlotSchema, SlotComputeInputs,
};

/// A script node as its body sees it.
pub struct ScriptNode {
    pub language: String,
    pub source: String,
    pub inputs: BTreeMap<String, Value>,
    pub placeholders: BTreeMap<String, Value>,
}

/// The fake body of a script node. It answers the placeholder for the port.
/// When Python arrives, only this function changes.
pub fn evaluate_script_output(
    node: &ScriptNode,
    port_name: &str,
    _inputs: &BTreeMap<String, Value>,
) -> Value {
    node.placeholders
        .get(port_name)
        .cloned()
        .unwrap_or(Value::Null)
}

pub fn script_language_path() -> Vec<String> {
    vec!["language".to_string()]
}

pub fn script_source_path() -> Vec<String> {
    vec!["source".to_string()]
}

pub fn script_in_port_path(name: &str) -> Vec<String> {
    vec!["in".to_string(), name.to_string()]
}

pub fn script_out_port_path(name: &str) -> Vec<String> {
    vec!["out".to_string(), name.to_string()]
}

pub fn script_placeholder_path(name: &str) -> Vec<String> {
    vec!["placeholder".to_string(), name.to_string()]
}

fn input_names<A>(object: &GraphObject<A>) -> Vec<String> {
    object
        .ports
        .as_ref()
        .map(|ports| ports.input.clone())
        .unwrap_or_default()
}

fn output_names<A>(object: &GraphObject<A>) -> Vec<String> {
    object
        .ports
        .as_ref()
        .map(|ports| ports.output.clone())
        .unwrap_or_default()
}

pub fn enumerate_script_in_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    input_names(object)
        .iter()
        .map(|name| script_in_port_path(name))
        .collect()
}

pub fn enumerate_script_placeholder_paths<A>(object: &GraphObject<A>) -> Vec<Vec<String>> {
    output_names(object)
        .iter()
        .map(|name| script_placeholder_path(name))
        .collect()
}

/// An output reads every input of the node and its own placeholder, so adding
/// an input re-runs each output rather than only the one that names it.
fn script_out_dependencies<A: 'static>(port_name: String) -> DerivedSlotDependencies<A> {
    DerivedSlotDependencies::Dynamic(Box::new(move |object, _objects| {
        let mut addresses: Vec<Address> = input_names(object)
            .iter()
            .map(|name| Address {
                object_id: object.id.clone(),
                path: script_in_port_path(name),
            })
            .collect();
        addresses.push(Address {
            object_id: object.id.clone(),
            path: script_placeholder_path(&port_name),
        });
        addresses
    }))
}

fn script_output_compute<A: 'static>(port_name: String) -> DerivedSlotCompute<A> {
    Box::new(move |object, inputs: &SlotComputeInputs<A>| {
        let mut gathered = BTreeMap::new();
        for name in input_names(object) {
            let Some(value) = inputs.at(object, &script_in_port_path(&name)) else {
                return Value::Error(ErrorValue {
                    error: ErrorCode::Ref,
                    message: format!("script: in.{name} did not resolve to a value"),
                });
            };
            if let Value::Error(_) = value {
                return value;
            }
            gathered.insert(name, value);
        }
        let Some(placeholder) = inputs.at(object, &script_placeholder_path(&port_name)) else {
            return Value::Error(ErrorValue {
                error: ErrorCode::Ref,
                message: format!("script: out.{port_name}'s placeholder value did not resolve"),
            });
        };
        if let Value::Error(_) = placeholder {
            return placeholder;
        }
        let node = ScriptNode {
            language: "python".to_string(),
            source: String::new(),
            inputs: gathered.clone(),
            placeholders: BTreeMap::from([(port_name.clone(), placeholder)]),
        };
        evaluate_script_output(&node, &port_name, &gathered)
    })
}

pub fn enumerate_script_out_derived_slots<A: 'static>(
    object: &GraphObject<A>,
) -> Vec<DerivedSlotSchema<A>> {
    output_names(object)
        .into_iter()
        .map(|name| DerivedSlotSchema {
            path: script_out_port_path(&name),
            dependencies: script_out_dependencies(name.clone()),
            compute: script_output_compute(name),
        })
        .collect()
}
