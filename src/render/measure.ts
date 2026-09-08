/**
 * measure.ts
 *
 * Layer: render. It reads engine state and calls mutations. It does nothing
 * else across that line. The engine must never import this file.
 *
 * The real Canvas2D TextMeasurer, and layOutText, which breaks lines.
 *
 * There are two measurers here and they are not interchangeable. The engine
 * one honours markup. The overlay one does not. The wrong one gives a size
 * defect that nothing reports.
 *
 * This file and renderer.ts must change together. One layout function with two
 * readers is what keeps the drawn text and the measured height in agreement.
 */
import type { TextMeasurement, TextMeasurer, TextStyle } from "../engine/eval-context.ts";
import { LIST_BULLET, parseMarkdownLite, verbatimLines, type MarkdownLine, type MarkdownRun } from "./markdown.ts";

export interface MeasurementContext {
  font: string;
  measureText(text: string): { readonly width: number };
}

export interface FontEmphasis {
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface LaidOutRun {
  readonly text: string;
  readonly font: string;
  readonly x: number;
  readonly width: number;
}

export interface LaidOutLine {
  readonly runs: readonly LaidOutRun[];
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TextLayout {
  readonly lines: readonly LaidOutLine[];
  readonly width: number;
  readonly height: number;
}

export interface TextLayoutRequest {
  readonly text: string;
  readonly style: TextStyle;
  readonly wrapWidth: number | undefined;
  readonly markup: boolean;
  readonly measureRun: (text: string, font: string) => number;
}

const HEADING_FONT_SCALES: readonly number[] = [2, 1.5, 1.17];

const CODE_FONT_FAMILY = "monospace";

interface Piece {
  readonly text: string;
  readonly font: string;
}

function finitePositive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function cssFont(fontSize: number, family: string, emphasis?: FontEmphasis): string {
  const italic = emphasis?.italic === true ? "italic " : "";
  const bold = emphasis?.bold === true ? "bold " : "";
  return `${italic}${bold}${fontSize}px ${family.trim() === "" ? "sans-serif" : family}`;
}

function withoutHangingSpaces(pieces: readonly Piece[]): Piece[] {
  const trimmed = pieces.slice();
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last === undefined) {
      break;
    }
    const text = last.text.replace(/ +$/, "");
    if (text === last.text) {
      break;
    }
    if (text === "") {
      trimmed.pop();
      continue;
    }
    trimmed[trimmed.length - 1] = { text, font: last.font };
    break;
  }
  return trimmed;
}

function wrapChunks(runText: string): readonly string[] {
  return runText.match(/[^ ]+ *| +/g) ?? [];
}

function runFont(run: MarkdownRun, line: MarkdownLine, family: string, fontSize: number): string {
  return cssFont(fontSize, run.code ? CODE_FONT_FAMILY : family, {
    bold: run.bold || line.kind === "heading",
    italic: run.italic,
  });
}

function headingScale(line: MarkdownLine): number {
  if (line.kind !== "heading") {
    return 1;
  }
  return HEADING_FONT_SCALES[line.level - 1] ?? 1;
}

function hangingIndent(
  line: MarkdownLine,
  family: string,
  fontSize: number,
  wrapWidth: number | undefined,
  measureRun: (text: string, font: string) => number,
): number {
  const bullet = line.runs[0];
  if (line.kind !== "list" || bullet === undefined || bullet.text !== LIST_BULLET) {
    return 0;
  }
  const indent = finiteOrZero(measureRun(bullet.text, runFont(bullet, line, family, fontSize)));
  return wrapWidth !== undefined && indent < wrapWidth ? indent : 0;
}

function chunksOf(line: MarkdownLine, family: string, fontSize: number): Piece[][] {
  const chunks: Piece[][] = [];
  for (const run of line.runs) {
    const font = runFont(run, line, family, fontSize);
    for (const chunkText of wrapChunks(run.text)) {
      const previous = chunks[chunks.length - 1];
      const lastPiece = previous?.[previous.length - 1];
      if (previous !== undefined && lastPiece !== undefined && !lastPiece.text.endsWith(" ") && !chunkText.startsWith(" ")) {
        previous.push({ text: chunkText, font });
        continue;
      }
      chunks.push([{ text: chunkText, font }]);
    }
  }
  return chunks;
}

function mergeRuns(pieces: readonly Piece[], measureRun: (text: string, font: string) => number): { readonly runs: LaidOutRun[]; readonly width: number } {
  const runs: LaidOutRun[] = [];
  let x = 0;
  let index = 0;
  while (index < pieces.length) {
    const font = pieces[index]?.font ?? "";
    let text = "";
    while (index < pieces.length) {
      const piece = pieces[index];
      if (piece === undefined || piece.font !== font) {
        break;
      }
      text += piece.text;
      index += 1;
    }
    const width = finiteOrZero(measureRun(text, font));
    runs.push({ text, font, x, width });
    x += width;
  }
  return { runs, width: x };
}

function appendCharacter(pieces: readonly Piece[], font: string, character: string): Piece[] {
  const last = pieces[pieces.length - 1];
  if (last === undefined || last.font !== font) {
    return pieces.concat([{ text: character, font }]);
  }
  const extended = pieces.slice(0, -1);
  extended.push({ text: last.text + character, font });
  return extended;
}

function wrapLine(chunks: readonly Piece[][], wrapWidth: number, hangingIndent: number, measureRun: (text: string, font: string) => number): Piece[][] {
  const width = (pieces: readonly Piece[]): number => mergeRuns(withoutHangingSpaces(pieces), measureRun).width;
  const lines: Piece[][] = [];
  const limit = (): number => (lines.length === 0 ? wrapWidth : wrapWidth - hangingIndent);
  let current: Piece[] = [];
  for (const chunk of chunks) {
    if (current.length > 0) {
      const candidate = current.concat(chunk);
      if (width(candidate) <= limit()) {
        current = candidate;
        continue;
      }
      lines.push(withoutHangingSpaces(current));
      current = [];
    }
    if (width(chunk) <= limit()) {
      current = chunk.slice();
      continue;
    }
    for (const piece of chunk) {
      for (const character of piece.text) {
        const candidate = appendCharacter(current, piece.font, character);
        if (current.length > 0 && width(candidate) > limit()) {
          lines.push(withoutHangingSpaces(current));
          current = [{ text: character, font: piece.font }];
        } else {
          current = candidate;
        }
      }
    }
  }
  lines.push(withoutHangingSpaces(current));
  return lines;
}

/** Breaks text into lines. One function, two readers: this layer and the engine. */
export function layOutText(request: TextLayoutRequest): TextLayout {
  const fontSize = finitePositive(request.style.fontSize);
  if (fontSize === undefined) {
    return { lines: [], width: 0, height: 0 };
  }
  const lineHeight = finitePositive(request.style.lineHeight) ?? fontSize;
  const wrapWidth = request.wrapWidth === undefined ? undefined : finitePositive(request.wrapWidth);
  const sourceLines = request.markup ? parseMarkdownLite(request.text) : verbatimLines(request.text);

  const lines: LaidOutLine[] = [];
  let top = 0;
  let widest = 0;
  for (const sourceLine of sourceLines) {
    const scale = headingScale(sourceLine);
    const height = lineHeight * scale;
    const chunks = chunksOf(sourceLine, request.style.font, fontSize * scale);
    const indent = hangingIndent(sourceLine, request.style.font, fontSize * scale, wrapWidth, request.measureRun);
    const wrapped = wrapWidth === undefined ? [chunks.flat()] : wrapLine(chunks, wrapWidth, indent, request.measureRun);
    let continuation = false;
    for (const linePieces of wrapped) {
      const merged = mergeRuns(linePieces, request.measureRun);
      const offset = continuation ? indent : 0;
      const runs = offset === 0 ? merged.runs : merged.runs.map((run) => ({ ...run, x: run.x + offset }));
      const width = merged.width + offset;
      lines.push({ runs, top, width, height });
      if (width > widest) {
        widest = width;
      }
      top += height;
      continuation = true;
    }
  }
  return { lines, width: widest, height: top };
}

function createMeasurer(ctx: MeasurementContext, markup: boolean): TextMeasurer {
  const measureRun = (text: string, font: string): number => {
    ctx.font = font;
    return finiteOrZero(ctx.measureText(text).width);
  };
  return {
    measure(text: string, style: TextStyle, maxWidth?: number): TextMeasurement {
      if (finitePositive(style.fontSize) === undefined || text === "") {
        return { width: 0, height: 0 };
      }
      const layout = layOutText({ text, style, wrapWidth: maxWidth, markup, measureRun });
      return { width: finiteOrZero(layout.width), height: finiteOrZero(layout.height) };
    },
  };
}

/** The measurer for the engine. It honours markup, so bold text measures wider. */
export function createCanvas2dTextMeasurer(ctx: MeasurementContext): TextMeasurer {
  return createMeasurer(ctx, true);
}

/**
 * The measurer for the in place editor. It measures the raw source and ignores markup.
 * The two measurers are not interchangeable. The wrong one gives a silent size defect.
 */
export function createSourceTextMeasurer(ctx: MeasurementContext): TextMeasurer {
  return createMeasurer(ctx, false);
}
