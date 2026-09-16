//! How the engine asks how wide a run of text is.
//!
//! This is the Rust side of `src/engine/eval-context.ts`. Text layout needs
//! glyph widths, a glyph width needs a canvas, and the engine opens none, so
//! the engine declares the trait and takes an implementation from outside it.
//! The result of a measurement becomes a graph value, so a measurer that
//! answers differently moves geometry and changes every formula downstream of
//! it.
//!
//! The TypeScript engine tells a real measurer from the null one by object
//! identity: `hasRealMeasurer` compares against the frozen null instance. Rust
//! has no equivalent comparison, and one written over a trait object would ask
//! a different question. So a measurer states its own capability, which also
//! separates two cases that identity ran together. A fake in a test that
//! answers every question with zero has the capability of a text measurer, and
//! the null measurer has none, even though the two return the same numbers.
//!
//! A measurement crosses a host boundary, so it can fail in ways an ordinary
//! function cannot: the host can throw, and it can hand back something that is
//! not a pair of numbers. Both arrive as a `MeasureError`, which the evaluator
//! turns into a `#MEASURE` value rather than into a guess. A width that is not
//! finite, or that is a negative zero, is refused here rather than further
//! downstream, because the graph refuses to store either and a measurement is
//! the one value that arrives from outside the engine.

use crate::model::{ErrorCode, ErrorValue, is_illegal_number};

/// The style a run of text is drawn in, which every glyph width depends on.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    pub font: String,
    pub font_size: f64,
    pub line_height: f64,
}

/// The size a run of mathematical notation is drawn at.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MathStyle {
    pub font_size: f64,
}

/// The size a run of text or notation takes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Measurement {
    pub width: f64,
    pub height: f64,
}

/// What a measurer can answer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MeasureCapability {
    /// The null measurer, which stands in where no host is present. It answers
    /// every question with zero, and the evaluator reads the capability rather
    /// than the zeros to know that no real measurement happened.
    None,
    /// Text alone, which is what a measurer written before the math object
    /// existed answers.
    Text,
    /// Text and notation.
    TextAndMath,
}

/// Why a measurement did not arrive.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MeasureError {
    /// The measurer answers for text alone, and something asked it to size
    /// notation.
    NoMathSupport,
    /// The host itself failed, such as a callback that threw.
    HostFailed(String),
    /// The host answered with something that is not a measurement the graph
    /// could store.
    BadResult(String),
}

impl MeasureError {
    /// The value a slot takes when a measurement fails. The wording reaches an
    /// operator, so it names what was asked for rather than the mechanism.
    pub fn to_value(&self) -> ErrorValue {
        let message = match self {
            MeasureError::NoMathSupport => "this measurer cannot size notation".to_string(),
            MeasureError::HostFailed(detail) => format!("the host could not measure: {detail}"),
            MeasureError::BadResult(detail) => {
                format!("the host returned no measurement: {detail}")
            }
        };
        ErrorValue {
            error: ErrorCode::Measure,
            message,
        }
    }
}

/// Checks a measurement that arrived from outside the engine.
///
/// A width or a height that the graph refuses to store is refused at the point
/// it enters rather than where it is read, so the object that produced it is
/// still known. A negative height is allowed through, because the TypeScript
/// engine stores one and a layout that produced one is a fault in the host
/// rather than a value the graph cannot hold.
pub fn check_measurement(measurement: Measurement) -> Result<Measurement, MeasureError> {
    if is_illegal_number(measurement.width) || is_illegal_number(measurement.height) {
        return Err(MeasureError::BadResult(format!(
            "width {} and height {} are not both numbers the graph can store",
            measurement.width, measurement.height
        )));
    }
    Ok(measurement)
}

/// The one service the engine takes from its host.
pub trait Measurer {
    fn capability(&self) -> MeasureCapability;

    /// The size of a run of text, wrapped at an optional maximum width.
    fn measure(
        &self,
        text: &str,
        style: &TextStyle,
        max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError>;

    /// The size of a run of notation. A measurer that answers for text alone
    /// keeps this default, which reports the missing capability rather than a
    /// guessed size.
    fn measure_math(&self, latex: &str, style: &MathStyle) -> Result<Measurement, MeasureError> {
        let _ = (latex, style);
        Err(MeasureError::NoMathSupport)
    }
}

/// The measurer that stands in where no host is present.
#[derive(Clone, Copy, Debug, Default)]
pub struct NullMeasurer;

impl Measurer for NullMeasurer {
    fn capability(&self) -> MeasureCapability {
        MeasureCapability::None
    }

    fn measure(
        &self,
        _text: &str,
        _style: &TextStyle,
        _max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        Ok(Measurement {
            width: 0.0,
            height: 0.0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MathStyle, MeasureCapability, MeasureError, Measurement, Measurer, NullMeasurer, TextStyle,
        check_measurement,
    };
    use crate::model::ErrorCode;

    /// A measurer that answers from the length of the text, which is what a
    /// headless test uses in place of a canvas.
    struct FakeMeasurer;

    impl Measurer for FakeMeasurer {
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
                width: text.chars().count() as f64 * style.font_size * 0.5,
                height: style.line_height,
            })
        }
    }

    /// A measurer that answers every question with zero, the way the null one
    /// does, and that is not the null one.
    struct ZeroMeasurer;

    impl Measurer for ZeroMeasurer {
        fn capability(&self) -> MeasureCapability {
            MeasureCapability::Text
        }

        fn measure(
            &self,
            _text: &str,
            _style: &TextStyle,
            _max_width: Option<f64>,
        ) -> Result<Measurement, MeasureError> {
            Ok(Measurement {
                width: 0.0,
                height: 0.0,
            })
        }
    }

    fn style() -> TextStyle {
        TextStyle {
            font: "sans-serif".to_string(),
            font_size: 16.0,
            line_height: 20.0,
        }
    }

    #[test]
    fn the_null_measurer_answers_with_zero_and_says_it_measured_nothing() {
        let measurement = NullMeasurer
            .measure("hello", &style(), None)
            .expect("the null measurer answers");
        assert_eq!(
            measurement,
            Measurement {
                width: 0.0,
                height: 0.0
            }
        );
        assert_eq!(NullMeasurer.capability(), MeasureCapability::None);
    }

    #[test]
    fn a_measurer_answering_with_zero_is_still_not_the_null_measurer() {
        let zero = ZeroMeasurer
            .measure("hello", &style(), None)
            .expect("it answers");
        let null = NullMeasurer
            .measure("hello", &style(), None)
            .expect("it answers");
        assert_eq!(zero, null);
        assert_ne!(ZeroMeasurer.capability(), NullMeasurer.capability());
    }

    #[test]
    fn a_measurer_for_text_alone_refuses_notation_rather_than_guessing() {
        let refusal = FakeMeasurer.measure_math("x^2", &MathStyle { font_size: 16.0 });
        assert_eq!(refusal, Err(MeasureError::NoMathSupport));
        assert_eq!(refusal.unwrap_err().to_value().error, ErrorCode::Measure);
    }

    #[test]
    fn a_wider_run_of_text_measures_wider() {
        let narrow = FakeMeasurer
            .measure("hi", &style(), None)
            .expect("it answers");
        let wide = FakeMeasurer
            .measure("hello there", &style(), None)
            .expect("it answers");
        assert!(wide.width > narrow.width);
        assert_eq!(narrow.height, 20.0);
    }

    #[test]
    fn a_measurement_the_graph_could_not_store_is_refused_where_it_enters() {
        for bad in [
            Measurement {
                width: f64::NAN,
                height: 10.0,
            },
            Measurement {
                width: f64::INFINITY,
                height: 10.0,
            },
            Measurement {
                width: 10.0,
                height: -0.0,
            },
        ] {
            let refusal = check_measurement(bad).expect_err("the graph refuses it");
            assert!(matches!(refusal, MeasureError::BadResult(_)));
            assert_eq!(refusal.to_value().error, ErrorCode::Measure);
        }
        assert!(
            check_measurement(Measurement {
                width: 0.0,
                height: 0.0
            })
            .is_ok()
        );
    }

    #[test]
    fn a_host_that_failed_carries_its_reason_to_the_operator() {
        let refusal = MeasureError::HostFailed("the canvas is gone".to_string());
        assert!(refusal.to_value().message.contains("the canvas is gone"));
    }
}
