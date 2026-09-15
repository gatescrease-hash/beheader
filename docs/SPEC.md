# SPEC - Graphpaper

This document defines the product. It says what the program must do and why.
It does not say what the code does today. `STATUS.md` says that.

---

## 1. The idea

Graphpaper is a keyboard driven spatial canvas. Every object on the canvas is a
live node in one shared dependency graph.

Geometry, text, tables, images, equations and script nodes are not separate
tools. They are all citizens of the same reactive system. They wire to each other:

- A polygon origin can read cell `A1` of a table. Type a new number in that cell
  and the polygon moves.
- A cell can hold `= polygon_1.origin.x * 2`. The cell reads a live value back
  out of the geometry.
- A text box can hold `The radius is {= table_x.A1 * 2 } units.` The text box
  redraws when that cell changes.
- Drag a circle. A text label bound to its center follows it. A polyline bound
  to its center redraws.

The program is not a CAD tool, not a spreadsheet and not a node graph editor. It
takes one idea from each:

- **AutoCAD** gives the always active command line and the small amount of
  screen furniture. A shape is a parametric path. A pentagon is not a special
  type. It is a preset over the polygon primitive.
- **Excel** gives the formula engine with references, math and conditionals.
- **Dynamo and Houdini** give the script node. A script node sits in the graph as
  an opaque box with visible input and output ports.

The goal is a substrate. An operator must be able to assemble small, live,
data driven machines from a few good primitives plus wiring.

### The philosophy

Keep the core simple and safe. Push complexity to the edges.

- The dependency graph is a strict directed acyclic graph. Each value has one
  source. The program finds a cycle and refuses it. The program never solves a
  cycle.
- The core holds no constraint solver. Hard problems go into a script node or a
  math object, and the graph treats each of those as an opaque box. A solver
  inside one box never reaches across the graph, so the rule above holds
  whatever a box does inside itself.
- The formula language is not Turing complete. It has expressions and nested
  conditionals. It has no loops and no recursion. It always stops.

---

## 2. Stack

| Item | Choice |
| --- | --- |
| Language | TypeScript, strict mode |
| Runtime | Browser, one process |
| Build tool | Vite |
| Drawing | Canvas2D, immediate mode |
| Runtime dependencies | One, MathLive, for mathematical notation. See section 12. |
| Python scripts | Not built. A stub node stands in. See section 11. |
| Storage | Versioned JSON. Save by download. Load by file input. |

**Why Canvas2D and not SVG.** Immediate mode redraw maps onto the loop
"evaluate the graph, then paint the world". SVG keeps retained DOM nodes. Those
nodes tempt a writer to put drawing state back into the data model. That is the
exact coupling this design avoids.

**The planned future stack.** A Rust engine core, a Tauri shell, a
TypeScript and WebGPU front end, and a local Python interpreter as a subprocess.
The migration plan and work register are in [RUST_PORT.md](RUST_PORT.md).
That document plans the engine port without starting the deferred implementation.
Do not implement the future stack yet. The shape of `src/engine/` matches a one to one port target for a
future Rust crate. Two rules come out of that:

1. Store IDs, not object references. The graph must never use JavaScript object
   identity to hold a relationship.
2. Keep graph state plain and serializable. Behaviour lives in functions that
   read that data, not attached to it.

---

## 3. Hard rules

### Rule 1. `src/engine/` is pure logic

The engine must not touch the DOM, `window`, `document` or a canvas. It must not
import from `src/render/`. A headless test must be able to drive all of it.

This rule has one trap: text measurement. Text layout needs glyph widths, and a
glyph width normally needs a canvas. Do not reach for a canvas inside the engine.
Instead:

- The engine declares a `TextMeasurer` interface.
- The engine gets an implementation through the evaluation context.
- `src/render/` supplies the real Canvas2D implementation. `main.ts` wires it in.
- A test supplies a fake measurer with fixed widths.

### Rule 2. All state change goes through `mutation.ts`

No other code writes graph state. The command line calls a mutation. A drag calls
a mutation. A document load calls a mutation. A mutation either commits in full
or leaves the old state untouched. The mutation API keeps an append only journal
from the first commit, so undo can arrive later.

### Rule 3. The address scheme is heavily relied upon

Formulas, bindings, script ports, storage and the command line all depend on it.
A change to it touches everything. See section 5.

### Rule 4. One formula engine

Table cells and text share one parser and one evaluator. Do not write a second
expression evaluator for text. Only the syntax around it differs.

The math object of section 12 holds a second language, and it is not an
exception to this rule. Mathematical notation reaches the graph through a
compute function on a derived slot, the same way a script node does, so no part
of it is a second evaluator for a cell or for a text box.

### Rule 5. Speed is not a goal

Write the simplest correct code:

- Cycle detection runs a full depth first search on every mutation.
- Evaluation recomputes the whole graph in topological order on every mutation.
- A transaction deep clones the document, applies to the clone, and swaps the
  clone in on success.

At a few hundred objects this is fast enough and it is easy to prove correct.

### Rule 6. Evaluation never changes the slot set

Evaluation never creates or destroys a slot. Only a mutation changes which slots
exist. This rule makes the simple topological pass safe. Several designs below
have their shape because of it.

### Rule 7. Do not build the items in section 17

---

## 4. The graph model

The graph is over slots, not over objects.

**Why.** With an object level graph, the chain
`table_x.A1 -> polygon_1.origin.x -> table_x.B1` reads as
`table -> polygon -> table`. The program refuses it as a false cycle. Slot
level granularity gives exact cycle detection and exact evaluation order.

### Objects and slots

An **object** is a thing on the canvas. It has a stable ID, a type, a name that
the operator can change, and a set of slots.

A **slot** is one addressable value on an object, such as `origin.x`, `radius`,
`cells.A1` or `out.result`. Slots are the nodes of the graph.

### The three slot kinds

| Kind | Value source | Operator can write | Has inbound edges |
| --- | --- | --- | --- |
| `literal` | a stored constant | yes | no |
| `formula` | a stored AST | yes, by an edit to the formula | yes, from `extractDependencies` |
| `derived` | a compute function in the schema | no, read only | yes, from the schema |

A derived slot is a full graph node. The topological pass evaluates it like a
formula slot. `polygon_1.centroid.x`, `text_1.measuredHeight` and
`script_1.out.result` are all derived slots, and a formula elsewhere can read
them.

**There is no second pass after evaluation.** If derived values came from a
later `recompute()` step, every formula that reads one gets the value from
the last propagation. It stays one step behind forever.

`literal` and `formula` swap at runtime. The schema declares the default kind.
`link` turns a literal slot into a formula slot. `unlink` turns it back.
`derived` never changes. A `link` or a `set` on a derived slot fails.

For each derived slot the schema declares the path, the dependencies and the
compute function. Dependencies come in two forms:

- **Static.** A fixed list of paths inside the same object.
- **Dynamic.** A function of the current state of the object. Two cases need
  this form. `text_1.resolvedContent` depends on whatever slots its block tree
  names, and that set changes with every edit. `script_1.out.*` depends on the
  `in.*` ports that exist now, and the operator adds and removes those.

A dynamic dependency function runs at edge derivation time, never during
evaluation. That is what keeps Rule 6 true.

### Values

```
Value = number | string | boolean | Point | Point[] | null | ErrorValue
ErrorValue = { error: "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT" | "#MEASURE"
                    | "#MATH",
               message: string }
```

There is no `#CYCLE` value. The program refuses a cycle at mutation time, so a
cycle never becomes state.

`Point` and `Point[]` let objects pass geometry to each other. The formula
language has no indexing and no vector math. A point in an arithmetic expression
gives `#TYPE`. A formula must read a scalar part, such as
`polygon_1.centroid.x`.

Errors travel. A formula that reads an error slot gives an error. An error must
never throw across the evaluation loop. A broken formula shows an error badge on
its object and leaves the rest of the graph at work. **An error value is normal
state. It is not a reason to refuse a mutation.**

### Edges

An edge points from a source slot to a dependent slot. The operator never makes
an edge by hand. Every edge comes from a formula AST or from a schema. Rebuild
the edge set. Never keep it by hand.

### The mutation loop

Every mutation follows this sequence:

1. **Stage.** Deep clone the current document state.
2. **Apply.** Apply the operations to the clone. This covers changes to the slot set
   and the reference adjustment pass of section 8.
3. **Derive edges.** Rebuild the whole edge set from stored ASTs and from the
   schema.
4. **Check integrity.** Refuse if a formula names a slot that does not exist.
   Refuse if the mutation removes a slot that still has dependents and does not
   repair them.
5. **Check for cycles.** Run a full depth first search. Refuse on a cycle and
   name every slot in it.
6. **On refusal.** Throw the clone away. Return a failure with a message a
   person can read. The old state never changed.
7. **Evaluate.** Sort all slots in topological order and evaluate each one. An
   evaluation error makes an error value. It does not roll back the mutation.
8. **Commit.** Swap the clone in. Append the mutation to the journal. Tell the
   renderer.

### Batch mutations

The API must accept a list of operations against one clone. It validates and
evaluates once, and it commits all or nothing.

Without a batch, a load of 200 objects means 200 clones and 200 full
evaluations. A document load must use a batch. A drag and a multi step command
must use one too.

### The evaluation context

Evaluation needs injected services. Today there is one, the `TextMeasurer`. Pass
an `EvalContext` object down through evaluation. Do not reach for a module level
global. This keeps Rule 1 true and keeps tests simple.

### Slot deletion

The invariant is narrow and absolute. **An edge must never point at a slot that
does not exist.** A dangling edge corrupts the topological sort.

There are exactly two legal ways to remove a slot that has dependents:

**(1) Refuse.** This is the default. The mutation fails and the message names
every dependent. The operator unlinks first, then retries. This covers
`delete <object>`, `explode` and `delvertex`. Each one is a destructive
structural change, and a silent break goes unseen.

**(2) Repair.** This is legal only where the mutation defines a repair pass. The
pass rewrites every inbound reference into a `#REF` error node in the AST that
refers to it. That removes the edge cleanly. **Table row and column deletion uses this
path.** `#REF` is the normal spreadsheet idiom. A refusal on every row deletion
that something reads makes tables unusable. The command must report which
slots it broke.

There is never a third option. Do not drop an edge in silence. Do not leave a
reference that points at a slot that is gone.

Both destructive commands take a `force` flag. The flag opts into repair instead
of refusal.

A `refs <object|slot>` command lets the operator see what points at something
before a delete. Without it, option 1 is only an annoyance. With it, option 1
works.

---

## 5. Addresses

The scheme has two layers. This is what lets an operator rename an object
without a change to any formula.

- **Identity layer.** Every object has an opaque, stable ID that the program
  never reuses, such as `obj_1`. All internal references, edges and stored links
  use IDs.
- **Name layer.** Every object has a unique name that the operator can change,
  such as `table_x` or `intersection_a`. Formulas and commands use names.

A resolver maps a name to an ID at parse time. **A stored AST holds IDs, not
names.** So a rename needs no formula rewrite. To show a formula, the program
maps IDs back to current names.

An address is `{ objectId: string, path: string[] }`.

| The operator writes | It resolves to |
| --- | --- |
| `table_x.A1` | `{ objectId: "obj_3", path: ["cells", "A1"] }` |
| `polygon_1.origin.x` | `{ objectId: "obj_7", path: ["origin", "x"] }` |
| `script_2.out.result` | `{ objectId: "obj_9", path: ["out", "result"] }` |

Use `formatAddress` and `parseAddress` everywhere. Never build an address string
by hand.

**Name rules.** A name is unique across the document. Lookup ignores case. The
pattern is `[a-zA-Z_][a-zA-Z0-9_]*`. The program makes a default name at
creation, such as `polygon_1`. A rename to a name in use fails.

---

## 6. The formula language

A small expression language. Table cells and text share it.

The four stages are lexer, parser, AST and evaluator. Keep them separate. The
AST is the interchange format.

**Grammar:**

- Literals: numbers, strings in double quotes, `TRUE` and `FALSE`.
- References: `name.path.path`. Also a bare cell reference such as `A1`. A bare
  cell reference is legal only inside a table cell formula, where it means
  "this table, that cell". A bare reference in text is a parse error.
- Operators, from loosest to tightest: `OR`, `AND`, comparison
  (`=`, `<>`, `<`, `>`, `<=`, `>=`), `+` and `-`, `*` and `/` and `%`, `^`,
  unary `-` and `NOT`, then parentheses and calls.
- Function calls: `NAME(arg, arg)`.
- No loops. No operator defined functions. No recursion. The language always
  stops.

**Built in functions:** `IF`, `AND`, `OR`, `NOT`, `SUM`, `MIN`, `MAX`, `AVG`,
`ABS`, `ROUND`, `FLOOR`, `CEIL`, `SQRT`, `POW`, `CONCAT`, `LEN`, `PI`, `SIN`,
`COS`, `TAN`, `ATAN2`, `DEG`, `RAD`. The registry is a table. One line adds a
function.

### Eager dependencies against lazy evaluation

This split is deliberate. Reverse it and reactivity breaks in a way that is very
hard to debug.

- **`extractDependencies(ast)` is eager and total.** It walks the whole AST and
  returns every address the formula can read. That includes both branches of
  every `IF` and every branch of every text conditional. This is correct. You
  cannot know which branch is live without evaluation, and the live branch
  changes all the time. The graph must subscribe to all of them, or the object
  fails to update when the condition flips.
- **`evaluate(ast)` is lazy.** `IF` evaluates only the taken branch. `AND` and
  `OR` stop early. So a runtime error in a branch that nothing takes never
  happens and never shows.
- **A cycle in an untaken branch is a real cycle. The program must refuse it.**
  It detonates the moment the condition flips.
- **An unresolvable reference is a parse time error in any branch**, because the
  parser resolves names to IDs.

Write `extractDependencies` once. Use it for cell formulas, text formulas and
bindings without change.

### Ranges

`A1:B4` is legal only as an argument to `SUM`, `MIN`, `MAX` or `AVG`. A range is
not a value.

- Store a range in the AST as a pair of endpoints. Never store an expanded list.
- Expand a range to concrete slot dependencies at edge derivation time. That
  step runs on every mutation, so the expansion can never go stale.
- A self inclusive range such as `A6 = SUM(A1:A6)` makes a real self edge. The
  program refuses it as a cycle. That is right. Do not add a special case.

---

## 7. The table primitive

A table is a self contained grid, not a region of one global sheet. Many
independent tables live on the canvas. `table_a.B2` can read `table_b.C3`. This
is a core concept, not a detail.

- The default size is 8 by 8. Rows and columns can come and go.
- Cell addresses use the A1 style. Each one is local to its table.
- Each cell is a slot. It is `literal` or `formula`.
- Because slots are graph nodes, dependencies inside one table and dependencies
  across two tables use the same mechanism. Do not write a special evaluator for
  the inside case.

### Reference adjustment on resize

An insert or a delete changes what `A1` means. At step 2 of the mutation loop,
run an adjustment pass over **every stored AST in the document**. Other tables
and text boxes can point into this one.

- A reference at or after an insert point shifts by one.
- A range endpoint shifts. A range that spans an insert point widens.
- A reference to a deleted row or column becomes a `#REF` node in the AST.
- A range whose endpoint went away clamps to the extent that remains. A range
  that went away in full becomes `#REF`.

Row and column deletion takes the repair path of section 4, not the refusal
path. It proceeds even when other objects depend on the deleted cells. It
rewrites each inbound reference to `#REF` and reports every slot it broke. This
is the one place where a deletion can break another formula. It is legal here
because `#REF` is what a spreadsheet operator expects.

**Drawing.** Fixed size cells and grid lines. Numbers align right. Strings align
left. The selected cell edits in place.

---

## 8. The geometry primitive

The primitive is the path itself. A named shape is a preset over it, and the
operator can decompose a preset at any time.

```
Path {
  vertices: Point[]
  bulges: number[]     // one for each vertex, for the edge that leaves it
  handles: Point[][]   // two for each vertex, one pulling each way
  closed: boolean
  style: { strokeColor, strokeWidth, fillColor | null }
}
```

Every shape carries `style.strokeColor`, `style.strokeWidth` and
`style.fillColor`. Each one is an ordinary slot, so a formula can drive it and
a table cell can colour a shape. A `fillColor` of null paints no fill, which is
what a new shape carries. Only a closed shape fills.

An edge is straight, an arc, or a cubic bezier. Two handles make it a cubic.
One pulls out of the vertex it leaves, and the other pulls into the vertex it
reaches. Each is an offset from its own vertex. With both handles at 0, a bulge
makes the edge an arc. A bulge is the tangent of a quarter of the included
angle, the number a DXF file carries on a vertex record. Zero makes a straight
edge, 1 makes a half circle, and the sign gives the direction.

So a curve needs no extra vertex, and `vertices` holds only the points an
operator placed. Nothing anywhere cuts a curve into sample points.

An arc answers every measurement in closed form. A bezier answers its area,
its centroid and its box in closed form as well. Two answers about a bezier
have no closed form for anybody: its length, and the distance from a point to
it. Each of those refines one number until the number holds still. Neither
makes a vertex. The renderer draws a true arc and a true cubic.

### How vertices become slots

A variable length vertex list must never change size during evaluation. So:

- **A straight sided preset** (polygon, rect) has one derived slot `vertices`
  that holds a `Point[]`. It computes from the parameter slots. A preset has no
  per vertex slots. A change to `sides` from 5 to 6 changes a value, not the
  slot set. Rule 6 holds.
- **A circle has no `vertices` slot.** Its area, length, centroid and bounds
  each have a closed form from the origin and the radius. A point list can only
  approximate what those already give exactly.
- **An editable path** (a polyline, or a preset after `explode`) has per vertex
  literal slots `vertex.0.x`, `vertex.0.y`, `vertex.0.bulge` and so on. It also
  has a derived `vertices` slot that gathers the coordinates. The count changes
  only through an explicit `addvertex` or `delvertex` mutation.
- **A path with N vertices carries N bulges.** The last one belongs to the edge
  home to vertex 0. That edge draws only when `closed` is true, and the slot
  exists at every value of `closed`. So a formula can drive `closed` without a
  change to the slot set.
- **A consumer of a many sided shape always reads `vertices`.** A preset and an
  editable path look the same from downstream. A circle is the one shape with
  no such list, because it needs none.

### Presets

Each preset keeps its inputs as live slots:

- `polygon(sides, radius, origin, rotation)`
- `circle(origin, radius)`
- `polyline(points[])`, an editable path
- `rect(origin, width, height)`

### Explode

`explode` turns a preset into an editable path. The object type changes, so the
schema changes too. The program snapshots `vertices` into literal per vertex
slots and deletes the parameter slots. So the refusal path of section 4 applies
unless the operator passes `force`.

`vertices` survives an explode. It stays a derived slot and reads from the new
literal vertex slots. Anything downstream that reads `vertices` sees no break.
That is the payoff for the uniform consumer interface. An explode is one way.

A circle explodes into two vertices across its diameter, joined by two half
circles. That path is the same circle, to the last decimal. So an explode
loses nothing, and the operator gets an editable path.

### Derived slots

`centroid.x`, `centroid.y`, `area` (closed paths only), `length` and
`bounds.{minX,minY,maxX,maxY}`. All are `derived`. A formula can read them. No
formula can write them. A `link` to one fails at parse time.

---

## 9. The text primitive

There is one text object type, not two. Complexity scales with use. Text is
plain by default, formatted if the operator uses markdown, and computed if the
operator uses formula syntax. Do not make a separate rich text class.

```
TextBox {
  content: string
  width: number | "auto"
  height: number | "auto"
  style: { font, fontSize, lineHeight, color, align }
}
```

Any style field can become a formula slot bound elsewhere.

**Markdown lite.** Support exactly this and no more: `**bold**`, `*italic*`,
`` `code` ``, `# heading` at levels 1 to 3, `- list item`, and a blank line for
a paragraph break. No tables, images, links, quotes or nested lists.

**Formula syntax in text.** Text is literal by default. Computation is opt in:

```
{= expression }                     evaluate and insert the result
{? condition } ... {:} ... {?}      a conditional block, {:} is the else part
```

Conditionals must nest.

The program parses `content` into a block tree:

```
Block = { type: "text", value: string }
      | { type: "formula", ast: FormulaAst }
      | { type: "conditional", condition: FormulaAst,
          trueBranch: Block[], falseBranch: Block[] }
      | { type: "math", parsed: ParsedMath, inline: boolean }
```

The math block is the inline and the block form of section 12. That section
gives its syntax and says what it can and cannot do.

A text specific dependency walker recurses the block tree and calls
`extractDependencies` on every embedded AST. It includes untaken branches, per
section 6. Evaluation of the tree stops early as normal.

**Derived slots:** `resolvedContent`, `measuredHeight` and `measuredWidth`. None
of them accepts a write. All of them evaluate in the topological pass. So
`= text_1.measuredHeight` is a legal formula and the order is correct.

**Layout.** The default is a fixed width with an auto height. The text wraps and
the box grows down.

---

## 10. The image primitive

Keep it small. Load through a file picker. Store the picture as a data URL in
the document. Draw it at a position with a width and a height. Keep the aspect
ratio by default. Slots: `origin.x`, `origin.y`, `width`, `height`, `opacity`.

---

## 11. The script node

The node is a real graph citizen. Its execution is fake.

The eventual design is a local Python interpreter that stays warm but holds no
state. The process stays alive for speed. Each run gets a fresh namespace,
because reused globals destroy the purity that the safety model needs.

**Ports are ordinary slots.** Do not invent a second address mechanism.

- `in.<port>` is a normal formula slot, a binding to some upstream address. Its
  address is `script_1.in.speed`. An explicit mutation creates and removes it.
- `out.<port>` is a normal derived slot. Its address is `script_1.out.result`.
  Its schema declares all of the `in.*` slots of the node as inputs. Its compute
  function is the stub.
- `source` is a literal slot that holds the code of the operator. The program
  stores it and never runs it. It is not an input to any derived slot, so an
  edit to it must not trigger a recompute.

```
ScriptNode {
  language: "python"
  source: string
  in:  Record<string, Slot>
  out: Record<string, Slot>
  placeholders: Record<string, Value>
}
```

The operator declares ports by hand for now. In the real system, instrumented
proxies find the inputs at runtime and the outputs come from a `return` dict. Do
not try either now.

The execution function is a one function seam:

```typescript
export function evaluateScriptOutput(
  node: ScriptNode,
  portName: string,
  inputs: Record<string, Value>,
): Value {
  return node.placeholders[portName] ?? null;
}
```

When Python arrives, only this body changes. **Script logic must never leak
into `graph/eval.ts`.** To the evaluator this is one more derived slot.

Draw the node as a labelled box. Put input ports on the left and output ports on
the right.

---

## 12. The math object

A math object holds mathematics written the way mathematics is written. It takes
named numbers in, evaluates one or more equation lines over them, and hands every
value it defines back to the document as an ordinary slot.

This is a separate primitive and not a larger formula language. Mathematical
notation has binding forms, implicit multiplication, subscripts and calculus.
The formula language of section 6 has none of those, and it needs none of them,
because each one costs the property that keeps that language safe: it is small
enough to read in an afternoon and it always stops. Rule 4 keeps one expression
language for cells and for text, and a math object is not a third consumer of
that language. It is a second language behind a seam, which is the arrangement
section 11 already gives a script node.

```
MathObject {
  source: string                   // the equation lines, as the editor writes them
  display: "source" | "value" | "both"
  origin: { x, y }
  in:   Record<string, Slot>       // one for each free name the source reads
  out:  Record<string, Slot>       // one for each name the source defines
  seed: Record<string, number>     // the starting point for a solved unknown
}
```

### The box is opaque

`graph/eval.ts` sees input slots, output slots and a compute function. It never
sees an equation, a solver or a unit. Everything else in this section describes
what happens inside the box and at its surface, and none of it reaches the
evaluator. This is the same containment the script node gets, and it is what
lets the inside of the box use a solver while the document around it stays a
strict directed acyclic graph.

The seam is one function:

```typescript
export function evaluateMathObject(
  program: MathProgram,
  inputs: Record<string, number>,
  references: Record<string, number>,
  seeds: Record<string, number>,
): { exports: Record<string, Value> };
```

It takes the whole program and gives back every name that program defines,
rather than one export at a time, because a later line reads the value an
earlier line reached and a call for one export alone would evaluate the lines
above it again.

Only this body knows how an answer is reached. A hand written evaluator and a
library both satisfy it, so the choice between them is reversible without a
change anywhere else.

### The three forms

The same parse and the same layout routine serve all three. The form picks the
box and the baseline rule, and changes nothing else.

- **Standalone** is an object on the canvas with its own origin, the same kind of
  citizen as a table or a text box.
- **Block** is a math run alone on a line inside a text object. It lays out on a
  line of its own, centred across the width of the box.
- **Inline** is a math run inside a line of prose, with its baseline on the
  baseline of that line.

### Names

Section 6 splits a bare name from a dotted name inside a table cell, where a
bare `A1` means this table and a dotted name means the document. Notation cannot
take that split, because letters beside each other multiply there, so a name of
more than one letter is a product and `table_x.A1` reads as five names times a
cell. An address therefore arrives wrapped in a command of its own.

- A **bare name** is local to the object.
- `\gpref{table_x.A1}` is a document address. The lexer reads the whole of the
  braced part as one token, which multiplication cannot break apart, and it
  draws as upright monospace so it reads as a piece of the document rather than
  as letters.

The stored form of that command holds the ID of the object, as
`\gpref{obj_3.cells.A1}`, so a rename rewrites nothing. An operator writes and
reads the name instead: the command line and the editable field map a name to an
ID on the way in, and the drawn form maps the ID back to whatever name the
object carries now. That is the same round trip a formula already makes, and it
is why section 5 keeps two layers.

A source naming a slot the document does not carry is refused when it is
written, and deleting an object that a source reads is refused with the source
named, which is the refusal path of section 4 rather than a reference quietly
going nowhere.

A bare name that the source never defines is an input. On a standalone object it
becomes a literal slot such as `math_1.in.speed`, with a value the operator
types, and `link` binds it to any upstream address exactly as a script port does.
A text object has nowhere to hang a port, so a free bare name inside a text math
run is a parse error, and the writer wraps an address in the command instead.

A port the source has just named holds `null`, which is the member of the
`Value` union of section 4 that carries the absence of a value. A number in its
place would be read as an answer: `y = x + 1` would export 1 from an input
nobody typed, and `y = 1/x` would export a division by zero, which reads as a
fault in the arithmetic rather than as a port waiting for a value. An empty
port leaves its name out of the evaluation environment instead, so each line
that reads the name exports `"x" has no value here`, and that error names the
row an operator fills or the address `link` binds.

The error lands per line, so a source whose other lines read nothing but their
own arithmetic still exports numbers from them. A seed keeps its zero, because
zero there is the start of a search and the root nearest the origin rather than
the absence of a choice.

A line of the form `name = expression` defines a name, and that name becomes a
derived slot `math_1.out.x_ans`. The exports go under `out` rather than at the
top of the object because a bare export named `source`, `display` or `origin`
would collide with a slot the schema declares, and a name the operator types must
never shadow the schema.

A function definition such as `f(x) = x^2` makes no slot, because a slot holds a
value and the `Value` union of section 4 has no function member. Later lines in
the same object can call it.

An integral, a sum, a product and a function definition each bind a name over
their body. A bound name is neither an input nor an export. The `x` in
`integral from 2 to 8 of sin(x_input) dx` belongs to the integral, and
`x_input` is the input port.

### The slot set comes from the source, at mutation time

The mutation that writes `source` parses it, works out the port set, the export
set and the seed set, and adds or removes those slots in the same batch.

Evaluation reads `source` to work out what an export holds, and never to work
out which exports exist. The port lists on the object carry that, and a
mutation is the only thing that writes them. So the slot set of a math object
is fixed for the whole of an evaluation pass even though it came from text an
operator typed, which is Rule 6. It is the pairing section 4 already describes
for a port name and a port value: the integrity check needs every address a
derived slot declares to be a real slot the moment that slot exists.

A parse that fails leaves the slot set alone and fails the mutation, because a
half parsed source would otherwise take the export slots away from whatever reads
them on every keystroke.

### Solving

Section 17 postpones constraint solving for the document graph, and that stays
true. The program never solves across objects. Two math objects that define each
other in a circle are a cycle, and the cycle check refuses them the same as any
other cycle.

Inside one box the rule is different. A single math object may solve for an
unknown that its own lines constrain, because the whole solve begins and ends
inside one compute function and nothing outside the box can observe a step of it.
A line such as `\solve{x} x^2 + 3 = y` is therefore legal, where `y` is known
and `x` is the unknown the object solves for.

The unknown is written rather than worked out. Notation gives `x^2 + 3 = y` no
way to say which of its letters the line is about, and every free name of a
source is otherwise an input port, so a rule that picked the unknown out of the
rest would have to read the lines around this one and would change what this
line solves for when a line above it was edited. `\solve{x}` is the same shape
`\gpref{...}` already takes for the same reason: the lexer reads the braced
part whole, and a macro draws it as the word solve, the unknown, and a colon in
front of the equation.

The unknown is bound over the equation, so it takes an export slot and no input
port, and a later line reads the value the solve reached the way it reads any
other export. An equation that never reads the unknown it names constrains
nothing, and the mutation refuses it.

Four properties make a solve safe to run inside the evaluation pass:

1. **It is confined.** A solve reads the input ports and the lines of one object.
   It never reads a slot on another object mid solve, so no partial state escapes.
2. **It terminates.** The solve carries an iteration bound. Exhausting the bound
   gives an error value and never hangs the pass.
3. **It is deterministic.** The same inputs give the same answer. Evaluation runs
   in full on every mutation, so a solver seeded by chance would make a document
   change under a cursor that touched nothing.
4. **It gives one value.** An equation with several roots would otherwise leave a
   slot without a defined value.

Each exported math line has a limit of 1,000,000 expression evaluations shared
by its function calls, series, integral samples and solver samples. Exhaustion
gives that export a `#MATH` error, and an independent line still evaluates.
This deterministic work limit prevents nested bounded loops from multiplying
into a stalled frame. Series endpoints are safe integers, so their indices
advance exactly. The existing series and solver iteration limits also apply.

The fourth property needs a rule, and the rule is a seed. Each solved unknown
gets a literal slot `math_1.seed.x`, and the object returns the root nearest that
seed. The seed is an ordinary slot, so a formula can drive it and an operator can
sweep a root across a range. A solve that finds no root gives an error value.

The search is what makes those four properties hold. It reads the difference
between the two sides of the equation at the seed, then at rings of doubling
radius around it, and a ring whose two ends carry differences of opposite sign
holds a root that halving the ring finds. Both sides of the first such ring are
checked before either answer is taken, so the nearer root comes back, and a tie
breaks upward so the answer is the same on every pass. The rings and the
halvings are each a fixed count, which is the iteration bound. Exhausting the
rings gives an error value.

Two costs come with finding a root this way. A root the curve touches without
crossing is invisible to a sign change, and two roots inside one ring on the
same side hide each other, which a seed nearer the wanted root uncovers.
Algebra would find both, and a search over a function built out of an integral
and a series has no algebra to call on.

**What this does not cover.** Desmos draws `x^2 + y^2 = 9` as a curve by
sampling the plane, and it fits parameters to data with a regression. A math
object gives numbers and draws notation, and it does neither of those. Section
16 holds the reason a curve waits.

### Display

`display` is a literal slot taking `source`, `value` or `both`.

While the operator edits, the object draws its source, with each free name
followed by its current value, so the reader sees which numbers the answer stands
on. Out of the editor, `display` picks what shows. The worked example reads as
the integral under `source`, as a number under `value`, and as the equation
followed by its result under `both`.

The properties panel of section 15 already splits modifiable slots from derived
ones, so ports and seeds land above the rule and exports land below it, with no
change to the panel.

### Math inside a text object

Section 9 parses text content into a block tree of text, formula and conditional
blocks. Math adds a fourth block type.

```
      | { type: "math", parsed: ParsedMath, inline: boolean }
```

`{$ ... }` inside a line is the inline form. A line that holds `{$$ ... }` alone
is the block form. The text dependency walker already recurses the tree and calls
`extractDependencies` on every embedded AST, so a math parse reports the
addresses it reads through that same function, and a text box that reads a math
object updates like any other reader.

A math run in text is notation to read rather than a thing to compute. It
defines no name, reads no address and evaluates nothing, so every letter in it
is a symbol and writing `E=mc^2` in a sentence asks the program for nothing. A
text object that grew slots out of its own content would need the mutation time
slot derivation above a second time, and the standalone object already solves
that problem in one place.

A document that wants a number in its prose has two ways to it that already
work. `{= math_1.out.x }` puts the value of a math object in the text, and a
standalone math object beside the text draws the working.

### Drawing

`convertLatexToMarkup` gives markup, and the renderer paints a canvas, so a math
object does not paint in the ordinary pass. It draws as an element in `#stage`,
laid out in world units with one transform scaling it to the current zoom. The
in place editor already works this way, and the same rule applies here: nothing
multiplies the zoom into a width or a font size a second time, because the
transform has applied it once already.

The canvas pass draws the box of the object, its selection furniture and its
error badge. The notation itself belongs to the overlay.

This costs one thing. An overlay draws above the canvas, so a math object sits
above every canvas object whatever the document order says. Raising the box to a
bitmap and painting that instead would keep the order and lose sharpness at
every zoom, and the order matters less than the notation being readable.

### Measurement

The inline form needs a width and a height before the line around it can break,
and that size comes from whatever draws the notation. `TextMeasurer` is the
existing interface for a measurement that crosses into the engine, so it grows a
method that measures one math run. `render/measure.ts` implements it with the
same library that draws, and a test supplies fixed sizes. `measuredWidth` and
`measuredHeight` are then derived slots like the ones a text box carries, and
Rule 1 holds.

### Errors

A line that fails gives `#MATH` on the export it defines, and that value travels
like any other error. A parse failure is not one of these, because a parse
failure fails the mutation instead.

### Runtime dependencies

The Stack table takes one, MathLive, and it covers both drawing and editing. An
editable field that behaves the way a mathematician expects is a year of work,
and the layout of mathematics is a typesetting problem with a long literature
and no interesting answer here.

MathLive ships two builds and this design uses both. The custom element is the
editable field, and it needs a browser. The `mathlive/ssr` build exports
`convertLatexToMarkup`, its type declarations name no DOM type, and it turns
stored source into markup for an object nobody is editing. So one package
answers the editable form and the static form, and a second drawing library
would duplicate the second of those.

MathLive depends on the Cortex compute engine, so that package arrives with it
whether or not anything calls it. The choice left open is whether the evaluator
behind `evaluateMathObject` calls that engine or is written by hand. Writing it
by hand is preferred, because `src/engine/` is the port target for a Rust crate
and a JavaScript evaluator does not port, and the compute engine parses LaTeX,
integrates, differentiates and solves, which is most of this section. Both
options typecheck under `tsconfig.engine.json`, which drops the DOM lib, and
that config is what catches a library that reaches for a browser.

The cost is a bundle several times its present size. That is acceptable for
notation an operator reads on every frame, and it is the reason a second
library would not be.

---

## 13. The document variable

A document variable is a named value that belongs to the document rather than
to any object on the canvas. One name, one value, readable by that name from a
formula anywhere, and shown wherever a copy of it is put down.

It exists because the pattern it replaces is a table of one row and one column.
That table carries a row count, a column count, a grid to draw and a cell to
address, all to hold a single number, and every formula that wants the number
reads `table_1.cells.A1` and depends on nobody moving it into another cell. The
number is the whole content, and the object around it is packaging.

### The shape

```
DocObject {                      // one for the document, named doc
  <name>: Slot                   // one slot for each variable, at the top
}

DocRefObject {                   // a copy on the canvas
  target: Address                // the variable this copy shows
  origin: { x, y }
  value:          Slot           // derived, the value of the target
  measuredWidth:  Slot           // derived, the size of the drawn text
  measuredHeight: Slot
}
```

A variable sits at the top of the doc object rather than under a family such as
`vars`, so an operator writes `doc.speed`. Section 12 puts the exports of a math
object under `out` because an export named `source` or `origin` would shadow a
slot that schema declares, and the doc object declares none of its own, so
nothing here is shadowed by a name an operator picks.

### One object, with no place on the canvas

The doc object is a singleton. It arrives with the first variable rather than
with the document, so a document that uses none carries none and a file saved
before this section loads unchanged.

It carries no origin, so the renderer never draws it and the hit test never
finds it. The `value` primitive already sits in the graph this way, which is
what makes a whole object type reachable by address alone.

### A bare name is the point

`speed` reads the variable, in a table cell, in a text formula, in a port of a
script or a math object, and in the command line. A name with no dot in it is
resolved in this order:

1. Inside a table cell, a name of the `A1` form is a cell of that table.
2. A document variable of that name.
3. Anything else is refused.

Three kinds of name are therefore refused when a variable is created, each for
the collision it would otherwise cause. A reserved word of section 6 is refused
because `SUM` is a function of the formula language. A name of the `A1` form is
refused because rule 1 above would make it unreachable from inside any table. A
name an object carries is refused because `speed` and `speed.value` would then
name two different things.

The address is the second thing a bare name has to survive. An operator types
`speed` and tab completion writes it as an address, which the field then draws
in the code font and the grey box that every other completed address gets. A
name typed without completing is still resolved, and the chip is what says so
on the way in, which is the difference between an address and a word that looks
like one.

### Writing one

```
docvar speed 12                  // a literal
docvar total =doc.a+doc.b        // a formula, read like any other slot
set doc.speed 12                 // the ordinary set, once the variable exists
```

A variable holds any member of the `Value` union of section 4, so a name can
carry text or a boolean as readily as a number.

A variable that holds a formula is an ordinary formula slot: it reads other
variables and any slot of the document, it re-evaluates when they change, and a
circle of variables that define each other is refused by the cycle check that
refuses every other circle. So the document has derived knobs as well as typed
ones, and neither is a new kind of thing in the graph.

### The copy on the canvas

```
docvar speed x=200 y=140         // puts a copy where the click lands
```

A copy draws the name, an equals sign and the value, in a monospaced font, with
no box and no furniture around it. It draws the name rather than the value
alone because two copies of different variables that hold the same number are
otherwise the same picture, and the name is the only thing in the drawing that
says which knob it is. A number with nothing beside it is what `{= doc.speed }`
inside a text object already gives, and a sentence around it is what a text
object is for.

A copy carries its position and its target and nothing else. It takes no fill,
no font size and no format, because each of those would be a property of a
second view of a value that lives somewhere else, and two copies of one variable
that look different are two things an operator then has to keep in step by hand.

Deleting a copy deletes the copy. The variable is in the doc object, so it
survives, and the other copies of it are undisturbed.

Editing a copy in place writes the variable. A table cell already edits this
way in section 7, the editor opens on a double click and commits on Enter, and
what it commits here goes through the same mutation `set doc.speed` goes
through. Every other copy
shows the new value in the same pass, which is the visible half of a value that
is shared rather than duplicated.

### Renaming and deleting a variable

A formula stores the ID of the doc object, so renaming the object that holds
the variables would rewrite nothing. That is the two layer scheme of section 5.
The name of a variable is the other half of the address, and there is no ID
under it: the slot key is the name an operator typed. So renaming a variable
moves the slot and rewrites every address that names it, in one mutation, the
way deleting a column of a table rewrites the references into it.

Three kinds of reader carry such an address: a formula, the embedded formulas of
a text object, and the address macros of a math source. A copy carries one as
well, in its target rather than in a slot. The rename moves all four together,
because a reader left behind would name a slot that is no longer there and the
integrity check would refuse the whole mutation.

```
renamevar speed velocity         // moves the slot and every reader of it
delvar speed                     // removes the variable and its copies
```

Deleting a variable that something reads is refused, with the reader named, by
the rule section 4 gives every slot. A variable that nothing reads goes on the
word `delvar`, and its copies go with it, because a copy with no target is a
drawing of a slot that is not there. A copy is not a reader for that refusal:
it draws the variable and holds nothing else, so it is what goes rather than
what stands in the way.

The doc object stays behind when its last variable goes. An operator who
removed one has said nothing about the next, and the `docvar` that follows
finds the object already there.

### Seeing the ones with no copy

A variable with no copy on the canvas is invisible, and a document driven by a
knob nobody can find is worse than one driven by a cell. `vars` selects the doc
object, and the properties panel of section 15 lists its slots and edits each in
place, which is the surface every other object already has. The panel needs no
change to serve it.

### What this does not cover

A name is one segment. `doc.rates.vat` would group the knobs of a document into
families, and the path already carries more than one segment, so the cost is in
the bare name rather than in the address: `vat` alone would then have to find
which family it belongs to. It waits for a document with enough knobs to need
grouping.

A slider, a stepper or any other widget. A copy on the canvas is text, and
section 17 holds the reason a control surface waits.

A unit, a number format or a value that is a list. A variable holds one member
of the `Value` union, the same as every literal slot in the document.

---

## 14. Renderer, camera, hit test, interaction

**Immediate mode.** On every invalidation: clear, apply the camera transform,
draw every visible object in z order. There is no retained scene graph and no
diff step.

**Camera.** Pan by a middle drag or a space drag. Zoom to the cursor with the
wheel. The camera converts world to screen and screen to world. All object
coordinates are world coordinates. Only the camera knows about screen space.

**Hit test.** A screen point maps to the topmost object. Use point in polygon
for a fill. Use distance to segment with a pixel tolerance for a stroke and an
open path. Use a bounding box for text, tables, images and script nodes.

**Interaction.** Click to select. Drag to move. Press escape to deselect. A drag
calls the mutation API. It never writes object state on its own.

### A drag works per component

A drag writes `origin.x` and `origin.y` on their own. For each one:

- If the slot is `literal`, write the new value.
- If the slot is `formula` or `derived`, skip that component and show a notice
  that does not block, such as "a formula drives x".

So a drag on an object with a bound x and a literal y slides it up and down
only. Axis constraint follows with no extra code. The single source rule stays true, and
a bound object does not feel dead. Only when a formula drives every component
does the drag do nothing.

**An object with no `origin` slot** (an editable path) drags by a delta applied
to every `vertex.N.x` and `vertex.N.y` slot, under the same per component rule.
A vertex bound to something else stays put while the rest move. This is on
purpose. A polyline whose two endpoints read a pair of other objects cannot be
dragged away from them.

**A selected path grows grips.** A square sits on each vertex and a diamond at
the middle of each edge. A grip answers a plain press, and only on a path the
operator already selected. So the first press picks the object, and the next
one picks a part of it.

| Press | What it moves |
| --- | --- |
| A vertex grip | That one vertex |
| An edge grip | Bends that edge, and writes `vertex.N.bulge` |
| The body of the path | Every vertex |

A bend is absolute. It writes the bulge that puts the middle of the edge under
the pointer, read from the ends the edge holds now. The sagitta over the half
chord is the tangent of a quarter of the sweep, so one drag gives an exact
bulge. A drag on a grip follows the same per component rule as every other
drag. So a vertex or a bulge a formula drives holds still, and shows a notice.

**A grip says whether a formula drives it.** A free grip is white inside and a
held one is grey. So the operator sees which points hold still before a drag
tells them. A path is legible this way: the points it reads from elsewhere look
different from the points it owns.

**One part of one path is the focus.** A press on a grip sets it, and a press on
the body of the path drops it again. The properties panel expands the focused
part and lists the rest.

**The panel shows a path by its parts, not by its slots.** A vertex owns seven
slots. Seven rows for each vertex buries the four rows the object itself has,
and the panel then grows past the drawing it describes. So a vertex reads as
one line: its index, where it is, and a chip for the shape of the edge it
leaves.

```
polyline_1                        x
closed             [ true|false ]
style.strokeColor  #1a1a1a
style.strokeWidth  1
style.fillColor    nothing
---------------------------------
0    0, 0                       ~
1    100, 0                     -
2    100, 100                   -
3    0, 100
       vertex.3.x   0
       vertex.3.y   100
=================================
vertices           4 points
area               #TYPE ...
```

A click on the index or the position opens the vertex, and shows its `x` and
`y`. A click on the chip opens the edge, and shows its `bulge`. The click sets
the same focus a grip does, so the canvas and the panel always agree.

**The chip names the shape of an edge.** A straight edge, an arc from a bulge,
or a cubic from a handle. Nothing else in the interface says which of the five
slots behind an edge is live. So a handle of half a unit turns an edge into a
curve that looks straight and reads as straight. The four handle slots stay out
of sight until a handle is what makes the edge a curve. Then they appear, and
the operator can put them back to 0.

**A right press over a path opens a menu.** The press picks the part, so the
menu never asks which one the operator meant. Over a vertex it offers that
vertex its own removal. Over an edge it offers the three shapes and one new
vertex at the point pressed.

| Over | What the menu offers |
| --- | --- |
| A vertex | `delete this vertex` |
| An edge | `straight`, `arc`, `curve`, `add a vertex here` |

**Every entry is a command line the operator can also type.** The menu writes
the line, and the usual command path runs it. So the log shows what happened,
the journal records it, and a refusal reads the same either way. The menu
reaches no mutation of its own.

The entry for the shape an edge already has carries a mark. It stays live,
because a second ask for it is harmless.

**`edgetype` is the one gesture that sets all five slots behind an edge.** No
single slot says which of the three shapes an edge is, so nothing else can
change one without five writes. The conversion keeps the shape where it can. A
curve that becomes an arc keeps its middle. A straight edge that becomes a
curve stays straight, so the operator has two handles to pull. A straight edge
that becomes an arc has no shape to keep, so it takes a quarter turn. A cubic
cannot hold a circular arc exactly, so an arc that becomes a curve moves a
little, and more as its sweep grows. The command refuses rather than write half
an edge when a formula drives one of the five.

**A colour slot takes a hex colour.** `#rgb`, `#rrggbb` or `#rrggbbaa`, or the
word `none` for no colour at all. A canvas quietly ignores a colour string it
cannot read, and paints the colour of the shape before it. So a wrong colour is
invisible rather than loud. The command line refuses one instead, and names the
form it takes. Hex is also what a colour picker gives back, so the typed form
and the picked form agree exactly.

Each colour row in the panel carries a swatch. It is a real colour input, so the
browser opens its own wheel. A slot that holds no colour draws a slash across the
swatch. A formula row carries no swatch, because a picker that silently replaced
a formula is the one gesture the panel must not offer.

A vertex a formula holds draws in grey italic, the same fact its grip draws.
The vertex list is the one part of a panel that scrolls, so a long path cannot
push the derived slots off the screen.

**Shift has two meanings.** Shift adds an object to the selection, or takes it
out again. Over an edge of a path it means something else. It grabs that
segment, and the drag moves only the two vertices at the ends of that edge. A
press that grabs a segment selects the path outright, because nothing can drag
an object that the same press has just deselected. A shift press inside a
filled path reaches no edge. So it adds to the selection and drags the whole
path, the way it does everywhere else. The gesture picks its vertices at the
press and holds them, so the set never changes under the pointer.

An edge grip sits where a shift press grabs a segment, so the two gestures want
the same pixel. A plain press bends the edge. A shift press moves it. Shift
takes no grip at all, so it keeps both meanings it already had.

**A note on drag speed.** A drag fires many mutations per second and each one
deep clones the document. If that becomes slow to watch, throttle drag mutations
to animation frames and draw a light preview between them. Do not work around it
by a write outside the mutation API.

**Feedback.** Show a selection highlight, and an error badge on an object that
holds an error value. Show a small mark on a slot that a formula drives.

---

## 15. The command line

The style is AutoCAD. A persistent input bar sits at the bottom. It holds focus
whenever the operator does not edit text or a cell.

The screen carries very little other furniture. There is one exception, added by
the human. A selected object shows a floating properties panel beside it. The
panel lists the slots of the object. It shows the modifiable slots above a thick
rule and the derived slots below it. The panel can edit a value and can unlink a
slot. There is no toolbar, no palette, no menu and no inspector. The command
line stays the main way to author a document.

```
circle x=100 y=100 r=20
polygon sides=5 x=0 y=0 r=50
polyline 0,0 100,0 100,100 [closed]      # or the word alone, then click
rect x=0 y=0 w=200 h=100
text x=0 y=0 "Hello {= table_x.A1 }"
table x=0 y=0 rows=8 cols=8
script x=0 y=0
image x=0 y=0

link polygon_1.origin.x table_x.A1
unlink polygon_1.origin.x
set polygon_1.radius 42
clear table_x.A1
rename polygon_1 intersection_a
delete intersection_a [force]
explode polygon_1 [force]
addvertex polyline_1 100,100
delvertex polyline_1 2
split polyline_1 0 50,50
edgetype polyline_1 0 arc
addport script_1 in factor
removeport script_1 in factor

refs intersection_a
props intersection_a
list
select intersection_a
zoom <factor> / fit
save / load
```

The parser is table driven. One registry entry adds a command. A small
log above the input echoes results and errors. **Every refusal message must name
the slots it is about.** That is the whole debug story for now.

A bare command word starts a prompt sequence in the AutoCAD style. The prompt
asks for each argument in turn. A click on the canvas answers a prompt that
takes a point, so the operator can draw with the pointer in place of typed
coordinates. Escape drops the whole half finished command.

**One prompt step can repeat.** `polyline` uses it. The prompt asks for a start
point. It then asks for one more point at a time, until the operator ends it
with an empty line. It offers a word at each step, in the AutoCAD manner, and
takes the whole word or its first letter:

| Word | What it does |
| --- | --- |
| `arc` | Bends each edge after it into an arc. |
| `line` | Returns to straight edges. |
| `close` | Closes the path and ends the command. |
| `undo` | Drops the last point or word. |

The prompt offers a word only where it applies. `close` waits until the path
holds two points, and the first prompt of all offers no word at all.

**The canvas draws the path as it grows.** A dashed line joins the points the
operator placed, and a square marks each one. A rubber band runs from the last
point to the pointer. Arc mode bends that band, so the operator sees the curve
before the click that commits it.

**An arc leaves the point before it along the direction the path already
travels.** So the two meet smoothly, and one click gives the arc its
`vertex.N.bulge` value. The first edge of a path has no direction to follow, so
it stays straight. This is the only way to author a bulge by hand other than
`set`.

---

## 16. The document format

Versioned JSON with a top level `formatVersion` integer from the first commit.

It holds the format version, the object list (ID, type, name, slot kinds and
values, stored ASTs, style), the mutation journal and the camera state.

**The program never stores a derived slot value.** A full evaluation pass on
load regenerates them.

A load applies objects through the mutation API and then evaluates. Save by JSON
download. Load by file input. Do not build a file manager.

The next object ID counter is a non-negative safe integer above every generated
`obj_` ID in current objects and journal creation or deletion entries. An ID
with that prefix followed by decimal digits without leading zeros reserves its
number even after deletion. Other ID spellings leave the counter unchanged.
Loading refuses a counter that could reuse an allocated ID or lies outside the
safe integer range. The maximum safe integer represents exhaustion: the file
still saves and loads, and creation returns a refusal without changing it.

---

## 17. Do not build

The team considered each item below and postponed it on purpose.

- **Python execution of any kind.** Script nodes are stubs.
- **Compound objects, containers or groups.** The design depends on real
  scripts, so it waits for them. Do not invent a substitute.
- **An undo or redo surface.** Journal the mutations. Build no user interface.
- **Drag through to source.** A drag on a bound object must not write to the
  upstream literal. The behaviour has no definition when the upstream is itself a
  formula. The per component rule of section 14 is the answer for now.
- **More than one viewport.** One canvas. Off screen is off screen.
- **64 bit precision or a floating origin.** Plain JavaScript numbers are fine
  at this scale.
- **Graphing a function as a curve.** A math object gives numbers, and drawing
  one as a curve is geometry. The primitives and the ports it would read exist
  already, so this waits on want rather than on design.
- **Constraint solving across objects.** The document graph refuses a cycle and
  never solves one. A math object may solve for an unknown its own lines
  constrain, because that solve begins and ends inside one compute function.
  Section 12 gives the four properties that keep it safe.
- **Collaboration.**
- **Script libraries, export formats, DXF or other interchange formats.**
- **WebGPU, Rust or Tauri.** That is the later stack. Only the module
  boundaries anticipate it.
- **Extra command words.** Add a command when a task needs it.

---

## 18. When the spec is silent

Prefer, in this order:

1. Whatever keeps `engine/` free of the DOM.
2. Whatever keeps graph state plain and serializable.
3. Whatever protects Rule 6.
4. Whatever is simplest to delete later.

The renderer is short lived. A GPU renderer replaces it later. The engine has
to survive, and to become Rust. Invest to match.
