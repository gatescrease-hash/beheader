/**
 * Table geometry and cell styles shared by painting, picking and editing.
 * Missing presentation slots retain the dimensions of older documents.
 * This drawing adapter reads evaluated values without changing graph state.
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
