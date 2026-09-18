# STATUS - Beheader

`SPEC.md` holds the product requirements, and this file holds the state of the
code. This file also holds the structure map of the repository, and the reason
each file exists. `TODO.md` holds the work that is open.

[RUST_PORT.md](RUST_PORT.md) holds the engine migration plan, its work
register, and the measurements behind leaving that migration unscheduled.

---

## 1. State

| Item | Value |
| --- | --- |
| Build | Clean. `npx vite build` succeeds. |
| Types | Clean. Both configs pass `tsc --noEmit`. |
| Tests | 2763 Vitest tests and 2 tooling tests pass, with 0 skipped. |
| Spec | Built, except the parts section 17 postpones. |
| Workspace | Compact typography, a profile helmet, and full, compact and hidden sidebar modes with pointer and keyboard resizing. |

### How to run it

```
npm install
npm run dev          # dev server
npm test             # engine, application and tooling tests
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

Why. The separation keeps host services explicit and makes the engine testable
with no browser, and it keeps a port of the directory to another language
available. A port to a Rust crate is a deferred option rather than a plan.
`RUST_PORT.md` holds the measurements behind that, the work register a later
decision would start from, and the host adapter and equivalence tests such a
port would still need.

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

| File | Purpose |
| --- | --- |
| `index.html` | The workspace shell, creation tools, object navigator, guide, canvas, panels, and command dock. |
| `src/workspace.css` | Workspace layout, responsive navigation, focus styles, and panel presentation. |
| `tools/workspace-check.cjs` | Browser checks for creation, live formulas, saved values, navigation, command recall, and narrow screens. Uses Playwright, with optional `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_EXECUTABLE`, and `WORKSPACE_URL` environment variables. |
| `package.json` | Scripts, dev dependencies, and the one runtime dependency, MathLive. |
| `tsconfig.json` | Strict mode over the whole of `src`. |
| `tsconfig.engine.json` | The narrower config over `src/engine/` alone, which fails when the engine reaches the DOM. |
| `vite.config.ts` | Dev server, production build, and the Vitest settings. |
| `tools/prose-check.mjs` | The prose checker that enforces `docs/STYLE.md`. |

### `src/engine/` - the pure core

| File | Purpose |
| --- | --- |
| `address.ts` | Addressing: object IDs, names, paths, and the A1 cell helpers. |
| `complete.ts` | What a half typed object name or address could still become, and the addresses a formula reads. |
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
| `primitives/doc.ts` | The document variable, the copy of one on the canvas, and the names a variable may not take. |
| `primitives/math.ts` | The slots a math object carries, the seeds a solve starts from, and the compute function behind each export. |
| `math/ast.ts` | The node types of the math language, and the depth check over them. |
| `math/lexer.ts` | LaTeX to tokens, including the subscript and the commands that are dropped. |
| `math/parser.ts` | Tokens to a program, with implicit multiplication, the binding forms and the implicit line. |
| `math/names.ts` | Which names are bound, which are defined, which are solved for, and which become input ports. |
| `math/eval.ts` | A program and its inputs to a value for each export, the search for a root included. |
| `script/stub.ts` | The script node and its ports. |
| `mutation.ts` | The one channel for state change, and every operation it accepts. |
| `journal.ts` | Replay of the journal, and the undo that rests on it. |
| `document.ts` | Save and load, and the versioned JSON format. |
| `index.ts` | The public surface of the engine. |

### `src/render/` - the short lived drawing layer

| File | Purpose |
| --- | --- |
| `camera.ts` | World and screen coordinates, pan, zoom, and the limits on both. |
| `extent.ts` | The world box of one object, and of the whole document. |
| `slots.ts` | Defensive readers for a slot value, and the fixed box sizes. |
| `textbox.ts` | The one rule for the size of a text box. |
| `hittest.ts` | A screen point to the topmost object under it. |
| `handles.ts` | The resize grabbers, and the box maths behind a resize. |
| `menu.ts` | The right press menu, and the command line each entry writes. |
| `grips.ts` | The grabbers on a selected path, and the part each one names. |
| `markdown.ts` | The small markdown parser behind a text object, and the line that holds notation. |
| `measure.ts` | The two Canvas2D measurers, and the line breaker. |
| `math.ts` | Notation to markup, the size it takes, and where the element holding it goes. |
| `renderer.ts` | The painter, the three passes it makes, and where notation inside text landed. |
| `images.ts` | The decoded bitmap cache. |
| `editor.ts` | Where the in place editor goes, and how it looks. |
| `interaction.ts` | Pointer state to mutation calls: select, drag, resize and bend. |
| `panel.ts` | Where a properties panel sits beside its object. |

### `src/command/`

| File | Purpose |
| --- | --- |
| `parser.ts` | One typed line to one command object. |
| `complete.ts` | What a completion key writes in a line or a formula field, and which runs named something. |
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
12. **`math/names.ts` and `math/eval.ts` agree on what a line can reach.** The
   binder resolves a function call against the definitions above that line
   alone, so a circle of function calls cannot be written and the recursion of
   the evaluator stays bounded. An evaluator that registered
   every function before the first line would run a self calling function that
   the binder had already refused, and the two would disagree about the same
   source. The evaluator registers a function at its own line for that reason.
13. **A measurement of notation taken before its fonts arrive is about a
   sixth too narrow.** The browser falls back to a font with other metrics, so
   the box drawn around a formula is too small and the end of it hangs outside.
   `main.ts` empties the measurement cache of `render/math.ts` and evaluates
   again whenever a font finishes loading, which is the only thing that repairs
   the sizes of a document already on screen.

   That repair runs for every object rather than for the math objects alone. A
   run of notation inside a text object measures the same way and goes just as
   wrong, and it is worse there: the words after it are written over, because
   the layout left a gap of the smaller size. A guard that named the math type
   left that case behind once already.
14. **A field and the layer that marks it agree on every property that moves a
   glyph, the sideways scroll included.** Three fields carry a layer: the
   command line, a table cell being edited, and a panel row. `index.html` sets
   the font, the padding, the border and the white space rule on each pair
   together, the cell layer copies its geometry from the field rather than
   working it out again, and every one of the three copies the scroll of its
   field on each repaint.

   A disagreement about a size slides each mark away from the letters it
   belongs to, by more the further along the line it sits. A disagreement about
   the scroll is worse and easier to miss: the boxes still measure the same, so
   a check of their geometry passes while each mark sits under whichever
   letters happen to be in view. A cell is narrow enough that any formula
   scrolls it, which is where that was found.

   Each layer draws its own text in no colour at all, so either kind of
   disagreement shows as a mark in the wrong place rather than as two sets of
   letters, which is the difference between a fault a reader notices and one
   that passes for a smudge.
15. **The operator cannot see what a test can see.** A live look on screen
   comes before anyone calls an operator surface done. It has found what the
   suite could not on every surface built so far.
16. **A MathLive field takes its macros after it is in the page.** Both the
   read and the write of the `macros` property throw on a field that is not
   mounted, so a field configured on the way to the page throws from inside the
   repaint that built it and never arrives. `main.ts` appends the field first
   and gives it the macros of this program after, which is the order that keeps
   the editable form drawing an address and a solve command the way the static
   form draws them.

   The suite cannot reach this. The field is a custom element from a package,
   and the throw happens where a real browser mounts it.
17. **A copy of a document variable carries its address outside the slot set.**
   Every other reference in the program sits in a formula, and the schema
   declares the slot that holds it. A copy holds its address in `target`, a
   field of the object beside its name and its type, because the copy has to
   know which variable it draws before any slot of it is evaluated.

   So `validateIntegrity` is the one place that pairs a copy with a variable
   that exists, and it is also what refuses a `target` on any other type, where
   the field would be state that nothing reads. A rename moves the field along
   with every formula, and clearing a variable removes the copies of it in the
   same mutation, because a copy left behind would draw an address that
   resolves to nothing.
18. **An input port of a math object holds `null` until something fills it.**
   A number there would be read as an answer, so a source is left exporting a
   value that no operator entered. The empty port is left out of the evaluation
   environment instead, which puts `"x" has no value here` on each line that
   names it and leaves the other lines exporting numbers. Section 12 of the
   spec carries the reason.

19. **The page carries two stylesheets, and the later one settles a tie.**
   The style element in `index.html` holds the geometry that the drawing
   layers measure against. `src/workspace.css` holds the palette and the
   layout of the shell around the canvas, and `main.ts` imports it, so the
   bundler puts it after that element and a selector named in both resolves
   there.

   So the stylesheet that arrives later reaches the same classes the
   measurements in TypeScript rest on. A font or a padding written there for a
   field alone, or for its marking layer alone, slides each mark away from the
   letters it belongs to, which is the failure the invariant above describes,
   reached from the other direction. Each pair is written as one selector in
   both files for that reason.

---

## 5. How to work here

`CLAUDE.md` holds the rules for a change. It names the checks to run, how to
write a comment, and what to prefer when the spec is silent. This file held a
second copy of them, and the two drifted apart. `AGENTS.md` at the root is a
pointer to `CLAUDE.md`, and it exists for a tool that looks for that filename.

`TODO.md` holds the open work, and an item leaves that file when it lands. Git
holds the history of each change, and this file holds the state that the
history arrives at.
