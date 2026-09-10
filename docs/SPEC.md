# SPEC - Graphpaper

This document defines the product. It says what the program must do and why.
It does not say what the code does today. `STATUS.md` says that.

---

## 1. The idea

Graphpaper is a keyboard driven spatial canvas. Every object on the canvas is a
live node in one shared dependency graph.

Geometry, text, tables, images and script nodes are not separate tools. They are
all citizens of the same reactive system. They wire to each other:

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
- The core holds no constraint solver. Hard problems go into script nodes. The
  graph treats a script node as an opaque box.
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
| Runtime dependencies | None. Hand write the graph, the parser and the renderer. |
| Python scripts | Not built. A stub node stands in. See section 11. |
| Storage | Versioned JSON. Save by download. Load by file input. |

**Why Canvas2D and not SVG.** Immediate mode redraw maps onto the loop
"evaluate the graph, then paint the world". SVG keeps retained DOM nodes. Those
nodes tempt a writer to put drawing state back into the data model. That is the
exact coupling this design avoids.

**The planned future stack.** A Rust engine core, a Tauri shell, a
TypeScript and WebGPU front end, and a local Python interpreter as a subprocess.
Do not build it. The shape of `src/engine/` matches a one to one port target for a
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

### Rule 3. The address scheme is load bearing

Formulas, bindings, script ports, storage and the command line all depend on it.
A change to it touches everything. See section 5.

### Rule 4. One formula engine

Table cells and text share one parser and one evaluator. Do not write a second
expression evaluator for text. Only the syntax around it differs.

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

### Rule 7. Do not build the items in section 15

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
ErrorValue = { error: "#REF" | "#TYPE" | "#DIV0" | "#PARSE" | "#SCRIPT" | "#MEASURE",
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

An edge is straight, an arc, or a cubic bezier. Two handles make it a cubic:
one pulls out of the vertex it leaves, the other pulls into the vertex it
reaches, and each is an offset from its own vertex. With both handles at 0, a
bulge makes the edge an arc. A bulge is the tangent of a quarter of the
included angle, the number a DXF file carries on a vertex record. Zero makes a
straight edge, 1 makes a half circle, and the sign gives the direction.

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
```

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

## 12. Renderer, camera, hit test, interaction

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
only. Axis constraint falls out for free. The single source rule stays true, and
a bound object does not feel dead. Only when a formula drives every component
does the drag do nothing.

**An object with no `origin` slot** (an editable path) drags by a delta applied
to every `vertex.N.x` and `vertex.N.y` slot, under the same per component rule.
A vertex bound to something else stays put while the rest move. This is on
purpose. In the road network test, the operator cannot drag a polyline away
from the two intersections that its endpoints read.

**A selected path grows grips.** A square sits on each vertex and a diamond at
the middle of each edge. A grip answers a plain press, and only on a path the
operator already selected, so the first press picks the object and the next one
picks a part of it.

| Press | What it moves |
| --- | --- |
| A vertex grip | That one vertex |
| An edge grip | Bends that edge, and writes `vertex.N.bulge` |
| The body of the path | Every vertex |

A bend is absolute. It writes the bulge that puts the middle of the edge under
the pointer, read from the ends the edge holds now. The sagitta over the half
chord is the tangent of a quarter of the sweep, so one drag gives an exact
bulge. A drag on a grip follows the same per component rule as every other
drag, so a vertex or a bulge a formula drives holds still and shows a notice.

**A grip says whether a formula drives it.** A free grip is white inside and a
held one is grey. So the operator sees which points hold still before a drag
tells them. This is what makes the road network legible: the intersections a
road reads look different from the points it owns.

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
slots behind an edge is live, so a handle of half a unit turns an edge into a
curve that looks straight and reads as straight. The four handle slots stay out
of sight until a handle is what makes the edge a curve. Then they appear, and
the operator can put them back to 0.

**A colour slot takes a hex colour.** `#rgb`, `#rrggbb` or `#rrggbbaa`, or the
word `none` for no colour at all. A canvas quietly ignores a colour string it
cannot read, and paints the colour of the shape before it, so a wrong colour is
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
out again. Over an edge of a path it means something else: it grabs that
segment, and the drag moves only the two vertices at the ends of that edge. A
press that grabs a segment selects the path outright, because nothing can drag
an object that the same press has just deselected. A shift press inside a
filled path reaches no edge, so it adds to the selection and drags the whole
path, the way it does everywhere else. The gesture picks its vertices at the
press and holds them, so the set never changes under the pointer.

An edge grip sits where a shift press grabs a segment, so the two gestures want
the same pixel. A plain press bends the edge. A shift press moves it. Shift
takes no grip at all, so it keeps both meanings it already had.

**A note on drag speed.** A drag fires many mutations per second and each one
deep clones the document. If that becomes slow to watch, throttle drag mutations
to animation frames and draw a light preview between them. Do not work around it
by a write outside the mutation API.

**Feedback.** Show a selection highlight, an error badge on an object that holds
an error value, and a small mark on a slot that a formula drives.

---

## 13. The command line

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
point, and then asks for one more point at a time until the operator ends it
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
operator placed, a square marks each one, and a rubber band runs from the last
point to the pointer. Arc mode bends that band, so the operator sees the curve
before the click that commits it.

**An arc leaves the point before it along the direction the path already
travels.** So the two meet smoothly, and one click gives the arc its
`vertex.N.bulge` value. The first edge of a path has no direction to follow, so
it stays straight. This is the only way to author a bulge by hand other than
`set`.

---

## 14. The document format

Versioned JSON with a top level `formatVersion` integer from the first commit.

It holds the format version, the object list (ID, type, name, slot kinds and
values, stored ASTs, style), the mutation journal and the camera state.

**The program never stores a derived slot value.** A full evaluation pass on
load regenerates them.

A load applies objects through the mutation API and then evaluates. Save by JSON
download. Load by file input. Do not build a file manager.

---

## 15. Do not build

The team considered each item below and postponed it on purpose.

- **Python execution of any kind.** Script nodes are stubs.
- **Compound objects, containers or groups.** The design depends on real
  scripts, so it waits for them. Do not invent a substitute.
- **An undo or redo surface.** Journal the mutations. Build no user interface.
- **Drag through to source.** A drag on a bound object must not write to the
  upstream literal. The behaviour has no definition when the upstream is itself a
  formula. The per component rule of section 12 is the answer for now.
- **More than one viewport.** One canvas. Off screen is off screen.
- **64 bit precision or a floating origin.** Plain JavaScript numbers are fine
  at this scale.
- **Constraint solving.** The program refuses a cycle. It never solves one.
- **Collaboration.**
- **Script libraries, export formats, DXF or other interchange formats.**
- **WebGPU, Rust or Tauri.** That is the later stack. Only the module
  boundaries anticipate it.
- **Extra command words.** Add a command when a task needs it.

---

## 16. When the spec is silent

Prefer, in this order:

1. Whatever keeps `engine/` free of the DOM.
2. Whatever keeps graph state plain and serializable.
3. Whatever protects Rule 6.
4. Whatever is simplest to delete later.

The renderer is throwaway. A GPU renderer replaces it later. The engine is
meant to survive and to become Rust. Invest to match.
