# STATUS - Beheader

`SPEC.md` holds the product requirements, and this file holds the state of the
code. This file also holds the structure map of the repository, and the reason
each file exists. `TODO.md` holds the work that is open.

[RUST_PORT.md](RUST_PORT.md) holds the engine migration, its work register,
and its current handoff. The spec has released that scope, and seven of the
seventeen packages have landed. The boundary is frozen in a generated inventory, a Rust
crate answers the same fixtures the TypeScript engine does, a browser binding
takes its measurements from the page, the data foundation holds values, slots,
objects, addresses and edges, and both languages run end to end: a formula from
source text to a value, and a math source to the value of every name it
defines.

---

## 1. State

| Item | Value |
| --- | --- |
| Build | Clean. `npx vite build` succeeds. |
| Types | Clean. Both configs pass `tsc --noEmit`. |
| Tests | 2744 Vitest tests and 23 tooling tests pass, with 0 skipped. |
| Rust | 267 tests pass. Formatting, lints and the browser target check are clean. |
| Conformance | 1928 cases match across the two engines, with none awaiting either. |
| Hosting | 17 checks pass in Chromium against the browser binding. |
| Spec | Built, except the parts section 17 postpones. |

### How to run it

```
npm install
npm run dev          # dev server
npm test             # engine, application and tooling tests
npm run typecheck    # both TypeScript configs
npm run build        # production build
npm run prose        # the prose checker, must give exit code 0
```

The Rust side needs a toolchain, which `rust-toolchain.toml` pins.

```
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo check -p beheader-engine --target wasm32-unknown-unknown --locked
npm run conformance  # both engines over the shared fixtures
npm run contract     # rewrites the frozen engine boundary
```

The browser proof needs Playwright and the wasm-bindgen command as well.

```
npm install --prefix <scratch> playwright
cargo install wasm-bindgen-cli --version 0.2.128 --locked
PLAYWRIGHT_DIR=<scratch> npm run hosting-proof
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

Why. This directory is being ported to a Rust crate, and that port is under
way. The separation keeps host services explicit and makes the engine testable
with no browser. `crates/beheader-engine/` holds the Rust that exists so far,
and shared fixtures ask the two engines the same questions. The port still
needs a host adapter and coverage of the rest of the behaviour, which
`RUST_PORT.md` registers.

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

Every source file under `src/` has a test file beside it with the same name
plus `.test.ts`. The map below names the source file only. Two files have no
test of their own: `primitives/image.ts` and `render/slots.ts`. Both are
constant tables, and other suites drive them anyway.

A Rust file carries its tests in a `tests` module at its own foot, which is
where a Rust reader looks for them, so the `.rs` rows below name no separate
file.

### Root

| File | Purpose |
| --- | --- |
| `index.html` | The page and its stylesheet: the canvas, the panel container, the log and the input bar. |
| `package.json` | Scripts, dev dependencies, and the one runtime dependency, MathLive. |
| `tsconfig.json` | Strict mode over the whole of `src`. |
| `tsconfig.engine.json` | The narrower config over `src/engine/` alone, which fails when the engine reaches the DOM. |
| `vite.config.ts` | Dev server, production build, and the Vitest settings. |
| `Cargo.toml` | The Rust workspace, its two crates, and the one dependency they share. |
| `rust-toolchain.toml` | The pinned Rust version, the components and the browser target. |
| `tools/prose-check.mjs` | The prose checker that enforces `docs/STYLE.md`. |
| `tools/engine-contract.mjs` | Reads the engine boundary out of the source, and refuses drift from the frozen copy. |
| `tools/conformance-runner.mjs` | Answers the shared fixtures with the TypeScript engine. |
| `tools/conformance-compare.mjs` | Runs both engines over the fixtures and reports where they differ. |

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

### `crates/` - the Rust engine and its runner

| File | Purpose |
| --- | --- |
| `beheader-engine/src/model.rs` | Values, error codes, object types, slots, objects, and the key a slot path joins into. |
| `beheader-engine/src/address.rs` | Names, cell reference forms, the column arithmetic, and the two spellings of a path. |
| `beheader-engine/src/graph/mod.rs` | A dependency edge, and the key a traversal holds one by. |
| `beheader-engine/src/graph/cycles.rs` | The depth first search that finds a loop, and the slots around it. |
| `beheader-engine/src/graph/eval.rs` | One pass over every slot in dependency order, reading the schema for each derived one. |
| `beheader-engine/src/mutation.rs` | The derived edge set, the four integrity checks, the fifteen operations, and the batch that commits in full or not at all. |
| `beheader-engine/src/formula/lexer.rs` | Formula text to tokens, over the units a JavaScript string counts. |
| `beheader-engine/src/formula/ast.rs` | The formula node types, the shape check a saved tree passes, and the depth limit. |
| `beheader-engine/src/formula/functions.rs` | Every built-in function: its argument count, its two habits, and what it computes. |
| `beheader-engine/src/formula/parser.rs` | Tokens to a tree, with names resolved to IDs and ranges placed. |
| `beheader-engine/src/formula/format.rs` | A tree back to source text, under the name each object carries now. |
| `beheader-engine/src/formula/deps.rs` | The addresses a formula reads, and the two rewrites a resize asks of a tree. |
| `beheader-engine/src/formula/eval.rs` | A tree down to one value, reading only the branches it takes. |
| `beheader-engine/src/math/ast.rs` | The node and line types of the math language, and its depth limit. |
| `beheader-engine/src/math/lexer.rs` | The LaTeX a math field writes, turned into tokens. |
| `beheader-engine/src/math/parser.rs` | Tokens to a program, over two passes, with juxtaposition as multiplication. |
| `beheader-engine/src/math/names.rs` | Which of the four groups each bare name falls into, and so the slot set. |
| `beheader-engine/src/math/eval.rs` | A program over its inputs, with a fixed quadrature and a search for a root. |
| `beheader-engine/src/primitives/edge.rs` | One path edge as a line, an arc or a cubic, and the area, length, centroid and bounds a path of them answers. |
| `beheader-engine/src/primitives/geometry.rs` | Where the corners of a preset fall, what a list of points measures, and what growing or shrinking a path does to its slots. |
| `beheader-engine/src/primitives/doc.rs` | Which names a document variable may take, and the line a copy of one draws. |
| `beheader-engine/src/primitives/math.rs` | The slots a math object carries, what each export computes, and the notation it draws. |
| `beheader-engine/src/primitives/text.rs` | The block tree a text object holds, the addresses it names, and the box its drawn text takes. |
| `beheader-engine/src/primitives/table.rs` | Cell address arithmetic, range expansion, and the two passes that resize a table by a line. |
| `beheader-engine/src/primitives/schema.rs` | Which slots each object type declares, what each derived one reads, and what narrows a free value. |
| `beheader-engine/src/primitives/image.rs` | The slot paths of the image type, and nothing else. |
| `beheader-engine/src/script/stub.rs` | The script node, whose ports are ordinary slots and whose body answers a placeholder. |
| `beheader-engine/src/number.rs` | The text JavaScript prints for a number, and the arithmetic whose Rust answer differs. |
| `beheader-engine/src/wire.rs` | The JSON codec the fixtures travel through, tagged numbers included. |
| `beheader-engine/src/measure.rs` | The one service the engine takes from its host, and the capability it states. |
| `beheader-conformance/src/main.rs` | Answers the shared fixtures with the Rust engine. |
| `beheader-hostproof/src/lib.rs` | The smallest graph with a measurement in the middle of it. |
| `beheader-hostproof/src/exchange.rs` | Measurement in rounds, which is the route the proof did not choose. |
| `beheader-hostproof/src/main.rs` | What the two ways of getting a measurement cost. |
| `beheader-wasm/src/lib.rs` | The browser binding, its measurement callback and its reentrancy guard. |

### `tests/conformance/` - what the two engines are compared on

| File | Purpose |
| --- | --- |
| `contract/inventory.json` | The generated engine boundary: exports, consumers, union members, modules. |
| `contract/dispositions.json` | What the Rust boundary does with each name a production file imports. |
| `fixtures/` | The questions both engines answer, and the comparison policy of each. |
| `manifest.json` | Which engine file each fixture reaches, and which files nothing reaches yet. |
| `comparator/` | Hand written results files that the comparator itself is tested on. |

### `tests/hosting/` - the browser proof

| File | Purpose |
| --- | --- |
| `index.html` | The page the proof drives, and the host measurer it answers with. |
| `tools/hosting-proof.mjs` | Builds the binding, serves the page, and checks what came back. |

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

19. **The two conformance runners are one adapter written twice.**
   `tools/conformance-runner.mjs` and `crates/beheader-conformance/src/main.rs`
   read the same fixtures, check the same argument domains, and word every
   refusal with the same sentence. The comparison compares that wording
   exactly, so a difference in it reads as a conformance failure. A refusal
   never quotes the JSON it came from, because the two engines print a number
   differently and a fixture that compared the wording would then be comparing
   their JSON writers rather than their decoders.

   The value codec at the head of the TypeScript runner mirrors
   `crates/beheader-engine/src/wire.rs` for the same reason. It is runner code
   rather than engine code: the TypeScript value union is structural and gets
   by without a decoder, while a Rust enum has to have one, so the two are held
   together by fixtures over every shape a value takes and six shapes no value
   takes.

20. **A number reaches an operator as text, and the two languages spell one
   differently.** Rust prints `1e21` as twenty two digits and JavaScript prints
   it as `1e+21`. That text reaches a formatted formula, the resolved content
   of a text object and the wording of a diagnostic, so
   `crates/beheader-engine/src/number.rs` implements the ECMAScript rules and
   the Rust engine never uses the Rust formatter for a number an operator
   sees.

21. **A measurement is the one value that arrives from outside the engine, so
   it is checked where it arrives.** `crates/beheader-engine/src/measure.rs`
   refuses a width or a height that the graph could not store, and the browser
   binding refuses an answer that is not a pair of numbers at all. A host that
   throws becomes a `#MEASURE` value carrying what it threw, rather than an
   exception crossing the binding, because a refused measurement is an ordinary
   outcome the application already draws and a thrown one would look the same
   as a fault of the binding itself.

   A measurement callback runs while a pass is half built, so
   `crates/beheader-wasm/src/lib.rs` refuses a callback that starts another
   pass. Without that guard the inner pass reads a candidate that does not
   exist yet and returns values for it, which `npm run hosting-proof` catches.

---

## 5. How to work here

`CLAUDE.md` holds the rules for a change. It names the checks to run, how to
write a comment, and what to prefer when the spec is silent. This file held a
second copy of them, and the two drifted apart.

`TODO.md` holds the open work, and an item leaves that file when it lands. Git
holds the history of each change, and this file holds the state that the
history arrives at.
