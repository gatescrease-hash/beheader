# STATUS - Graphpaper

`SPEC.md` holds the product requirements, and this file holds the state of the
code. This file also holds the structure map of the repository, and the reason
each file exists.

The last full audit ran on 2026-09-08.

That audit replaced the old set of process documents with this file and
`SPEC.md`. It cut the comments in `src/` from 14436 lines to 851. It also
removed every reference to a document that no longer exists. That covered 4346
comments, 721 test names, and 33 messages the operator reads. It changed no
logic. The reasons that used to sit in a file header now sit in section 3
below. An untouched copy of the repository as it was before the audit sits
beside this one, in `beheader-clean-alpha-archive`.

---

## 1. State

| Item | Value |
| --- | --- |
| Build | Clean. `npx vite build` succeeds. |
| Types | Clean. Both configs pass `tsc --noEmit`. |
| Tests | 2369 pass, 0 skip, across 42 test files. |
| Phase | The alpha phase is complete, and beta is open. |

The alpha phase built the graph core, the formula engine, the table, the
canvas, the command line, text, images and the script stub. A person confirmed
the last of it on screen on 2026-09-07.

The beta phase starts here. Section 5 lists the gaps that remain open for beta.

### How to run it

```
npm install
npm run dev          # dev server
npm test             # 2369 tests
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
formula language, the primitives and the mutation channel. It does not touch
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

Why. This layer is short lived. A GPU renderer replaces it later. The seam
stays narrow, so the replacement is cheap.

**`src/command/`** turns a typed line into a mutation. It parses, asks for each
argument it needs, and runs the handlers.

Why. The command line is the main way to author a document. A table driven
parser means one registry entry adds a command.

**`src/main.ts`** owns the browser. It holds the application state, finds the
DOM elements, and connects the other three layers.

Why. Only one file needs to know about the browser event loop. Everything else
stays a pure function of its arguments, so the tests run without a browser.

---

## 3. The structure map

This map routes. Each row says what a reader would come to that file to
change, and no more. The reason a file is shaped the way it is lives in its own header,
next to the code, where an edit cannot miss it. Section 4 holds the invariants
that span more than one file, because no single header owns those.

Every source file has a test file beside it with the same name plus
`.test.ts`. The map below names the source file only. Two files have no test of
their own: `primitives/image.ts` and `render/slots.ts`. Both are constant
tables, and other suites drive them anyway.

### Root

| File | What you would come here to change |
| --- | --- |
| `index.html` | The page and its stylesheet: the canvas, the panel container, the log and the input bar. |
| `package.json` | Scripts and dev dependencies. There are no runtime dependencies. |
| `tsconfig.json` | Strict mode over the whole of `src`. |
| `tsconfig.engine.json` | The narrower config over `src/engine/` alone, which fails when the engine reaches the DOM. |
| `vite.config.ts` | Dev server, production build, and the Vitest settings. |
| `tools/prose-check.mjs` | The prose checker that enforces `docs/STYLE.md`. |

### `src/engine/` - the pure core

| File | What you would come here to change |
| --- | --- |
| `address.ts` | Addressing: object IDs, names, paths, and the A1 cell helpers. |
| `eval-context.ts` | The `TextMeasurer` interface and the context that carries it. |
| `graph/node.ts` | The data model: values, the three slot kinds, `GraphObject` and `slotKey`. |
| `graph/edge.ts` | The `Edge` record and `addressKey`. |
| `graph/cycles.ts` | Cycle detection over the edge set. |
| `graph/eval.ts` | The topological pass that evaluates every slot. |
| `formula/lexer.ts` | Formula text to tokens. |
| `formula/parser.ts` | Tokens to an AST, with object names resolved to IDs. |
| `formula/ast.ts` | The AST node types, and their shape and depth checks. |
| `formula/deps.ts` | The addresses a formula reads, and the rewrites a table resize needs. |
| `formula/eval.ts` | An AST to a value. |
| `formula/functions.ts` | The registry of built in functions. |
| `formula/format.ts` | An AST back to source text. |
| `primitives/edge.ts` | The maths of one path edge: straight, arc or cubic. |
| `primitives/schema.ts` | Which slots each object type declares, and of which kind. |
| `primitives/geometry.ts` | Vertex maths for every shape, and the derived measurements. |
| `primitives/table.ts` | Cell addressing, range expansion, and the row and column resize. |
| `primitives/text.ts` | The text block tree, its dependencies, and its measurements. |
| `primitives/image.ts` | Slot path constants for the image type. |
| `script/stub.ts` | The script node and its ports. |
| `mutation.ts` | The one channel for state change, and every operation it accepts. |
| `journal.ts` | Replay of the journal, and the undo that rests on it. |
| `document.ts` | Save and load, and the versioned JSON format. |
| `index.ts` | The public surface of the engine. |

### `src/render/` - the short lived drawing layer

| File | What you would come here to change |
| --- | --- |
| `camera.ts` | World and screen coordinates, pan, zoom, and the limits on both. |
| `extent.ts` | The world box of one object, and of the whole document. |
| `slots.ts` | Defensive readers for a slot value, and the fixed box sizes. |
| `textbox.ts` | The one rule for the size of a text box. |
| `hittest.ts` | A screen point to the topmost object under it. |
| `handles.ts` | The resize grabbers, and the box maths behind a resize. |
| `menu.ts` | The right press menu, and the command line each entry writes. |
| `grips.ts` | The grabbers on a selected path, and the part each one names. |
| `markdown.ts` | The small markdown parser behind a text object. |
| `measure.ts` | The two Canvas2D measurers, and the line breaker. |
| `renderer.ts` | The painter, and the three passes it makes over every frame. |
| `images.ts` | The decoded bitmap cache. |
| `editor.ts` | Where the in place editor goes, and how it looks. |
| `interaction.ts` | Pointer state to mutation calls: select, drag, resize and bend. |
| `panel.ts` | Where a properties panel sits beside its object. |

### `src/command/`

| File | What you would come here to change |
| --- | --- |
| `parser.ts` | One typed line to one command object. |
| `prompt.ts` | The prompt sequence a bare command word starts. |
| `commands.ts` | The handlers, and every refusal message an operator reads. |
| `props.ts` | The slot rows that the panel and the `props` command both read. |

### `src/main.ts`

The only file that owns the browser. It holds `AppState`, the transitions over
it, the panel model, and the wiring to real DOM elements.

## 4. Invariants a reader cannot guess from the code

These hold across more than one file, so no single header owns them. An
invariant that lives inside one file belongs in that file's header, next to
the code it constrains.

1. **Edge derivation and both integrity checks call the same resolver.** A
   dynamic slot family such as a table `cells.*` resolves per object. Three
   sites that resolve it on their own will drift. The graph is then no longer
   total, and no test goes red.
2. **A schema declares the slot set. An object carries its own slots.** Where
   the two disagree, the evaluator still evaluates the slot but nothing ever
   orders it and its edges never exist. An integrity check catches this, and it
   runs before the cycle check. A cycle check over an edge set that nobody
   trusts proves nothing.
3. **A port name and a port value are two separate operations that land in one
   batch.** The moment an `out.*` port exists, the integrity check needs every
   address it declares to be a real slot. An `addPort` fails when the same
   batch does not hold a paired `setSlot`.
4. **Two functions share the name `evaluate`.** `graph/eval.ts` runs the whole
   graph. `formula/eval.ts` runs one AST. `engine/index.ts` re-exports them as
   `evaluateGraph` and `evaluateFormulaAst`. Every consumer imports the
   aliased name from there, and never the bare one from a deep path.
5. **`vertices` holds only the points an operator placed.** A curve never
   becomes a run of sample points, at any layer. The renderer draws an arc
   with `ctx.arc`, the hit test measures to the circle, and area, length and
   bounds each have a closed form. So the count of vertices is never a quality
   setting. A vertex arrives on a curve only when an operator splits an edge
   at a point they pick.
   ---
6. **`measure.ts` and `renderer.ts` move together.** One layout function, two
   readers.
7. **`render/textbox.ts` holds the one rule for the size of a text box.** Three
   readers use it, and a fourth does not belong there.
8. **`.text-editor` does not set a font, a padding or a border.** It sets
   `overflow-wrap: break-word` on purpose, and `measure.ts` implements the
   same rule. The pair changes together, or not at all.
9. **The in place editor mounts in `#stage`, not in `#panels`.** The overlay
   lays out in world units and one transform scales it. Nothing multiplies the
   zoom into its width or its font size a second time.
10. **A registry completeness test that goes red has found a real gap.** One
   new command word turns four tests red, and all four need an update.
11. **A test that agrees with its author proves nothing.** An inert module with
   thirty green tests shipped a real bug. A new module reaches a consumer in
   the same change.
12. **The operator cannot see what a test can see.** A live look comes before
   anyone calls an operator surface done. That step decided six cycles in a
   row, and it closed the last phase.

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
   over the same corners. A polygon is a closed polyline at the schema layer,
   and not only in the math. A live polyline can also grow and shrink now,
   through `addvertex` and `delvertex`, and a preset can turn into one through
   `explode` (item 4). The operator can also draw one with the pointer. The
   word `polyline` starts the AutoCAD prompt sequence, and a click on the
   canvas answers each point. `arc`, `line`, `close` and `undo` are the words
   it takes. An arc leaves the point before it along the direction the path
   already travels. So one click gives an edge its bulge, and the two meet
   smoothly. The canvas draws the path as it grows, with a rubber band from the
   last point to the pointer. `AppState.pointer` holds where the pointer is,
   and `promptPreview` in `main.ts` asks the command layer what shape to draw.
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
   where it is while the rest move. That is how a road holds on to the
   intersections its ends read. A shift drag over an edge moves only the two
   vertices of that edge. The press picks its vertices once and holds them, so
   the set never changes under the pointer.

### Specified, and built during beta

4. **`addvertex`, `delvertex` and `explode` all exist now.** `addvertex`
   appends one vertex and cannot break a live reference, because nothing else
   can name a vertex that does not exist yet. By default, `delvertex` refuses
   when a live formula, anywhere in the document, names the exact vertex marked
   for removal, and repairs that reference to `#REF` under `force` instead. A
   reference to a later vertex always shifts down to match, with or without
   `force`. The same real vertex survives under a new index, and a shift is
   never a break. `explode` turns a circle, a polygon or a rect into a
   polyline, under the same id and name. It snapshots the preset's current
   `vertices` into literal per vertex slots, closes the new path, and drops the
   parameter slots. Those are `origin`, `radius`, `sides`, and so on.
   `vertices`, `centroid`, `area`, `length` and `bounds` all stay declared at
   the same paths on the new schema. The style slots cross unchanged, so a
   formula that reads one of those does not need repair. A formula that reads a
   dropped slot follows the same refuse-by-default, repair-under-`force` rule
   as `delvertex`.
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
    test names and 33 messages the operator reads, which named the old rulings.
    A grep for the old marks over `src/` and `index.html` returns nothing. It
    stays that way.
11. **The package carries the name `graphpaper`. The folder carries the name
    `beheader-clean`.** The spec calls the product Graphpaper. Nothing depends
    on the folder name. One name wins when it starts to matter.

---

## 6. How to work here

`CLAUDE.md` holds the rules for a change. It names the checks to run, how to
write a comment, and what to prefer when the spec is silent. This file held a
second copy of them, and the two drifted apart.

Git holds the history of each change, and this file holds the state that the
history arrives at.
