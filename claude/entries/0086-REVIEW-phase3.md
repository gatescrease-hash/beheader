# 0086 — REVIEW (phase 3)
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0085-command-effects   Reviewing: entry 0085 (`CommandEffect`, the widened
`CommandOutcome`, and the `select`/`zoom`/`fit`/`save`/`load` handlers in `command/commands.ts`).
Trigger: §6.1 item 5 (five test expectations deleted and one rewritten), self-reported by the entry.

Diff reviewed: `56fd6ac` — `src/command/commands.ts` (+174/-29), `src/command/commands.test.ts`
(+143/-20). Re-measured: **2 files, 317 added / 49 deleted = 366 changed** (see F3 on the entry's
number). No `src/engine/` file touched; no §6.2 file touched.

Verdict: **ACCEPT WITH EDITS.** Four findings, two fixed here, two reported. One ruling (**D-082**).
Nothing added to the fix list that blocks the next slice.

This is the cycle D-075 was written for, and it spends the ruling as written rather than
re-deriving it. The three things that could have gone wrong here all went right: the effect is data
and not a callback, the name is resolved on THIS side of the seam, and the camera does not leak
into `command/` in either direction — no `CameraState`, no clamp, no `document.camera` read or
write. The two domain refusals the entry adds (`zoom 0`, `fit` on an empty document) are the
correct instinct and are argued from what the other layer would silently absorb, which is the
right argument; I have ruled the split so the `main.ts` cycle inherits it rather than re-deciding
it (**D-082**).

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — not touched, and checked anyway: the diff adds no import to
  `src/engine/`, and `document.`/`window.`/`canvas`/`render/` over `src/engine` still returns only
  `document.ts`'s local parameter and header prose. `command/commands.ts` gained two type-only
  imports (`SelectCommand`, `ZoomCommand`) from `./parser.ts` — command layer to command layer.
- **Rule 2 (state changes only through `mutation.ts`)** — upheld, and this is the rule most at risk
  in a cycle about the camera. No new code path assigns to a document, to `objects`, to `journal`,
  or to `camera`. All five handlers return the document they were HANDED, by identity; four of them
  read nothing from it and `fit` reads `objects.length`. D-027 clause 2's camera write does not
  happen here and, per D-075 clause 5, must not.
- **Rule 5 (dumbest correct implementation)** — upheld. `fit` is `objects.length === 0`, `zoom` is
  two comparisons, `save`/`load` are one object literal each. No extent, no memo, no registry.
- **Rules 3, 4, 6, 7** — not touched. The diff creates no slot, stores no address, evaluates
  nothing, and adds no expression evaluator. The one place Rule 3 could have been broken — putting
  the object's NAME in the effect — is the thing the code deliberately does not do, and a test
  names that reason.

## 2. Invariant audit

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total
extraction, lazy evaluation, no dangling edges: **not touched.** Nothing in this diff calls
`mutate` or `deriveEdges`.

**Graph state plain and serializable** — upheld for the new shape, and worth more than a line,
because `CommandEffect` is the first type in this codebase that exists to cross a layer boundary
rather than to be stored. It is a discriminated union of string and number fields; it names an
object by ID; it holds no `CameraState`, no callback, no DOM handle. The test that JSON round-trips
all five and compares with `toEqual` is a real mechanical pin, not a gesture: a function-valued
field would not survive it (`JSON.stringify` drops the key, and the comparison then sees a function
against an absent one). Probed that directly rather than assuming it.

**Rejection leaves prior state unchanged** — upheld trivially, and now tested for all five: see F1.

## 3. Spec conformance

§5.10's `select intersection_a`, `zoom <factor>`, `fit`, `save`, `load` all run. Three readings the
cycle made, all three correct:

- **`zoom` is a MULTIPLIER, not a level.** `parser.ts` already said so (its `ZoomCommand` doc); the
  handler passes the number through untouched and the echoed line says "zoom by 2". Nothing here
  invents a zoom level, which would have made the clamp in `camera.ts` wrong rather than merely
  redundant.
- **`fit` carries no payload.** §5.11 puts camera state in the document, but the EXTENT is geometry
  over drawn objects and needs the viewport size D-061 gives `main.ts` per call. Keeping the arm
  empty is what stops `command/` from growing a bounding-box function it has no business owning.
- **`load` returns the CURRENT document.** The alternative — a widened effect carrying a loaded
  `Document` — would have made `command/` the second place a document is built from JSON, against
  §5.11's single loader. The entry's decision 5 gets this right for the right reason.

**Where the brief is silent, and where I have ruled: D-082.** §5.10 gives `zoom` a factor and says
nothing about what a non-positive one means, and nothing at all about `fit` over an empty document.
Both are domain questions two layers could plausibly own. The decidable line is *which layer can
still say NO* — `clampZoom` cannot refuse, it can only absorb, turning `zoom 0` into `MIN_ZOOM` and
`zoom <400 digits>` into "no change". Ruled: DOMAIN in `command/`, RANGE in `render/`, plus the two
clauses the `main.ts` cycle needs (an exhaustive `switch` over `CommandEffect` with the `never`
default, since the optional field costs the seam its compile-time exhaustiveness; and no name
resolution in `main.ts`, restating D-075 clause 1 at the moment it becomes tempting).

## 4. Findings

### F1 — `zoom` and `fit` had no test that the document comes back unchanged. FIXED here

"Changes no document state" is the PREMISE of D-075 — it is why these five may return an effect at
all — and it was pinned by identity for `select`, `save` and `load` but not for the two commands
that actually reach the camera, which are exactly the two where a future edit would be tempted to
write `document.camera` directly (D-027 clause 2 puts that write outside `mutate`, so no other
guard would catch it). Added two `it` cases in the existing `zoom` and `fit` blocks asserting
`outcome.document` is the same object, each with the reason in an adjacent comment. Tests:
1056 → 1058.

### F2 — `main.ts`'s header said `commands.ts` "runs the creation commands". FIXED here

Stale before this cycle (the file has run `set`/`link`/`rename`/`delete`/`refs`/`list` for several
entries) and fully falsified by it. §5.2's present-tense rule (D-060) binds a header a reader lands
on cold, and this is the header of the file that must now perform effects. Rewritten to say that
`commands.ts` runs every command the parser can produce and returns a `CommandEffect` for the five
that reach the camera, the selection or a file, and that THIS file performs one (D-075). One
sentence; nothing else in the stub touched.

### F3 — Two numbers in entry 0085 are slightly wrong. Reported, not fixed (entries are append-only)

Neither changes a conclusion; both are what the honesty audit exists to catch.

1. The entry says the new block is "18 `it` cases, 22 at runtime". It is **17 written, 21 at
   runtime** — counted mechanically (`vitest run -t "effect commands"` reports 21 passed).
2. The entry's batch line says "~317 lines / 2 files". 317 is the ADDED count; by the measurement
   0084-REVIEW used and stated (added + deleted), the diff is **366 changed**. Either number is far
   inside the 800/10 cap, so nothing about the batch decision changes — but two consecutive reviews
   should count the same way, and added+deleted is the one §6.3 means.

Everything else in the entry re-measures exact: the typecheck is clean on both configs, `npm test`
gives 1056/1056 with zero skips and zero `.only` (re-run, not read), and the mutation check
reproduces **in kind** — seeding the same three faults (the `zoom` guard forced false,
`objectId: object.name`, the empty-`fit` guard forced false) gives 10 failures against the entry's
9, a difference explainable by how the `select` fault is spelled. The checker is real and the suite
does bite.

### F4 — `zoom` with a 400-digit factor refuses by naming a value the operator did not type. Reported; fix-list item 4

`zoom 999…9` (400 digits) comes back as `factor must be a positive number, got Infinity`. The
refusal is right and the guard is right; the message names `Number`'s reading rather than the
operator's line. The handler cannot do better without the raw token, which `parser.ts` has and does
not pass. Not worth a signature change on its own — it goes on the fix list beside the other
message-quality items, for the cycle that opens that seam anyway.

## 5. Legibility audit

Headers present and present-tense. Vocabulary locked — "object", "slot", "document", "effect" used
exactly; no "property", no "node", no "computed". No `any`, justified or otherwise, in the diff.
Test names are behaviour sentences and most name the rule they defend (D-075 clauses 1 and 4,
D-062, §5.2), which is the standard §5.6 asks for and rarely gets.

Three things worth naming because they are the habit this project wants:

- **It deleted `noHandlerYet` rather than leaving it unreferenced**, and swept the four sentences
  elsewhere in the file that the deletion falsified. That is D-065's discipline applied unprompted.
- **It found a comment naming a line an operator cannot type** (`zoom 1e999` — the number grammar
  has no exponent form), corrected it, and said so in the "stuck" section. Verified against
  `NUMBER_PATTERN`: correct, and the guard is still reachable via a long run of digits, which the
  test now uses.
- **`onlyNamed`** turns a would-be `undefined.id` into a named test failure. Small, and it is part
  of why F1 was the only test gap left to find.

## 6. Honesty audit

The log matches the diff. Declared scope was two files and the diff is two files; `main.ts` was
declared out of scope and, apart from my own one-sentence header edit under F2, is untouched. No
silent scope expansion, no optimistic completion claim — the entry states plainly that no effect
has ever been performed and that Phase 3's criterion is not claimed, which is exactly right. F3's
two miscounts are the whole of the discrepancy.

The §6.1 trigger 5 self-report is correct and correctly argued: the five deleted tests asserted
that the five commands refuse, the commands now run, and the coverage those tests protected is
asserted MORE strictly afterwards (`COMMANDS_WITH_HANDLERS === COMMAND_NAMES`, with `COMMAND_NAMES`
derived from `COMMAND_SPECS` rather than hand-written, so the hand-written side is the only side
that can drift and the test catches it). That is a test expectation that changed because the
behaviour changed, not a test weakened to reach green — checked, not accepted.

## 7. Open questions

- **Q-012 (world units vs screen pixels)** — remains OPEN and correctly untouched; the entry takes
  no side and nothing in `command/` can. Still a product-visual call for the human, still blocking
  nothing: no `style` slot exists to author a width.
- **Q-008 (`-0` as document state)** — remains OPEN, provisional choice standing. Worth one line
  because `zoom` newly compares a number against zero: `-0 <= 0` is true, so `zoom -0` and
  `zoom 0.0` are both refused, and whichever way Q-008 lands cannot change that. No new tag, no new
  exposure.

No new question is raised by this diff.

## 8. Edits made

1. `src/command/commands.test.ts` — two `it` cases (F1), one in the `zoom` block and one in the
   `fit` block, each asserting `outcome.document` by identity with the reason in an adjacent
   comment.
2. `src/main.ts` — one sentence in the header (F2).

Verification after my edits, run here:

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  24 passed (24)
      Tests  1058 passed (1058)
```

## 9. Fix list

**Items 1–3 unchanged from 0082-REVIEW §9 and 0084-REVIEW §9. Item 4 is new and does not block.**

1. **Depth-limit `formula/parser.ts`'s recursive descent, from a CONSTANT (D-079).** Return `#PARSE`
   past a fixed depth instead of unwinding; guard `format.ts`'s recursion for the loaded-file path;
   set the constant at or below **1,000** nesting levels, never from a measurement; pin the constant
   with a test; then remove the exception sentences the four sites carry. Take it **before**
   `main.ts`.
2. **Give the missing-slot refusal a remedy.** Message only; **D-047 clause 4 does not move**.
3. **`findDanglingReferences` names a dependent once per missing source.** Group by dependent or
   dedupe within the message. `mutation.ts`, owned by the cycle that opens that function.
4. **NEW — `zoom`'s refusal names `Infinity` rather than what was typed** (F4). Message only. Owned
   by whichever cycle next opens the `parser.ts`/`commands.ts` seam for another reason.
5. **Carried from 0074-REVIEW §9, all six unchanged, none blocking:** (1) D-074's refused prompt
   answer · (2) the usage line for the form a prompting command was used in · (3) what a quoted
   command WORD means, and entry 0072's "only site" claim · (4) disclose 0074-REVIEW F4's two
   message changes and test (a) · (5) `set = x`'s self-contradictory message · (6) `parser.ts`'s
   header restating D-069 · the twelve bare "this cycle" sites in test files · `render/slots.ts` at
   the THIRD consumer of `readNumber`/`asPointArray` · `.gitattributes`.

## 10. Where Phase 3 stands, and the next slice

**Every §5.10 command the parser can produce is now built AND reviewed.** The command layer is done
as a layer: sixteen registry words, sixteen handlers, one seam out to the application. What remains
between here and Phase 3's criterion is entirely on the `main.ts` side, and STATUS's order stands
with step 1 now closed:

1. ~~D-075's `effect`~~ — done, entry 0085, reviewed here.
2. **The parser depth limit** (fix-list item 1), its own small slice, taken **before** step 3. It is
   the last thing that can throw out of `executeCommand`, and `main.ts` is where a throw stops being
   a test failure and starts being a dead input bar.
3. **`main.ts`** — one clamped camera into `renderDocument`/`hitTest`/`pointerDown`/`pointerMove`
   (D-062), the effect switch per **D-082 clause 3**, `zoom`/`fit` writing `Document.camera`
   directly and never through `mutate` (D-027 clause 2), the D-066 guard on a degenerate
   single-point extent, the transform reset before screen-space chrome, and `prompt.ts` wired so a
   canvas click during a live sequence is a `picked` response with screen→world done in `camera.ts`.

**Phase 3's criterion is correctly not claimed.** No pixel has come out of this project and the
entry says so in those words.

## 11. Verdict

**ACCEPT WITH EDITS.**

The seam is the right seam and it is thin: five arms, one optional field, no callback, no camera,
no name. The cycle spent a ruling instead of re-deriving one, disclosed the two places it was
unsure (`fit`'s empty arm may grow a field; nothing tests the far side of the seam), and its two
domain refusals are the kind of judgement an implementer is supposed to make and then have ruled —
which is what D-082 now does, in the direction the code already took.

The only real gap was on the test side and it was the premise, not the behaviour: the two commands
that touch the camera were the two not pinned as leaving the document alone. Fixed. F3's miscounts
are small enough to be worth stating only because this project's continuity is the log, and a log
that rounds its own numbers stops being checkable a few entries later.
