//! Reports what the two ways of getting a measurement cost.
//!
//! The quantity that decides between them is the count of host round trips one
//! evaluation needs, which is a property of the graph rather than of the
//! machine the report runs on. A binding that measures inside the pass makes
//! one call for each measurement and never leaves the pass. A binding that
//! measures in rounds runs the whole pass again for each step of the longest
//! measured chain, and each of those rounds is a crossing of a process
//! boundary.
//!
//! The timings printed beside those counts are the work this process does. The
//! cost of crossing a boundary is not measured here, because this binary has
//! no boundary to cross, and a made up latency would decide the question by
//! assumption rather than by evidence.
//!
//!   cargo run -p beheader-hostproof

use std::time::Instant;

use beheader_engine::measure::{MeasureError, Measurement, Measurer};
use beheader_hostproof::exchange::{KeyMeasurer, Limits, MeasureKey, MeasurementTable, run};
use beheader_hostproof::{CountingMeasurer, ProofInputs, evaluate};

/// Counts the calls a pass makes, standing in for a host callback.
struct CountingHost {
    inner: CountingMeasurer,
    calls: std::cell::Cell<u32>,
}

impl Measurer for CountingHost {
    fn capability(&self) -> beheader_engine::measure::MeasureCapability {
        self.inner.capability()
    }

    fn measure(
        &self,
        text: &str,
        style: &beheader_engine::measure::TextStyle,
        max_width: Option<f64>,
    ) -> Result<Measurement, MeasureError> {
        self.calls.set(self.calls.get() + 1);
        self.inner.measure(text, style, max_width)
    }

    fn measure_math(
        &self,
        latex: &str,
        style: &beheader_engine::measure::MathStyle,
    ) -> Result<Measurement, MeasureError> {
        self.calls.set(self.calls.get() + 1);
        self.inner.measure_math(latex, style)
    }
}

struct KeyHost {
    answered: u32,
}

impl KeyMeasurer for KeyHost {
    fn measure_key(&mut self, key: &MeasureKey) -> Result<Measurement, MeasureError> {
        self.answered += 1;
        let text = key.as_str().rsplit('|').next().unwrap_or_default();
        Ok(Measurement {
            width: text.chars().count() as f64 * 8.0,
            height: 20.0,
        })
    }
}

const REPETITIONS: u32 = 10_000;

fn main() {
    let inputs = ProofInputs::default();

    let host = CountingHost {
        inner: CountingMeasurer::default(),
        calls: std::cell::Cell::new(0),
    };
    let started = Instant::now();
    for _ in 0..REPETITIONS {
        host.calls.set(0);
        evaluate(&inputs, &host).expect("the pass settles");
    }
    let inside_pass = started.elapsed();
    let calls_inside = host.calls.get();

    let started = Instant::now();
    let mut rounds = 0;
    let mut requests = 0;
    for _ in 0..REPETITIONS {
        let mut table = MeasurementTable::new(1);
        let mut key_host = KeyHost { answered: 0 };
        let report = run(&inputs, &mut table, &mut key_host, Limits::default())
            .expect("the exchange settles");
        rounds = report.rounds;
        requests = report.requests;
    }
    let in_rounds = started.elapsed();

    let mut warm_table = MeasurementTable::new(1);
    let mut key_host = KeyHost { answered: 0 };
    run(&inputs, &mut warm_table, &mut key_host, Limits::default()).expect("the exchange settles");
    let started = Instant::now();
    for _ in 0..REPETITIONS {
        run(&inputs, &mut warm_table, &mut key_host, Limits::default()).expect("it settles");
    }
    let warm = started.elapsed();

    println!("Measurement cost over the proof graph, {REPETITIONS} evaluations each.");
    println!();
    println!("  Measured inside the pass");
    println!("    host calls per evaluation   {calls_inside}");
    println!("    passes per evaluation       1");
    println!("    host round trips            0, the host answers without leaving the pass");
    println!(
        "    engine work per evaluation  {:?}",
        inside_pass / REPETITIONS
    );
    println!();
    println!("  Measured in rounds, from an empty table");
    println!("    measurements requested      {requests}");
    println!("    passes per evaluation       {rounds}");
    println!(
        "    host round trips            {}, one for each pass that stopped short",
        rounds - 1
    );
    println!(
        "    engine work per evaluation  {:?}",
        in_rounds / REPETITIONS
    );
    println!();
    println!("  Measured in rounds, against a table that already holds the answers");
    println!("    passes per evaluation       1");
    println!("    host round trips            0");
    println!("    engine work per evaluation  {:?}", warm / REPETITIONS);
    println!();
    println!(
        "The chain is {calls_inside} measurements deep, and the exchange needs {rounds} passes to"
    );
    println!(
        "settle: one that stops at each measurement it has yet to hold, and a last one that finds"
    );
    println!("the table full.");
}
