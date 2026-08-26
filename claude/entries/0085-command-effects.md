# 0085 — `select`/`zoom`/`fit`/`save`/`load`: D-075's effect, as plain data
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5
Previous entry: 0084-REVIEW-phase3   Last review: 0084-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~317 lines / 2 files changed so far.

## Declared scope
Implement **D-075** for §5.10's five commands that change no document state: widen
`CommandOutcome`'s success arm with an optional `effect`, and give `select`, `zoom`, `fit`, `save`
and `load` handlers that do the IDENTITY and DOMAIN work here and return what to do as plain data.
`commands.ts` and its test file only.

## Explicitly not in scope
- **`main.ts`.** Nothing performs an effect yet; the file is still the stub it was. That is
  STATUS's next-slice step 3 and is blocked behind the parser depth limit (step 2, 0080-REVIEW F3).
- **The parser depth limit** (fix-list item 1), and the four "ONE MEASURED EXCEPTION" sentences it
  will remove — `executeCommand`'s doc still carries its one, untouched.
- Fix-list items 2 and 3, and every carried item from 0074-REVIEW §9.
- `render/camera.ts`: not opened. No `fit` extent, no clamp, no `CameraState` anywhere in
  `command/`.

## What I did

### `src/command/commands.ts`
- **`CommandEffect`, exported** — a discriminated union over `kind`:
  `{ select, objectId }` · `{ zoom, factor }` · `{ fit }` · `{ save }` · `{ load }`. Plain and
  serializable, an object named by **ID** and never by name (§5.2 — a name is mutable), and
  carrying no `CameraState` (D-075 clause 5).
- **`CommandOutcome`'s success arm gains `effect?: CommandEffect`.** Optional, so every existing
  caller and all eleven existing handlers are unchanged: an absent `effect` means "the document, or
  the lines, are the whole result". `list` and `refs` therefore stay exactly as they were
  (D-075 clause 4), and a test now pins that they carry none.
- **Five handlers**, in one new section:
  - `select` — resolves the name through `findGraphObjectByName` (the same case-insensitive §5.2
    lookup `delete` and `rename` use) and refuses an unknown one HERE, per D-075 clause 1.
  - `zoom` — passes the factor through untouched and refuses one that is not a positive finite
    multiplier. See "Decisions" below.
  - `fit` — refuses an EMPTY document; the extent itself never travels in the effect.
  - `save`/`load` — return the document they were given, by identity, and serialize nothing.
- **`noHandlerYet` is deleted** and `COMMANDS_WITH_HANDLERS` now lists all sixteen registry words.
- **Header, and three falsified sentences elsewhere in the file** (D-065): the NOT DONE HERE entry
  for these five is replaced by what is genuinely not done here (performing an effect, computing an
  extent), a new INVARIANTS bullet states D-075's shape rule, and `executeCommand`'s doc no longer
  claims "a command with no handler yet" among its refusals or "five arms with no handler yet"
  among its switch arms.

### `src/command/commands.test.ts`
- The `the arms with no handler yet` block is **gone**, replaced by
  `every registry command reaches a handler`, whose coverage test is now
  `COMMANDS_WITH_HANDLERS === COMMAND_NAMES` (sorted). `EVERY_REGISTRY_EXAMPLE` spells the five
  lines out instead of deriving them from the deleted list, so the never-throws sweep still covers
  all sixteen words and still checks itself against `COMMAND_NAMES`.
- A new block, `the effect commands` — 18 `it` cases, 22 at runtime (one is a loop over five
  refused factors): what each effect carries, that `select` resolves
  case-insensitively and refuses an unknown name, the four refused `zoom` factors, `fit` on an
  empty document, that `save`/`load`/`select` return the SAME document object by identity, that
  `list`/`refs` and every mutating command carry NO effect, and one that JSON round-trips every
  effect to pin D-075 clause 2 mechanically.
- `onlyNamed`, a file-wide test helper, so a test asserting on an ID cannot silently read
  `undefined.id`.

## Decisions I made
1. **`effect` is OPTIONAL rather than a `kind: "none"` arm.** Widening beats restructuring
   (the stance `Operation` and `Command` both take), and eleven handlers keep compiling untouched.
   The cost is that `effect === undefined` is the "no effect" case rather than a named arm; the
   test block asserts it explicitly for both reasons a handler can lack one.
2. **`zoom` refuses a factor that is not finite and `> 0`, and does NOT range-check it.** The
   refusal is a DOMAIN failure, the posture `refuseCountOutOfRange` already takes in this file.
   `parser.ts` validates the FORM of a number, not its usefulness, so `zoom 0`, `zoom -2` and a run
   of 400 digits (`Number` reads it as `Infinity`) all parse. Passed on, each would hit
   `render/camera.ts`'s clamp and become `MIN_ZOOM` or a silent no-op — a command that looks like
   it worked and did something else. The `[MIN_ZOOM, MAX_ZOOM]` RANGE stays in `camera.ts` (D-062):
   it is a property of the resulting camera, not of the factor, and this layer cannot see the
   current zoom.
3. **`fit` refuses an empty document.** "Are there any objects" is a document read and this is
   where a `Command` meets a `Document` (D-069). `camera.ts` would survive the alternative —
   `finiteOrFallback` leaves the camera where it was (D-027) — but the operator would see a success
   that moved nothing. This does NOT discharge `main.ts`'s duty to guard a degenerate
   single-point extent (D-066).
4. **The echoed line names the REQUEST where the result is not this layer's.** `selected polygon_1`
   is past tense because nothing after it can fail; `zoom by 2`, `fit to the document extent`,
   `saving document` and `loading document` are not, because clamping, the extent, and the DOM are
   all on the far side of the seam.
5. **`load` returns the CURRENT document.** The loaded one cannot come back through this outcome —
   reading a file is asynchronous and DOM-driven, `executeCommand` is synchronous and DOM-free. It
   is §5.11's loader, driven by `main.ts`, that installs the result.

## Verification (real output)
```
$ npx tsc --noEmit
(no output, exit 0)

$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)

$ npm test
 Test Files  24 passed (24)
      Tests  1056 passed (1056)
```
Zero skipped, zero `.only`.

**Mutation check** (the suite passed first try, so it was checked, and the checker with it). Three
seeded faults at once — `zoom`'s guard forced false, `select`'s effect carrying `object.name`
instead of `object.id`, and `fit`'s empty-document guard forced false — produced
`Tests  9 failed | 1047 passed`, read off the ANSI-stripped `Tests` line. Restored from a copy
taken before the seeding, and re-verified green above.

## Acceptance criteria status
Phase 3 criterion: *"create a polygon and a table by command, see both drawn, pan/zoom, select, and
drag the polygon."* — **NOT YET, and not claimed.** `select` and `zoom` now produce an effect that
says what to do, and no line of code performs one: `main.ts` still holds no canvas and listens for
nothing. Nothing here has been seen.

## Where I got stuck / what is unfinished
- My first `zoom` test refused `zoom 1e999` and the line **would not parse** — `NUMBER_PATTERN` has
  no exponent form. The guard is still right and still reachable (400 digits), but the doc comment
  I had written around it named a line an operator cannot type. Corrected both; the test now says
  in a comment why `1e999` is absent.
- **`fit`'s effect is empty, and that may not survive `main.ts`.** If the fit computation wants
  anything from the document that `render/` cannot derive from `document.objects`, this arm grows a
  field. Nothing suggests it will.
- **No test asserts what `main.ts` does with an effect**, because `main.ts` does nothing with one.
  The seam is pinned only from this side.

## Open questions raised
None. Q-012 and Q-008 are untouched; nothing here takes a side on world-units-vs-pixels.

## Review point
Fired: **§6.1 trigger 5** — a test's expectations changed. The five
`"<word>" has no handler yet — nothing was changed` tests are deleted, and the registry-coverage
test now compares against an empty complement. This is the change STATUS's next slice asked for
rather than a test weakened to reach green: the five commands went from refusing to running, so the
assertion that they refuse could not survive, and the coverage it protected is now asserted more
strictly (`COMMANDS_WITH_HANDLERS === COMMAND_NAMES`) rather than less.
No §6.2 file was touched — `commands.ts` is not load-bearing under §6.2.
Batch: cycle 1/3, ~317 lines / 2 files (cap 800/10).
