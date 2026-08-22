# Project Brief & Build Plan — Reactive Spatial Canvas (working name: **Graphpaper**)

> **Read this whole document before writing any code.** It is the only context you will receive. It contains the product concept, the architectural decisions that have already been made (and why), hard rules that must not be violated, concrete specifications for each subsystem, and a phased build order with acceptance criteria.
>
> Where this document says **MUST** or **NEVER**, treat it as a constraint, not a suggestion. Where it says *suggested* or *your call*, use judgement.

---

## 1. What we are building

A **single-user, keyboard-driven spatial canvas where every object is a live node in one shared dependency graph.**

Geometry, text, tables (spreadsheet fragments), images, and scripts are not separate tools bolted together. They are all citizens of the same reactive system, wired to each other parametrically. Concretely:

- A polygon's origin X can be bound to cell `A1` of a table. Type a new number in that cell and the polygon moves.
- A different cell can contain the formula `= polygon_1.origin.x * 2`, reading a live value back out of the geometry.
- A text box can contain `The radius is {= table_x.A1 * 2} units.` and re-render whenever that cell changes.
- Drag a circle on the canvas, and a text label bound to its center follows it, while a polyline bound to its center re-draws.

It is **not** a CAD program, **not** a spreadsheet, and **not** a node-graph editor, though it borrows the best interaction model from each:

- **AutoCAD** — an always-active command line, minimal UI chrome, and the conviction that shapes are just polylines/polygons defined parametrically. A "pentagon" is not a special type; it is a preset over the polygon primitive that can be decomposed at any time.
- **Excel** — a formula engine with references, math, and conditionals.
- **Dynamo / Houdini** — script nodes with visible input/output ports that sit in the graph as opaque computation boxes.

The real goal is a **substrate for assembling small, live, data-driven "machines" out of a few competent primitives plus wiring.** A recurring example used during design (and adopted below as the final acceptance test) is a road network: intersections you can drag, roads that stay connected between them, and traffic-volume labels that come from a spreadsheet and hover near the intersections they belong to. The point is not roads — the point is that *any* such linked, draggable, data-bound contraption should be assemblable from parts.

### Governing philosophy

**Keep the core dumb and safe; push complexity to the edges.**

- The dependency graph is a strict **DAG**. Single source of truth per value. **Cycles are detected and rejected, never solved.**
- There is deliberately **no constraint solver** in the core. Anything hairy — simultaneous equations, optimization, loops, procedural generation — is exiled into script nodes, which the graph treats as opaque boxes with inputs and outputs.
- The formula language is intentionally **non-Turing-complete**: expressions and nestable conditionals, but no loops and no recursion. It always terminates.
- Rigor where it pays off (parametric geometry that decomposes to primitives; one shared formula engine reused by both cells and text). Pragmatism everywhere else.

---

## 2. Stack decisions (already made — do not revisit)

This is the **deliberately simple first version**. Performance has been explicitly traded away for a small stack and fast iteration.

| Decision | Value |
| --- | --- |
| Language | **TypeScript**, strict mode |
| Runtime | Browser, single process |
| Build tool | **Vite** |
| Rendering | **Canvas2D** (immediate-mode redraw) |
| Dependencies | **Effectively none at runtime.** Write the graph, formula parser, and renderer by hand. Dev-only deps (Vite, TypeScript, a test runner such as Vitest) are fine. |
| Python scripting | **NOT IMPLEMENTED.** Stubbed as a fake node (see §5.8). |
| Persistence | JSON document, versioned, save/load via file download + file input |

### Why Canvas2D and not SVG

Immediate-mode redraw maps naturally onto "re-evaluate the graph, then repaint the world," and it is the closer conceptual rehearsal for the eventual GPU renderer. SVG's retained DOM nodes tempt you into letting rendering state creep back into the data model, which is the exact coupling we are avoiding.

### Known future migration (design for it, do not build it)

The intended eventual production stack is: **Rust engine core + Tauri shell + TypeScript/WebGPU frontend + a persistent local Python interpreter as a subprocess.** You are building the simple version, but `src/engine/` is deliberately shaped to be a 1:1 port target for a future `crates/engine/` Rust crate. Two practical consequences for how you write engine code:

1. **Store IDs, not object references.** The graph must never rely on JavaScript object identity to express a relationship. Every relationship is expressed as an ID or an address that could be serialized or written in Rust unchanged.
2. **No closures, functions, class instances, or `Map`s of live objects stored inside graph state.** Graph state must be plain, serializable data. Behaviour lives in functions that operate on that data, not attached to it.

---

## 3. Hard rules

These are the rules that make the whole thing work. Violating them is the main way this project fails.

### RULE 1 — `src/engine/` is pure logic. It NEVER touches the DOM, `window`, `document`, or a canvas.

No imports from `src/render/`. No `document.createElement`. No `CanvasRenderingContext2D`. The engine must be fully unit-testable in a headless environment.

**This rule has one non-obvious trap: text measurement.** Laying out text requires measuring glyph widths, which normally requires a canvas context. Do **not** solve this by reaching for a canvas inside the engine. Instead:

- Define an interface in the engine: `interface TextMeasurer { measure(text: string, style: TextStyle): { width: number; height: number } }`
- The engine depends only on that interface and receives an implementation through the **evaluation context** (§5.1), injected at construction time.
- `src/render/` provides the real Canvas2D-backed implementation and `main.ts` wires it in.
- Tests provide a fake fixed-width measurer.

### RULE 2 — Every state change flows through the single mutation API in `src/engine/mutation.ts`, and every mutation is transactional.

Nothing anywhere else mutates graph state directly. The command line calls mutations. Dragging on the canvas calls mutations. Loading a document calls mutations. A mutation either **fully commits or leaves prior state bit-for-bit untouched** — see §5.1 for the required stage/validate/commit sequence, and for the batch form that applies many operations as one transaction. Undo is **not** being built now, but the mutation API **MUST** record an append-only journal of committed mutations from day one so that it can be.

### RULE 3 — The addressing scheme is load-bearing. Get it right early.

Formulas, bindings, script ports, serialization, and the command line all depend on it. Changing it later touches everything. See §5.2.

### RULE 4 — One formula engine, used by both table cells and text.

Do not write a second expression evaluator for text. Text embeds the *same* parser and evaluator; only the surrounding syntax differs.

### RULE 5 — Performance is explicitly a non-goal. Prefer the dumbest correct implementation.

Specifically, and deliberately:

- **Cycle detection**: a full DFS from scratch on every mutation. No incremental bookkeeping.
- **Evaluation**: on any mutation, re-evaluate **the entire graph** in topological order. Do not implement real dirty-flag tracking yet.
- **Transactionality**: implement staging by **deep-cloning the document state**, applying to the clone, and swapping it in on success. At a few hundred objects this is imperceptible and it is trivially correct.

Keep `dirty.ts` and `eval.ts` as separate modules so the *structure* of the fast version is preserved — but implement them naively.

### RULE 6 — The slot set is fixed during evaluation.

Evaluation never creates or destroys slots. Only mutations change which slots exist. This invariant is what makes naive topological evaluation safe, and several specifications below (variable-length vertex lists, table resizing) are shaped specifically to preserve it. **Do not violate it for convenience.**

### RULE 7 — Do not build the deferred items in §8.

---

## 4. Project structure

```
project-root/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── engine/                  # PURE LOGIC. No DOM. Future Rust port target.
    │   ├── graph/
    │   │   ├── node.ts          # slot/object data model
    │   │   ├── edge.ts          # dependency edges
    │   │   ├── dirty.ts         # (naive) invalidation
    │   │   ├── cycles.ts        # DFS cycle detection
    │   │   └── eval.ts          # topological evaluation
    │   ├── address.ts           # addressing scheme + resolver
    │   ├── formula/
    │   │   ├── lexer.ts
    │   │   ├── parser.ts
    │   │   ├── ast.ts
    │   │   ├── eval.ts
    │   │   ├── deps.ts          # extractDependencies
    │   │   └── functions.ts     # built-in function library
    │   ├── primitives/
    │   │   ├── schema.ts        # per-type slot schemas + derived-slot compute fns
    │   │   ├── geometry.ts
    │   │   ├── text.ts
    │   │   ├── table.ts
    │   │   └── image.ts
    │   ├── script/
    │   │   └── stub.ts          # fake node; real Python is a TODO
    │   ├── mutation.ts          # THE single transactional channel for state change
    │   ├── document.ts          # versioned save/load (JSON)
    │   └── index.ts             # public engine API surface
    │
    ├── render/                  # Canvas2D. Deliberately throwaway.
    │   ├── renderer.ts
    │   ├── camera.ts            # world <-> screen, pan/zoom
    │   ├── hittest.ts
    │   ├── measure.ts           # TextMeasurer implementation
    │   └── interaction.ts       # mouse drag/select -> mutation calls
    │
    ├── command/
    │   ├── parser.ts            # command string -> command object
    │   └── commands.ts          # command handlers -> mutation API calls
    │
    └── main.ts                  # wires engine + render + command together
```

`src/engine/` mirrors the future Rust crate one-to-one. The `engine ↔ render` seam is a plain function-call boundary here; in the future stack it becomes the Tauri IPC boundary. Keep it clean and narrow: the renderer reads engine state and calls mutations, and does nothing else across the line.

---

## 5. Subsystem specifications

### 5.1 The graph model — nodes are SLOTS, not objects

This is the most important structural decision in the document. **The dependency graph is over addressable slots (individual properties), not over whole objects.**

**Why:** if the graph were object-granular, a chain like `table_x.A1 → polygon_1.origin.x → table_x.B1` would register as `table → polygon → table` and be falsely rejected as a cycle. That would be maddening in normal use. Slot-granularity gives precise cycle detection and precise evaluation ordering.

#### Objects and slots

- An **Object** is a user-visible thing on the canvas: a polygon, a table, a text box, an image, a script node. It has a stable ID, a type, a user-facing name, and a set of **slots**.
- A **Slot** is a single addressable value belonging to an object: `origin.x`, `radius`, `fillColor`, `cells.A1`, `in.speed`, `out.result`. Slots are the nodes of the dependency graph.

#### The three slot kinds

Every slot is exactly one of:

| Kind | Value comes from | Writable by user | Has inbound edges |
| --- | --- | --- | --- |
| `literal` | a stored constant | yes | no |
| `formula` | evaluating a stored AST (a binding is just the degenerate formula `= other.slot`) | yes (edit the formula) | yes, from `extractDependencies` |
| `derived` | an object-type-specific compute function declared in `primitives/schema.ts` | **no — read-only** | yes, from the schema's declared input slots |

**Derived slots are first-class graph nodes and are evaluated inside the topological pass, exactly like formula slots.** This matters: `polygon_1.centroid.x`, `polygon_1.area`, `text_1.measuredHeight`, and `script_1.out.result` are all derived slots that formulas elsewhere are allowed to read. If derived values were computed in a separate pass after evaluation, every formula reading one would consume a value from the *previous* propagation and be permanently one step stale. Do not add a post-evaluation `recompute()` phase; there isn't one.

**`literal` and `formula` are interchangeable at runtime.** The schema declares a slot's *default* kind; `link` converts a literal slot to a formula slot and `unlink` converts it back. Any slot the schema marks as literal-by-default may therefore be driven by a formula instead — this is how a polyline vertex gets bound to a circle's center. **`derived` is fixed by schema and can never be converted**; attempting to `link` or `set` a derived slot is rejected.

Each object type's schema declares, for every derived slot: its address path, its dependencies, and its compute function. Dependencies may be declared **statically** (a fixed list of paths within the same object, e.g. `centroid` ← `vertices`) or **dynamically** (a function of the object's current state). Two cases require the dynamic form and you must support it:

- `text_1.resolvedContent` depends on whatever slots its parsed block tree happens to reference, which changes whenever `content` is edited.
- `script_1.out.*` depends on all of that node's currently declared `in.*` slots, which change as the user adds ports.

Dynamic dependency functions are evaluated during edge derivation (step 3 below), never during evaluation — so Rule 6 holds.

#### Value types

Keep the runtime value union small and explicit:

```
Value = number | string | boolean | Point | Point[] | null | ErrorValue
ErrorValue = { error: "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT", message: string }
```

There is deliberately no `#CYCLE` value: cycles are rejected at mutation time and never enter the graph as state.

`Point` and `Point[]` exist so objects can pass geometry to each other, but the formula language has no indexing or vector arithmetic in v1 — using one in an arithmetic expression yields `#TYPE`. Formulas should read scalar components (`polygon_1.centroid.x`), not aggregates.

Errors **propagate**: any formula reading an error slot yields an error. Errors must never throw across the evaluation loop — a broken formula shows an error badge on its object and leaves the rest of the graph working. **An `ErrorValue` in the graph is legitimate state, not a reason to reject a mutation.**

#### Edges

An **Edge** is `sourceSlot → dependentSlot`. Users never create edges by hand; edges are always *derived* from a formula AST or a schema declaration. Re-derive them; never hand-maintain them.

#### The mutation → evaluation loop (transactional)

Every mutation follows this exact sequence:

1. **Stage.** Deep-clone the current document state (Rule 5).
2. **Apply** the mutation to the clone. This includes any slot-set changes (adding/removing table rows, exploding a preset) and any **reference adjustment** (§5.4).
3. **Re-derive ALL edges** from stored formula ASTs and schema declarations (static and dynamic). Per Rule 5, rebuild the whole edge set rather than tracking which slots were affected.
4. **Validate integrity.** Reject if any formula references a slot that does not exist, or if the mutation would delete a slot that still has inbound dependents without repairing them (§5.1.1).
5. **Validate acyclicity.** Full DFS over the whole graph. Reject on cycle, naming every slot in the cycle.
6. **On rejection:** discard the clone entirely and return a failure with a human-readable message. Prior state is untouched — nothing was ever applied to it.
7. **Evaluate.** Topologically sort all slots and evaluate every one: literals return their stored value, formulas evaluate their AST, derived slots call their schema compute function. Evaluation errors produce `ErrorValue`s; they do **not** roll back the mutation.
8. **Commit.** Swap the clone in as current state, append the mutation to the journal, notify the renderer.

#### Batch mutations (required)

The API must accept a **list** of operations applied to a single clone, validated and evaluated once, committing all-or-nothing. Without this, loading a 200-object document means 200 full clones and 200 full evaluations, which will be visibly slow even at this scale. Document loading MUST use a batch. Dragging and multi-step commands should too.

#### Evaluation context

Evaluation needs injected services (currently just the `TextMeasurer`). Pass an `EvalContext` object down through evaluation rather than reaching for module-level globals — this keeps Rule 1 intact and keeps tests trivial.

#### 5.1.1 Slot deletion rule — GENERAL, not per-command

The invariant being protected is narrow and absolute: **an edge must never point at a slot that no longer exists.** A dangling edge corrupts the topological sort. There are exactly two legal ways to remove a slot that has dependents:

**(1) Reject** — the default. The mutation fails with a message naming every dependent; the user unlinks first and retries. This applies to `delete <object>`, `explode`, and `delvertex`, which are destructive structural operations where a silent break would go unnoticed.

**(2) Repair** — permitted only where the mutation defines a reference-repair pass that *rewrites* every inbound reference into a `#REF` error node in the referring AST. This removes the edge cleanly rather than orphaning it, so the invariant holds. **Table row/column deletion uses this path**, because `#REF` is the established spreadsheet idiom and rejecting every row deletion that anything reads would make tables unusable. The command must report which slots were broken.

Both destructive commands accept a `force` flag (`delete intersection_a force`, `explode polygon_1 force`) that opts into repair semantics instead of rejection.

**Never a third option:** do not silently drop edges, and do not leave a reference pointing at a removed slot.

Provide a `refs <object|slot>` command (§5.10) so the user can see what points at something before deleting it. Without that, rule (1) is merely annoying; with it, it is workable.

### 5.2 Addressing (`address.ts`)

Two-layer scheme — this is what lets a user rename an object without breaking every formula pointing at it.

- **Identity layer**: every object has an opaque, stable, never-reused ID (`obj_1`, `obj_2`, …). All internal references, edges, and serialized links use IDs.
- **Naming layer**: every object has a unique, user-facing, mutable name (`table_x`, `polygon_1`, `intersection_a`). Formulas and commands are written against names. A resolver maps name → ID **at parse time**; **stored ASTs hold IDs, not names.** Renaming therefore requires zero formula rewriting, and displaying a formula maps IDs back to current names.

An address is `{ objectId: string, path: string[] }`. Examples:

| Written by user | Resolves to |
| --- | --- |
| `table_x.A1` | `{ objectId: "obj_3", path: ["cells", "A1"] }` |
| `polygon_1.origin.x` | `{ objectId: "obj_7", path: ["origin", "x"] }` |
| `polygon_1.centroid.x` | `{ objectId: "obj_7", path: ["centroid", "x"] }` (derived, read-only) |
| `script_2.out.result` | `{ objectId: "obj_9", path: ["out", "result"] }` |
| `script_2.in.speed` | `{ objectId: "obj_9", path: ["in", "speed"] }` |

Provide `formatAddress` / `parseAddress` helpers and use them everywhere. Never build address strings ad hoc.

**Naming rules:** unique across the document, case-insensitive for lookup, `[a-zA-Z_][a-zA-Z0-9_]*`. Auto-generate defaults on creation (`polygon_1`, `polygon_2`, …). Reject rename to an existing name.

### 5.3 Formula engine (`formula/`)

A small, hand-written expression language shared by table cells and text.

**Lexer → recursive-descent (or Pratt) parser → AST → evaluator.** Keep those four stages genuinely separate; the AST is the interchange format.

**Grammar (v1):**
- Literals: numbers (`3`, `1.5`, `-2`), strings (`"hello"`, double quotes, `\"` escape), booleans (`TRUE`, `FALSE`)
- References: `name.path.path` resolving via §5.2, plus **bare cell refs** (`A1`) which are legal **only inside a table cell formula** and mean "this table, that cell." Bare refs in text formulas are a parse error.
- Operators, loosest to tightest: `OR` → `AND` → comparison (`=`, `<>`, `<`, `>`, `<=`, `>=`) → `+ -` → `* / %` → `^` → unary `-` / `NOT` → parens/calls
- Function calls: `NAME(arg, arg, ...)`
- **No loops. No user-defined functions. No recursion.** Guaranteed termination.

**Built-ins (v1 minimum):** `IF`, `AND`, `OR`, `NOT`, `SUM`, `MIN`, `MAX`, `AVG`, `ABS`, `ROUND(n, digits)`, `FLOOR`, `CEIL`, `SQRT`, `POW`, `CONCAT`, `LEN`, `PI()`, `SIN`, `COS`, `TAN`, `ATAN2`, `DEG`, `RAD`. Make the registry table-driven in `functions.ts` (name → arity → implementation) so adding one is a single line.

#### Eager total dependency extraction vs. lazy short-circuit evaluation

This distinction is deliberate and must be implemented exactly as stated, because getting it backwards breaks reactivity in a way that is very hard to debug:

- **`extractDependencies(ast)` is EAGER and TOTAL.** It walks the entire AST and returns every address it *could* read, including both branches of every `IF` and every branch of every text conditional. This is not a bug and does not need "fixing." You cannot know which branch is live without evaluating, and which branch is live changes constantly — so the graph must subscribe to all of them, or the object will fail to update when the condition flips.
- **`evaluate(ast)` is LAZY and SHORT-CIRCUITS.** `IF` evaluates only the taken branch. `AND`/`OR` short-circuit. A runtime error (division by zero, reading an error value) in an *untaken* branch therefore never occurs and never surfaces.
- **A cycle discovered in an untaken branch is a REAL cycle and MUST be rejected.** It is not a false positive. It would detonate the instant the condition flips; rejecting it at authoring time is the safe behaviour.
- **An unresolvable reference is a PARSE-time error regardless of branch**, because names are resolved to IDs at parse time. A formula naming a nonexistent object fails to parse whether or not that branch would ever execute.

Write `extractDependencies` once, in `formula/deps.ts`, and use it for cell formulas, text formulas, and bindings identically.

#### Ranges

Support `A1:B4` **only** as an argument to an aggregate function (`SUM`, `MIN`, `MAX`, `AVG`). A range is not a first-class value in v1.

- **Store a range in the AST as an endpoint pair**, never as a pre-expanded list of cells.
- **Expand to concrete slot dependencies at edge-derivation time** (step 3 of the mutation loop), which runs on every mutation. Expansion is therefore always re-derived from current table dimensions and can never go stale.
- A self-inclusive range (`A6 = SUM(A1:A6)`) produces a genuine self-edge and is correctly rejected as a cycle. This is right; do not special-case it.

### 5.4 Table / spreadsheet primitive

A **self-contained grid**, not a global sheet. Multiple independent tables live on the canvas and can reference each other — `table_a.B2` can read `table_b.C3` — without being regions of one giant sheet. This is a core concept, not an implementation detail.

- Default 8×8; rows and columns can be added or removed.
- A1-style addressing scoped to the table. Optional header row (display only in v1).
- Each cell is a slot, `literal` or `formula`.
- Because slots are graph nodes, intra-table and inter-table dependencies use the *same* mechanism. Do not write a special-case intra-table evaluator.

#### Reference adjustment on resize (required)

Inserting or deleting rows/columns changes what `A1` means. At step 2 of the mutation loop, run an **Excel-style reference-adjustment pass over every stored AST in the document** (not just the resized table's own formulas — other tables and text boxes may point into it):

- References at or after an insertion point shift by one.
- Range endpoints shift; a range that spans an insertion point **widens** to include the new row/column.
- A reference to a **deleted** row/column becomes a `#REF` error stored in the AST at that position.
- A range whose endpoint was deleted clamps to the remaining extent; a range deleted entirely becomes `#REF`.

**Row/column deletion takes the repair path of §5.1.1, not the rejection path.** It proceeds even when other objects depend on the deleted cells, rewriting each inbound reference to `#REF` — including references from *other* tables and from text boxes. The command reports every slot it broke. This is the one place in the system where a deletion is allowed to invalidate someone else's formula, and it is allowed because `#REF` is the expected spreadsheet idiom and the repair keeps the edge set consistent.

**Rendering:** fixed-size cells, grid lines, numbers right-aligned and strings left-aligned. Formula bar / in-place editing for the selected cell.

### 5.5 Geometry primitive

**The primitive is the geometry itself. Named shapes are presets over it, decomposable at any time.**

```
Path {
  vertices: Point[]          // see slot exposure below
  segments: Segment[]
  closed: boolean
  style: { strokeColor, strokeWidth, fillColor | null }
}

Segment = { type: "line" }
        | { type: "arc", bulge: number }
        | { type: "bezier", c1: Point, c2: Point }
```

#### How vertices are exposed as slots (respects Rule 6)

Variable-length vertex lists must never change cardinality during evaluation. Therefore:

- **Preset shapes** (polygon, circle, rect) expose a **single derived slot `vertices`** holding a `Point[]`, computed from their parameter slots. They expose **no per-vertex slots.** Changing `sides` from 5 to 6 changes a *value*, not the slot set — Rule 6 preserved.
- **Editable paths** (polyline, or any exploded preset) expose **per-vertex literal slots** `vertex.0.x`, `vertex.0.y`, … *and* a derived `vertices` slot aggregating them. Cardinality changes only via explicit `addvertex` / `delvertex` mutations, never during evaluation.
- **Consumers always read `vertices`**, so both cases present an identical interface downstream.

#### Presets

Constructors producing a parametric object that retains its inputs as live slots:

- `polygon(sides, radius, origin, rotation)` — slots `sides`, `radius`, `origin.x`, `origin.y`, `rotation`
- `circle(origin, radius)` — slots `origin.x`, `origin.y`, `radius`
- `polyline(points[])` — editable path, per-vertex literal slots
- `rect(origin, width, height)`

#### Explode

Converts a preset into an editable path (an object-type change, so the schema swaps too): `vertices` is snapshotted into literal per-vertex slots, and the parameter slots (`sides`, `radius`, `rotation`) are **deleted** — so **§5.1.1 rejection applies** unless `force` is passed. If anything still reads `polygon_1.radius`, explode fails and names the dependents.

Note that `vertices` **survives** explode: it remains a derived slot, merely re-sourced from the new literal vertex slots instead of from the parameters. Anything downstream reading `vertices` is therefore unaffected — which is the payoff for the uniform consumer interface above. One-way; no re-parameterization.

For `circle`, the derived `vertices` slot yields a polygonal approximation used for bounds and hit-testing; the renderer still draws a true arc.

#### Derived slots

`centroid.x`, `centroid.y`, `area` (closed paths only), `length`, `bounds.{minX,minY,maxX,maxY}`. All `derived` kind: readable by formulas, **not writable**, participating in the topological pass. Binding *to* one is rejected at parse time.

### 5.6 Text primitive

**One text object type, not two.** Complexity scales gracefully — plain by default, formatted if you use markdown, computed if you use formula syntax. Do not create separate "simple text" and "rich text" classes.

```
TextBox {
  content: string             // literal slot: raw source including markup
  width: number | "auto"
  height: number | "auto"
  overflow: "visible" | "clip" | "ellipsis"
  style: { font, fontSize, lineHeight, color, align }
}
```

Any style field may be a formula slot bound elsewhere (e.g. `fontSize` reading a cell).

**Markdown-lite** — support exactly this and nothing more: `**bold**`, `*italic*`, `` `code` ``, `# heading` (levels 1–3), `- list item`, blank-line paragraph breaks. **No** tables, images, links, blockquotes, or nested lists.

**Embedded formula syntax** — text is literal by default; computation is opt-in:

```
{= expression }                     evaluate and insert the result
{? condition } ... {:} ... {?}      conditional block, {:} is the optional else
```

Conditionals **must nest**. Example:

```
Radius is {= table_x.A1 * 2 } units.

{? script_1.out.result > 1 }
  **Status: PASS** — value {= script_1.out.result }
{:}
  {? script_1.out.result > 0.5 }
    **Status: MARGINAL**
  {:}
    **Status: FAIL**
  {?}
{?}
```

Parse `content` into a block tree:

```
Block = { type: "text", value: string }
      | { type: "formula", ast: FormulaAST }
      | { type: "conditional", condition: FormulaAST, trueBranch: Block[], falseBranch: Block[] }
```

Write a text-specific dependency walker that recurses the block tree and calls `formula/deps.ts` on every embedded AST — **including untaken branches**, per §5.3. Evaluation of the tree short-circuits normally.

**Derived slots:** `resolvedContent` (from `content` plus every referenced slot) and `measuredHeight` (from `resolvedContent`, `width`, and `style`, computed via the injected `TextMeasurer`). Both read-only and evaluated in the topological pass. This makes `= text_1.measuredHeight` legal in a formula and correctly ordered.

**Layout:** fixed width + auto height (wrap, grow down) is the default. Fixed width + fixed height applies `overflow`. Auto width + auto height means no wrapping.

### 5.7 Image primitive

Lowest priority; keep it minimal. Load via file picker, store as a data URL in the document (acceptable at this scale), draw at a position with width/height, preserve aspect ratio by default. Slots: `origin.x`, `origin.y`, `width`, `height`, `opacity`.

### 5.8 Script node — **STUB ONLY**

Build the node as a **real, first-class graph citizen** whose execution is fake. The eventual design (documented so the stub's shape is correct) is a persistent local Python interpreter, warm but stateless — the process stays alive for speed, but each graph-script run gets a **fresh namespace**, because reusing globals between runs would silently destroy the purity guarantee the safety model rests on.

**Ports are ordinary slots.** Do not invent a parallel addressing mechanism:

- `in.<port>` is a normal **formula** slot (a binding to some upstream address), addressed as `script_1.in.speed`, created and removed by explicit mutations.
- `out.<port>` is a normal **derived** slot, addressed as `script_1.out.result`, whose schema declares its inputs as *all* of the node's `in.*` slots and whose compute function is the stub below.
- `source` is a literal slot holding the user's code. It is **stored and never executed**, and it is **not** an input to any derived slot — editing it must not trigger recomputation, because nothing reads it.

```
ScriptNode {
  language: "python"                            // fixed for now
  source: string                                // literal slot; stored, never executed
  in:  Record<string, Slot>                     // formula slots (bindings)
  out: Record<string, Slot>                     // derived slots
  placeholders: Record<string, Value>           // stub output values, user-editable
}
```

Ports are declared manually in the UI for now. In the real system, inputs are discovered at runtime by instrumented proxies that log every read, and outputs come from the script's `return` dict — do not attempt either now.

**The execution function is a one-function seam:**

```typescript
// engine/script/stub.ts
export function evaluateScriptOutput(
  node: ScriptNode,
  portName: string,
  inputs: Record<string, Value>,
): Value {
  // TODO: dispatch to persistent Python interpreter over IPC.
  // Warm-but-stateless: fresh namespace per graph-script execution.
  // For now: return the user-set placeholder for this output port.
  return node.placeholders[portName] ?? null;
}
```

When Python lands, only this body changes. **No script-specific logic may leak into `eval.ts`** — from the evaluator's perspective this is just another derived slot.

Render as a labelled box with input ports on the left and output ports on the right.

### 5.9 Renderer, camera, hit-testing (`render/`)

**Immediate mode.** Every invalidation: clear, apply camera transform, draw every visible object in z-order. No retained scene graph, no diffing.

- **Camera**: pan (middle-drag or space-drag), zoom to cursor (wheel), `world → screen` and `screen → world`. All object coordinates are world coordinates; the camera is the only thing that knows about screen space.
- **Hit-testing**: `screen point → topmost object`. Point-in-polygon for fills, distance-to-segment with pixel tolerance for strokes and open paths, bounding box for text/tables/images/scripts.
- **Interaction**: click to select, drag to move, escape to deselect. **Dragging calls the mutation API** — it never writes object state directly (Rule 2).

#### Dragging is per-component, not all-or-nothing

A drag writes to `origin.x` and `origin.y` independently. For each component:

- If the slot is `literal`, write the new value.
- If the slot is `formula` or `derived`, **skip that component** and show non-blocking feedback (e.g. "x is driven by `table_x.A1`").

So dragging an object whose `x` is bound and whose `y` is literal slides it vertically only — constrained-axis dragging falls out for free, and the single-source-of-truth rule stays intact without making bound objects feel dead. Only when *every* component is driven does the drag do nothing.

**Objects with no `origin` slot** (editable paths, after `polyline` or `explode`) are dragged by applying the delta to every `vertex.N.x` / `vertex.N.y` slot, under the same per-component rule — vertices bound to something else stay put while the rest move. This is intentional: in the Phase 7 road network, a polyline whose endpoints are bound to two intersections cannot be dragged away from them, which is exactly right.

**Drag performance note:** a drag fires many mutations per second, and each one deep-clones the document (Rule 5). If that becomes visibly laggy, throttle drag mutations to animation frames and draw a lightweight preview between them — **do not** work around it by writing state outside the mutation API.

- **Visual feedback**: selection highlight, error badge on objects holding `ErrorValue`s, and a subtle indicator on slots that are formula-driven rather than literal.

### 5.10 Command line (`command/`)

AutoCAD-style: a persistent input bar at the bottom, **always focused when the user is not editing text or a cell**. Minimal UI chrome elsewhere — no panels, no toolbars.

```
circle x=100 y=100 r=20
polygon sides=5 x=0 y=0 r=50
polyline 0,0 100,0 100,100
rect x=0 y=0 w=200 h=100
text x=0 y=0 "Hello {= table_x.A1 }"
table x=0 y=0 rows=8 cols=8
script x=0 y=0
image x=0 y=0

link polygon_1.origin.x table_x.A1     # make first slot a formula reading the second
unlink polygon_1.origin.x              # revert to literal, keeping last computed value
set polygon_1.radius 42
rename polygon_1 intersection_a
delete intersection_a [force]           # force = repair dependents to #REF instead of rejecting
explode polygon_1 [force]
addvertex polyline_1 100,100
delvertex polyline_1 2

refs intersection_a                     # list inbound dependents — check before deleting
list                                    # dump all objects and names
select intersection_a
pan / zoom <factor> / fit
save / load
```

Table-driven parser; adding a command is one registry entry. Echo results and errors in a small scrolling log above the input. **Every rejection message must name the specific slots involved** — that is the entire debugging story for now.

### 5.11 Document format (`document.ts`)

Versioned JSON with a top-level `formatVersion` integer **from the first commit**. Contains: format version, object list (ID, type, name, slot kinds and values, stored ASTs, style), the mutation journal, and camera state. **Derived slot values are never serialized** — they are regenerated by a full evaluation pass on load.

Loading applies objects through the mutation API and then evaluates. Save via JSON download; load via file input. Do not build a file manager.

---

## 6. Build order

Each phase has an acceptance criterion. **Do not start a phase before its predecessor's criterion passes.**

### Phase 0 — Graph core (headless, no pixels)
Build `address.ts`, `graph/*`, `primitives/schema.ts`, `mutation.ts`, `document.ts`. Test with a trivial `value` object (one literal numeric slot) and an `add` object (two formula input slots, one **derived** output slot) — the `add` node exercises the derived-slot mechanism that geometry, text, and scripts all rely on.

✅ **Done when:** you can build a graph in a unit test, bind slots, mutate a value and watch it propagate in correct topological order *including through derived slots*; a cycle is rejected with the offending slots named **and prior state is provably unchanged**; deleting a slot with dependents is rejected; and a document round-trips to JSON and back identically.

### Phase 1 — Formula engine
`formula/*`, standalone and heavily unit-tested. `extractDependencies` from the start.

✅ **Done when:** tests cover literals, operator precedence, nested `IF`, every built-in, reference resolution, ranges in aggregates, and error propagation — plus explicit tests that dependency extraction is **total across both `IF` branches** while evaluation **short-circuits**, and that malformed input yields `#PARSE` rather than throwing.

### Phase 2 — Table primitive
Wire the formula engine into cell slots. Add reference adjustment. Still headless.

✅ **Done when:** two separate tables exist; `table_a.B2` holds `= table_b.C3 * 2` and updates live; a circular reference between them is rejected; `SUM(A1:A5)` recomputes correctly after inserting a row inside the range; and deleting a row whose cells have external dependents rewrites those references to `#REF` (repair path) rather than leaving a dangling edge, while `delete <table>` on that same table is *rejected* (rejection path) until `force` is passed.

### Phase 3 — Canvas, camera, geometry, command line
First pixels. Renderer, camera, hit-testing, drag interaction, command line, geometry primitive and presets. Render tables too.

✅ **Done when:** you can create a polygon and a table by command, see both drawn, pan/zoom, select, and drag the polygon.

### Phase 4 — **The validation moment: cross-object linking**
This is where the core thesis is proved. Note it requires **two separate polygons** — one polygon cannot satisfy both directions, because a bound `origin.x` is by definition not draggable:

- **(a) Data drives geometry.** `polygon_a.origin.x` is a formula slot reading `table_x.A1`. Typing a new number in that cell visibly moves `polygon_a`.
- **(b) Geometry drives data.** `polygon_b.origin.x` is a **literal** slot. `table_x.B1` holds `= polygon_b.origin.x * 2`. Dragging `polygon_b` on canvas updates that cell live.
- **(c) Partial binding.** Dragging `polygon_a` slides it in Y only, with feedback that X is driven, per §5.9.

✅ **Done when:** all three hold simultaneously in one document, with no false cycle.

### Phase 5 — Text primitive
Text object, markdown-lite, `{= }` and `{? }{:}{?}` with nesting, layout via the injected measurer, `resolvedContent` and `measuredHeight` as derived slots.

✅ **Done when:** a text box reading `Radius: {= table_x.A1 }{? table_x.A1 > 50 } — **LARGE**{:} — small{?}` updates both its number and its branch as the cell changes, wraps at its set width, **and re-renders when a value referenced only inside the currently non-taken branch changes.**

### Phase 6 — Script stub + image
Both small. Ports must be ordinary slots.

✅ **Done when:** `script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to `script_1.out.result`, and changing the placeholder output value moves the polygon — with no script-specific code in `eval.ts`.

### Phase 7 — Acceptance test: the road network
Build by hand from primitives, via the command line. No new features should be needed — if something is impossible here, that is a real gap worth fixing.

✅ **Done when:** two circles act as intersections; a polyline's endpoints are bound to the two circles' centers; two text boxes read traffic volumes from a table and are positioned relative to their intersection's center; and **dragging either intersection keeps the road connected and both labels following**, while editing the volumes updates the label text.

---

## 7. Suggested first-session order of work

1. `package.json`, `tsconfig.json` (strict), `vite.config.ts`, `index.html`, test runner.
2. `address.ts` with tests — the load-bearing piece.
3. `graph/node.ts` + `graph/edge.ts` data model, including the three slot kinds.
4. `primitives/schema.ts` — the derived-slot declaration mechanism.
5. `graph/cycles.ts` (naive DFS) + `graph/eval.ts` (naive full topological re-eval over all three slot kinds).
6. `mutation.ts` with clone/validate/commit and the journal.
7. `document.ts` round-trip test.

Stop and confirm Phase 0's acceptance criterion before touching anything visual.

---

## 8. Explicitly deferred — DO NOT BUILD

Each was considered and consciously postponed.

- **Python execution of any kind.** Script nodes are stubs (§5.8).
- **Compound objects / containers / "minions."** The design (a container = a base-logic script defining internal relationships + an exposed interface, with a soft non-clipping boundary) depends on real scripts, so it is postponed. Phase 7 is hand-wired instead. Do not invent a substitute grouping system.
- **Undo/redo UI.** Journal the mutations; build no UI.
- **Drag-through-to-source** (dragging a bound object writing to its upstream literal). Tempting, but undefined when upstream is itself a formula. Deferred deliberately; §5.9's per-component rule is the v1 behaviour.
- **Multiple viewports.** Single canvas; off-screen is simply off-screen.
- **64-bit precision / floating-origin.** Plain JS numbers are fine at this scale.
- **Constraint solving.** Cycles are rejected, never solved. Non-negotiable.
- **Collaboration / CRDTs.**
- **Script libraries, export/bundling, DXF or other interchange formats.**
- **WebGPU, Rust, Tauri.** Later stack; only the module boundaries anticipate it.
- **Command-language gold-plating.** Add commands as needed, one registry entry each.

---

## 9. If you have to make a call

Where this document is silent, prefer, in order: (1) whatever keeps `engine/` free of DOM dependencies; (2) whatever keeps graph state plain and serializable; (3) whatever preserves Rule 6; (4) whatever is simplest to delete later.

The renderer is expected to be thrown away and rewritten on GPU; the engine is expected to survive and be ported to Rust. Invest accordingly.
