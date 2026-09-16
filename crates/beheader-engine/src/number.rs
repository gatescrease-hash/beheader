//! Turns an `f64` into the text JavaScript would print for it.
//!
//! The graph stores binary64 numbers in both engines, so two equal numbers
//! always compare equal. Their text does not follow from that. Rust prints
//! `1e21` as a row of twenty two digits and JavaScript prints it as `1e+21`,
//! and that text reaches an operator through a formatted formula, the resolved
//! content of a text object and the wording of a diagnostic. A port that used
//! the Rust `Display` output would change all three.
//!
//! The rules here are the ones ECMAScript gives for `Number::toString` with
//! radix ten. The shortest run of digits that reads back as the same number
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
