# 0061 — render-renderer
Date: 2026-08-24   Phase: 3   Model: implementer
Previous entry: 0060-REVIEW-phase3   Last review: 0060-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; this cycle is its own §6.1 trigger-2 review point
(0060-REVIEW §10 named `render/renderer.ts` explicitly), so it does not batch further regardless.

## Declared scope

Build `render/renderer.ts`: `renderDocument(ctx, viewportWidth, viewportHeight, objects, camera)`,
implementing §5.9's immediate-mode sequence (clear, apply the camera transform, draw every object
in z-order) for the object types that currently have a schema — `circle` (true arc, per §5.5),
`polygon`/`rect` (via the derived `vertices` slot), and `table` (fixed-size grid, §5.4's
right-align-numbers/left-align-strings rule). Not doing: hit-testing, interaction, selection,
error badges, `style` slots, or wiring `main.ts` — see below.

## Explicitly not in scope

- `render/hittest.ts`, `render/interaction.ts`, `command/parser.ts` — 0060-REVIEW §10's own
  ordering; each is its own future review point.
- Selection highlight, error badges, and the formula-driven-slot indicator §5.9 names. Each needs
  state this file has no way to read yet (a selection model does not exist; an error-badge design
  is its own small decision). Noted in the file's own NOT DONE HERE rather than silently dropped.
- `style` slots (`strokeColor`/`fillColor`/`strokeWidth`) — `primitives/geometry.ts` does not
  declare them (its own prior NOT DONE HERE), so nothing exists yet to read a color from. Every
  shape draws with one disclosed default stroke style.
- Wiring `main.ts` to actually put a canvas on screen. Without `interaction.ts`/`command/` there is
  nothing to create an object with, and a hardcoded demo document is not something any brief section
  asks for. `renderDocument` is a pure, ready-to-wire function; wiring happens once there is
  something for a user to do.
- `polyline`, `text`, `script`, `image`, and the Phase-0-only `value`/`add` fixtures — no schema, so
  no visual definition; each draws nothing, matching `primitives/schema.ts`'s own honest-`undefined`
  stance for a type it has nothing to say about.

## What I did

- **`src/render/renderer.ts`** (new file, first real drawing logic under `render/` —
  `render/camera.ts` precedes it but is pure coordinate math, per its own header). Implements
  PROJECT_BRIEF §5.9 and §5.4's rendering clause. `renderDocument` clears the whole viewport at an
  identity transform (`clearScreen`), then sets the camera transform via a single `ctx.setTransform`
  call whose `(e, f)` are `render/camera.ts`'s own `worldToScreen(camera, {x:0,y:0})` — never a
  second, hand-written copy of `screen = (world - camera) * zoom` (D-010) — then draws every object
  in `objects`' own array order (disclosed as z-order; the brief names z-order but gives objects no
  explicit z field yet). Every subsequent draw call uses raw world-space coordinates; the canvas's
  own transform does the screen conversion.

  Per-type drawing: `drawCircle` reads `origin.x`/`origin.y`/`radius` directly (never `vertices`)
  and calls `ctx.arc` — §5.5, verbatim, "the renderer still draws a true arc." `drawVerticesShape`
  (`polygon`/`rect`) reads the derived `vertices` slot and strokes the closed path it describes.
  `drawTable` draws a fixed-size (`TABLE_CELL_WIDTH` x `TABLE_CELL_HEIGHT`, world units) grid via
  `primitives/table.ts`'s `getTableDimensions`, and each cell's current value via `formatCellValue`
  (exhaustive over `Value`'s six members) and `drawCellText` (numbers right-aligned, everything else
  left-aligned, §5.4). Every other `ObjectType` draws nothing. No function here ever throws: a
  missing/wrong-typed/`ErrorValue` input to any per-type drawer makes that ONE object draw nothing,
  never aborts the loop.

- **`src/render/renderer.test.ts`** (new file). 17 tests: the clear-then-transform sequence and its
  exact formula (checked against a non-identity camera, so the `(e,f)` values are a real assertion,
  not a coincidence of the identity case); z-order as array order; circle drawn as a true arc with
  zero `lineTo` calls (pins the "never the polygonal approximation" clause directly); a circle with
  a missing or negative radius drawing nothing; polygon/rect's exact `moveTo`/`lineTo`/`closePath`/
  `stroke` call sequence from a hand-fed `vertices` array; polygon skipped for an `ErrorValue` or
  empty `vertices`; a table's cell-border count (`rows * cols`); the number/string/boolean/error/
  null alignment and formatting matrix, with exact `x`/`y` coordinates asserted (not just
  left-vs-right); the table origin `(0,0)` fallback and the honored-origin case; an unsupported type
  (`value`) drawing nothing; and one integration test (D-016 discipline, matching
  `geometry.test.ts`'s own precedent) that creates a real pentagon through `mutate` and asserts the
  renderer's `moveTo`/`lineTo` counts against the ACTUALLY EVALUATED `vertices`, not a hand-written
  fixture.

  No jsdom: every test builds a plain object implementing exactly the `CanvasRenderingContext2D`
  members `renderer.ts` calls, records every call, and casts it via `as unknown as
  CanvasRenderingContext2D` — avoids adding a runtime dependency (PROCESS_BRIEF §4), and is the
  render-layer analogue of the engine's injected-fake-`TextMeasurer` test posture.

## Decisions I made

1. **`renderDocument` takes `objects: readonly GraphObject[]` and `camera: CameraState` separately,
   not a whole `engine/document.ts` `Document`.** Two reasons: this file draws graph state and has
   no use for `formatVersion`/`nextObjectId`/the journal, and importing `Document` into a file that
   also sits where the DOM's global `Document` type is in scope invites exactly the kind of
   name-shadowing confusion worth avoiding by construction rather than by convention. Reversible,
   and cheap — a future caller passing `document.objects, document.camera` is one line either way.
2. **The camera transform is a single `ctx.setTransform`, its `(e, f)` computed by calling
   `worldToScreen(camera, {x:0,y:0})` rather than re-deriving the formula.** This makes it
   structurally impossible for `renderer.ts` to compute a different world<->screen mapping than
   `camera.ts` does (D-010's "declare once" principle, applied to a transform matrix instead of a
   path/slot key for the first time). The alternative — calling `worldToScreen` per vertex on every
   draw call instead of setting one canvas transform — would work too, but leaning on the canvas's
   own transform stack is both simpler code and the more idiomatic Canvas2D shape for "apply camera
   transform" as one step (§5.9's own wording).
3. **`circle` reads `origin.x`/`origin.y`/`radius` directly and draws `ctx.arc`, never touching the
   `vertices` slot at all.** This is not a style choice — §5.5 states it as a requirement ("the
   renderer still draws a true arc") — but it has a nice consequence: a circle can be drawn from a
   hand-built object carrying only its three own parameter slots, with no `vertices` slot required
   at all, which is what test 1 in the circle `describe` block exercises directly (see its own
   assertion that zero `lineTo` calls occur).
4. **A table's position falls back to `(0, 0)` via `ORIGIN_X_PATH`/`ORIGIN_Y_PATH` — the SAME path
   constants `circle`/`polygon`/`rect` already use for their own position, imported from
   `geometry.ts` rather than re-declared.** `TABLE_SCHEMA` (`primitives/schema.ts`) does not declare
   an origin yet — `primitives/table.ts`'s own NOT DONE HERE names the table-creation command as the
   cycle that will need one, and §5.10's `table x=0 y=0 rows=8 cols=8` implies it will exist. Reusing
   the SAME path (rather than inventing a second position convention) means that whenever a real
   table origin lands, this file needs zero change — only the `?? 0` fallback stops mattering.
   Considered whether this is `Q`-worthy: no — it is reversible, has zero document-state impact (a
   render-time default only), and does not touch the data model, addressing, or mutation sequence,
   so it does not meet PROCESS_BRIEF §7's escalation bar. Disclosed here instead, per the same bar's
   "reversible → take it and say so" branch.
5. **`formatCellValue`'s final `Point` branch needed an explicit `as Point` cast.** TypeScript's
   negative narrowing across `Array.isArray`'s `arg is any[]` guard does not land the remaining
   union member on `Point` by itself when the positive arm is `readonly Point[]` — verified directly
   (removing the cast reproduces the compiler error). Cast, with a comment pointing at
   `graph/node.ts`'s `hasIllegalNumber`, which hits the identical remaining-case shape and takes the
   same approach.
6. **An `ErrorValue` cell displays its bare code (`"#REF"`), left-aligned, with no special styling.**
   This is deliberately NOT §5.9's "error badge" — it is the same even-handed treatment every other
   `Value` member gets in `formatCellValue`, so a broken cell is legible instead of silently blank,
   without claiming a feature (error badges) this cycle does not build.

## Verification (real output)

```
$ npx tsc --noEmit && npx tsc --noEmit -p tsconfig.engine.json
(no output — clean under both configs)

$ npx vitest run
 Test Files  18 passed (18)
      Tests  731 passed (731)
```

731/731, 0 skipped, 0 `.only`/`.skip`/`.todo` (checked directly: no matches in the new test file).
17 of the 731 are new (`renderer.test.ts`); every other file's count is unchanged from 0060-REVIEW's
own re-verified 714.

## Acceptance criteria status

Phase 3's criterion ("you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon") is **NOT** claimed as passing, and no clause of it is. This cycle
gives the renderer half of "see both drawn" a real, tested implementation, but there is still no
command line to CREATE anything and no `main.ts` wiring to see it on an actual screen — both
correctly out of scope here (see above). `render/camera.ts` (0057) already covers pan/zoom's own
math; this cycle does not touch selection or drag at all.

## Where I got stuck / what is unfinished

- The `Array.isArray` narrowing gap (Decision 5) cost a few minutes to diagnose — first symptom was
  a `tsc` error, not a test failure, so the pure-math side note in `graph/node.ts` I ended up citing
  was worth finding.
- The FIRST test run failed two table tests (`right-aligns a number...` and `displays an
  ErrorValue...`) because I initially wrote the hand-built fixtures with slot keys `A1`/`B1`/`C1`
  instead of the actual stored key `cells.A1`/`cells.B1`/`cells.C1` (`graph/node.ts`'s `slotKey`
  joins the PATH, `["cells","A1"]`, not the surface form) — caught immediately by the failing
  assertions (empty array where three `fillText` calls were expected), not by inspection. Fixed by
  correcting the fixtures, not the renderer; the renderer's own `getSlot(object, [TABLE_CELL_PATH_
  PREFIX, formatCellReference(...)])` call was right from the first draft. Recording this because
  it is exactly the kind of test-fixture mistake (surface form vs. stored form, D-005's own
  distinction) this codebase's history shows recurring in different guises.
- Nothing else. The tree is green and the slice is complete as declared.

## Open questions raised

None. Decision 4 (table origin fallback) was considered against PROCESS_BRIEF §7's escalation bar
and does not meet it — see that decision's own reasoning.

## Review point

Fired: §6.1 trigger 2 — first file with real Canvas2D drawing logic under `render/`, which
0060-REVIEW §10 named in advance as its own review point regardless of batch state. `render/
hittest.ts`/`render/interaction.ts` and `command/parser.ts` remain as the next two, per that same
review's ordering.
