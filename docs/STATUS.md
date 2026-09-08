# STATUS - Graphpaper

Read `SPEC.md` for what the product must be. Read this file for what the code
is. This file also holds the structure map of the repository, and the reason
each file exists.

Last full audit: 2026-09-08.

That audit replaced the old set of process documents with this file and
`SPEC.md`. It cut the comments in `src/` from 14436 lines to 851, and it
removed 4346 references to documents that no longer exist. It changed no code.
The reasons that used to sit in a file header now sit in section 3 below. An
untouched copy of the repository as it was before the audit sits beside this
one, in `beheader-clean-alpha-archive`.

---

## 1. State

| Item | Value |
| --- | --- |
| Build | Clean. `npx vite build` succeeds. |
| Types | Clean. Both configs pass `tsc --noEmit`. |
| Tests | 1955 pass, 0 skip, across 36 test files. |
| Phase | Alpha complete. Beta open. |

The alpha phase built the graph core, the formula engine, the table, the
canvas, the command line, text, images and the script stub. A person confirmed
the last of it on screen on 2026-09-07.

The beta phase starts here. Section 5 lists the gaps that beta must close.

### How to run it

```
npm install
npm run dev          # dev server
npm test             # 1955 tests
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
The map below names the source file only. Three files have no test of their own:
`primitives/image.ts`, `render/slots.ts` and `render/extent.ts`. The first two
are constant tables. The third has no test file, although other suites drive it.

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
| `graph/node.ts` | The data model. `Value`, `ErrorValue`, `Slot` in its three kinds, `GraphObject`, and the `slotKey` function. `slotKey` joins a path into one string key. There is no sanctioned inverse. Code that needs a path must derive it from the schema, never invert a key. |
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
| `primitives/schema.ts` | The registry that declares, for each object type, which slots exist and which kind each one has. It is the single source of truth for a slot path. Three sites read it in one pass: edge derivation and two integrity checks. All three must read it through the same resolver, or a dynamic slot family drifts between them. Types with an entry today: `value`, `add`, `table`, `circle`, `polygon`, `rect`, `text`, `image`, `script`. `value` and `add` are test fixtures from the first phase. Keep them. They are the smallest case that exercises a derived slot. |
| `primitives/geometry.ts` | Vertex math for the presets, plus centroid, area, length and bounds. A preset has one derived `vertices` slot, not per vertex slots. A change to `sides` changes a value, not the slot set, so Rule 6 holds. A circle gets a polygon approximation for bounds and hit tests. The renderer still draws a true arc. |
| `primitives/table.ts` | Cell address math, range expansion, and the row and column resize passes. A range expands to concrete cells at edge derivation time, from the size the table has now. So an expansion can never go stale. An empty cell inside a range gets no edge, which is why a sparse table works. |
| `primitives/text.ts` | The block tree parser for `{= }` and `{? }{:}{?}`, the dependency walker over it, and the three compute functions for `resolvedContent`, `measuredHeight` and `measuredWidth`. The dependency walker is the first dynamic dependency resolver in the codebase. It re-parses `content` on every edge derivation, because the set of slots the text names changes with every edit. |
| `primitives/image.ts` | Slot path constants only. No logic. The image primitive is data plus a renderer arm. |
| `script/stub.ts` | The script node. Ports are ordinary slots. An `in.<port>` slot is a formula slot. An `out.<port>` slot is a derived slot. The `source` slot is a literal slot that nothing reads, so an edit to it triggers no recompute. The `evaluateScriptOutput` function returns the placeholder value. When Python arrives, only that body changes. |
| `mutation.ts` | The single channel for state change. It runs the eight step loop: stage, apply, derive edges, check integrity, check cycles, refuse or evaluate, then commit and journal. It is the largest engine file and the most load bearing one. A batch applies many operations to one clone and commits all or nothing. A document load must use a batch. |
| `document.ts` | The versioned JSON format, and save and load. It never stores a derived value. A full evaluation pass on load regenerates them. Load goes through the mutation API, so a bad file fails the same checks a bad command does. |

### `src/render/` - the throwaway drawing layer

| File | What and why |
| --- | --- |
| `camera.ts` | World to screen and screen to world, plus pan, zoom and clamps. It is the only place that knows about screen space. Every other file must read the transform from here. |
| `extent.ts` | The world space box of an object, and of the whole document. A drawn extent and a clickable extent are one extent. Give a type an arm here and it becomes clickable. Give it a renderer arm in the same change, or it becomes an invisible click target. |
| `slots.ts` | Small readers that pull a number, a string or a boolean out of a slot value, plus the fixed table and script box sizes. It exists so no drawing file re-invents the same defensive read. |
| `textbox.ts` | The one rule for how big a text box is. Three files read it. Do not answer the same question in a fourth place. |
| `hittest.ts` | A screen point to the topmost object. Point in polygon for a fill. Distance to segment for a stroke. A box for text, tables, images and script nodes. |
| `handles.ts` | The resize grabbers on a selected object, and the box math they drive. A resize is absolute, from the extent the drag started with, not a sum of small steps. |
| `markdown.ts` | The markdown lite parser. Bold, italic, code, headings, list items and paragraph breaks, and nothing else. Its rule for which asterisk opens and which closes is load bearing. A simpler version reintroduces a bug that thirty tests did not catch. |
| `measure.ts` | The real Canvas2D `TextMeasurer`, and `layOutText`, the line breaker. There are two measurers and they are not the same. The engine one honours markup. The overlay one does not. |
| `renderer.ts` | The immediate mode painter. It makes three passes. It clears the screen. It draws every object under the camera transform. Then it draws furniture such as labels and badges at a constant size in screen space. It reads `layOutText` from `measure.ts`. Those two files must change together, because one layout with two readers is what keeps the drawn text and the measured height in agreement. |
| `images.ts` | The bitmap decode cache. A data URL decodes once and the result stays for later paints. |
| `editor.ts` | Where an in place editor goes and what it looks like. It answers the placement question for a text box and for a table cell. `main.ts` mounts the real element. |
| `interaction.ts` | Mouse state to mutation calls. A drag writes each component on its own. A literal component moves. A component a formula drives stays put and shows a notice. So an object with a bound x slides up and down only, and axis constraint falls out for free. |
| `panel.ts` | Where a properties panel goes next to its object. Placement only. `main.ts` builds the rows. |

### `src/command/`

| File | What and why |
| --- | --- |
| `parser.ts` | One typed line to one command object, through a table of specs. It never throws. A bad line returns a failure that names what is wrong and where. It also holds the list of commands the spec names but the code does not build yet. An operator who types one gets the truth instead of "unknown command". That list and the built registry must stay disjoint. A test pins it. |
| `prompt.ts` | The AutoCAD style prompt sequence. A bare command word starts it. The prompt asks for each argument in turn. This is a state machine on its own, apart from the one shot parser. |
| `commands.ts` | The handlers. Each one turns a command object into mutation operations and a log line. This is where a refusal message gets written, so this is where the debug story lives. |
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

---

## 5. Gaps. This is the beta backlog.

The alpha phase closed with these items specified and not built. The first
group blocks the acceptance test in `SPEC.md` section 12.

### Blocks the road network test

1. **`polyline` does not exist.** It has no schema entry, no creation command,
   no extent, no hit test and no renderer arm. It is the largest single piece
   of work in the list.
2. **Per vertex slots do not exist.** `vertex.0.x` and `vertex.0.y` are
   specified in `SPEC.md` section 8 and nothing builds them. The address
   parser and the lexer already accept the form. Nothing produces it.
3. **A drag over an object with no `origin` slot is not built.** That path
   needs per vertex slots first.

### Specified and not built

4. **`explode`, `addvertex` and `delvertex`.** The parser names all three as
   not built. Each one needs a new mutation operation kind.
5. **`pan` as a command.** The mouse can pan. The command has no argument
   grammar yet.
6. **Path `segments`.** `SPEC.md` section 8 declares arcs and beziers. Only
   straight lines exist.
7. **Geometry style slots.** `strokeColor`, `strokeWidth` and `fillColor` are
   specified as slots that a formula can drive. No schema declares them. The
   renderer uses fixed colours.
8. **`src/engine/index.ts`.** The spec names one public engine surface. It does
   not exist, so every consumer imports deep paths. That makes the future Rust
   port boundary harder to see.
9. **`src/engine/graph/dirty.ts`.** Rule 5 says to keep the module even with a
   naive body, so the shape of the fast version survives. It was never made.
10. **Journal replay.** Every mutation appends to the journal. Nothing reads it
    back. Undo needs a reader.

### Smaller

11. **Header row for a table.** The spec calls it display only. Nothing shows
    it.
12. **`image` opacity** clamps at draw time instead of at write time. That is a
    deliberate choice, recorded here so the next reader does not treat it as a
    defect.
13. **721 test names still cite documents that no longer exist.** A name such
    as "an absent cell is D-047's other spelling of empty" points at a ruling
    file that the audit of 2026-09-08 deleted. About 420 of them carry the
    citation in brackets, and a small pass can drop it. The other 301 use the
    citation as part of the sentence, so each one needs a human rewrite. The
    audit left them alone, because a test name is code and the audit changed no
    code. Treat this as the last piece of the old process language.
14. **The package carries the name `graphpaper`. The folder carries the name
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
