import { expect, it } from "vitest";
import { cellStyle, fittedCellNumber, formattedCell, tableCellAt, tableLayout } from "./table-layout.ts";
import { type GraphObject } from "../engine/index.ts";
import { objectExtent } from "./extent.ts";
import { editorPlacement, editorTargetAt } from "./editor.ts";

const table: GraphObject = { id: "table", name: "table_1", type: "table", slots: Object.fromEntries(Object.entries({ rows: 2, cols: 2, "columns.1.width": 140, "rowsizes.1.height": 40, "cellStyle.B2.bold": true, "cellStyle.B2.format": "percent", "style.color": "#123456" }).map(([key, value]) => [key, { kind: "literal", value }])) };

it("uses resized dimensions for bounds, cell picking and the editor at zoom", () => {
  expect(tableLayout(table)).toMatchObject({ x: [0, 140, 220], y: [0, 40, 64], width: 220, height: 64 });
  expect(tableCellAt(table, 150, 42)).toBe("B2");
  expect(tableCellAt(table, -1, 42)).toBeUndefined();
  expect(objectExtent(table)).toEqual({ minX: 0, minY: 0, maxX: 220, maxY: 64 });
  const target = editorTargetAt({ x: 300, y: 84 }, [table], { x: 0, y: 0, zoom: 2 });
  expect(target).toEqual({ kind: "cell", objectId: "table", cell: "B2" });
  expect(editorPlacement(target!, table, { x: 0, y: 0, zoom: 2 }, 1)).toEqual({ left: 280, top: 80, width: 80, height: 24, scale: 2 });
});

it("uses per-cell formatting over object styles and formats computed numbers", () => {
  expect(cellStyle(table, "B2")).toMatchObject({ bold: true, color: "#123456", format: "percent" });
  expect(cellStyle(table, "A1").bold).toBe(false);
  expect(formattedCell(0.125, "percent")).toBe("12.5%");
  expect(formattedCell(2, "decimal")).toBe("2.00");
});

/** A cell that fits a text of so many characters, standing in for a measure of the text in the cell's font. */
const room = (characters: number) => (text: string): boolean => text.length <= characters;

it("fits a number to its cell the way a spreadsheet's General format does, rather than clipping its tail", () => {
  expect(fittedCellNumber(5026.548245743669, "general", room(20))).toBe("5026.548245743669");
  expect(fittedCellNumber(5026.548245743669, "general", room(8))).toBe("5026.548");
  expect(fittedCellNumber(5026.548245743669, "general", room(4))).toBe("5027");
  expect(fittedCellNumber(-12.3456, "general", room(4))).toBe("-12");
  expect(fittedCellNumber(123456789012, "general", room(8))).toBe("1.23e+11");
});

it("keeps two significant digits of a small number before it turns to exponent form, so it never shows as 0", () => {
  expect(fittedCellNumber(0.000123456, "general", room(7))).toBe("0.00012");
  expect(fittedCellNumber(0.000123456, "general", room(5))).toBe("1e-4");
});

it("fills a cell with marks when no form of the number fits, and a fixed format that does not fit goes straight to them", () => {
  expect(fittedCellNumber(5026.548245743669, "general", room(3))).toBe("###");
  expect(fittedCellNumber(2.5, "decimal", room(4))).toBe("2.50");
  expect(fittedCellNumber(2.5, "decimal", room(3))).toBe("###");
  expect(fittedCellNumber(0.125, "percent", room(4))).toBe("####");
});
