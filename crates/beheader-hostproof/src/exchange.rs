//! The measurement exchange a binding needs when it cannot call the host back
//! inside evaluation.
//!
//! A native or worker binding sits across a process boundary, so it cannot
//! stop half way through a pass and wait for a glyph width. It evaluates
//! against a table of measurements it already holds instead. A width that is
//! missing from the table stops the pass, the key is requested from the host,
//! and the same pass runs again from the same inputs with the table one entry
//! larger. Nothing is published from a pass that stopped, so a missing
//! measurement never reaches the graph as a guessed zero.
//!
//! A key carries the exact text, every style field that moves a glyph, the
//! optional wrapping width, and the epoch of the host metrics. The epoch
//! changes when a font finishes loading, which is what makes every earlier
//! measurement unusable rather than merely old: the same text under the same
//! style measures differently once the real font has arrived, and a table that
//! kept the earlier answer would draw a box that the text hangs out of.
//!
//! Because the epoch is part of the key, a reply that was in flight when the
//! epoch changed cannot be mistaken for an answer to the question being asked
//! now. The table refuses it rather than storing it under the current epoch.
//!
//! Two limits bound the exchange. A pass over a graph with no cycle in it asks
//! for one new measurement per step of its longest measured chain, so the
//! number of rounds is the depth of that chain rather than the count of
//! objects, and such a pass always settles. That makes the limits a backstop
//! rather than an ordinary condition.
//!
//! The case the backstop catches is metrics that move faster than the exchange
//! settles. A font that finishes loading between a request and its answer
//! moves the epoch, the answer is refused because its key belongs to the
//! epoch before, and a host whose fonts keep arriving holds the exchange short
//! of its last measurement for as long as that goes on. A binding that
//! measures inside the pass never meets that case, because every measurement
//! of one pass is taken under one epoch.

use std::cell::RefCell;
use std::collections::HashMap;

use beheader_engine::measure::{
    MathStyle, MeasureCapability, MeasureError, Measurement, Measurer, TextStyle,
};

use crate::{ProofInputs, ProofValues, evaluate};

/// The reason a pass stopped that is a missing measurement rather than a
/// failure. It never leaves this module: the driver reads the list of missing
/// keys instead.
const MISSING: &str = "the measurement is not in the table yet";

/// Everything about a measurement that changes its answer, as one piece of
/// text a request can carry and a table can key by.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct MeasureKey(String);

impl MeasureKey {
    pub fn text(text: &str, style: &TextStyle, max_width: Option<f64>, epoch: u64) -> MeasureKey {
        let width = match max_width {
            None => "none".to_string(),
            Some(width) => beheader_engine::number::to_javascript_text(width),
        };
        MeasureKey(format!(
            "text|{epoch}|{}|{}|{}|{width}|{text}",
            style.font, style.font_size, style.line_height
        ))
    }

    pub fn math(latex: &str, style: &MathStyle, epoch: u64) -> MeasureKey {
        MeasureKey(format!("math|{epoch}|{}|{latex}", style.font_size))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The measurements a binding already holds, under the epoch they were taken
/// at.
#[derive(Clone, Debug, Default)]
pub struct MeasurementTable {
    epoch: u64,
    entries: HashMap<MeasureKey, Measurement>,
}

impl MeasurementTable {
    pub fn new(epoch: u64) -> MeasurementTable {
        MeasurementTable {
            epoch,
            entries: HashMap::new(),
        }
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Moves to a new epoch, which is what a font finishing its load does.
    /// Every earlier entry stays in the table and none of it can be read
    /// again, because a key carries the epoch it was taken under.
    pub fn advance_epoch(&mut self) {
        self.epoch += 1;
    }

    /// Stores an answer from the host. A key from another epoch is a reply
    /// that was in flight when the metrics changed, and it is refused rather
    /// than stored.
    pub fn store(
        &mut self,
        key: MeasureKey,
        measurement: Measurement,
    ) -> Result<(), ExchangeError> {
        let prefix = format!("|{}|", self.epoch);
        if !key.as_str().contains(&prefix) {
            return Err(ExchangeError::StaleReply {
                key: key.as_str().to_string(),
                epoch: self.epoch,
            });
        }
        self.entries.insert(key, measurement);
        Ok(())
    }
}

/// Why an exchange produced no values.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExchangeError {
    /// The pass asked for another round after the limit, which means it never
    /// settled.
    RoundLimit { rounds: u32 },
    /// The pass asked for more measurements than the limit allows.
    RequestLimit { requests: u32 },
    /// An answer arrived for a question from an earlier epoch.
    StaleReply { key: String, epoch: u64 },
    /// The measurement itself failed, which is a failure of the host rather
    /// than of the exchange.
    Measurement(MeasureError),
}

/// What one exchange cost and what it produced.
#[derive(Clone, Debug, PartialEq)]
pub struct ExchangeReport {
    pub values: ProofValues,
    /// How many times the whole pass ran.
    pub rounds: u32,
    /// How many measurements were asked of the host.
    pub requests: u32,
}

/// The limits an exchange runs under.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_rounds: u32,
    pub max_requests: u32,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            max_rounds: 16,
            max_requests: 256,
        }
    }
}

/// Answers from the table, and writes down what it could not answer.
struct TableMeasurer<'a> {
    table: &'a MeasurementTable,
    missing: RefCell<Vec<MeasureKey>>,
}

impl TableMeasurer<'_> {
    fn miss(&self, key: MeasureKey) -> MeasureError {
        self.missing.borrow_mut().push(key);
        MeasureError::HostFailed(MISSING.to_string())
    }
}

impl Measurer for TableMeasurer<'_> {
    fn capability(&self) -> MeasureCapability {
        MeasureCapability::TextAndMath
    }

    fn measure(
        &self,
        text: &str,
        style: &TextStyle,
        max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        let key = MeasureKey::text(text, style, max_width, self.table.epoch);
        match self.table.entries.get(&key) {
            Some(measurement) => Ok(*measurement),
            None => Err(self.miss(key)),
        }
    }

    fn measure_math(&self, latex: &str, style: &MathStyle) -> Result<Measurement, MeasureError> {
        let key = MeasureKey::math(latex, style, self.table.epoch);
        match self.table.entries.get(&key) {
            Some(measurement) => Ok(*measurement),
            None => Err(self.miss(key)),
        }
    }
}

/// What one round of the exchange produced.
enum Round {
    Settled(ProofValues),
    Missing(Vec<MeasureKey>),
    Failed(MeasureError),
}

fn one_round(inputs: &ProofInputs, table: &MeasurementTable) -> Round {
    let measurer = TableMeasurer {
        table,
        missing: RefCell::new(Vec::new()),
    };
    match evaluate(inputs, &measurer) {
        Ok(values) => Round::Settled(values),
        Err(failure) => {
            let missing = measurer.missing.into_inner();
            if missing.is_empty() {
                Round::Failed(failure)
            } else {
                Round::Missing(missing)
            }
        }
    }
}

/// Answers a batch of keys, standing in for whatever is on the far side of the
/// boundary.
pub trait KeyMeasurer {
    fn measure_key(&mut self, key: &MeasureKey) -> Result<Measurement, MeasureError>;
}

/// Runs the exchange until the pass settles or a limit stops it.
///
/// A limit produces an error and no values, so a binding that reaches one
/// keeps whatever it committed last rather than publishing a pass that never
/// settled.
pub fn run(
    inputs: &ProofInputs,
    table: &mut MeasurementTable,
    host: &mut dyn KeyMeasurer,
    limits: Limits,
) -> Result<ExchangeReport, ExchangeError> {
    let mut rounds = 0;
    let mut requests = 0;
    loop {
        rounds += 1;
        if rounds > limits.max_rounds {
            return Err(ExchangeError::RoundLimit { rounds: rounds - 1 });
        }
        match one_round(inputs, table) {
            Round::Settled(values) => {
                return Ok(ExchangeReport {
                    values,
                    rounds,
                    requests,
                });
            }
            Round::Failed(failure) => return Err(ExchangeError::Measurement(failure)),
            Round::Missing(keys) => {
                for key in keys {
                    requests += 1;
                    if requests > limits.max_requests {
                        return Err(ExchangeError::RequestLimit {
                            requests: requests - 1,
                        });
                    }
                    let measurement = host.measure_key(&key).map_err(ExchangeError::Measurement)?;
                    table.store(key, measurement)?;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ExchangeError, KeyMeasurer, Limits, MeasureKey, MeasurementTable, run};
    use crate::ProofInputs;
    use beheader_engine::measure::{MeasureError, Measurement};

    /// Answers a key from the text at the end of it, which is enough to make
    /// the widths of the chain differ from each other.
    struct KeyLength {
        answered: u32,
        width_per_character: f64,
    }

    impl KeyLength {
        fn new() -> KeyLength {
            KeyLength {
                answered: 0,
                width_per_character: 8.0,
            }
        }
    }

    impl KeyMeasurer for KeyLength {
        fn measure_key(&mut self, key: &MeasureKey) -> Result<Measurement, MeasureError> {
            self.answered += 1;
            let text = key.as_str().rsplit('|').next().unwrap_or_default();
            Ok(Measurement {
                width: text.chars().count() as f64 * self.width_per_character,
                height: 20.0,
            })
        }
    }

    #[test]
    fn a_chain_of_three_measurements_settles_in_four_rounds() {
        let mut table = MeasurementTable::new(1);
        let mut host = KeyLength::new();
        let report = run(
            &ProofInputs::default(),
            &mut table,
            &mut host,
            Limits::default(),
        )
        .expect("the exchange settles");
        // Three measurements, each one needing the one above it before its own
        // text is known, and a fourth round that finds the table complete.
        assert_eq!(report.rounds, 4);
        assert_eq!(report.requests, 3);
        assert_eq!(host.answered, 3);
        assert!(report.values.box_width > 0.0);
    }

    #[test]
    fn a_second_run_over_the_same_inputs_asks_for_nothing() {
        let mut table = MeasurementTable::new(1);
        let mut host = KeyLength::new();
        let inputs = ProofInputs::default();
        let first = run(&inputs, &mut table, &mut host, Limits::default()).expect("it settles");
        let second = run(&inputs, &mut table, &mut host, Limits::default()).expect("it settles");
        assert_eq!(second.rounds, 1);
        assert_eq!(second.requests, 0);
        assert_eq!(first.values, second.values);
    }

    #[test]
    fn a_font_that_finished_loading_makes_every_earlier_measurement_unreadable() {
        let mut table = MeasurementTable::new(1);
        let mut host = KeyLength::new();
        let inputs = ProofInputs::default();
        run(&inputs, &mut table, &mut host, Limits::default()).expect("it settles");
        let before = table.len();

        table.advance_epoch();
        let after_font =
            run(&inputs, &mut table, &mut host, Limits::default()).expect("it settles");
        assert_eq!(after_font.rounds, 4);
        assert_eq!(after_font.requests, 3);
        assert_eq!(table.len(), before * 2);
    }

    #[test]
    fn an_answer_from_an_earlier_epoch_is_refused_rather_than_stored() {
        let mut table = MeasurementTable::new(1);
        let stale = MeasureKey::math(
            "x^2",
            &beheader_engine::measure::MathStyle { font_size: 16.0 },
            0,
        );
        let refusal = table
            .store(
                stale,
                Measurement {
                    width: 10.0,
                    height: 10.0,
                },
            )
            .expect_err("a reply from an earlier epoch is refused");
        assert!(matches!(refusal, ExchangeError::StaleReply { .. }));
        assert!(table.is_empty());
    }

    #[test]
    fn a_round_limit_below_the_depth_of_the_chain_produces_no_values() {
        let mut table = MeasurementTable::new(1);
        let mut host = KeyLength::new();
        let outcome = run(
            &ProofInputs::default(),
            &mut table,
            &mut host,
            Limits {
                max_rounds: 2,
                max_requests: 256,
            },
        );
        assert_eq!(outcome, Err(ExchangeError::RoundLimit { rounds: 2 }));
    }

    #[test]
    fn a_request_limit_below_the_count_of_measurements_produces_no_values() {
        let mut table = MeasurementTable::new(1);
        let mut host = KeyLength::new();
        let outcome = run(
            &ProofInputs::default(),
            &mut table,
            &mut host,
            Limits {
                max_rounds: 1000,
                max_requests: 2,
            },
        );
        assert_eq!(outcome, Err(ExchangeError::RequestLimit { requests: 2 }));
    }

    /// Metrics that change faster than the exchange settles.
    ///
    /// This is the case that stops a binding asking for measurements in rounds
    /// and leaves a binding that measures inside the pass alone. Every answer
    /// arrives under an epoch that has already moved on, so the table never
    /// holds two entries of the same epoch at once and the pass never reaches
    /// its third measurement however long it runs.
    struct MetricsKeepMoving<'a> {
        table_epoch: &'a std::cell::Cell<bool>,
    }

    impl KeyMeasurer for MetricsKeepMoving<'_> {
        fn measure_key(&mut self, key: &MeasureKey) -> Result<Measurement, MeasureError> {
            self.table_epoch.set(true);
            let text = key.as_str().rsplit('|').next().unwrap_or_default();
            Ok(Measurement {
                width: text.chars().count() as f64 * 8.0,
                height: 20.0,
            })
        }
    }

    #[test]
    fn metrics_that_move_every_round_stop_the_exchange_with_no_values() {
        let moved = std::cell::Cell::new(false);
        let mut table = MeasurementTable::new(1);
        let inputs = ProofInputs::default();
        let limits = Limits {
            max_rounds: 8,
            max_requests: 256,
        };
        let mut rounds = 0;
        let outcome = loop {
            rounds += 1;
            if rounds > limits.max_rounds {
                break Err(ExchangeError::RoundLimit {
                    rounds: limits.max_rounds,
                });
            }
            let mut host = MetricsKeepMoving {
                table_epoch: &moved,
            };
            moved.set(false);
            let attempt = run(
                &inputs,
                &mut table,
                &mut host,
                Limits {
                    max_rounds: 2,
                    max_requests: 256,
                },
            );
            if moved.get() {
                // A font finished loading while the answers were in flight.
                table.advance_epoch();
            }
            if let Ok(report) = attempt {
                break Ok(report);
            }
        };
        assert_eq!(outcome, Err(ExchangeError::RoundLimit { rounds: 8 }));
    }

    #[test]
    fn a_host_that_fails_ends_the_exchange_with_no_values() {
        struct AlwaysFails;
        impl KeyMeasurer for AlwaysFails {
            fn measure_key(&mut self, _key: &MeasureKey) -> Result<Measurement, MeasureError> {
                Err(MeasureError::HostFailed("the worker is gone".to_string()))
            }
        }
        let mut table = MeasurementTable::new(1);
        let outcome = run(
            &ProofInputs::default(),
            &mut table,
            &mut AlwaysFails,
            Limits::default(),
        );
        assert!(matches!(outcome, Err(ExchangeError::Measurement(_))));
        assert!(table.is_empty());
    }
}
