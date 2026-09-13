/**
 * markdown.ts
 *
 * The markdown lite parser covers bold, italic, code, a heading at levels one
 * to three, a list item and a paragraph break. It covers nothing else.
 *
 * Everything depends on the rule for which asterisk opens a span and which
 * one closes it. A simpler version brings back a bug that thirty green tests
 * missed.
 *
 * Render-layer code: it reads engine state and calls mutations, and crosses
 * that line for nothing else. Nothing in the engine imports this file, so a
 * GPU renderer can replace the whole layer later.
 */
export interface MarkdownRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: boolean;
}

export type MarkdownLineKind = "paragraph" | "heading" | "list";

export interface MarkdownLine {
  readonly kind: MarkdownLineKind;
  readonly level: number;
  readonly runs: readonly MarkdownRun[];
}

export const LIST_BULLET = "• ";

const HEADING_PREFIXES: readonly { readonly prefix: string; readonly level: number }[] = [
  { prefix: "### ", level: 3 },
  { prefix: "## ", level: 2 },
  { prefix: "# ", level: 1 },
];

const LIST_PREFIX = "- ";
const CODE_MARKER = "`";
const BOLD_MARKER = "**";
const ITALIC_MARKER = "*";

interface InlineStyle {
  readonly bold: boolean;
  readonly italic: boolean;
}

const PLAIN_STYLE: InlineStyle = { bold: false, italic: false };

export function parseMarkdownLite(text: string): readonly MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  for (const hardLine of text.split(/\r?\n/)) {
    lines.push(parseLine(hardLine));
  }
  return lines;
}

export function verbatimLines(text: string): readonly MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  for (const hardLine of text.split(/\r?\n/)) {
    lines.push({
      kind: "paragraph",
      level: 0,
      runs: hardLine === "" ? [] : [{ text: hardLine, bold: false, italic: false, code: false }],
    });
  }
  return lines;
}

function parseLine(hardLine: string): MarkdownLine {
  for (const heading of HEADING_PREFIXES) {
    if (hardLine.startsWith(heading.prefix)) {
      return { kind: "heading", level: heading.level, runs: parseInlineRuns(hardLine.slice(heading.prefix.length)) };
    }
  }
  if (hardLine.startsWith(LIST_PREFIX)) {
    const runs = parseInlineRuns(hardLine.slice(LIST_PREFIX.length));
    return { kind: "list", level: 0, runs: [{ text: LIST_BULLET, bold: false, italic: false, code: false }, ...runs] };
  }
  return { kind: "paragraph", level: 0, runs: parseInlineRuns(hardLine) };
}

function closesEmphasis(line: string, index: number): boolean {
  return index > 0 && line.charAt(index - 1) !== " ";
}

function closerIndex(line: string, marker: string, from: number): number {
  let at = line.indexOf(marker, from);
  while (at !== -1) {
    if (closesEmphasis(line, at)) {
      return at;
    }
    at = line.indexOf(marker, at + 1);
  }
  return -1;
}

function opensEmphasis(line: string, index: number, marker: string): boolean {
  const after = index + marker.length;
  if (after >= line.length || line.charAt(after) === " ") {
    return false;
  }
  return closerIndex(line, marker, after + 1) !== -1;
}

function parseInlineRuns(line: string): readonly MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  const open: { readonly closer: string; readonly outer: InlineStyle }[] = [];
  let style = PLAIN_STYLE;
  let pending = "";
  let index = 0;

  const flush = (): void => {
    if (pending !== "") {
      runs.push({ text: pending, bold: style.bold, italic: style.italic, code: false });
      pending = "";
    }
  };

  while (index < line.length) {
    const innermost = open[open.length - 1];
    if (innermost !== undefined && line.startsWith(innermost.closer, index) && closesEmphasis(line, index)) {
      flush();
      style = innermost.outer;
      open.pop();
      index += innermost.closer.length;
      continue;
    }
    if (line.startsWith(CODE_MARKER, index)) {
      const closer = line.indexOf(CODE_MARKER, index + CODE_MARKER.length);
      if (closer > index + CODE_MARKER.length) {
        flush();
        runs.push({ text: line.slice(index + CODE_MARKER.length, closer), bold: style.bold, italic: style.italic, code: true });
        index = closer + CODE_MARKER.length;
        continue;
      }
      pending += CODE_MARKER;
      index += CODE_MARKER.length;
      continue;
    }
    if (line.startsWith(BOLD_MARKER, index)) {
      if (!style.bold && opensEmphasis(line, index, BOLD_MARKER)) {
        flush();
        open.push({ closer: BOLD_MARKER, outer: style });
        style = { bold: true, italic: style.italic };
        index += BOLD_MARKER.length;
        continue;
      }
      pending += BOLD_MARKER;
      index += BOLD_MARKER.length;
      continue;
    }
    if (line.startsWith(ITALIC_MARKER, index)) {
      if (!style.italic && opensEmphasis(line, index, ITALIC_MARKER)) {
        flush();
        open.push({ closer: ITALIC_MARKER, outer: style });
        style = { bold: style.bold, italic: true };
        index += ITALIC_MARKER.length;
        continue;
      }
      pending += ITALIC_MARKER;
      index += ITALIC_MARKER.length;
      continue;
    }
    pending += line.charAt(index);
    index += 1;
  }
  flush();
  return runs;
}
