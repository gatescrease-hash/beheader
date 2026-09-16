//! The smallest graph that could invalidate the hosting proposal, evaluated
//! two ways.
//!
//! The engine takes one service from its host, and it is the awkward one: a
//! glyph width arrives from a canvas the engine cannot open, and the result
//! becomes a graph value that geometry and further measurements depend on. Two
//! ways of getting that width are proposed. A browser binding calls the host
//! back inside evaluation and gets an answer before the call returns. A native
//! or worker binding cannot, because it sits across a process boundary, so it
//! evaluates against a table of measurements it already has and asks for the
//! ones it lacks.
//!
//! The chain below is four steps long because the second proposal only breaks
//! down over a chain. An upstream number makes a piece of text, the width of
//! that text sets the width of a box, the width of the box makes another piece
//! of text, and that line carries notation beside the words. Each step needs
//! the step above it measured before its own text is known, so a binding that
//! asks for measurements in batches cannot ask for all of them at once.
//!
//! The graph here is written out by hand rather than built from the schema and
//! the topological pass, which arrive with their own packages. It is a
//! prototype, and its value is that it is the same shape as the real one while
//! costing little enough to throw away.

use beheader_engine::measure::{
    MathStyle, MeasureCapability, MeasureError, Measurement, Measurer, TextStyle, check_measurement,
};
use beheader_engine::number::to_javascript_text;

pub mod exchange;

/// The inputs the proof graph evaluates from.
#[derive(Clone, Debug, PartialEq)]
pub struct ProofInputs {
    /// The upstream number that the first piece of text is built from.
    pub count: f64,
    /// The space the box leaves around the text it holds.
    pub padding: f64,
    pub font: String,
    pub font_size: f64,
    pub line_height: f64,
}

impl Default for ProofInputs {
    fn default() -> ProofInputs {
        ProofInputs {
            count: 7.0,
            padding: 8.0,
            font: "sans-serif".to_string(),
            font_size: 16.0,
            line_height: 20.0,
        }
    }
}

/// What the proof graph computed, with the measured values named separately
/// from the values derived from them.
#[derive(Clone, Debug, PartialEq)]
pub struct ProofValues {
    pub label_text: String,
    pub label_width: f64,
    pub label_height: f64,
    pub box_width: f64,
    pub note_text: String,
    pub note_width: f64,
    pub math_latex: String,
    pub math_width: f64,
    pub math_height: f64,
    /// The width of the line that holds the words and the notation together,
    /// which is the case that goes wrong when notation is measured before its
    /// fonts arrive.
    pub line_width: f64,
}

impl ProofInputs {
    fn text_style(&self) -> TextStyle {
        TextStyle {
            font: self.font.clone(),
            font_size: self.font_size,
            line_height: self.line_height,
        }
    }

    fn math_style(&self) -> MathStyle {
        MathStyle {
            font_size: self.font_size,
        }
    }

    fn label_text(&self) -> String {
        format!("Item {}", to_javascript_text(self.count))
    }

    fn box_width(&self, label_width: f64) -> f64 {
        label_width + self.padding * 2.0
    }

    fn note_text(&self, box_width: f64) -> String {
        format!("Box is {} wide", to_javascript_text(box_width.round()))
    }

    fn math_latex(&self, box_width: f64) -> String {
        format!("w = {}", to_javascript_text(box_width.round()))
    }
}

/// Evaluates the proof graph with a measurer that answers inside the call.
///
/// A failed measurement stops the pass and nothing is returned, so a caller
/// keeps whatever it committed last. There is no half filled result to mistake
/// for a finished one.
pub fn evaluate(
    inputs: &ProofInputs,
    measurer: &dyn Measurer,
) -> Result<ProofValues, MeasureError> {
    let text_style = inputs.text_style();

    let label_text = inputs.label_text();
    let label = check_measurement(measurer.measure(&label_text, &text_style, None)?)?;

    let box_width = inputs.box_width(label.width);

    let note_text = inputs.note_text(box_width);
    let note = check_measurement(measurer.measure(&note_text, &text_style, None)?)?;

    let math_latex = inputs.math_latex(box_width);
    let math = check_measurement(measurer.measure_math(&math_latex, &inputs.math_style())?)?;

    Ok(ProofValues {
        label_text,
        label_width: label.width,
        label_height: label.height,
        box_width,
        note_text,
        note_width: note.width,
        math_latex,
        math_width: math.width,
        math_height: math.height,
        line_width: note.width + math.width,
    })
}

/// A measurer that answers from the count of characters, for a test that has
/// no canvas. It reports the capability of a real text and notation measurer,
/// because a measurer that returns made up numbers is still a measurer and the
/// null one is told apart by its capability rather than by its answers.
#[derive(Clone, Copy, Debug)]
pub struct CountingMeasurer {
    pub width_per_character: f64,
}

impl Default for CountingMeasurer {
    fn default() -> CountingMeasurer {
        CountingMeasurer {
            width_per_character: 8.0,
        }
    }
}

impl Measurer for CountingMeasurer {
    fn capability(&self) -> MeasureCapability {
        MeasureCapability::TextAndMath
    }

    fn measure(
        &self,
        text: &str,
        style: &TextStyle,
        _max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        Ok(Measurement {
            width: text.chars().count() as f64 * self.width_per_character,
            height: style.line_height,
        })
    }

    fn measure_math(&self, latex: &str, style: &MathStyle) -> Result<Measurement, MeasureError> {
        Ok(Measurement {
            width: latex.chars().count() as f64 * self.width_per_character * 1.25,
            height: style.font_size * 1.5,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{CountingMeasurer, ProofInputs, ProofValues, evaluate};
    use beheader_engine::measure::{
        MathStyle, MeasureCapability, MeasureError, Measurement, Measurer, NullMeasurer, TextStyle,
    };
    use std::cell::Cell;

    fn values(inputs: &ProofInputs) -> ProofValues {
        evaluate(inputs, &CountingMeasurer::default()).expect("the counting measurer answers")
    }

    #[test]
    fn a_measured_width_reaches_the_geometry_below_it() {
        let result = values(&ProofInputs::default());
        assert_eq!(result.label_text, "Item 7");
        assert_eq!(result.label_width, 48.0);
        assert_eq!(result.box_width, 64.0);
    }

    #[test]
    fn a_change_upstream_moves_every_measured_value_under_it() {
        let narrow = values(&ProofInputs::default());
        let wide = values(&ProofInputs {
            count: 1000000.0,
            ..ProofInputs::default()
        });
        assert!(wide.label_width > narrow.label_width);
        assert!(wide.box_width > narrow.box_width);
        assert_ne!(wide.note_text, narrow.note_text);
        assert!(wide.line_width > narrow.line_width);
    }

    #[test]
    fn the_line_holding_words_and_notation_is_as_wide_as_both() {
        let result = values(&ProofInputs::default());
        assert_eq!(result.line_width, result.note_width + result.math_width);
        assert!(result.math_width > 0.0);
    }

    #[test]
    fn a_larger_font_measures_larger_without_any_input_changing() {
        let small = values(&ProofInputs::default());
        let large = values(&ProofInputs {
            font_size: 32.0,
            ..ProofInputs::default()
        });
        assert!(large.math_height > small.math_height);
    }

    #[test]
    fn a_measurer_that_cannot_size_notation_stops_the_pass() {
        struct TextOnly;
        impl Measurer for TextOnly {
            fn capability(&self) -> MeasureCapability {
                MeasureCapability::Text
            }
            fn measure(
                &self,
                text: &str,
                style: &TextStyle,
                _max_width: Option<f64>,
            ) -> Result<Measurement, MeasureError> {
                Ok(Measurement {
                    width: text.chars().count() as f64,
                    height: style.line_height,
                })
            }
        }
        assert_eq!(
            evaluate(&ProofInputs::default(), &TextOnly),
            Err(MeasureError::NoMathSupport)
        );
    }

    #[test]
    fn a_host_that_fails_part_way_leaves_nothing_behind() {
        struct FailsOnTheSecondCall {
            calls: Cell<u32>,
        }
        impl Measurer for FailsOnTheSecondCall {
            fn capability(&self) -> MeasureCapability {
                MeasureCapability::TextAndMath
            }
            fn measure(
                &self,
                text: &str,
                style: &TextStyle,
                _max_width: Option<f64>,
            ) -> Result<Measurement, MeasureError> {
                self.calls.set(self.calls.get() + 1);
                if self.calls.get() >= 2 {
                    return Err(MeasureError::HostFailed("the canvas is gone".to_string()));
                }
                Ok(Measurement {
                    width: text.chars().count() as f64,
                    height: style.line_height,
                })
            }
        }
        let measurer = FailsOnTheSecondCall {
            calls: Cell::new(0),
        };
        let outcome = evaluate(&ProofInputs::default(), &measurer);
        assert!(matches!(outcome, Err(MeasureError::HostFailed(_))));
        assert_eq!(measurer.calls.get(), 2);
    }

    #[test]
    fn a_measurement_the_graph_could_not_store_stops_the_pass() {
        struct AnswersWithInfinity;
        impl Measurer for AnswersWithInfinity {
            fn capability(&self) -> MeasureCapability {
                MeasureCapability::TextAndMath
            }
            fn measure(
                &self,
                _text: &str,
                _style: &TextStyle,
                _max_width: Option<f64>,
            ) -> Result<Measurement, MeasureError> {
                Ok(Measurement {
                    width: f64::INFINITY,
                    height: 10.0,
                })
            }
        }
        let outcome = evaluate(&ProofInputs::default(), &AnswersWithInfinity);
        assert!(matches!(outcome, Err(MeasureError::BadResult(_))));
    }

    #[test]
    fn the_null_measurer_runs_the_pass_and_measures_nothing() {
        let outcome = evaluate(&ProofInputs::default(), &NullMeasurer);
        assert_eq!(outcome, Err(MeasureError::NoMathSupport));
        assert_eq!(NullMeasurer.capability(), MeasureCapability::None);
    }

    #[test]
    fn notation_measured_at_the_wrong_size_leaves_the_line_too_narrow() {
        // The fault invariant 13 of STATUS.md describes, reproduced here as a
        // number rather than as a drawing: notation measured before its fonts
        // arrive comes back about a sixth too narrow, and the line that holds
        // it is short by the same amount, so the words after it are written
        // over.
        struct EarlyMath;
        impl Measurer for EarlyMath {
            fn capability(&self) -> MeasureCapability {
                MeasureCapability::TextAndMath
            }
            fn measure(
                &self,
                text: &str,
                style: &TextStyle,
                _max_width: Option<f64>,
            ) -> Result<Measurement, MeasureError> {
                CountingMeasurer::default().measure(text, style, None)
            }
            fn measure_math(
                &self,
                latex: &str,
                style: &MathStyle,
            ) -> Result<Measurement, MeasureError> {
                let arrived = CountingMeasurer::default().measure_math(latex, style)?;
                Ok(Measurement {
                    width: arrived.width * 5.0 / 6.0,
                    height: arrived.height,
                })
            }
        }
        let early = evaluate(&ProofInputs::default(), &EarlyMath).expect("it answers");
        let arrived = values(&ProofInputs::default());
        assert!(early.line_width < arrived.line_width);
        assert_eq!(early.note_width, arrived.note_width);
    }
}
