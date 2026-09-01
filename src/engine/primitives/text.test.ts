/**
 * text.test.ts — tests for primitives/text.ts (PROJECT_BRIEF §5.6's block-tree engine).
 *
 * IMPLEMENTS: the slice of Phase 5's acceptance criterion this file can demonstrate
 * headless — "updates both its number and its branch as the cell changes" is the
 * EVALUATION half (`evaluateBlockTree`); "re-renders when a value referenced only
 * inside the currently non-taken branch changes" is the DEPENDENCY half
 * (`extractTextDependencies`, pinned directly: a reference inside an untaken branch
 * IS reported). NOT demonstrated here: markdown-lite rendering, layout/wrapping, or
 * anything about a `text` OBJECT/schema — text.ts's own header explains why those are
 * later cycles.
 */
import { describe, expect, it } from "vitest";
import type { Address, AddressableObject } from "../address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext, type TextMeasurer } from "../eval-context.ts";
import type { GraphObject, ObjectType, Slot } from "../graph/node.ts";
import type { ErrorValue, Value } from "../graph/node.ts";
import type { ReadRange, ReadSlot } from "../formula/eval.ts";
import {
  computeMeasuredHeight,
  computeResolvedContent,
  evaluateBlockTree,
  extractTextDependencies,
  MAX_BLOCK_TREE_DEPTH,
  parseTextContent,
  resolveTextDependencyAddresses,
  TEXT_CONTENT_PATH,
  type Block,
} from "./text.ts";

// Same fixture-building convention as parser.test.ts/address.test.ts.
function objects(...entries: Array<[id: string, name: string, type?: ObjectType]>): AddressableObject[] {
  return entries.map(([id, name, type = "table"]) => ({ id, name, type }));
}

const TABLE_1 = objects(["obj_1", "table_1"]);

function reader(values: Record<string, Value>): ReadSlot {
  return (address) => {
    const key = `${address.objectId}::${address.path.join(".")}`;
    return Object.hasOwn(values, key) ? values[key] : undefined;
  };
}

const EMPTY_READ: ReadSlot = () => undefined;
const NO_RANGE: ReadRange | undefined = undefined;

function expectError(value: Value, code: string): void {
  expect(value).toMatchObject({ error: code });
}

/** Asserts `blocks` is exactly one `error`-kind Block and returns its message, for tests that only care that parsing recovered rather than threw. */
function soleErrorMessage(blocks: readonly Block[]): string {
  expect(blocks).toHaveLength(1);
  const block = blocks[0] as Block;
  if (block.type !== "error") {
    throw new Error(`expected a sole error block, got: ${JSON.stringify(block)}`);
  }
  return block.message;
}

describe("parseTextContent — plain text", () => {
  it("content with no markers is a single text block", () => {
    expect(parseTextContent("hello world", [])).toEqual([{ type: "text", value: "hello world" }]);
  });

  it("empty content is an empty block list", () => {
    expect(parseTextContent("", [])).toEqual([]);
  });

  it("a lone '{' with no marker after it stays literal text", () => {
    expect(parseTextContent("a { b } c", [])).toEqual([{ type: "text", value: "a { b } c" }]);
  });
});

describe("parseTextContent — {= } formula blocks", () => {
  it("parses a formula block's expression", () => {
    const blocks = parseTextContent("Radius is {= 2 * 3 } units.", []);
    expect(blocks).toEqual([
      { type: "text", value: "Radius is " },
      { type: "formula", ast: { type: "binaryOp", operator: "*", left: { type: "literal", value: 2 }, right: { type: "literal", value: 3 } } },
      { type: "text", value: " units." },
    ]);
  });

  it("resolves a real reference against the supplied object list, to an ID (§5.2)", () => {
    const blocks = parseTextContent("{= table_1.rows }", TABLE_1);
    expect(blocks).toEqual([
      { type: "formula", ast: { type: "reference", address: { objectId: "obj_1", path: ["rows"] } } },
    ]);
  });

  it("a bare cell ref is a PARSE ERROR in text — §5.3: 'bare refs in text formulas are a parse error', falling out of NO tableObjectId being supplied", () => {
    const blocks = parseTextContent("{= A1 }", TABLE_1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("error");
  });

  it("an unparseable expression becomes an error block, not a thrown exception", () => {
    const blocks = parseTextContent("before {= 1 + } after", []);
    expect(blocks[0]).toEqual({ type: "text", value: "before " });
    expect(blocks[1]?.type).toBe("error");
    expect(blocks[2]).toEqual({ type: "text", value: " after" });
  });

  it("an unclosed {= never reaching a '}' is left as literal text, not a marker", () => {
    expect(parseTextContent("no closing brace {= 1 + 1", [])).toEqual([
      { type: "text", value: "no closing brace {= 1 + 1" },
    ]);
  });

  it("a '}' inside a quoted string does not end the formula block early (quote-aware scan)", () => {
    const blocks = parseTextContent('{= CONCAT("a}b", "x") }', []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "formula",
      ast: { type: "functionCall", name: "CONCAT", args: [{ type: "literal", value: "a}b" }, { type: "literal", value: "x" }] },
    });
  });
});

describe("parseTextContent — {? }{:}{?} conditionals", () => {
  it("parses a conditional with no else branch", () => {
    const blocks = parseTextContent("{? table_1.rows > 0 }yes{?}", TABLE_1);
    expect(blocks).toEqual([
      {
        type: "conditional",
        condition: {
          type: "binaryOp",
          operator: ">",
          left: { type: "reference", address: { objectId: "obj_1", path: ["rows"] } },
          right: { type: "literal", value: 0 },
        },
        trueBranch: [{ type: "text", value: "yes" }],
        falseBranch: [],
      },
    ]);
  });

  it("parses a conditional WITH an else branch", () => {
    const blocks = parseTextContent("{? TRUE }yes{:}no{?}", []);
    expect(blocks).toEqual([
      {
        type: "conditional",
        condition: { type: "literal", value: true },
        trueBranch: [{ type: "text", value: "yes" }],
        falseBranch: [{ type: "text", value: "no" }],
      },
    ]);
  });

  it("PROJECT_BRIEF §5.6's own worked nested example parses without error", () => {
    const content = [
      "{? TRUE }",
      "**Status: PASS**",
      "{:}",
      "{? TRUE }",
      "MARGINAL",
      "{:}",
      "FAIL",
      "{?}",
      "{?}",
    ].join("\n");
    const blocks = parseTextContent(content, []);
    expect(blocks).toHaveLength(1);
    const outer = blocks[0] as Block;
    if (outer.type !== "conditional") {
      throw new Error(`expected a conditional, got ${outer.type}`);
    }
    // The joined "\n"s around each marker are ordinary literal text (indentation is
    // never special, per §5.6) — so the false branch is whitespace, the nested
    // conditional, then more whitespace, not the conditional alone.
    const inner = outer.falseBranch.find((block) => block.type === "conditional");
    expect(inner).toBeDefined();
  });

  it("a condition that fails to parse becomes ONE error block spanning the whole construct, its branches held in `orphaned` rather than inline (D-116)", () => {
    const blocks = parseTextContent("{? 1 + }kept text{?}", []);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Block;
    if (block.type !== "error") {
      throw new Error(`expected an error block, got ${block.type}`);
    }
    // Inline siblings would RENDER once D-116 stops an error block poisoning the tree;
    // held here they still carry every dependency and print nothing.
    expect(block.orphaned).toEqual([{ type: "text", value: "kept text" }]);
    expect(block.source).toBe("{? 1 + }kept text{?}");
  });

  it("an unclosed conditional (no matching {?}) becomes an error block whose span runs to the end of content", () => {
    const content = "{? TRUE }never closed";
    const blocks = parseTextContent(content, []);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Block;
    if (block.type !== "error") {
      throw new Error(`expected an error block, got ${block.type}`);
    }
    expect(block.orphaned).toEqual([{ type: "text", value: "never closed" }]);
    expect(block.source).toBe(content);
  });

  it("a stray top-level {?} with no opening {? } is kept as literal text, not dropped or fatal — as three text blocks, adjacent text is not merged (Rule 5: no consumer needs it, evaluateBlockTree concatenates regardless)", () => {
    expect(parseTextContent("before {?} after", [])).toEqual([
      { type: "text", value: "before " },
      { type: "text", value: "{?}" },
      { type: "text", value: " after" },
    ]);
  });

  it("a stray top-level {:} with no opening {? } is kept as literal text", () => {
    expect(parseTextContent("before {:} after", [])).toEqual([
      { type: "text", value: "before " },
      { type: "text", value: "{:}" },
      { type: "text", value: " after" },
    ]);
  });

  it("nesting past MAX_BLOCK_TREE_DEPTH refuses without throwing", () => {
    const opens = "{? TRUE }".repeat(MAX_BLOCK_TREE_DEPTH + 5);
    const closes = "{?}".repeat(MAX_BLOCK_TREE_DEPTH + 5);
    expect(() => parseTextContent(opens + closes, [])).not.toThrow();
    // Some conditional in the (deeply nested) result refused past the bound — the
    // exact shape of recovery is not the contract; not throwing is.
    const serialized = JSON.stringify(parseTextContent(opens + closes, []));
    expect(serialized).toContain("nests too deeply");
  });
});

describe("extractTextDependencies", () => {
  it("a plain text block contributes nothing", () => {
    expect(extractTextDependencies([{ type: "text", value: "hi" }])).toEqual([]);
  });

  it("an error block with no orphaned blocks contributes nothing (D-028's own 'absence of a dependency' move, applied here)", () => {
    expect(
      extractTextDependencies([{ type: "error", message: "broken", source: "{= 1 + }", start: 2, orphaned: [] }]),
    ).toEqual([]);
  });

  it("a formula block contributes its own extractDependencies", () => {
    const blocks = parseTextContent("{= table_1.rows }", TABLE_1);
    expect(extractTextDependencies(blocks)).toEqual([
      { kind: "reference", address: { objectId: "obj_1", path: ["rows"] } },
    ]);
  });

  it("§5.6's acceptance criterion, pinned directly: a conditional's UNTAKEN branch's reference is still reported", () => {
    const untaken = objects(["obj_9", "untaken_source"]);
    const blocks = parseTextContent("{? TRUE }{= table_1.rows }{:}{= untaken_source.rows }{?}", [...TABLE_1, ...untaken]);
    const dependencies = extractTextDependencies(blocks);
    expect(dependencies).toContainEqual({ kind: "reference", address: { objectId: "obj_1", path: ["rows"] } });
    expect(dependencies).toContainEqual({ kind: "reference", address: { objectId: "obj_9", path: ["rows"] } });
  });

  it("a reference living ONLY in the false branch of a BROKEN conditional is still reported (D-115) — the case that made extraction non-total before 0121-REVIEW", () => {
    const other = objects(["obj_9", "poly_1", "polygon"]);
    const blocks = parseTextContent("{? 1 + }x{:}{= poly_1.rows }{?}", [...TABLE_1, ...other]);
    // The condition is broken, so this whole construct renders `!` + its own source
    // (D-116) and `orphaned` is never evaluated — but the address the content NAMES
    // must still be reported, or the object would subscribe to strictly fewer slots
    // than its own content mentions.
    expect(extractTextDependencies(blocks)).toEqual([
      { kind: "reference", address: { objectId: "obj_9", path: ["rows"] } },
    ]);
  });

  it("a cycle reachable only through an untaken branch is still a real, discoverable dependency (§5.3's own rule, applied at the block-tree level)", () => {
    // extractTextDependencies does not itself detect cycles (that is mutation.ts's job) —
    // this pins that the edge INTO the untaken branch is reported at all, which is the
    // precondition a cycle check needs.
    const blocks = parseTextContent("{? FALSE }{= table_1.rows }{?}", TABLE_1);
    expect(extractTextDependencies(blocks)).toEqual([
      { kind: "reference", address: { objectId: "obj_1", path: ["rows"] } },
    ]);
  });
});

describe("evaluateBlockTree — plain text and formula embedding", () => {
  it("plain text evaluates to itself", () => {
    expect(evaluateBlockTree([{ type: "text", value: "hello" }], EMPTY_READ)).toBe("hello");
  });

  it("embeds a number, a string, and a boolean (spelled TRUE/FALSE, matching the formula language's own literals)", () => {
    const blocks = parseTextContent('{= 1 + 1 } {= "x" } {= TRUE } {= FALSE }', []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("2 x TRUE FALSE");
  });

  it("a null value (e.g. an explicit null literal) embeds as an empty string", () => {
    const read: ReadSlot = () => null;
    const blocks = parseTextContent("[{= table_1.rows }]", TABLE_1);
    expect(evaluateBlockTree(blocks, read)).toBe("[]");
  });

  it("reads through the supplied read/readRange exactly like an ordinary formula slot, D-110's empty-in-extent-cell 0 included when the caller's read implements it", () => {
    const read: ReadSlot = () => 0; // stand-in for a caller already applying D-110's coercion
    const blocks = parseTextContent("{= table_1.A1 + 1 }", TABLE_1);
    expect(evaluateBlockTree(blocks, read)).toBe("1");
  });

  it("a RUNTIME-broken embedded formula renders `!` + its error CODE in place, and the text around it still renders (D-117)", () => {
    const blocks = parseTextContent("before {= 1 / 0 } after", []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("before !#DIV0 after");
  });

  it("a PARSE-broken span renders `!` + its own source verbatim, delimiters and all — not #PARSE, and the text around it still renders (D-116)", () => {
    const blocks = parseTextContent("before {= 1 + } after", []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("before !{= 1 + } after");
  });

  it("every broken span in a paragraph of five embeddings is marked independently — the injury D-116 was ruled against", () => {
    const read: ReadSlot = () => 5;
    const blocks = parseTextContent("{= table_1.rows } ok {= 1 + } mid {= 1 / 0 } end", TABLE_1);
    expect(evaluateBlockTree(blocks, read)).toBe("5 ok !{= 1 + } mid !#DIV0 end");
  });

  it("evaluateBlockTree ALWAYS returns a string, broken spans included (D-116 clause 3 / D-117 clause 4: resolvedContent never holds an ErrorValue)", () => {
    expect(typeof evaluateBlockTree(parseTextContent("{= 1 + }", []), EMPTY_READ)).toBe("string");
    expect(typeof evaluateBlockTree(parseTextContent("{= 1 / 0 }", []), EMPTY_READ)).toBe("string");
  });

  it("a Point/Point[] value that cannot be embedded renders `!#TYPE` in place — D-117, matching §5.1's 'read a scalar component instead'", () => {
    const read: ReadSlot = (address) => (address.path[0] === "origin" ? { x: 1, y: 2 } : undefined);
    const addr: Address = { objectId: "obj_1", path: ["origin"] };
    const blocks: readonly Block[] = [{ type: "text", value: "at " }, { type: "formula", ast: { type: "reference", address: addr } }];
    expect(evaluateBlockTree(blocks, read)).toBe("at !#TYPE");
  });
});

describe("evaluateBlockTree — conditionals short-circuit (§5.6: 'evaluation of the tree short-circuits normally')", () => {
  const POISON_BLOCKS: readonly Block[] = parseTextContent("{= 1 / 0 }", []);

  it("evaluates ONLY the true branch when the condition is true — the untaken false branch's error never surfaces", () => {
    const blocks: readonly Block[] = [
      {
        type: "conditional",
        condition: { type: "literal", value: true },
        trueBranch: [{ type: "text", value: "ok" }],
        falseBranch: POISON_BLOCKS,
      },
    ];
    expect(evaluateBlockTree(blocks, EMPTY_READ, NO_RANGE)).toBe("ok");
  });

  it("evaluates ONLY the false branch when the condition is false — the untaken true branch's error never surfaces", () => {
    const blocks: readonly Block[] = [
      {
        type: "conditional",
        condition: { type: "literal", value: false },
        trueBranch: POISON_BLOCKS,
        falseBranch: [{ type: "text", value: "ok" }],
      },
    ];
    expect(evaluateBlockTree(blocks, EMPTY_READ, NO_RANGE)).toBe("ok");
  });

  it("a non-boolean condition renders `!#TYPE` in place and takes NEITHER branch (D-117 clause 6)", () => {
    const blocks: readonly Block[] = [
      { type: "text", value: "x " },
      { type: "conditional", condition: { type: "literal", value: "not a bool" }, trueBranch: [{ type: "text", value: "T" }], falseBranch: [{ type: "text", value: "F" }] },
      { type: "text", value: " y" },
    ];
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("x !#TYPE y");
  });

  it("a RUNTIME-broken condition renders `!` + its error CODE in place, taking neither branch (D-117 clause 6)", () => {
    const blocks = parseTextContent("a {? 1 / 0 }yes{:}no{?} b", []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("a !#DIV0 b");
  });

  it("a PARSE-broken conditional renders its WHOLE construct source verbatim behind `!`, never its branches (D-116 clause 5)", () => {
    const blocks = parseTextContent("x {? 1 + }yes{:}no{?} y", []);
    // `!{? 1 + }yes{:}no{?}`, NOT `!{? 1 + }` followed by `yesno` — orphaned is never rendered.
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("x !{? 1 + }yes{:}no{?} y");
  });

  it("a broken embedding INSIDE the taken branch is marked there, recursively — no new case (D-117 clause 6)", () => {
    const blocks = parseTextContent("{? TRUE }val {= 1 / 0 }{:}skipped{?}", []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("val !#DIV0");
  });

  it("PROJECT_BRIEF §5.6's own worked example evaluates to the PASS branch and leaves the others untouched", () => {
    const content = "{? TRUE }PASS{:}{? TRUE }MARGINAL{:}FAIL{?}{?}";
    const blocks = parseTextContent(content, []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("PASS");
  });

  it("the FAIL leaf of the same nested example is reached when both conditions are false", () => {
    const content = "{? FALSE }PASS{:}{? FALSE }MARGINAL{:}FAIL{?}{?}";
    const blocks = parseTextContent(content, []);
    expect(evaluateBlockTree(blocks, EMPTY_READ)).toBe("FAIL");
  });
});

describe("recovered parse errors carry a readable message", () => {
  it("names something about the failure, not just 'error'", () => {
    expect(soleErrorMessage(parseTextContent("{= 1 + }", []))).not.toBe("");
  });

  it("an error block carries the whole broken SPAN, delimiters included, and its offset into content (D-038 clauses 2 and 4, via D-115/D-116)", () => {
    const content = "aaaaaaaaaaaaaaaaaaaa{= SUMM(1) }bbbb";
    const blocks = parseTextContent(content, []);
    const error = blocks.find((block) => block.type === "error");
    if (error === undefined || error.type !== "error") {
      throw new Error(`expected an error block, got: ${JSON.stringify(blocks)}`);
    }
    // Delimiters included: D-116 renders this span back verbatim, so `{=` and `}` are
    // part of it — ` SUMM(1) ` alone could not be printed without re-inventing them.
    expect(error.source).toBe("{= SUMM(1) }");
    // The offset must be into CONTENT — a caller underlining the span reads the
    // operator's own text, not a substring of it. This round trip is the contract.
    expect(content.slice(error.start, error.start + error.source.length)).toBe(error.source);
    expect(error.start).toBe(20);
  });

  it("a broken CONDITION's span covers the ENTIRE construct through its matching {?}, not just the condition", () => {
    const content = "hi {? 1 + }kept{?} bye";
    const blocks = parseTextContent(content, []);
    const error = blocks.find((block) => block.type === "error");
    if (error === undefined || error.type !== "error") {
      throw new Error(`expected an error block, got: ${JSON.stringify(blocks)}`);
    }
    expect(error.source).toBe("{? 1 + }kept{?}");
    expect(content.slice(error.start, error.start + error.source.length)).toBe(error.source);
  });
});

describe("PROJECT_BRIEF §6's Phase 5 acceptance-criterion string, verbatim (added 0121-REVIEW)", () => {
  // The brief's own words, character for character. Added by the review rather than
  // paraphrased, because §12 makes the criterion itself the contract: the tests above
  // exercise the same machinery through fixtures the implementer chose, and a fixture
  // an implementer chose cannot show that the SPEC's own string parses.
  const CRITERION = "Radius: {= table_x.A1 }{? table_x.A1 > 50 } — **LARGE**{:} — small{?}";
  const TABLE_X = objects(["obj_1", "table_x"]);
  const cellA1 = { objectId: "obj_1", path: ["cells", "A1"] };

  it("parses into text + formula + conditional, resolving table_x.A1 through D-005's stored path", () => {
    const blocks = parseTextContent(CRITERION, TABLE_X);
    expect(blocks.map((block) => block.type)).toEqual(["text", "formula", "conditional"]);
  });

  it("subscribes to the cell BOTH the embedding and the condition name (eager and total)", () => {
    const dependencies = extractTextDependencies(parseTextContent(CRITERION, TABLE_X));
    expect(dependencies).toEqual([
      { kind: "reference", address: cellA1 },
      { kind: "reference", address: cellA1 },
    ]);
  });

  it("updates BOTH its number and its branch as the cell changes — the criterion's own clause", () => {
    const blocks = parseTextContent(CRITERION, TABLE_X);
    expect(evaluateBlockTree(blocks, () => 80)).toBe("Radius: 80 — **LARGE**");
    expect(evaluateBlockTree(blocks, () => 12)).toBe("Radius: 12 — small");
  });

  it("markdown-lite markup survives as literal text for render/ to interpret, uninterpreted here", () => {
    expect(evaluateBlockTree(parseTextContent(CRITERION, TABLE_X), () => 80)).toContain("**LARGE**");
  });
});

// ---------------------------------------------------------------------------
// The `text` schema entry's two halves (entry 0127, D-114)
// ---------------------------------------------------------------------------

/** A `text` GraphObject with a literal `content` slot and the `resolvedContent` derived-slot placeholder D-018 requires. */
function textObject(id: string, name: string, content: Value): GraphObject {
  return {
    id,
    name,
    type: "text",
    slots: {
      [TEXT_CONTENT_PATH.join(".")]: { kind: "literal", value: content },
      resolvedContent: { kind: "derived", value: null },
    },
  };
}

/** A `table` GraphObject: literal `rows`/`cols` plus a `cells.<ref>` literal slot for each populated cell. */
function tableWithCells(id: string, name: string, rows: number, cols: number, cells: Record<string, Value>): GraphObject {
  const slots: Record<string, Slot> = {
    rows: { kind: "literal", value: rows },
    cols: { kind: "literal", value: cols },
  };
  for (const [ref, value] of Object.entries(cells)) {
    slots[`cells.${ref}`] = { kind: "literal", value };
  }
  return { id, name, type: "table", slots };
}

function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

describe("resolveTextDependencyAddresses — the resolvedContent dynamic dependency resolver (§5.1, D-114)", () => {
  const table = tableWithCells("obj_t", "table_1", 4, 4, { A1: 10, A2: 20, A3: 30, A4: 40 });

  it("always returns `content` itself first (§5.6: 'from content plus every referenced slot')", () => {
    const text = textObject("obj_x", "text_1", "no markers here");
    expect(resolveTextDependencyAddresses(text, [text])).toEqual([addr("obj_x", "content")]);
  });

  it("returns `content` alone for a non-literal or non-string content slot (Rule 6 — parsed literal-only)", () => {
    const formulaContent: GraphObject = {
      id: "obj_x",
      name: "text_1",
      type: "text",
      slots: { content: { kind: "formula", ast: { type: "literal", value: "x" }, value: "x" }, resolvedContent: { kind: "derived", value: null } },
    };
    expect(resolveTextDependencyAddresses(formulaContent, [formulaContent])).toEqual([addr("obj_x", "content")]);
  });

  it("subscribes to every populated cell an embedding names", () => {
    const text = textObject("obj_x", "text_1", "sum is {= table_1.A1 + table_1.A3 }");
    expect(resolveTextDependencyAddresses(text, [text, table])).toEqual([
      addr("obj_x", "content"),
      addr("obj_t", "cells", "A1"),
      addr("obj_t", "cells", "A3"),
    ]);
  });

  it("subscribes to BOTH branches of a conditional, eagerly and totally (§5.3) — including the one not taken", () => {
    const text = textObject("obj_x", "text_1", "{? table_1.A1 > 0 }{= table_1.A2 }{:}{= table_1.A4 }{?}");
    const addresses = resolveTextDependencyAddresses(text, [text, table]);
    expect(addresses).toContainEqual(addr("obj_t", "cells", "A2"));
    expect(addresses).toContainEqual(addr("obj_t", "cells", "A4"));
  });

  it("still subscribes to a reference living only in a BROKEN conditional's branch (D-115 clause 3, via `orphaned`)", () => {
    const text = textObject("obj_x", "text_1", "{? 1 + }x{:}{= table_1.A4 }{?}");
    expect(resolveTextDependencyAddresses(text, [text, table])).toContainEqual(addr("obj_t", "cells", "A4"));
  });

  it("expands an embedded range per in-extent populated cell, via the SAME enumeration a cell formula's range uses (D-114 clause 1)", () => {
    const text = textObject("obj_x", "text_1", "total {= SUM(table_1.A1:table_1.A4) }");
    expect(resolveTextDependencyAddresses(text, [text, table])).toEqual([
      addr("obj_x", "content"),
      addr("obj_t", "cells", "A1"),
      addr("obj_t", "cells", "A2"),
      addr("obj_t", "cells", "A3"),
      addr("obj_t", "cells", "A4"),
    ]);
  });

  it("gives an EMPTY in-extent cell NO edge (D-110 clause 4) — the bare-reference mirror of a range member", () => {
    const text = textObject("obj_x", "text_1", "{= table_1.B2 }"); // B2 is in a 4x4 extent but has no slot
    expect(resolveTextDependencyAddresses(text, [text, table])).toEqual([addr("obj_x", "content")]);
  });

  it("DOES emit an edge for an OUT-OF-extent cell, so validateIntegrity's dangling check still names it (D-110 clause 6)", () => {
    const text = textObject("obj_x", "text_1", "{= table_1.Z9 }"); // Z9 is beyond the 4x4 extent
    expect(resolveTextDependencyAddresses(text, [text, table])).toContainEqual(addr("obj_t", "cells", "Z9"));
  });

  it("contributes nothing for a parse-broken span (D-028's 'absence of a dependency, made explicit')", () => {
    const text = textObject("obj_x", "text_1", "before {= 1 + } after");
    expect(resolveTextDependencyAddresses(text, [text])).toEqual([addr("obj_x", "content")]);
  });

  it("never throws for a table that does not exist — falls back to the range start so the dangling check catches it", () => {
    const text = textObject("obj_x", "text_1", "{= SUM(gone.A1:gone.A4) }");
    expect(() => resolveTextDependencyAddresses(text, [text])).not.toThrow();
  });
});

describe("computeResolvedContent — the resolvedContent compute (§5.6, D-114 clause 4)", () => {
  const CONTENT_KEY = "obj_x::content";
  const text = textObject("obj_x", "text_1", "unused — read supplies content");
  const table = tableWithCells("obj_t", "table_1", 4, 4, { A1: 10, A2: 20, A3: 30, A4: 40 });

  function readWith(content: Value, extra: Record<string, Value> = {}): ReadSlot {
    return reader({ [CONTENT_KEY]: content, ...extra });
  }

  it("returns plain content verbatim", () => {
    expect(computeResolvedContent(text, readWith("hello **world**"), undefined, { objects: [text] })).toBe("hello **world**");
  });

  it("evaluates an embedded formula, re-parsing content every call (never cached — D-114 clause 4)", () => {
    expect(computeResolvedContent(text, readWith("2 + 3 = {= 2 + 3 }"), undefined, { objects: [text] })).toBe("2 + 3 = 5");
  });

  it("reads `content` through `read`, so it is a declared dependency, not an object-slots peek", () => {
    // A `read` that returns undefined for the content path -> empty resolved content.
    expect(computeResolvedContent(text, () => undefined, undefined, { objects: [text] })).toBe("");
  });

  it("propagates an ErrorValue `content` (a formula-driven content slot that errored — §5.1: errors propagate)", () => {
    const errored: ErrorValue = { error: "#DIV0", message: "content formula divided by zero" };
    expect(computeResolvedContent(text, readWith(errored), undefined, { objects: [text] })).toEqual(errored);
  });

  it("marks a broken embedded span in place rather than blanking (delegates to evaluateBlockTree — D-116)", () => {
    expect(computeResolvedContent(text, readWith("ok {= 1 + } still ok"), undefined, { objects: [text] })).toBe("ok !{= 1 + } still ok");
  });

  it("uses the injected `readRange` for an embedded aggregate (D-114 clause 1 — without it a RangeNode is #PARSE)", () => {
    const readRange: ReadRange = () => [1, 2, 3, 4];
    const withRange = computeResolvedContent(text, readWith("total {= SUM(table_1.A1:table_1.A4) }"), undefined, { readRange, objects: [text, table] });
    expect(withRange).toBe("total 10");
    const withoutRange = computeResolvedContent(text, readWith("total {= SUM(table_1.A1:table_1.A4) }"), undefined, { objects: [text, table] });
    expect(withoutRange).toBe("total !#PARSE");
  });

  it("never throws for a nonsense content string", () => {
    expect(() => computeResolvedContent(text, readWith("{? {= {:} }} {?"), undefined, { objects: [text] })).not.toThrow();
  });
});

describe("computeMeasuredHeight — the measuredHeight compute (§5.6, D-118, D-120 — entry 0129)", () => {
  const OBJECT: GraphObject = { id: "obj_x", name: "text_1", type: "text", slots: {} };

  /** A read over `resolvedContent` / `width` / the three size-relevant `style.*` fields — the compute's declared deps. */
  function styleRead(over: Partial<Record<"resolvedContent" | "width" | "font" | "fontSize" | "lineHeight", Value>> = {}): ReadSlot {
    return reader({
      "obj_x::resolvedContent": over.resolvedContent ?? "some resolved text",
      "obj_x::width": over.width ?? "auto",
      "obj_x::style.font": over.font ?? "sans",
      "obj_x::style.fontSize": over.fontSize ?? 12,
      "obj_x::style.lineHeight": over.lineHeight ?? 16,
    });
  }

  /** A fake: height is `lineHeight + (maxWidth ?? 0)`, so a test can read back BOTH that it ran and what `maxWidth` it got (D-120). Records the last call. */
  function fakeContext(): { context: EvalContext; lastCall: () => Parameters<TextMeasurer["measure"]> | undefined } {
    let last: Parameters<TextMeasurer["measure"]> | undefined;
    return {
      context: {
        measurer: {
          measure: (text, style, maxWidth) => {
            last = [text, style, maxWidth];
            return { width: text.length, height: style.lineHeight + (maxWidth ?? 0) };
          },
        },
      },
      lastCall: () => last,
    };
  }

  it("D-118: returns #MEASURE — not a height — when only NULL_EVAL_CONTEXT is available", () => {
    expect(computeMeasuredHeight(OBJECT, styleRead(), NULL_EVAL_CONTEXT, undefined)).toMatchObject({ error: "#MEASURE" });
  });

  it("D-118: returns #MEASURE when context is undefined (the isolated-unit-test path)", () => {
    const result = computeMeasuredHeight(OBJECT, styleRead(), undefined, undefined);
    expect(result).toMatchObject({ error: "#MEASURE" });
    expect((result as ErrorValue).message).toContain("text_1");
  });

  it("with a real measurer, returns measure(...).height", () => {
    const { context } = fakeContext();
    expect(computeMeasuredHeight(OBJECT, styleRead({ lineHeight: 20 }), context, undefined)).toBe(20);
  });

  it("D-120: a numeric `width` slot is passed to measure() as maxWidth; \"auto\" is not", () => {
    const withNumber = fakeContext();
    computeMeasuredHeight(OBJECT, styleRead({ width: 150 }), withNumber.context, undefined);
    expect(withNumber.lastCall()?.[2]).toBe(150);

    const withAuto = fakeContext();
    computeMeasuredHeight(OBJECT, styleRead({ width: "auto" }), withAuto.context, undefined);
    expect(withAuto.lastCall()?.[2]).toBeUndefined();
  });

  it("measures the resolved string it is handed (markup and all — §5.6: 'from resolvedContent')", () => {
    const { context, lastCall } = fakeContext();
    computeMeasuredHeight(OBJECT, styleRead({ resolvedContent: "the answer is 42" }), context, undefined);
    expect(lastCall()?.[0]).toBe("the answer is 42");
  });

  it("propagates an upstream ErrorValue from resolvedContent / width / any style field (§5.1)", () => {
    const { context } = fakeContext();
    const err: ErrorValue = { error: "#REF", message: "style.fontSize reads a deleted cell" };
    expect(computeMeasuredHeight(OBJECT, styleRead({ resolvedContent: err }), context, undefined)).toEqual(err);
    expect(computeMeasuredHeight(OBJECT, styleRead({ width: err }), context, undefined)).toEqual(err);
    expect(computeMeasuredHeight(OBJECT, styleRead({ fontSize: err }), context, undefined)).toEqual(err);
  });

  it("upstream-error propagation wins over #MEASURE — an errored input is reported even with no measurer", () => {
    const err: ErrorValue = { error: "#DIV0", message: "width formula divided by zero" };
    expect(computeMeasuredHeight(OBJECT, styleRead({ width: err }), NULL_EVAL_CONTEXT, undefined)).toEqual(err);
  });

  it("#MEASURE wins over a #TYPE style problem — with no measurer the style shape cannot matter", () => {
    expect(computeMeasuredHeight(OBJECT, styleRead({ font: 5 }), NULL_EVAL_CONTEXT, undefined)).toMatchObject({ error: "#MEASURE" });
  });

  it("returns #TYPE for a style the measurer cannot use — a missing slot (undefined) included", () => {
    const { context } = fakeContext();
    expect(computeMeasuredHeight(OBJECT, styleRead({ font: 5 }), context, undefined)).toMatchObject({ error: "#TYPE" });
    expect(computeMeasuredHeight(OBJECT, styleRead({ fontSize: "big" }), context, undefined)).toMatchObject({ error: "#TYPE" });
    // A missing style.fontSize slot: `read` returns undefined, not a Value — same fail-closed branch.
    const missing = reader({ "obj_x::resolvedContent": "t", "obj_x::width": "auto", "obj_x::style.font": "sans", "obj_x::style.lineHeight": 16 });
    expect(computeMeasuredHeight(OBJECT, missing, context, undefined)).toMatchObject({ error: "#TYPE" });
  });

  it("treats a non-string resolvedContent as empty text rather than throwing", () => {
    const { context, lastCall } = fakeContext();
    expect(() => computeMeasuredHeight(OBJECT, styleRead({ resolvedContent: 7 }), context, undefined)).not.toThrow();
    expect(lastCall()?.[0]).toBe("");
  });

  it("fails closed with #TYPE if a (buggy) measurer returns a non-finite height — validateIntegrity runs before evaluate, so nothing else would catch it (0129-REVIEW)", () => {
    const nanMeasurer: EvalContext = { measurer: { measure: () => ({ width: 0, height: Number.NaN }) } };
    expect(computeMeasuredHeight(OBJECT, styleRead(), nanMeasurer, undefined)).toMatchObject({ error: "#TYPE" });
    const infMeasurer: EvalContext = { measurer: { measure: () => ({ width: 0, height: Infinity }) } };
    expect(computeMeasuredHeight(OBJECT, styleRead(), infMeasurer, undefined)).toMatchObject({ error: "#TYPE" });
  });
});
