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
import type { ObjectType } from "../graph/node.ts";
import type { ErrorValue, Value } from "../graph/node.ts";
import type { ReadRange, ReadSlot } from "../formula/eval.ts";
import {
  evaluateBlockTree,
  extractTextDependencies,
  MAX_BLOCK_TREE_DEPTH,
  parseTextContent,
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
    // The condition is broken, so this whole tree evaluates to #PARSE either way — but
    // the address the content NAMES must still be reported, or the object would
    // subscribe to strictly fewer slots than its own content mentions.
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

  it("a broken embedded formula's ErrorValue propagates as the WHOLE tree's result, stopping there (left to right)", () => {
    const blocks = parseTextContent("before {= 1 / 0 } after", []);
    expectError(evaluateBlockTree(blocks, EMPTY_READ), "#DIV0");
  });

  it("an error block (a parse-time failure) propagates as #PARSE", () => {
    const blocks = parseTextContent("{= 1 + }", []);
    expectError(evaluateBlockTree(blocks, EMPTY_READ), "#PARSE");
  });

  it("a Point/Point[] value cannot be embedded directly — #TYPE, matching §5.1's 'read a scalar component instead'", () => {
    const read: ReadSlot = (address) => (address.path[0] === "origin" ? { x: 1, y: 2 } : undefined);
    const addr: Address = { objectId: "obj_1", path: ["origin"] };
    const blocks: readonly Block[] = [{ type: "formula", ast: { type: "reference", address: addr } }];
    expectError(evaluateBlockTree(blocks, read), "#TYPE");
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

  it("a non-boolean condition is #TYPE", () => {
    const blocks: readonly Block[] = [
      { type: "conditional", condition: { type: "literal", value: "not a bool" }, trueBranch: [], falseBranch: [] },
    ];
    expectError(evaluateBlockTree(blocks, EMPTY_READ), "#TYPE");
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
