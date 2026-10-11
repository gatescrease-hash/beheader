/**
 * Table geometry and cell styles shared by painting, picking and editing.
 * Missing presentation slots retain the dimensions of older documents.
 * This drawing adapter reads evaluated values without changing graph state.
 *
 * A number fits its cell here as well, by the rule fittedCellNumber gives. The
 * fit takes a test of whether a text fits rather than a measurer, so the canvas
 * and the vector picture, which measure text their own ways, fit a number the
 * same way when their measures agree.
 */
import { formatCellReference, getTableDimensions, type GraphObject, type Value } from "../engine/index.ts";

function positive(value: Value | undefined, fallback: number, minimum: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

export function tableLayout(object: GraphObject) {
  const { rows, cols } = getTableDimensions(object);
  const widths = Array.from({ length: cols }, (_, i) => positive(object.slots[`columns.${i + 1}.width`]?.value, 80, 24));
  const heights = Array.from({ length: rows }, (_, i) => positive(object.slots[`rowsizes.${i + 1}.height`]?.value, 24, 20));
  const offsets = (sizes: readonly number[]): number[] => sizes.reduce<number[]>((out, size) => [...out, out[out.length - 1]! + size], [0]);
  const x = offsets(widths), y = offsets(heights);
  return { widths, heights, x, y, width: x[cols]!, height: y[rows]! };
}

export function tableCellAt(object: GraphObject, x: number, y: number): string | undefined {
  const layout = tableLayout(object);
  const col = layout.x.findIndex((left, i) => x >= left && x < (layout.x[i + 1] ?? left));
  const row = layout.y.findIndex((top, i) => y >= top && y < (layout.y[i + 1] ?? top));
  return col < 0 || row < 0 ? undefined : formatCellReference({ column: col + 1, row: row + 1 });
}

export function cellStyle(object: GraphObject, cell: string) {
  const value = (key: string): Value | undefined => object.slots[`cellStyle.${cell}.${key}`]?.value ?? object.slots[`style.${key}`]?.value;
  const string = (key: string, fallback: string): string => typeof value(key) === "string" ? value(key) as string : fallback;
  return { bold: value("bold") === true, italic: value("italic") === true,
    fontSize: positive(value("fontSize"), 14, 1), font: string("font", "sans-serif"),
    color: string("color", "#1a1a1a"), fillColor: string("fillColor", "transparent"),
    align: string("align", "auto"), format: string("format", "general") };
}

export function formattedCell(value: Value | undefined, format: string): string | undefined {
  if (typeof value !== "number") return undefined;
  if (format === "decimal") return value.toFixed(2);
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  return String(value);
}

/** The most digits an exponent form keeps after the point before it gives up digits to fit. */
const EXPONENT_DIGITS = 6;

/**
 * The text of a number in a cell, fitted to the room the cell gives it, the way
 * a spreadsheet fits a number in its General format. `fits` answers whether a
 * text fits the cell in the cell's own font.
 *
 * A number that fits shows every digit. One that does not drops decimals,
 * rounding the last one kept, for as long as the text still says how large the
 * number is: a number of 1 or more keeps every digit before the point, and a
 * smaller one keeps two significant digits. Past that it turns to exponent
 * form with fewer digits, and as a last resort it fills the cell with # marks,
 * which says the column is too narrow rather than showing a wrong number. A
 * fixed format, two decimals or a percentage, goes straight from its own text
 * to the marks, because dropping its digits would change the format the
 * operator chose. So a cell never shows the tail of a number clipped from the
 * left, which reads as a different number.
 */
export function fittedCellNumber(value: number, format: string, fits: (text: string) => boolean): string {
  const exact = formattedCell(value, format) ?? String(value);
  if (fits(exact)) return exact;
  if (format === "general" && Number.isFinite(value)) {
    const point = exact.indexOf(".");
    const decimals = exact.includes("e") || point < 0 ? 0 : exact.length - point - 1;
    for (let kept = decimals - 1; kept >= 0; kept -= 1) {
      const text = String(Number(value.toFixed(kept)));
      if (keepsMagnitude(value, text) && fits(text)) return text;
    }
    for (let digits = EXPONENT_DIGITS; digits >= 0; digits -= 1) {
      const text = Number(value.toExponential(digits)).toExponential();
      if (fits(text)) return text;
    }
  }
  let marks = "#";
  while (fits(`${marks}#`)) marks += "#";
  return marks;
}

/**
 * True when a shortened text still says how large the number is: every digit
 * before the point for a number of 1 or more, and two significant digits for a
 * smaller one, so 0.000123 never shows as 0.
 */
function keepsMagnitude(value: number, text: string): boolean {
  if (Math.abs(value) >= 1) return !text.includes("e");
  const significant = text.replace(/^-?0\.0*/, "").replace(/[^0-9]/g, "");
  return significant.length >= 2;
}
