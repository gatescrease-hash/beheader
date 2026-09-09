# STATUS - Graphpaper

Read `SPEC.md` for what the product must be. Read this file for what the code
is. This file also holds the structure map of the repository, and the reason
each file exists.

Last full audit: 2026-09-08.

That audit replaced the old set of process documents with this file and
`SPEC.md`. It cut the comments in `src/` from 14436 lines to 851, and it
removed every reference to a document that no longer exists: 4346 in
comments, 721 in test names, and 33 in messages the operator reads. It changed
no logic.
The reasons that used to sit in a file header now sit in section 3 below. An
untouched copy of the repository as it was before the audit sits beside this
one, in `beheader-clean-alpha-archive`.

---

## 1. State

| Item | Value |
| --- | --- |
| Build | Clean. `npx vite build` succeeds. |
| Types | Clean. Both configs pass `tsc --noEmit`. |
| Tests | 2250 pass, 0 skip, across 40 test files. |
| Phase | Alpha complete. Beta open. |

The alpha phase built the graph core, the formula engine, the table, the
canvas, the command line, text, images and the script stub. A person confirmed
the last of it on screen on 2026-09-07.

The beta phase starts here. Section 5 lists the gaps that beta must close.

### How to run it

```
npm install
npm run dev          # dev server
npm test             # 2250 tests
npm run typecheck    # both TypeScript configs
npm run build        # production build
npm run prose        # the prose checker, must give exit code 0
```

---

## 2. The layers, and why they exist

The repository has four layers. The import direction is one way.

```
   command/  ---.
                 \
   render/   -----+---> engine/          main.ts wires all three together
                 /
   (main.ts) ---'
```

**`src/engine/`** is pure logic. It holds the data model, the graph, the
formula language, the primitives and the mutation channel. It must never touch
the DOM, `window`, `document`, a canvas or `src/render/`.

Why. The plan is to port this directory to a Rust crate. A pure directory ports
one to one. A directory with browser calls in it does not. The rule also makes
every part of the engine testable with no browser.

The one hard case is text measurement. Layout needs glyph widths, and a glyph
width needs a canvas. The engine declares a `TextMeasurer` interface and takes
an implementation through the evaluation context. `render/measure.ts` supplies
the real one. A test supplies a fake one.

**`src/render/`** draws and reads the mouse. It imports from `engine/` and reads
engine state. It calls mutations. It does nothing else across the line.

Why. This layer is throwaway. A GPU renderer replaces it later. Keep the seam
narrow so the replacement is cheap.

**`src/command/`** turns a typed line into a mutation. It parses, asks for each
argument it needs, and runs the handlers.

Why. The command line is the main way to author a document. A table driven
parser means one registry entry adds a command.

**`src/main.ts`** owns the browser. It holds the application state, finds the
DOM elements, and connects the other three layers.

Why. Only one file needs to know about the browser event loop. Everything else
stays a pure function of its arguments, so tests need no browser.

---

## 3. The structure map

Every source file has a test file beside it with the same name plus `.test.ts`.
The map below names the source file only. Two files have no test of their own:
`primitives/image.ts` and `render/slots.ts`. Both are constant tables, and
other suites drive them anyway.

### Root

| File | What and why |
| --- | --- |
| `index.html` | The page. It holds the canvas, the panel container, the log and the input bar. `main.ts` finds each by id. It holds no state and no behaviour. The stylesheet lives here because there is no CSS build step. |
| `package.json` | Scripts and dev dependencies. There are no runtime dependencies on purpose. |
| `tsconfig.json` | Strict mode for the whole of `src`. |
| `tsconfig.engine.json` | A second, narrower config over `src/engine/` alone. It is the mechanical guard for Rule 1. If someone imports the DOM into the engine, this config fails even when the main one passes. |
| `vite.config.ts` | Dev server, build, and the Vitest settings. The two share no options that clash, so they live in one file. |
| `tools/ste-check.mjs` | The prose checker. It reads comments and Markdown, strips the code out, and reports each sentence that breaks a rule. Run it before every commit. |

### `src/engine/` - the pure core

| File | What and why |
| --- | --- |
| `address.ts` | The two layer address scheme. An object has a stable ID and a name the operator can change. Formulas resolve a name to an ID at parse time, and a stored AST holds the ID. So a rename needs no formula rewrite. This file also holds the A1 cell reference helpers. A cell reference is an address form, and nothing else needs a second copy of that logic. Load bearing. Everything depends on it. |
| `eval-context.ts` | The `TextMeasurer` interface and the `EvalContext` that carries it. This file exists so Rule 1 has a shape, not only a prohibition. It has no imports at all, which is the point. |
| `graph/node.ts` | The data model. `Value`, `ErrorValue`, `Slot` in its three kinds, `GraphObject`, and the `slotKey` function. `slotKey` joins a path into one string key. There is no sanctioned inverse. Code that needs a path must derive it from the schema, never invert a key. `GraphObject.vertexCount` sits beside the slots, not inside them. A polyline's vertex count changes only through `addvertex` or `delvertex`. Ports sit outside the slots for the same reason. |
| `graph/edge.ts` | The `Edge` record and `addressKey`. Tiny on purpose. An edge is data, and only `mutation.ts` makes one. |
| `graph/cycles.ts` | Depth first cycle detection over the whole edge set. It names every slot in the cycle it finds, because the message is the whole debug story. It runs from scratch on every mutation, per Rule 5. |
| `graph/eval.ts` | The topological pass. It sorts every slot and evaluates each one. A literal returns its stored value. A formula evaluates its AST. A derived slot calls its schema compute function. All three kinds go through this one pass, so a derived value is never one step stale. No type specific logic belongs here. The script node must stay one more derived slot. |
| `formula/lexer.ts` | Source text to tokens. A numeric path segment such as the `0` in `vertex.0.x` scans as a number token. The parser handles that. |
| `formula/parser.ts` | Tokens to AST, by recursive descent. It resolves object names to IDs here, so an unknown name is a parse error in any branch. It has a depth limit so a deep input cannot exhaust the stack. |
| `formula/ast.ts` | The AST node types plus a shape validator and a depth check. The AST is the interchange format between the four stages. It is also what the document stores. |
| `formula/deps.ts` | `extractDependencies` walks an AST and returns every address it can read. It is eager and total. It includes both branches of an `IF`. This is correct and is not a defect. The graph must subscribe to a branch that is not live now, or the object fails to update when the condition flips. This file also holds the two AST rewrite passes that table resize needs. |
| `formula/eval.ts` | AST to value. It is lazy. `IF` evaluates one branch. `AND` and `OR` stop early. The contrast with `deps.ts` is deliberate. |
| `formula/functions.ts` | The built in function registry. It is a table from name to arity to implementation. One line adds a function. Two functions are lazy, because `IF` must not evaluate the branch it does not take. |
| `formula/format.ts` | AST back to source text. It maps IDs back to current names. This is what lets the properties panel and the `props` command show a formula the way the operator wrote it. |
| `primitives/edge.ts` | The math of one path edge. An edge is straight, an arc, or a cubic bezier. Two handles make it a cubic. Otherwise a bulge makes it an arc. A bulge is the tangent of a quarter of the included angle, the number a DXF vertex record carries. Nothing here cuts a curve into sample points, so `vertices` never grows a point an operator did not place. The two vertex circle is the case that proves it, and `edge.test.ts` pins its area, length, centroid and box. An arc answers everything in closed form. A bezier answers its area, its centroid and its box in closed form too, through a five point Gauss rule. Those integrands are polynomials of degree nine or less, so the rule is exact and not an estimate. Two answers about a bezier have no closed form for anybody: its length, and the distance from a point to it. Each of those refines one number until the number holds still. `pathContains` answers whether a closed path encloses a point, by the nonzero rule a canvas fills with. It casts one ray and counts the edges that cross it. A line crosses at one point, an arc where the ray meets its circle, and a cubic at the roots of its own y. So a click inside a filled shape lands on the true curve and not on a chord. `edgeEndDirection` gives the direction a path travels as it leaves an edge. `bulgeForTangentArc` gives the bulge of the arc that continues from such a direction. Together they let one click place an arc that meets the edge before it smoothly. `splitEdgeAt` cuts one edge at the point on it nearest a point the caller gives. An arc becomes two arcs of the same circle. A cubic becomes two cubics, through De Casteljau. So the shape on screen holds still either way, and nothing here subdivides an edge evenly. |
| `primitives/schema.ts` | The registry that declares, for each object type, which slots exist and which kind each one has. It is the single source of truth for a slot path. Three sites read it in one pass: edge derivation and two integrity checks. All three must read it through the same resolver, or a dynamic slot family drifts between them. Types with an entry today: `value`, `add`, `table`, `circle`, `polygon`, `polyline`, `rect`, `text`, `image`, `script`. `value` and `add` are test fixtures from the first phase. Keep them. They are the smallest case that exercises a derived slot. |
| `primitives/geometry.ts` | Vertex math for the presets, plus centroid, area, length and bounds. A straight sided preset has one derived `vertices` slot, not per vertex slots. A change to `sides` changes a value, not the slot set, so Rule 6 holds. A circle has no `vertices` slot at all. `circleDerivedSlots` gives its area, length, centroid and bounds a closed form from the origin and the radius. `explode` turns it into two vertices joined by two bulges of 1, which is the same circle exactly. It also holds the polyline's per vertex slot paths (`vertex.0.x`, `vertex.0.y`, and so on) and `pathDerivedSlots`, the derived set a polyline uses instead of `verticesDerivedSlots`. Both sets sit at the same nine paths, area included, so a polygon is a closed polyline at the schema layer too. The `closed` literal slot picks the math for each one. A closed path gets the shoelace area, the area weighted centroid and the full perimeter. An open path gets the plain vertex mean, the length of the segments it has, and a `#TYPE` error at `area`. `hasClosedSlot` answers one question for two readers: `pathDependencies`, which lists the addresses each derived slot depends on, and `readClosedFlag`, which reads the value. A polyline built before the `closed` slot existed carries none, and both readers must agree that it does not. `existingCurvePaths` and `readCurveParts` carry the same duty for the bulge and handle slots. A vertex has seven slots now: `x`, `y`, `bulge`, and the x and y of one handle for each direction. `VERTEX_PART_SUFFIXES` lists them, and `delvertex` and `split` move all seven together. Note the two vertex enumerations. `enumeratePolylineVertexSlotPaths` lists all three slots of each vertex and declares the schema. `enumeratePolylineCoordinateSlotPaths` lists only x and y, and the `vertices` slot depends on that one, because a change to a bulge moves no point. `pathEdgesOfObject` builds the edge list the render layer draws and hit tests. `GEOMETRY_STYLE_PATHS` names the three style slots every shape declares, and `GEOMETRY_STYLE_DEFAULTS` holds what a new one starts with. `insertVertexIntoObject` and `shiftVertexAddressForInsert` serve `split`. An insert loses no vertex, so a reference only ever shifts up, and `split` has no `force` flag at all.| Two more functions grow and shrink a polyline's storage: `addVertexToObject` and `deleteVertexFromObject`. Two others give `mutation.ts` the address rewrites `delvertex` needs. One, `shiftVertexAddressForDelete`, moves a vertex that survives down an index. The other, `repairVertexAddressForDelete`, marks the exact deleted one, so `mutation.ts` can turn it into `#REF`. `explodeObjectToPolyline` snapshots a preset's vertices into a fresh polyline object, same id and name, and closes it. Every preset it accepts is a closed shape, so `area` survives the explode with the same value. `EXPLODABLE_TYPES` names the three preset types explode accepts: circle, polygon and rect. |
| `primitives/table.ts` | Cell address math, range expansion, and the row and column resize passes. A range expands to concrete cells at edge derivation time, from the size the table has now. So an expansion can never go stale. An empty cell inside a range gets no edge, which is why a sparse table works. |
| `primitives/text.ts` | The block tree parser for `{= }` and `{? }{:}{?}`, the dependency walker over it, and the three compute functions for `resolvedContent`, `measuredHeight` and `measuredWidth`. The dependency walker is the first dynamic dependency resolver in the codebase. It re-parses `content` on every edge derivation, because the set of slots the text names changes with every edit. |
| `primitives/image.ts` | Slot path constants only. No logic. The image primitive is data plus a renderer arm. |
| `script/stub.ts` | The script node. Ports are ordinary slots. An `in.<port>` slot is a formula slot. An `out.<port>` slot is a derived slot. The `source` slot is a literal slot that nothing reads, so an edit to it triggers no recompute. The `evaluateScriptOutput` function returns the placeholder value. When Python arrives, only that body changes. |
| `mutation.ts` | The single channel for state change. It runs the eight step loop: stage, apply, derive edges, check integrity, check cycles, refuse or evaluate, then commit and journal. It is the largest engine file and the most load bearing one. A batch applies many operations to one clone and commits all or nothing. A document load must use a batch. A `deleteVertex` without force refuses through `findLiveVertexDependents`, ahead of the stage step, not through the usual post-apply dangling check. The vertex after a deleted one refills its index at once, so a leftover reference to that exact index reads the wrong vertex in silence. It does not dangle. `explode` has no such trap. A slot it drops (`origin`, `radius`, `area`, and so on) is simply gone from the object. The usual post-apply dangling check catches a leftover reference on its own, the same way `deleteObject` already relies on it. |
| `journal.ts` | The reader of the append only journal `mutation.ts` writes. `replayJournal` rebuilds the objects of a document as they stood after any entry. It runs the same operations again over an empty document. Undo reads the state before the last entry. It refuses, and names the entry, rather than hand back half a document. `journalIsComplete` answers whether a full replay rebuilds exactly the objects given. Anything must ask that before it trusts a replay of a document that arrived from somewhere other than a mutation. A replay rebuilds objects only. `nextObjectId` and the camera never enter the journal. |
| `document.ts` | The versioned JSON format, and save and load. It never stores a derived value. A full evaluation pass on load regenerates them. Load goes through the mutation API, so a bad file fails the same checks a bad command does. It reconstructs `ports` and `vertexCount` by hand, the same as every slot. Both sit outside `GraphObject.slots`, so a generic JSON parse cannot validate their shape. |
| `index.ts` | The one public surface of the engine. A consumer outside `src/engine` imports from here, and never from a deep path. It re-exports every other file in this directory. The one name that collides is `evaluate`. Both `graph/eval.ts` and `formula/eval.ts` export it, for different reasons. This file aliases them to `evaluateGraph` and `evaluateFormulaAst`. Two tests in `index.test.ts` hold the boundary. One finds every engine file through the bundler and names each export this file leaves out. The other reads the source of every file outside the engine and names each deep import. Neither reads a list anybody keeps by hand. |

### `src/render/` - the throwaway drawing layer

| File | What and why |
| --- | --- |
| `camera.ts` | World to screen and screen to world, plus pan, zoom and clamps. It is the only place that knows about screen space. Every other file must read the transform from here. |
| `extent.ts` | The world space box of an object, and of the whole document. A drawn extent and a clickable extent are one extent. Give a type an arm here and it becomes clickable. Give it a renderer arm in the same change, or it becomes an invisible click target. |
| `slots.ts` | Small readers that pull a number, a string or a boolean out of a slot value, plus the fixed table and script box sizes. It exists so no drawing file re-invents the same defensive read. |
| `textbox.ts` | The one rule for how big a text box is. Three files read it. Do not answer the same question in a fourth place. |
| `hittest.ts` | A screen point to the topmost object. Point in polygon for a fill. Distance to segment for a stroke. A box for text, tables, images and script nodes. A shape that paints a fill answers to a click anywhere inside it. A shape with no fill is a hollow outline, and answers only near its edge. A circle hits on its true ring, from the origin and the radius. A polyline is a stroke test too, over its edges rather than its vertices. So a click on an arc measures to the circle and not to the chord. Its `closed` slot says whether the gap between the last vertex and the first is a real edge. |
| `handles.ts` | The resize grabbers on a selected object, and the box math they drive. A resize is absolute, from the extent the drag started with, not a sum of small steps. |
| `markdown.ts` | The markdown lite parser. Bold, italic, code, headings, list items and paragraph breaks, and nothing else. Its rule for which asterisk opens and which closes is load bearing. A simpler version reintroduces a bug that thirty tests did not catch. |
| `measure.ts` | The real Canvas2D `TextMeasurer`, and `layOutText`, the line breaker. There are two measurers and they are not the same. The engine one honours markup. The overlay one does not. |
| `renderer.ts` | The immediate mode painter. `PathPreview` is the one thing it draws that no object owns: the points, bulges and closed flag of a command the operator has not finished. It draws over the objects and under the screen space furniture, dashed, with a square on each point. It is plain geometry, so this file never asks which command made it. `buildEdgePath` walks an edge list for both a preview and a real path. It makes three passes. It clears the screen. It draws every object under the camera transform. Then it draws furniture such as labels and badges at a constant size in screen space. It reads `layOutText` from `measure.ts`. Those two files must change together, because one layout with two readers is what keeps the drawn text and the measured height in agreement. |
| `images.ts` | The bitmap decode cache. A data URL decodes once and the result stays for later paints. |
| `editor.ts` | Where an in place editor goes and what it looks like. It answers the placement question for a text box and for a table cell. `main.ts` mounts the real element. |
| `interaction.ts` | Mouse state to mutation calls. A drag writes each component on its own. A literal component moves. A component a formula drives stays put and shows a notice. So an object with a bound x slides up and down only, and axis constraint falls out for free. A path has no origin, so it drags by every vertex instead. A shift press over an edge grabs that segment and moves only its two vertices. `pointerDown` picks the vertex list once and `DragState` holds it, so the set never changes under the pointer. |
| `panel.ts` | Where a properties panel goes next to its object. Placement only. `main.ts` builds the rows. |

### `src/command/`

| File | What and why |
| --- | --- |
| `parser.ts` | One typed line to one command object, through a table of specs. It never throws. A bad line returns a failure that names what is wrong and where. It also holds the list of commands the spec names but the code does not build yet. An operator who types one gets the truth instead of "unknown command". That list and the built registry must stay disjoint. A test pins it. `polyline` and `addvertex` both take a `points` positional kind, which consumes every token left on the line as an `x,y` pair. It is the only positional kind matchArguments lets grow past the declared count. The grammar does not cap `addvertex` at one point. `commands.ts` refuses more than one, the same way it checks `polygon`'s side count. `explode` and `delete` share one spec shape: a bare target plus an optional `force` flag. `split` takes a target, an edge index and one point. A `points` list stops at a flag name. That one exception lets `polyline` end with `closed`, and it is why matchArguments looks for a flag before it grows the list. This file also holds `polylineFromStrokes`, which reads a run of picks and words into a finished `polyline` command. It is the only place that knows what `arc`, `line` and `close` mean. `prompt.ts` moves the strokes and never reads them. The same walk serves the preview, because a pointer joins the end as one more pick. |
| `prompt.ts` | The AutoCAD style prompt sequence. A bare command word starts it. The prompt asks for each argument in turn. This is a state machine on its own, apart from the one shot parser. One step can repeat. Such a step collects a stroke list. A stroke is a point the operator picked, or a word they typed. The step index holds still while the step collects. An empty answer ends it, once it holds the points its `minimum` names. A word takes one of three effects: `record` keeps it and asks again, `undo` drops the last stroke, and `end` finishes the step. The prompt offers a word only once the count of points reaches its `needs`, so `close` stays hidden until a path can close. `polyline` is the one command that uses any of this. |
| `commands.ts` | The handlers. Each one turns a command object into mutation operations and a log line. This is where a refusal message gets written, so this is where the debug story lives. The engine's `deleteVertex` refusal names only the dependents. The handler here appends the `force` suggestion on top. `deleteObject` already uses the same split, since an `Operation` carries no command syntax to quote. `explode` follows the same pattern, one more time. |
| `props.ts` | Slot descriptors for the `props` command and for the properties panel. Both surfaces read one list, so they can never disagree about what an object has. |

### `src/main.ts`

The only file that owns the browser. It holds `AppState`, the transition
functions over it, the panel model, and the wiring to real DOM elements.

The transitions are pure functions from state to state. That is why a file this
size still has 1966 lines of tests over it with no browser. Keep new logic in a
pure transition and keep the DOM work at the edge.

---

## 4. Invariants a reader cannot guess from the code

These are the traps. Each one cost real time to find.

1. **`slotKey` has no inverse.** To get a path, ask the schema. Never take a
   key apart.
2. **Edge derivation and both integrity checks must call the same resolver.**
   A dynamic slot family such as a table `cells.*` resolves per object. Three
   sites that resolve it on their own will drift. The graph is then no longer
   total, and no test goes red.
3. **A schema declares the slot set. An object carries its own slots.** Where
   the two disagree, the evaluator still evaluates the slot but nothing ever
   orders it and its edges never exist. An integrity check catches this. It
   must run before the cycle check. A cycle check over an edge set that nobody
   trusts proves nothing.
4. **An empty cell inside a range gets no edge.** An empty cell named by a bare
   reference gets no edge either. Both are normal state, not a dangling
   reference.
5. **A port name and a port value are two separate operations that must land in
   one batch.** The moment an `out.*` port exists, the integrity check needs
   every address it declares to be a real slot. An `addPort` fails when the same batch
   holds no paired `setSlot`.
6. **`measure.ts` and `renderer.ts` move together.** One layout function, two
   readers.
7. **`render/textbox.ts` holds the one rule for the size of a text box.** Three
   readers. Do not add a fourth.
8. **There are two text measurers and they are not interchangeable.** The
   engine one honours markup. The overlay one does not. The wrong one gives a
   silent size defect.
9. **A text box never crops.** The measurer breaks a long word. There is no
   `overflow` slot. A human overruled eight earlier rulings to settle this on
   2026-09-02. Do not correct the code back toward any of them.
10. **The in place editor mounts in `#stage`, not in `#panels`.** The overlay
    lays out in world units and one transform scales it. Do not multiply the
    zoom into its width or its font size a second time.
11. **`.text-editor` must not set a font, a padding or a border.** It sets
    `overflow-wrap: break-word` on purpose, and `measure.ts` implements the
    same rule. Change the pair together or not at all.
12. **A registry completeness test that goes red is the system at work.** One
    new command word turns four tests red. Update them.
13. **A test that agrees with its author proves nothing.** An inert module with
    thirty green tests shipped a real bug. Wire a new module to a consumer in
    the same change.
14. **The operator cannot see what a test can see.** Ask for a live look before
    you call an authoring surface done. This was the deciding step in six
    cycles in a row, and it is what closed the last phase.
15. **A polyline's vertex count is a field on `GraphObject`, not a slot.**
    `vertexCount` sits beside `slots`, the same as `ports` does for a script
    node. Both change only through a mutation operation, never through `set`,
    so neither belongs inside the set a formula can write. `document.ts`
    reconstructs both by hand on load for the same reason.
16. **Two functions share the name `evaluate`.** `graph/eval.ts` runs the whole
    graph. `formula/eval.ts` runs one AST. `engine/index.ts` re-exports them as
    `evaluateGraph` and `evaluateFormulaAst`. Import the aliased name from
    there, never the bare one from a deep path.
17. **`delvertex` cannot lean on the usual post-apply dangling check.** Every
    other refuse-by-default deletion (`deleteObject`, a table's row and column
    delete) removes an ID or a coordinate that never comes back, so a leftover
    reference to it is dangling and the ordinary integrity check catches it.
    A vertex delete is different: the index it frees is refilled at once by
    the vertex after it, shifted down. A leftover reference to that exact
    index would silently read the wrong vertex instead of dangling, so
    `mutation.ts` refuses BEFORE staging, through `findLiveVertexDependents`,
    rather than after.

18. **A polyline declares `area` at every value of `closed`.** The `closed`
    slot picks the math, and never the slot set. An open path holds a `#TYPE`
    error at `area` instead of holding no slot. Two things follow. A formula
    can drive `closed`, because evaluation then changes values only, and
    Rule 4 holds. And `explode` breaks no reference to `area`, because the
    path it makes is closed and the slot stays at the same address.

20. **The renderer writes each colour twice.** It writes the default, then the
    value the style slot holds. A canvas quietly keeps its last colour when it
    cannot read the one it gets, so a single write would paint one shape in
    the colour of the shape before it. The first write makes the fallback the
    default instead. `paintShape` in `renderer.ts` is the only place that
    needs this.

19. **`vertices` holds only the points an operator placed.** A curve never
    becomes a run of sample points, at any layer. The renderer draws an arc
    with `ctx.arc`, the hit test measures to the circle, and area, length and
    bounds each have a closed form. So the count of vertices is never a
    quality setting, and a vertex arrives on a curve only when an operator
    splits an edge at a point they pick.

---

## 5. Gaps. This is the beta backlog.

The alpha phase closed with these items specified and not built. The first
group blocks the acceptance test in `SPEC.md` section 12.

### Blocks the road network test

1. **`polyline` exists now, and it can close.** It has a schema entry, a
   creation command (`polyline <x,y> <x,y> [<x,y> ...] [closed]`), per vertex
   slots, a derived `vertices` slot, an extent, a hit test and a renderer arm.
   It declares the same nine derived paths a preset declares, `area` included.
   Its `closed` slot picks the math for each one, and never the slot set. So a
   closed polyline reports the same area, centroid and length as the polygon
   over the same corners, and a polygon is a closed polyline at the schema
   layer, not only in the math. A live polyline can also grow and shrink now,
   through `addvertex` and `delvertex`, and a preset can turn into one through
   `explode` (item 4). The operator can also draw one with the pointer. The word
   `polyline` starts the AutoCAD prompt sequence, and a click on the canvas
   answers each point. `arc`, `line`, `close` and `undo` are the words it takes.
   An arc leaves the point before it along the direction the path already
   travels, so one click gives an edge its bulge and the two meet smoothly. The
   canvas draws the path as it grows, with a rubber band from the last point to
   the pointer. `AppState.pointer` holds where the pointer is, and
   `promptPreview` in `main.ts` asks the command layer what shape to draw.
2. **Per vertex slots exist, and a mutation can grow or shrink the set.**
   `vertex.0.x` and `vertex.0.y`, as `SPEC.md` section 8 specifies.
   `enumeratePolylineVertexSlotPaths` in `geometry.ts` builds the paths from
   `GraphObject.vertexCount`, a field beside the slots rather than a slot
   itself, because the count changes only through a mutation operation.
   `createObjectFromCommand`, `addVertexToObject` and `deleteVertexFromObject`
   all write it now.
3. **A path drags by its vertices now.** A polyline has no `origin` slot, so a
   drag applies the delta to every `vertex.N.x` and `vertex.N.y`, under the
   same per component rule an origin follows. A vertex a formula drives stays
   where it is while the rest move, which is how a road holds on to the
   intersections its ends read. A shift drag over an edge moves only the two
   vertices of that edge. The press picks its vertices once and holds them, so
   the set never changes under the pointer.

### Specified, and built during beta

4. **`addvertex`, `delvertex` and `explode` all exist now.** `addvertex`
   appends one vertex and cannot break a live reference, because nothing else
   can name a vertex that does not exist yet. By default, `delvertex` refuses
   when a live formula, anywhere in the document, names the exact vertex
   marked for removal, and repairs that reference to `#REF` under `force`
   instead. A reference to a later vertex always shifts down to match, with
   or without `force`, because the same real vertex survives under a new
   index, and a shift is never a break. `explode` turns a circle, a polygon
   or a rect into a polyline, same id and name: it snapshots the preset's
   current `vertices` into literal per vertex slots, closes the new path, and
   drops the parameter slots (`origin`, `radius`, `sides`, and so on).
   `vertices`, `centroid`, `area`, `length` and `bounds` all stay declared at
   the same paths on the new schema, and the style slots cross unchanged, so a
   formula that reads one of those needs no repair. A
   formula that reads a dropped slot follows the same refuse-by-default,
   repair-under-`force` rule as `delvertex`.
5. **Every path segment the spec names exists: straight, arc and cubic
   bezier.** A
   `vertex.N.bulge` slot bends the edge that leaves vertex N into an arc.
   `vertex.N.handle.out.x` and its three companions bend it into a cubic
   instead, and a handle wins over a bulge. Area, length, centroid, bounds, the
   hit test and the renderer all treat each edge as the true curve it is.
   `edge.ts` holds that math. `split <object> <edge> <x,y>` cuts one edge at the
   point on it nearest `x,y` and puts a vertex there. An arc becomes two arcs
   and a cubic becomes two cubics, so the shape does not move either way. It
   refuses a point that lands on an end, where a vertex already sits. A circle
   has dropped its `vertices` slot too, so no shape anywhere holds a point an
   operator did not place.
6. **Geometry style slots exist now.** Circle, polygon, rect and polyline each
   declare `style.strokeColor`, `style.strokeWidth` and `style.fillColor`. Each
   one is an ordinary slot, so a formula drives it and a table cell can colour
   a shape. A new shape gets the old fixed colours as its defaults, and a
   `fillColor` of null. Only a closed shape fills. A shape that paints a fill
   also answers to a click anywhere inside it, through `pathContains`.
7. **`src/engine/index.ts` is the only engine path anything outside the engine
   imports.** It re-exports every other engine file under one name each, and
   resolves the one collision (`evaluate`) to `evaluateGraph` and
   `evaluateFormulaAst`. The 28 files of `command/`, `render/` and `main.ts`
   each hold one import from it now, in place of the 103 deep imports they
   held before. The build output did not change by one byte, which is the
   proof that this moved no logic. Two tests in `index.test.ts` keep it that
   way. A later question stays open, and this change does not settle it: the
   surface re-exports 311 names, and the layers outside use 114. A curated
   list of named re-exports is a separate decision, cheaper to make now that
   the real usage sits in one file for each layer.
8. **The journal has a reader now.** `journal.ts` holds it. `replayJournal`
   rebuilds the objects of a document as they stood after any entry, and undo
   reads the entry before the last one. `journalIsComplete` says whether a
   full replay rebuilds exactly the objects given, so nothing trusts a replay
   of a document the journal does not account for. A session of twelve
   commands, `explode` and `split` among them, rebuilds from its journal
   alone. `SPEC.md` section 15 still holds: no undo surface, and no command.
   This is the reader that one needs, and nothing more.

### Smaller

9. **`image` opacity** clamps at draw time instead of at write time. That is a
   deliberate choice, recorded here so the next reader does not treat it as a
   defect.
10. **Nothing now cites a document that does not exist.** The audit rewrote 721
    test names and 33 operator facing messages that named the old rulings. A
    grep for the old marks over `src/` and `index.html` returns nothing. Keep
    it that way.
11. **The package carries the name `graphpaper`. The folder carries the name
    `beheader-clean`.** The spec calls the product Graphpaper. Nothing depends
    on the folder name. Pick one name when it starts to matter.

---

## 6. How to work here

1. Read `SPEC.md` for the product. Read this file for the code.
2. Pick one item from section 5.
3. Write the tests with the code.
4. Run `npm test` and `npm run typecheck`. Both must be clean.
5. Run `npm run prose`. It must give exit code 0.
6. Update section 5 of this file when an item lands.

Do not write a log entry file for each change. Git holds the history. This file
holds the state.

When the spec is silent, prefer, in order: whatever keeps `engine/` free of the
DOM, whatever keeps graph state plain, whatever protects Rule 6, and whatever is
simplest to delete later.
