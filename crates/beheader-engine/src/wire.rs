//! Turns a value into JSON and back, for the fixtures the two engines share.
//!
//! Ordinary JSON cannot carry three of the numbers the engine has to be tested
//! against. A non-finite number has no JSON spelling at all, and a negative
//! zero has one that JavaScript throws away: `JSON.stringify(-0)` writes `0`,
//! so a fixture that wrote a negative zero as a plain number would arrive at
//! the other engine as a positive one and the refusal it tests would never be
//! reached.
//!
//! Each of those four numbers travels as a tagged object instead, such as
//! `{"$number": "-0"}`. The tag belongs to the fixtures alone. A document
//! never holds one, because a document never holds one of those numbers, and
//! the document decoder is a separate piece of work that refuses them.
//!
//! The codec is written out rather than derived. The value union is untagged
//! in JSON, so a decoder has to decide by shape, and the order it tries the
//! shapes in is the behaviour: an object carrying an error member is an error
//! value even though it could be read as a point with no coordinates.

use serde_json::{Map, Value as Json};

use crate::model::{ErrorCode, ErrorValue, Point, Value};

/// The member that marks a number ordinary JSON cannot hold.
const NUMBER_TAG: &str = "$number";

/// The one wording both runners give for anything that is not a point. The
/// message never quotes the JSON it refused, because the two engines print a
/// number differently and a fixture that compared the wording would then be
/// comparing their JSON writers rather than their decoders.
const POINT_SHAPE: &str = "a point is an object with an x member and a y member";

/// Why a piece of JSON is not a value the engine could hold.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WireError {
    pub message: String,
}

impl WireError {
    fn new(message: impl Into<String>) -> WireError {
        WireError {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for WireError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for WireError {}

/// Whether a piece of JSON is a tagged number rather than a value.
fn tagged_number(json: &Json) -> Option<&str> {
    let object = json.as_object()?;
    if object.len() != 1 {
        return None;
    }
    object.get(NUMBER_TAG)?.as_str()
}

/// Reads a number, tagged or plain.
pub fn decode_number(json: &Json) -> Result<f64, WireError> {
    if let Some(tag) = tagged_number(json) {
        return match tag {
            "NaN" => Ok(f64::NAN),
            "Infinity" => Ok(f64::INFINITY),
            "-Infinity" => Ok(f64::NEG_INFINITY),
            "-0" => Ok(-0.0),
            other => Err(WireError::new(format!(
                "\"{other}\" is not a tagged number"
            ))),
        };
    }
    json.as_f64().ok_or_else(|| {
        WireError::new("a number is a plain JSON number or one of the four tagged ones")
    })
}

/// Writes a number, with a tag for the four that ordinary JSON loses.
pub fn encode_number(number: f64) -> Json {
    let tag = if number.is_nan() {
        Some("NaN")
    } else if number == f64::INFINITY {
        Some("Infinity")
    } else if number == f64::NEG_INFINITY {
        Some("-Infinity")
    } else if number == 0.0 && number.is_sign_negative() {
        Some("-0")
    } else {
        None
    };
    match tag {
        Some(tag) => {
            let mut object = Map::new();
            object.insert(NUMBER_TAG.to_string(), Json::String(tag.to_string()));
            Json::Object(object)
        }
        None => serde_json::Number::from_f64(number)
            .map(Json::Number)
            .unwrap_or(Json::Null),
    }
}

fn decode_point(json: &Json) -> Result<Point, WireError> {
    let object = json
        .as_object()
        .ok_or_else(|| WireError::new(POINT_SHAPE))?;
    let x = object.get("x").ok_or_else(|| WireError::new(POINT_SHAPE))?;
    let y = object.get("y").ok_or_else(|| WireError::new(POINT_SHAPE))?;
    if object.len() != 2 {
        return Err(WireError::new(
            "a point carries an x and a y member and nothing else",
        ));
    }
    Ok(Point {
        x: decode_number(x)?,
        y: decode_number(y)?,
    })
}

fn encode_point(point: Point) -> Json {
    let mut object = Map::new();
    object.insert("x".to_string(), encode_number(point.x));
    object.insert("y".to_string(), encode_number(point.y));
    Json::Object(object)
}

fn decode_error_value(object: &Map<String, Json>) -> Result<ErrorValue, WireError> {
    let code = object
        .get("error")
        .and_then(Json::as_str)
        .ok_or_else(|| WireError::new("the error member of an error value is text"))?;
    let error = ErrorCode::parse(code)
        .ok_or_else(|| WireError::new(format!("\"{code}\" is not one of the seven error codes")))?;
    let message = object
        .get("message")
        .and_then(Json::as_str)
        .ok_or_else(|| WireError::new("an error value carries a message"))?;
    Ok(ErrorValue {
        error,
        message: message.to_string(),
    })
}

/// Reads a value, by the shape of the JSON that carries it.
pub fn decode_value(json: &Json) -> Result<Value, WireError> {
    match json {
        Json::Null => Ok(Value::Null),
        Json::Bool(boolean) => Ok(Value::Boolean(*boolean)),
        Json::Number(_) => Ok(Value::Number(decode_number(json)?)),
        Json::String(text) => Ok(Value::Text(text.clone())),
        Json::Array(items) => {
            let points = items
                .iter()
                .map(decode_point)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Value::Points(points))
        }
        Json::Object(object) => {
            if tagged_number(json).is_some() {
                return Ok(Value::Number(decode_number(json)?));
            }
            if object.contains_key("error") {
                return Ok(Value::Error(decode_error_value(object)?));
            }
            Ok(Value::Point(decode_point(json)?))
        }
    }
}

/// Writes a value back to the JSON shape it arrived in.
pub fn encode_value(value: &Value) -> Json {
    match value {
        Value::Null => Json::Null,
        Value::Boolean(boolean) => Json::Bool(*boolean),
        Value::Number(number) => encode_number(*number),
        Value::Text(text) => Json::String(text.clone()),
        Value::Point(point) => encode_point(*point),
        Value::Points(points) => {
            Json::Array(points.iter().map(|point| encode_point(*point)).collect())
        }
        Value::Error(error) => {
            let mut object = Map::new();
            object.insert(
                "error".to_string(),
                Json::String(error.error.as_str().to_string()),
            );
            object.insert("message".to_string(), Json::String(error.message.clone()));
            Json::Object(object)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_number, decode_value, encode_number, encode_value};
    use crate::model::{ErrorCode, ErrorValue, Point, Value};
    use serde_json::json;

    #[test]
    fn carries_the_four_numbers_json_cannot_hold() {
        for (tag, number) in [
            ("NaN", f64::NAN),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
        ] {
            let encoded = encode_number(number);
            assert_eq!(encoded, json!({ "$number": tag }));
            let decoded = decode_number(&encoded).expect("a tagged number reads back");
            assert_eq!(decoded.is_nan(), number.is_nan());
            if !number.is_nan() {
                assert_eq!(decoded, number);
            }
        }
        let negative_zero = encode_number(-0.0);
        assert_eq!(negative_zero, json!({ "$number": "-0" }));
        let decoded = decode_number(&negative_zero).expect("a negative zero reads back");
        assert!(decoded == 0.0 && decoded.is_sign_negative());
    }

    #[test]
    fn a_positive_zero_stays_a_plain_number() {
        assert_eq!(encode_number(0.0), json!(0.0));
        assert_eq!(decode_number(&json!(0.0)).expect("zero reads back"), 0.0);
    }

    #[test]
    fn reads_each_value_shape() {
        assert_eq!(decode_value(&json!(null)).unwrap(), Value::Null);
        assert_eq!(decode_value(&json!(true)).unwrap(), Value::Boolean(true));
        assert_eq!(decode_value(&json!(7.5)).unwrap(), Value::Number(7.5));
        assert_eq!(
            decode_value(&json!("a")).unwrap(),
            Value::Text("a".to_string())
        );
        assert_eq!(
            decode_value(&json!({ "x": 1.0, "y": 2.0 })).unwrap(),
            Value::Point(Point { x: 1.0, y: 2.0 })
        );
        assert_eq!(decode_value(&json!([])).unwrap(), Value::Points(vec![]));
        assert_eq!(
            decode_value(&json!({ "error": "#REF", "message": "gone" })).unwrap(),
            Value::Error(ErrorValue {
                error: ErrorCode::Ref,
                message: "gone".to_string()
            })
        );
    }

    #[test]
    fn an_object_with_an_error_member_reads_as_an_error_and_not_as_a_point() {
        let error = decode_value(&json!({ "error": "#DIV0", "message": "divide by zero" }))
            .expect("an error value reads back");
        assert!(matches!(error, Value::Error(_)));
    }

    #[test]
    fn refuses_a_shape_no_value_takes() {
        assert!(decode_value(&json!({ "x": 1.0 })).is_err());
        assert!(decode_value(&json!({ "x": 1.0, "y": 2.0, "z": 3.0 })).is_err());
        assert!(decode_value(&json!({ "error": "#NOPE", "message": "" })).is_err());
        assert!(decode_value(&json!({ "error": "#REF" })).is_err());
        assert!(decode_value(&json!(["not a point"])).is_err());
        assert!(decode_number(&json!({ "$number": "twelve" })).is_err());
    }

    #[test]
    fn every_value_shape_survives_a_round_trip() {
        let values = vec![
            Value::Null,
            Value::Boolean(false),
            Value::Number(-1.5),
            Value::Number(f64::NEG_INFINITY),
            Value::Text(String::new()),
            Value::Point(Point { x: -0.0, y: 3.0 }),
            Value::Points(vec![Point { x: 1.0, y: 2.0 }]),
            Value::Error(ErrorValue {
                error: ErrorCode::Math,
                message: "no root".to_string(),
            }),
        ];
        for value in values {
            let encoded = encode_value(&value);
            assert_eq!(decode_value(&encoded).expect("a value reads back"), value);
        }
    }
}
