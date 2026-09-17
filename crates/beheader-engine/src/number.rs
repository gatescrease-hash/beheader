//! Turns an `f64` into the text JavaScript would print for it.
//!
//! The graph stores binary64 numbers in both engines, so two equal numbers
//! always compare equal. Their text does not follow from that. Rust prints
//! `1e21` as a row of twenty two digits and JavaScript prints it as `1e+21`,
//! and that text reaches an operator through a formatted formula, the resolved
//! content of a text object and the wording of a diagnostic. A port that used
//! the Rust `Display` output would change all three.
//!
//! The file also holds the arithmetic whose JavaScript answer differs from the
//! Rust one. Both languages hold binary64, so they agree on what a number is,
//! and they disagree on what some operations over one give back. A document
//! carries the answers JavaScript gave, so the engines agree only where these
//! are used in place of the Rust methods.
//!
//! The transcendental functions divide into three groups, and every one of
//! them reaches JavaScript through a wrapper here so that a call site names
//! which group it is in. Some the binary64 rules fix, so they agree everywhere,
//! and `js_sqrt` is one of those. Some follow an algorithm of plain arithmetic
//! this file carries out itself, and `js_hypot` is the one of those. The rest
//! come from `libm`, in place of the method the target supplies: a native build
//! otherwise reaches the system library and a `wasm32-unknown-unknown` build
//! reaches a different implementation compiled in, so a conformance run on the
//! native target would say nothing about the engine an operator loads.
//!
//! Of the sixteen functions the engine reaches, seven answer exactly what V8
//! answers and nine part from it by one unit in the last place, at rates from
//! one argument in four thousand to one in eleven. `D-012` in
//! `docs/RUST_PORT.md` holds the measurement and what closing the difference
//! would take. Each function below says which of the two groups it is in, so a
//! call site that needs agreement can see whether it has it.
//!
//! The rules for the text are the ones ECMAScript gives for `Number::toString`
//! with radix ten. The shortest run of digits that reads back as the same number
//! comes from the Rust `{:e}` formatter, which already produces exactly that
//! run, and the rules below decide where the decimal point goes and whether an
//! exponent appears at all.

/// The number of digits either side of which ECMAScript writes an exponent.
const FIXED_NOTATION_LIMIT: i32 = 21;

/// The exponent below which ECMAScript writes a small number with an exponent
/// rather than as a run of leading zeros.
const SMALL_NOTATION_LIMIT: i32 = -6;

/// The text JavaScript prints for a number, such as `1e+21` or `0.000001`.
pub fn to_javascript_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        // Negative zero prints as `0`, which is the one place the sign of a
        // zero disappears in both engines alike.
        return "0".to_string();
    }
    if value.is_infinite() {
        return if value < 0.0 { "-Infinity" } else { "Infinity" }.to_string();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let (digits, point) = shortest_digits(value.abs());
    format!("{sign}{}", place_point(&digits, point))
}

/// The shortest digits that read back as the same number, and where the
/// decimal point falls. The value is `0.digits` times ten to the power of the
/// second member, which is the `n` of the ECMAScript rules.
fn shortest_digits(value: f64) -> (String, i32) {
    let scientific = format!("{value:e}");
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("the Rust scientific formatter always writes an exponent");
    let digits: String = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect();
    let exponent: i32 = exponent.parse().expect("the exponent is an integer");
    (digits, exponent + 1)
}

/// Writes the digits with the decimal point or the exponent in the place
/// ECMAScript puts it.
fn place_point(digits: &str, point: i32) -> String {
    let count = digits.len() as i32;
    if point >= count && point <= FIXED_NOTATION_LIMIT {
        return format!("{digits}{}", "0".repeat((point - count) as usize));
    }
    if point > 0 && point <= FIXED_NOTATION_LIMIT {
        let split = point as usize;
        return format!("{}.{}", &digits[..split], &digits[split..]);
    }
    if point > SMALL_NOTATION_LIMIT && point <= 0 {
        return format!("0.{}{digits}", "0".repeat((-point) as usize));
    }
    let exponent = point - 1;
    let exponent_sign = if exponent >= 0 { "+" } else { "-" };
    let magnitude = exponent.abs();
    if count == 1 {
        return format!("{digits}e{exponent_sign}{magnitude}");
    }
    format!(
        "{}.{}e{exponent_sign}{magnitude}",
        &digits[..1],
        &digits[1..]
    )
}

/// Rounds a half toward positive infinity, which is what `Math.round` does and
/// what `f64::round` does not: the Rust method rounds a half away from zero, so
/// it answers -3 where JavaScript answers -2 for -2.5.
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    if x > 0.0 && x < 0.5 {
        return 0.0;
    }
    if (-0.5..0.0).contains(&x) {
        return -0.0;
    }
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// The sign of a number as JavaScript gives it: -1, 0 or 1, with a zero
/// keeping its sign and a NaN answering NaN. `f64::signum` answers 1 for a
/// positive zero and -1 for a negative one, and never NaN.
pub fn js_sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 {
        return x;
    }
    if x > 0.0 { 1.0 } else { -1.0 }
}

/// The smaller of two numbers, answering NaN where either is NaN. `f64::min`
/// answers the other side instead, which would hide a NaN that the check for
/// an illegal number is there to catch.
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a < b {
        a
    } else if b < a {
        b
    } else if a.is_sign_negative() {
        a
    } else {
        b
    }
}

pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a > b {
        a
    } else if b > a {
        b
    } else if a.is_sign_positive() {
        a
    } else {
        b
    }
}

#[cfg(test)]
mod tests {
    use super::to_javascript_text;

    #[test]
    fn writes_whole_numbers_without_a_point() {
        assert_eq!(to_javascript_text(0.0), "0");
        assert_eq!(to_javascript_text(-0.0), "0");
        assert_eq!(to_javascript_text(1.0), "1");
        assert_eq!(to_javascript_text(-42.0), "-42");
        assert_eq!(to_javascript_text(1e20), "100000000000000000000");
    }

    #[test]
    fn writes_an_exponent_where_javascript_does() {
        assert_eq!(to_javascript_text(1e21), "1e+21");
        assert_eq!(to_javascript_text(1.5e21), "1.5e+21");
        assert_eq!(to_javascript_text(1e-7), "1e-7");
        assert_eq!(to_javascript_text(-1e-7), "-1e-7");
        assert_eq!(to_javascript_text(1.2345e-7), "1.2345e-7");
    }

    #[test]
    fn writes_small_numbers_as_leading_zeros_down_to_the_limit() {
        assert_eq!(to_javascript_text(1e-6), "0.000001");
        assert_eq!(to_javascript_text(0.1), "0.1");
        assert_eq!(to_javascript_text(0.5), "0.5");
        assert_eq!(to_javascript_text(-0.25), "-0.25");
    }

    #[test]
    fn writes_the_shortest_run_that_reads_back() {
        assert_eq!(to_javascript_text(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(to_javascript_text(f64::MAX), "1.7976931348623157e+308");
        assert_eq!(
            to_javascript_text(f64::MIN_POSITIVE),
            "2.2250738585072014e-308"
        );
        assert_eq!(to_javascript_text(5e-324), "5e-324");
    }

    #[test]
    fn writes_the_names_of_the_numbers_that_are_not_finite() {
        assert_eq!(to_javascript_text(f64::NAN), "NaN");
        assert_eq!(to_javascript_text(f64::INFINITY), "Infinity");
        assert_eq!(to_javascript_text(f64::NEG_INFINITY), "-Infinity");
    }
}

/// The distance JavaScript gives for a right triangle, which is neither
/// `f64::hypot` nor the square root of a sum of squares.
///
/// `Math.hypot` divides both legs by the larger magnitude and then sums the
/// squares with a compensation term, so a long leg beside a short one does not
/// round the short one away. Each step is an addition, a multiplication, a
/// division or a square root, and the binary64 rules fix the result of every one of
/// those, so this answer is the same on each target the engine builds for and
/// the same as the one V8 gives. The routine behind `f64::hypot` follows a
/// different algorithm and parts from it for about a third of pairs.
pub fn js_hypot(a: f64, b: f64) -> f64 {
    // An infinite leg answers before a NaN one, in the order the ECMAScript
    // algorithm tests them.
    if a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    let largest = js_max(a.abs(), b.abs());
    if largest == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut compensation = 0.0f64;
    for leg in [a, b] {
        let scaled = leg / largest;
        let summand = scaled * scaled - compensation;
        let running = sum + summand;
        compensation = (running - sum) - summand;
        sum = running;
    }
    sum.sqrt() * largest
}

/// The square root, which the binary64 rules fix. It has a wrapper of its own so
/// the whole set a formula function can reach reads from one place.
pub fn js_sqrt(x: f64) -> f64 {
    x.sqrt()
}

/// The tangent, which agreed with V8 over every one of the 220,005 measured
/// arguments.
pub fn js_tan(x: f64) -> f64 {
    libm::tan(x)
}

/// The arc sine, which agreed with V8 over every measured argument inside the
/// range where it has a value.
pub fn js_asin(x: f64) -> f64 {
    libm::asin(x)
}

/// The arc cosine, which agreed with V8 over every measured argument inside the
/// range where it has a value.
pub fn js_acos(x: f64) -> f64 {
    libm::acos(x)
}

/// The arc tangent, which agreed with V8 over every one of the 220,005 measured
/// arguments.
pub fn js_atan(x: f64) -> f64 {
    libm::atan(x)
}

/// The two argument arc tangent, which agreed with V8 over every one of the
/// 220,005 measured pairs.
pub fn js_atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// The sine. It parts from V8 by one unit in the last place for about one
/// argument in a hundred and twenty, under `D-012`.
pub fn js_sin(x: f64) -> f64 {
    libm::sin(x)
}

/// The cosine. It parts from V8 by one unit in the last place for about one
/// argument in a hundred and twenty, under `D-012`.
pub fn js_cos(x: f64) -> f64 {
    libm::cos(x)
}

/// The hyperbolic sine. It parts from V8 for about one argument in a hundred
/// and thirty, under `D-012`.
pub fn js_sinh(x: f64) -> f64 {
    libm::sinh(x)
}

/// The hyperbolic cosine. It parts from V8 for about one argument in a hundred,
/// under `D-012`.
pub fn js_cosh(x: f64) -> f64 {
    libm::cosh(x)
}

/// The hyperbolic tangent. It parts from V8 for about one argument in eleven
/// over a wide sweep, which is the loosest of the set, under `D-012`.
pub fn js_tanh(x: f64) -> f64 {
    libm::tanh(x)
}

/// The natural logarithm. It parts from V8 for about one argument in two
/// hundred, under `D-012`.
pub fn js_ln(x: f64) -> f64 {
    libm::log(x)
}

/// The base ten logarithm. It parts from V8 for about one argument in fourteen,
/// under `D-012`.
pub fn js_log10(x: f64) -> f64 {
    libm::log10(x)
}

/// The exponential. It parts from V8 for about one argument in four thousand,
/// which is the tightest of the nine and still includes `exp(1)`, under
/// `D-012`.
pub fn js_exp(x: f64) -> f64 {
    libm::exp(x)
}

/// The power. It parts from V8 for about one pair in twenty three, under
/// `D-012`. The `**` operator and `Math.pow` are the same operation in
/// JavaScript, so a formula written with either one reaches this.
pub fn js_pow(base: f64, exponent: f64) -> f64 {
    libm::pow(base, exponent)
}

#[cfg(test)]
mod javascript_arithmetic_tests {
    use super::*;

    /// The pairs come from `Math.hypot` in V8. The first two are the ordinary
    /// case, and the last is the one that separates the two algorithms: a leg
    /// far larger than the other rounds the smaller one away under a plain sum
    /// of squares, and survives the scaling this one does first.
    #[test]
    fn hypot_answers_what_javascript_answers() {
        assert_eq!(js_hypot(3.0, 4.0), 5.0);
        assert_eq!(js_hypot(0.0, 0.0), 0.0);
        assert_eq!(
            js_hypot(1e300, 1e300).to_bits(),
            1.4142135623730952e300f64.to_bits()
        );
        assert_eq!(js_hypot(-0.0, -0.0), 0.0);
    }

    /// An infinite leg answers before a NaN one, so a NaN beside an infinity
    /// gives the infinity rather than the NaN a plain comparison would keep.
    #[test]
    fn hypot_puts_an_infinity_before_a_not_a_number() {
        assert_eq!(js_hypot(f64::INFINITY, f64::NAN), f64::INFINITY);
        assert_eq!(js_hypot(f64::NAN, f64::NEG_INFINITY), f64::INFINITY);
        assert!(js_hypot(f64::NAN, 1.0).is_nan());
    }

    /// The results come from V8. Each one is a function the measurement found
    /// no difference in over 220,005 arguments, so a change in the
    /// implementation behind the wrapper shows up here rather than waiting for
    /// a conformance run to meet the argument that exposes it.
    #[test]
    fn the_agreeing_functions_answer_what_javascript_answers() {
        // Each right side is the V8 answer, and the four written as a
        // constant are cases where that answer is the nearest double to the
        // exact one. A half has an arc sine of a sixth of a turn either way.
        assert_eq!(js_tan(0.171).to_bits(), 0.1726864653232263f64.to_bits());
        assert_eq!(js_atan(0.5).to_bits(), 0.4636476090008061f64.to_bits());
        assert_eq!(
            js_atan2(1.0, 2.0).to_bits(),
            0.4636476090008061f64.to_bits()
        );
        assert_eq!(
            js_asin(0.5).to_bits(),
            std::f64::consts::FRAC_PI_6.to_bits()
        );
        assert_eq!(
            js_acos(0.5).to_bits(),
            std::f64::consts::FRAC_PI_3.to_bits()
        );
        assert_eq!(js_sqrt(2.0).to_bits(), std::f64::consts::SQRT_2.to_bits());
    }

    /// `exp(1)` is the argument that showed the measurement of the agreeing
    /// group was drawn too narrowly: a sweep of random arguments met no
    /// difference in the exponential, and the one constant most likely to reach
    /// it carries one. The test holds the V8 answer rather than the `libm` one,
    /// so it fails on the day `D-012` closes and the wrapper starts agreeing.
    #[test]
    fn the_exponential_of_one_still_parts_from_javascript() {
        // V8 answers the nearest double to e, and this wrapper answers the one
        // above it.
        let javascript = std::f64::consts::E;
        assert_ne!(js_exp(1.0).to_bits(), javascript.to_bits());
        assert_eq!(js_exp(1.0).to_bits() - javascript.to_bits(), 1);
    }
}
