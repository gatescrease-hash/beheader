/**
 * text.ts
 *
 * The text primitive: the parser that turns content into a block tree, the
 * dependency walker over that tree, and the three compute functions behind
 * resolvedContent, measuredHeight and measuredWidth.
 *
 * Text is literal until a block opens. {= expression } inserts a value, and {?
 * condition } ... {:} ... {?} is a conditional. Blocks nest.
 *
 * The dependency walker was the first dynamic resolver in the codebase. It
 * re-parses content on every edge derivation rather than caching, because
 * editing a single character can change which slots the text reads. Like
 * formula/deps.ts it reports both arms of a conditional, so flipping the
 * condition does not leave the object subscribed to the wrong one.
 *
 * A text box never crops its contents. When a word is too long for the width,
 * the measurer breaks the word. There is no overflow slot and no plan for one:
 * a person settled that question against eight earlier rulings, and correcting
 * the code back toward any of them would undo the decision rather than fix a
 * bug.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */

import type { Address, AddressableObject } from "../address.ts";
import { hasRealMeasurer, type EvalContext, type TextStyle } from "../eval-context.ts";
import type { FormulaAst } from "../formula/ast.ts";
import { extractDependencies, rewriteAddressesInAst, type Dependency } from "../formula/deps.ts";
import { formatFormula } from "../formula/format.ts";
import { evaluate as evaluateFormulaAst, type ReadRange, type ReadSlot } from "../formula/eval.ts";
import { isParseError, parseFormula } from "../formula/parser.ts";
import { getSlot, hasIllegalNumber, isErrorValue, resolveSlot, type ErrorValue, type GraphObject, type Value } from "../graph/node.ts";
import type { DerivedSlotComputeDeps } from "./schema.ts";
import { enumerateRangeCellAddresses, isInExtentTableCellAddress, isRangeEnumerationError } from "./table.ts";

export interface TextBlock {
  readonly type: "text";
  readonly value: string;
}

export interface FormulaBlock {
  readonly type: "formula";
  readonly ast: FormulaAst;
}

export interface ConditionalBlock {
  readonly type: "conditional";
  readonly condition: FormulaAst;
  readonly trueBranch: readonly Block[];
  readonly falseBranch: readonly Block[];
}

/**
 * A run of mathematical notation inside text. The block holds the LaTeX and
 * the marker it was written with, and it evaluates to nothing: notation is
 * drawn rather than computed, so the run reaches the layout as the text it was
 * typed as and the two readers of that layout draw it.
 *
 * display is true for a run that takes a line of its own, and false for one
 * that sits inside a line of prose.
 */
export interface MathRunBlock {
  readonly type: "math";
  readonly latex: string;
  readonly display: boolean;
  /** The marker as it was written, which is what the resolved content carries. */
  readonly source: string;
}

export interface BlockParseErrorBlock {
  readonly type: "error";
  readonly message: string;

  readonly source: string;
  readonly start: number;

  readonly orphaned: readonly Block[];
}

export type Block = TextBlock | FormulaBlock | ConditionalBlock | MathRunBlock | BlockParseErrorBlock;

export const MAX_BLOCK_TREE_DEPTH = 64;

interface TextParseState {
  readonly content: string;
  readonly objects: readonly AddressableObject[];
  pos: number;
  depth: number;
}

type SequenceTerminator = "else" | "close" | "eof";

function findUnquotedBrace(content: string, from: number): number | undefined {
  let i = from;
  let inString = false;
  while (i < content.length) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\" && content[i + 1] === '"') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === "}") {
      return i;
    }
    i += 1;
  }
  return undefined;
}

/** The two markers that open notation: one for a line of its own, one inline. */
export const MATH_DISPLAY_OPEN = "{$$";
export const MATH_INLINE_OPEN = "{$";

export interface MathMarker {
  readonly latex: string;
  readonly display: boolean;
  /** The index just past the closing brace. */
  readonly end: number;
}

/**
 * Reads a run of notation that starts at pos, or reports none.
 *
 * The braces are counted rather than scanned for the first closing one,
 * because notation is full of them: the b of a fraction sits inside a pair of
 * its own, and stopping at the first would cut the run in half.
 *
 * This is the one reader of the syntax. The block tree calls it to keep
 * notation out of the reach of a formula marker, and the markdown parser calls
 * it again on the resolved text, and two scanners of one syntax would drift.
 */
export function matchMathMarkerAt(content: string, pos: number): MathMarker | undefined {
  const display = content.startsWith(MATH_DISPLAY_OPEN, pos);
  const inline = !display && content.startsWith(MATH_INLINE_OPEN, pos);
  if (!display && !inline) {
    return undefined;
  }

  const from = pos + (display ? MATH_DISPLAY_OPEN.length : MATH_INLINE_OPEN.length);
  let depth = 1;
  let at = from;
  while (at < content.length) {
    const character = content[at];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { latex: content.slice(from, at).trim(), display, end: at + 1 };
      }
    }
    at += 1;
  }
  return undefined;
}

type Marker =
  | { readonly kind: "formulaOpen"; readonly source: string; readonly end: number }
  | { readonly kind: "conditionalOpen"; readonly source: string; readonly end: number }
  | { readonly kind: "conditionalElse"; readonly end: number }
  | { readonly kind: "conditionalClose"; readonly end: number }
  | { readonly kind: "math"; readonly math: MathMarker; readonly end: number };

function matchMarkerAt(content: string, pos: number): Marker | undefined {
  const second = content[pos + 1];
  if (second === "$") {
    const math = matchMathMarkerAt(content, pos);
    return math === undefined ? undefined : { kind: "math", math, end: math.end };
  }
  if (second === "=") {
    const close = findUnquotedBrace(content, pos + 2);
    if (close === undefined) {
      return undefined;
    }
    return { kind: "formulaOpen", source: content.slice(pos + 2, close), end: close + 1 };
  }
  if (second === "?") {
    if (content[pos + 2] === "}") {
      return { kind: "conditionalClose", end: pos + 3 };
    }
    const close = findUnquotedBrace(content, pos + 2);
    if (close === undefined) {
      return undefined;
    }
    return { kind: "conditionalOpen", source: content.slice(pos + 2, close), end: close + 1 };
  }
  if (second === ":" && content[pos + 2] === "}") {
    return { kind: "conditionalElse", end: pos + 3 };
  }
  return undefined;
}

/** Rewrites addresses in formula markers while preserving prose and notation. */
export function rewriteTextReferences(content: string, before: readonly GraphObject[], after: readonly GraphObject[], rewrite: (address: Address) => Address): string {
  let output = "";
  let copied = 0;
  for (let pos = 0; pos < content.length; pos += 1) {
    if (content[pos] !== "{") continue;
    const marker = matchMarkerAt(content, pos);
    if (marker === undefined) continue;
    if (marker.kind === "formulaOpen" || marker.kind === "conditionalOpen") {
      const ast = parseFormula(marker.source, before);
      if (!isParseError(ast)) {
        const rewritten = rewriteAddressesInAst(ast, rewrite);
        if (JSON.stringify(ast) !== JSON.stringify(rewritten)) {
          output += content.slice(copied, pos + 2) + " " + formatFormula(rewritten, after) + " }";
          copied = marker.end;
        }
      }
    }
    pos = marker.end - 1;
  }
  return output + content.slice(copied);
}

function parseBlockSequence(state: TextParseState): { readonly blocks: readonly Block[]; readonly terminator: SequenceTerminator } {
  const blocks: Block[] = [];
  let textStart = state.pos;

  const flushText = (end: number): void => {
    if (end > textStart) {
      blocks.push({ type: "text", value: state.content.slice(textStart, end) });
    }
  };

  while (state.pos < state.content.length) {
    if (state.content[state.pos] !== "{") {
      state.pos += 1;
      continue;
    }
    const marker = matchMarkerAt(state.content, state.pos);
    if (marker === undefined) {
      state.pos += 1;
      continue;
    }
    flushText(state.pos);
    switch (marker.kind) {
      case "conditionalElse":
        state.pos = marker.end;
        return { blocks, terminator: "else" };
      case "conditionalClose":
        state.pos = marker.end;
        return { blocks, terminator: "close" };
      case "math": {
        blocks.push({
          type: "math",
          latex: marker.math.latex,
          display: marker.math.display,
          source: state.content.slice(state.pos, marker.end),
        });
        state.pos = marker.end;
        textStart = state.pos;
        continue;
      }
      case "formulaOpen": {
        const spanStart = state.pos;
        state.pos = marker.end;
        const parsed = parseFormula(marker.source, state.objects);
        blocks.push(
          isParseError(parsed)
            ? {
                type: "error",
                message: parsed.message,
                source: state.content.slice(spanStart, marker.end),
                start: spanStart,
                orphaned: [],
              }
            : { type: "formula", ast: parsed },
        );
        textStart = state.pos;
        break;
      }
      case "conditionalOpen": {
        const spanStart = state.pos;
        state.pos = marker.end;
        for (const block of parseConditional(state, marker.source, spanStart)) {
          blocks.push(block);
        }
        textStart = state.pos;
        break;
      }
    }
  }
  flushText(state.pos);
  return { blocks, terminator: "eof" };
}

function parseConditional(state: TextParseState, conditionSource: string, spanStart: number): readonly Block[] {
  if (state.depth >= MAX_BLOCK_TREE_DEPTH) {
    return [
      {
        type: "error",
        message: `text conditional nests too deeply (limit ${MAX_BLOCK_TREE_DEPTH})`,
        source: state.content.slice(spanStart, state.pos),
        start: spanStart,
        orphaned: [],
      },
    ];
  }
  state.depth += 1;
  const trueResult = parseBlockSequence(state);
  let falseBranch: readonly Block[] = [];
  let unclosed = trueResult.terminator === "eof";
  if (trueResult.terminator === "else") {
    const falseResult = parseBlockSequence(state);
    falseBranch = falseResult.blocks;
    unclosed = falseResult.terminator === "eof";
  }
  state.depth -= 1;
  const span = state.content.slice(spanStart, state.pos);
  return finishConditional(conditionSource, span, spanStart, state.objects, trueResult.blocks, falseBranch, unclosed);
}

function finishConditional(
  conditionSource: string,
  span: string,
  spanStart: number,
  objects: readonly AddressableObject[],
  trueBranch: readonly Block[],
  falseBranch: readonly Block[],
  unclosed: boolean,
): readonly Block[] {
  const orphaned = [...trueBranch, ...falseBranch];
  const condition = parseFormula(conditionSource, objects);
  if (isParseError(condition)) {
    return [{ type: "error", message: condition.message, source: span, start: spanStart, orphaned }];
  }
  if (unclosed) {
    return [
      {
        type: "error",
        message: "unclosed {? ... } conditional (no matching {?})",
        source: span,
        start: spanStart,
        orphaned,
      },
    ];
  }
  return [{ type: "conditional", condition, trueBranch, falseBranch }];
}

/** Parses content into the block tree. It never throws. A bad block becomes an error block. */
export function parseTextContent(content: string, objects: readonly AddressableObject[]): readonly Block[] {
  const blocks: Block[] = [];
  const state: TextParseState = { content, objects, pos: 0, depth: 0 };
  while (true) {
    const { blocks: sequenceBlocks, terminator } = parseBlockSequence(state);
    for (const block of sequenceBlocks) {
      blocks.push(block);
    }
    if (terminator === "eof") {
      return blocks;
    }
    blocks.push({ type: "text", value: terminator === "else" ? "{:}" : "{?}" });
  }
}

/** Every address the block tree names, from both branches of every conditional. */
export function extractTextDependencies(blocks: readonly Block[]): readonly Dependency[] {
  const dependencies: Dependency[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
      case "math":
        break;
      case "error":
        for (const dependency of extractTextDependencies(block.orphaned)) {
          dependencies.push(dependency);
        }
        break;
      case "formula":
        for (const dependency of extractDependencies(block.ast)) {
          dependencies.push(dependency);
        }
        break;
      case "conditional":
        for (const dependency of extractDependencies(block.condition)) {
          dependencies.push(dependency);
        }
        for (const dependency of extractTextDependencies(block.trueBranch)) {
          dependencies.push(dependency);
        }
        for (const dependency of extractTextDependencies(block.falseBranch)) {
          dependencies.push(dependency);
        }

        break;
      default: {
        const exhaustive: never = block;
        void exhaustive;
        break;
      }
    }
  }
  return dependencies;
}

const BROKEN_SPAN_MARK = "!";

function renderRuntimeError(value: ErrorValue): string {
  return `${BROKEN_SPAN_MARK}${value.error}`;
}

function formatValueForEmbedding(value: Value): string | ErrorValue {
  if (isErrorValue(value)) {
    return value;
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return {
    error: "#TYPE",
    message: `cannot embed ${Array.isArray(value) ? "a point array" : "a point"} in text; read a scalar component instead`,
  };
}

function describeConditionType(value: Value): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a point array";
  }
  if (typeof value === "object") {
    return "a point";
  }
  return typeof value;
}

function evaluateBlocks(blocks: readonly Block[], read: ReadSlot, readRange: ReadRange | undefined): string {
  let result = "";
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        result += block.value;
        break;
      case "math":
        result += block.source;
        break;
      case "error":
        result += `${BROKEN_SPAN_MARK}${block.source}`;
        break;
      case "formula": {
        const value = evaluateFormulaAst(block.ast, read, readRange);
        if (isErrorValue(value)) {
          result += renderRuntimeError(value);
          break;
        }
        const embedded = formatValueForEmbedding(value);
        result += isErrorValue(embedded) ? renderRuntimeError(embedded) : embedded;
        break;
      }
      case "conditional": {
        const condition = evaluateFormulaAst(block.condition, read, readRange);
        if (isErrorValue(condition)) {
          result += renderRuntimeError(condition);
          break;
        }
        if (typeof condition !== "boolean") {
          result += renderRuntimeError({
            error: "#TYPE",
            message: `text conditional's condition must evaluate to a boolean, got ${describeConditionType(condition)}`,
          });
          break;
        }
        result += evaluateBlocks(condition ? block.trueBranch : block.falseBranch, read, readRange);
        break;
      }
      default: {
        const exhaustive: never = block;
        void exhaustive;
        break;
      }
    }
  }
  return result;
}

/** Evaluates the tree to a string. A conditional takes one branch only. */
export function evaluateBlockTree(blocks: readonly Block[], read: ReadSlot, readRange?: ReadRange): string {
  return evaluateBlocks(blocks, read, readRange);
}

export const TEXT_CONTENT_PATH: readonly string[] = ["content"];
export const TEXT_WIDTH_PATH: readonly string[] = ["width"];
export const TEXT_HEIGHT_PATH: readonly string[] = ["height"];

export const TEXT_AUTORESIZE_PATH: readonly string[] = ["autoresize"];
export const TEXT_STYLE_FONT_PATH: readonly string[] = ["style", "font"];
export const TEXT_STYLE_FONT_SIZE_PATH: readonly string[] = ["style", "fontSize"];
export const TEXT_STYLE_LINE_HEIGHT_PATH: readonly string[] = ["style", "lineHeight"];
export const TEXT_STYLE_COLOR_PATH: readonly string[] = ["style", "color"];
export const TEXT_STYLE_ALIGN_PATH: readonly string[] = ["style", "align"];

export const TEXT_RESOLVED_CONTENT_PATH: readonly string[] = ["resolvedContent"];
export const TEXT_MEASURED_HEIGHT_PATH: readonly string[] = ["measuredHeight"];
export const TEXT_MEASURED_WIDTH_PATH: readonly string[] = ["measuredWidth"];

export function resolveTextDependencyAddresses(
  object: GraphObject,
  objects: readonly GraphObject[],
): readonly Address[] {
  const addresses: Address[] = [{ objectId: object.id, path: TEXT_CONTENT_PATH }];
  const contentSlot = getSlot(object, TEXT_CONTENT_PATH);
  if (contentSlot === undefined || contentSlot.kind !== "literal" || typeof contentSlot.value !== "string") {
    return addresses;
  }
  const blocks = parseTextContent(contentSlot.value, objects);
  for (const dependency of extractTextDependencies(blocks)) {
    if (dependency.kind === "reference") {
      if (resolveSlot(dependency.address, objects) === undefined && isInExtentTableCellAddress(dependency.address, objects)) {
        continue;
      }
      addresses.push(dependency.address);
      continue;
    }
    const tableObject = objects.find((candidate) => candidate.id === dependency.start.objectId);
    if (tableObject === undefined) {
      addresses.push(dependency.start);
      continue;
    }
    const cellAddresses = enumerateRangeCellAddresses(dependency.start, dependency.end, tableObject);
    if (isRangeEnumerationError(cellAddresses)) {
      addresses.push(dependency.start);
      continue;
    }
    for (const cellAddress of cellAddresses) {
      if (getSlot(tableObject, cellAddress.path) === undefined) {
        continue;
      }
      addresses.push(cellAddress);
    }
  }
  return addresses;
}

export function computeResolvedContent(
  object: GraphObject,
  read: ReadSlot,
  _context: EvalContext | undefined,
  deps: DerivedSlotComputeDeps | undefined,
): Value {
  const rawContent = read({ objectId: object.id, path: TEXT_CONTENT_PATH });
  if (rawContent !== undefined && isErrorValue(rawContent)) {
    return rawContent;
  }
  const content = typeof rawContent === "string" ? rawContent : "";
  const blocks = parseTextContent(content, deps?.objects ?? []);
  return evaluateBlockTree(blocks, read, deps?.readRange);
}

type TextBoxMeasurement =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: ErrorValue };

function measureTextBox(
  object: GraphObject,
  read: ReadSlot,
  context: EvalContext | undefined,
  slotLabel: string,
): TextBoxMeasurement {
  const resolved = read({ objectId: object.id, path: TEXT_RESOLVED_CONTENT_PATH });
  const width = read({ objectId: object.id, path: TEXT_WIDTH_PATH });
  const font = read({ objectId: object.id, path: TEXT_STYLE_FONT_PATH });
  const fontSize = read({ objectId: object.id, path: TEXT_STYLE_FONT_SIZE_PATH });
  const lineHeight = read({ objectId: object.id, path: TEXT_STYLE_LINE_HEIGHT_PATH });

  for (const upstream of [resolved, width, font, fontSize, lineHeight]) {
    if (upstream !== undefined && isErrorValue(upstream)) {
      return { ok: false, error: upstream };
    }
  }

  if (!hasRealMeasurer(context)) {
    return {
      ok: false,
      error: {
        error: "#MEASURE",
        message: `${slotLabel}: ${object.name} has no real text measurer wired (only the null EvalContext) — cannot measure`,
      },
    };
  }

  if (typeof font !== "string" || typeof fontSize !== "number" || typeof lineHeight !== "number") {
    return {
      ok: false,
      error: {
        error: "#TYPE",
        message: `${slotLabel}: ${object.name} needs style.font (string) and style.fontSize / style.lineHeight (numbers)`,
      },
    };
  }
  const style: TextStyle = { font, fontSize, lineHeight };

  const text = typeof resolved === "string" ? resolved : "";
  const maxWidth = typeof width === "number" ? width : undefined;

  const measured = context.measurer.measure(text, style, maxWidth);
  if (hasIllegalNumber(measured.width) || hasIllegalNumber(measured.height)) {
    return {
      ok: false,
      error: {
        error: "#TYPE",
        message:
          `${slotLabel}: ${object.name}'s text measurer returned a non-finite box ` +
          `(width ${measured.width}, height ${measured.height})`,
      },
    };
  }
  return { ok: true, width: measured.width, height: measured.height };
}

/** Height of the laid out text. It needs the measurer from the evaluation context. */
export function computeMeasuredHeight(
  object: GraphObject,
  read: ReadSlot,
  context: EvalContext | undefined,
  _deps: DerivedSlotComputeDeps | undefined,
): Value {
  const measurement = measureTextBox(object, read, context, "measuredHeight");
  return measurement.ok ? measurement.height : measurement.error;
}

/** Width of the laid out text. It needs the measurer from the evaluation context. */
export function computeMeasuredWidth(
  object: GraphObject,
  read: ReadSlot,
  context: EvalContext | undefined,
  _deps: DerivedSlotComputeDeps | undefined,
): Value {
  const measurement = measureTextBox(object, read, context, "measuredWidth");
  return measurement.ok ? measurement.width : measurement.error;
}
