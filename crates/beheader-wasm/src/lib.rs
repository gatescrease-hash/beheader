//! The browser binding, and the measurement callback it hands the engine.
//!
//! The engine needs a glyph width part way through a pass. In the page there
//! is no boundary to cross, so the binding calls a function the host gave it
//! and has the answer before the call returns. That is the whole premise this
//! crate exists to test, and everything else here is what the premise needs to
//! be safe.
//!
//! A domain refusal comes back as data rather than as an exception. Returning
//! a Rust `Result` through wasm-bindgen throws on the error side, and a
//! measurement that failed is an ordinary outcome that the application already
//! knows how to draw. Throwing for it would turn every refusal into a fault
//! the host has to catch, and would leave a genuine fault looking the same as
//! a table cell holding a division error. So the result carries the same
//! discriminant shape the TypeScript engine returns, and an exception is
//! reserved for a fault of the binding itself.
//!
//! The callbacks live as long as the engine instance that holds them, so a
//! function handed over at construction cannot outlive the engine or be called
//! after it has gone.
//!
//! Evaluation guards against reentry. A measurement callback that started
//! another evaluation would be reading a candidate that is half built, so the
//! guard refuses the inner call and the outer pass carries the refusal out.
//! A font that finishes loading during a pass does the same thing the
//! application already does: it schedules a refresh instead of interrupting
//! the pass that is running.

use std::cell::Cell;

use beheader_engine::measure::{
    MathStyle, MeasureCapability, MeasureError, Measurement, Measurer, TextStyle,
};
use beheader_hostproof::{ProofInputs, ProofValues, evaluate};
use js_sys::{Function, Object, Reflect};
use wasm_bindgen::prelude::*;

/// Reads a number off a JavaScript object, or says what was there instead.
fn number_member(value: &JsValue, name: &str) -> Result<f64, MeasureError> {
    let member = Reflect::get(value, &JsValue::from_str(name))
        .map_err(|_| MeasureError::BadResult(format!("the answer has no {name}")))?;
    member
        .as_f64()
        .ok_or_else(|| MeasureError::BadResult(format!("the {name} of the answer is not a number")))
}

/// Turns whatever the host threw into text, so the reason reaches an operator
/// rather than being replaced by a generic failure.
fn thrown_text(thrown: &JsValue) -> String {
    if let Some(text) = thrown.as_string() {
        return text;
    }
    let message = Reflect::get(thrown, &JsValue::from_str("message"))
        .ok()
        .and_then(|value| value.as_string());
    message.unwrap_or_else(|| "the host threw something with no message".to_string())
}

/// The measurer that calls back into the page.
struct HostMeasurer {
    measure_text: Function,
    measure_math: Option<Function>,
    calls: Cell<u32>,
    /// Set while a pass is running, so a callback that tries to start another
    /// one is refused rather than handed a half built candidate.
    inside_pass: Cell<bool>,
}

impl HostMeasurer {
    fn call(
        &self,
        function: &Function,
        arguments: &js_sys::Array,
    ) -> Result<Measurement, MeasureError> {
        self.calls.set(self.calls.get() + 1);
        let answer = function
            .apply(&JsValue::NULL, arguments)
            .map_err(|thrown| MeasureError::HostFailed(thrown_text(&thrown)))?;
        if !answer.is_object() {
            return Err(MeasureError::BadResult(
                "the host answered with something that is not an object".to_string(),
            ));
        }
        Ok(Measurement {
            width: number_member(&answer, "width")?,
            height: number_member(&answer, "height")?,
        })
    }
}

impl Measurer for HostMeasurer {
    fn capability(&self) -> MeasureCapability {
        match self.measure_math {
            Some(_) => MeasureCapability::TextAndMath,
            None => MeasureCapability::Text,
        }
    }

    fn measure(
        &self,
        text: &str,
        style: &TextStyle,
        max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        let arguments = js_sys::Array::new();
        arguments.push(&JsValue::from_str(text));
        arguments.push(&JsValue::from_str(&style.font));
        arguments.push(&JsValue::from_f64(style.font_size));
        arguments.push(&JsValue::from_f64(style.line_height));
        arguments.push(&match max_width {
            Some(width) => JsValue::from_f64(width),
            None => JsValue::UNDEFINED,
        });
        self.call(&self.measure_text, &arguments)
    }

    fn measure_math(&self, latex: &str, style: &MathStyle) -> Result<Measurement, MeasureError> {
        let Some(function) = self.measure_math.as_ref() else {
            return Err(MeasureError::NoMathSupport);
        };
        let arguments = js_sys::Array::new();
        arguments.push(&JsValue::from_str(latex));
        arguments.push(&JsValue::from_f64(style.font_size));
        self.call(function, &arguments)
    }
}

fn set(object: &Object, name: &str, value: JsValue) {
    Reflect::set(object, &JsValue::from_str(name), &value).expect("a plain object takes a member");
}

fn values_to_js(values: &ProofValues) -> JsValue {
    let object = Object::new();
    set(&object, "ok", JsValue::TRUE);
    set(&object, "labelText", JsValue::from_str(&values.label_text));
    set(&object, "labelWidth", JsValue::from_f64(values.label_width));
    set(
        &object,
        "labelHeight",
        JsValue::from_f64(values.label_height),
    );
    set(&object, "boxWidth", JsValue::from_f64(values.box_width));
    set(&object, "noteText", JsValue::from_str(&values.note_text));
    set(&object, "noteWidth", JsValue::from_f64(values.note_width));
    set(&object, "mathLatex", JsValue::from_str(&values.math_latex));
    set(&object, "mathWidth", JsValue::from_f64(values.math_width));
    set(&object, "mathHeight", JsValue::from_f64(values.math_height));
    set(&object, "lineWidth", JsValue::from_f64(values.line_width));
    object.into()
}

fn failure_to_js(failure: &MeasureError) -> JsValue {
    let value = failure.to_value();
    let object = Object::new();
    set(&object, "ok", JsValue::FALSE);
    set(&object, "error", JsValue::from_str(value.error.as_str()));
    set(&object, "message", JsValue::from_str(&value.message));
    object.into()
}

/// The engine as the page holds it.
#[wasm_bindgen]
pub struct ProofEngine {
    measurer: HostMeasurer,
}

#[wasm_bindgen]
impl ProofEngine {
    /// Takes the host measurer. The object carries a `measureText` function,
    /// and a `measureMath` function where the host can size notation.
    ///
    /// A missing `measureText` is a fault of the binding rather than a domain
    /// refusal, so it throws. Nothing the engine could do would recover from a
    /// host that handed over no measurer at all.
    #[wasm_bindgen(constructor)]
    pub fn new(host: &JsValue) -> Result<ProofEngine, JsValue> {
        let measure_text = Reflect::get(host, &JsValue::from_str("measureText"))
            .ok()
            .and_then(|value| value.dyn_into::<Function>().ok())
            .ok_or_else(|| JsValue::from_str("the host carries no measureText function"))?;
        let measure_math = Reflect::get(host, &JsValue::from_str("measureMath"))
            .ok()
            .and_then(|value| value.dyn_into::<Function>().ok());
        Ok(ProofEngine {
            measurer: HostMeasurer {
                measure_text,
                measure_math,
                calls: Cell::new(0),
                inside_pass: Cell::new(false),
            },
        })
    }

    /// Whether this measurer can size notation, which the host reads rather
    /// than guessing from the answers it gets.
    #[wasm_bindgen(js_name = canMeasureMath)]
    pub fn can_measure_math(&self) -> bool {
        self.measurer.capability() == MeasureCapability::TextAndMath
    }

    /// How many times the engine has called back into the page.
    #[wasm_bindgen(js_name = callbackCount)]
    pub fn callback_count(&self) -> u32 {
        self.measurer.calls.get()
    }

    /// Runs the pass, calling the host for each measurement it needs.
    ///
    /// The outcome is data either way. A pass that settled carries its values,
    /// and a pass that stopped carries the error code and the message an
    /// operator reads, with no half filled result in between.
    pub fn evaluate(
        &self,
        count: f64,
        padding: f64,
        font: &str,
        font_size: f64,
        line_height: f64,
    ) -> JsValue {
        if self.measurer.inside_pass.get() {
            return failure_to_js(&MeasureError::HostFailed(
                "a measurement callback started another evaluation".to_string(),
            ));
        }
        self.measurer.inside_pass.set(true);
        let inputs = ProofInputs {
            count,
            padding,
            font: font.to_string(),
            font_size,
            line_height,
        };
        let outcome = evaluate(&inputs, &self.measurer);
        self.measurer.inside_pass.set(false);
        match outcome {
            Ok(values) => values_to_js(&values),
            Err(failure) => failure_to_js(&failure),
        }
    }
}
