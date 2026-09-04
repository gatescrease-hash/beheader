# 0169 — `engine/script/stub.ts`, `SCRIPT_SCHEMA`, and §5.10's `script` command
Date: 2026-09-04   Phase: 6   Model: implementer (Claude Sonnet 5)
Previous entry: 0168-REVIEW-phase6   Last review: 0168-REVIEW-phase6 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~893 lines / 13 files changed so far (over the
800/10 cap already — see "Review point" below; this is its own §6.1 trigger 2 regardless).

## Declared scope

D-141 clause 7's next slice, exactly as STATUS.md and 0168-REVIEW named it: `engine/script/stub.ts`
(§5.8's `ScriptNode` shape, the `evaluateScriptOutput` seam, and the path/enumerator/compute
plumbing for a `script` node's three dynamic slot families), `SCRIPT_SCHEMA` wired into
`primitives/schema.ts`'s registry, and §5.10's `script x= y=` CREATION command (parser + handler).
Not in scope: any `addport`/`removeport` COMMAND (§5.10 names no grammar for one; `addPort`/
`removePort` stay reachable only via `mutation.ts`'s operations directly, exactly as D-141 clause 6
left them), and anything render/UI-facing (a labelled box with ports — a separate future slice, the
same posture `image`'s 0165 cycle took for drawing, per D-066).

## Explicitly not in scope

- Real Python execution — `evaluateScriptOutput`'s body stays the stub §5.8 gives verbatim.
- `render/`, `extent.ts`, `hittest.ts` — a script node has no drawing, no extent, and is unselectable,
  same as `image` before its own rendering cycle.
- Fixing `command/props.ts`'s D-077 walk to summarise `script`'s two new dynamic non-derived
  families (`in.*`/`placeholder.*`) — that file's own header already anticipated a future dynamic
  group needing a summary "or it is silently dropped"; I disclosed the gap is now REAL (not
  hypothetical) in that file's header, but did not fix it — out of this slice's declared scope.
- A per-object reconciliation check between `ports.out` and `placeholder.<name>`'s VALUES beyond
  what `mutation.ts`'s existing generic D-017/D-018 checks already give for free (see "Decisions I
  made" below for why nothing new was needed there).

## What I did

- **`src/engine/script/stub.ts`** (new file, first of the `engine/script/` subsystem — §6.1 trigger 2).
  `ScriptNode` (§5.8's shape, with one disclosed deviation — see below), `evaluateScriptOutput`
  (copied verbatim from §5.8's own code block), `SCRIPT_LANGUAGE_PATH`/`SCRIPT_SOURCE_PATH`,
  `scriptInPortPath`/`scriptOutPortPath`/`scriptPlaceholderPath`, `enumerateScriptInPaths`/
  `enumerateScriptPlaceholderPaths` (the two dynamic `NonDerivedSlotPathGroup` enumerators, sized by
  `object.ports.in`/`object.ports.out`), and `enumerateScriptOutDerivedSlots` (the one dynamic
  `DerivedSlotGroup` enumerator, sized by `object.ports.out`) with its own dependency resolver
  (`scriptOutDependencies`) and compute function (`makeScriptOutputCompute`).
- **`src/engine/script/stub.test.ts`** (new). Path builders, both `enumerate*` functions (portless and
  wired), `evaluateScriptOutput` directly, `enumerateScriptOutDerivedSlots`'s dependency shape
  (proven against a two-in/two-out fixture so one port's compute never picks up another's
  dependencies), and the compute function itself called directly with a fake `read` (placeholder
  read, missing/error input propagation in port-declaration order, missing/error placeholder,
  never-throws) — the same posture `schema.test.ts`'s own `add` compute tests take.
- **`src/engine/primitives/schema.ts`**. `SCRIPT_SCHEMA` (§5.8): two static paths (`language`,
  `source`) plus `origin.x`/`origin.y` (imported, same identity every positioned object uses); two
  dynamic non-derived groups (`in.*`, `placeholder.*`); one dynamic derived group (`out.*`);
  `slotOptions` closing `language` to `["python"]`. Registered in `SCHEMAS`. Header's scope list and
  NOT DONE HERE updated (D-137) — `script` moves out of "no entry yet."
- **`src/engine/primitives/schema.test.ts`**. Removed `script` from the "no schema entry" case
  (only `polyline` remains); added a `script` registry-wiring describe block covering the portless
  and wired non-derived/derived path lists, the dynamic dependency kind, and `slotOptions`.
- **`src/command/parser.ts`**. `CreateScriptCommand` (`kind`, `x`, `y` — the identical shape
  `CreateImageCommand` takes), added to the `Command` union, a `script` `COMMAND_SPECS` entry
  (`x=`/`y=` required, one-step `point` prompt, mirroring `image`'s entry exactly), removed `script`
  from `COMMANDS_SPECIFIED_BUT_NOT_BUILT`, updated both header notes that named it.
- **`src/command/parser.test.ts`**, **`src/command/prompt.test.ts`**. `script x=0 y=0` added to
  `DOCUMENTED_EXAMPLES`/`EQUIVALENT_FORMS` respectively (both are coverage-checked against the
  registry, so a missing entry would have failed loudly rather than silently under-testing).
- **`src/command/commands.ts`**. `DEFAULT_SCRIPT_LANGUAGE`/`DEFAULT_SCRIPT_SOURCE`, `createScript`
  (mirrors `createImage`: four static slots from the command + defaults, no derived slots to fill,
  no ports — a freshly created script node is portless), registered in `executeCommand`'s switch and
  `COMMANDS_WITH_HANDLERS`. Header's IMPLEMENTS line updated (D-137).
- **`src/command/commands.test.ts`**. `createScript` basic-shape test, the same `origin.x`/`origin.y`
  identity test `image` has, a grammar test (`w=`-style stray argument refused), `script x=0 y=0`
  added to two existing coverage lists (`carries createdObjectId...`, `EVERY_REGISTRY_EXAMPLE`), and
  two integration tests: one wiring both port families through raw `addPort`/`setSlot` batches and
  reading/writing them via ordinary `set`, and one reproducing **Phase 6's acceptance criterion's
  exact shape** end to end (`table_1.A1` → `script_1.in.factor` via `link`; `script_1.out.result` →
  `polygon_1.radius` via `link`; editing the placeholder moves the polygon; the table binding still
  holds afterward) — see "Acceptance criteria status" below for what this does and does not claim.
- **`src/engine/mutation.test.ts`**. Three pre-existing hand-built `script` fixtures updated (see
  "Decisions I made" — §6.1 trigger 5) plus the describe block's own header comment, which was
  explicitly written to go stale the moment a schema landed and did.
- **`src/engine/document.test.ts`**. Three pre-existing ports round-trip fixtures updated the same
  way, plus the describe block's own header comment, plus `documentWithPorts`'s signature widened
  with an optional `slots` parameter (default `{}`, so every test that doesn't need one is untouched).
- **`src/command/props.test.ts`**. Swapped the "type with no schema entry" example from `script` to
  `polyline` (the one type left without one) — the same swap this test's own comment already
  disclosed happening once before (`text`, entry 0127).
- **`src/command/props.ts`**. One header-comment correction (D-137): the D-077 paragraph's claim
  "`TABLE_SCHEMA` is the only `dynamic` group in the registry today" is now false; reworded to name
  the real, now-live gap for `script`'s two dynamic non-derived families. No code change.

## Decisions I made

1. **`ScriptNode.in`/`.out` are `Record<string, Value>`, not §5.8's literal `Record<string, Slot>`.**
   `evaluateScriptOutput`'s body reads only `.placeholders[portName]`; reconstructing full `Slot`
   objects for fields the seam never touches would be untested, unused code — and worse, reading them
   from `object.slots` directly (bypassing the dependency-gated `read`) would be a genuine staleness
   trap for a formula-driven port, since `object.slots[key].value` is the PREVIOUS pass's cached
   value mid-evaluation, not the current one `evaluatedValues` holds. I built `in`/`out` from the
   SAME resolved values `read()` already supplies (the `inputs` record, and an empty `{}` for `out`
   since a port never depends on ANOTHER port's own output), matching the runtime data the seam
   would actually need once Python lands and starts reading them for real, rather than the brief's
   literal type. Disclosed here per §6.1 trigger 3; reversible in one file, no stored state depends
   on it (never serialized, never read outside `stub.ts`).
2. **`placeholder.<port>` is its OWN dynamic non-derived slot family, not part of `out.<port>` or a
   structural field like `ports`.** §5.8 calls `placeholders` "user-editable," and `out.<port>` is
   `derived` — never user-settable (§5.1) — so the value a user edits cannot live at that path. A
   literal slot is the ordinary, already-existing mechanism for exactly this shape (`text.content`
   feeding `resolvedContent` is the same pattern). Sized by `object.ports.out`, the same structural
   field `out.*` itself is sized by — one authority, two families reading it, no drift.
3. **`out.<port>`'s dependency list includes its OWN `placeholder.<port>` address, not just every
   `in.*` address §5.1's one sentence names.** Required by construction, not merely thorough:
   `graph/eval.ts`'s `read` (D-013) refuses anything not in a slot's OWN declared dependency set, so
   without this the compute could never read the very value it exists to surface, and editing the
   placeholder would never re-trigger `out.<port>` at all. **Verified by neutralisation** (D-016): I
   removed this one address from `scriptOutDependencies`'s `resolve` and re-ran the new Phase-6-shape
   integration test — it failed with exactly the predicted `#REF: derived slot's compute function
   read an address outside its declared dependencies (D-013)`, confirmed at the exact line reading
   `script_1.out.result`. Restored; the full suite is green with it back (see Verification).
4. **A REAL CONSEQUENCE THIS SLICE SURFACED, worth flagging loudly for whoever builds real port UI
   next:** because `out.<port>`'s dependencies are literal addresses (not a range — D-047's
   "empty-in-a-range is fine" does not apply here), `validateIntegrity`'s existing dangling-reference
   check (§5.1.1) now requires that EVERY currently-declared `in.<port>` and this port's own
   `placeholder.<port>` be REAL slots, not merely declared-but-tolerated-absent paths, the moment
   ANY out port exists. Declaring a port's NAME (`addPort`) and giving it a VALUE (`setSlot`) were
   already documented as a required pairing in `mutation.ts`'s own doc comments; this cycle is what
   makes that pairing load-bearing rather than aspirational, and it is what broke three pre-existing
   hand-built test fixtures — see below.
5. **No new validateIntegrity check was needed for the `placeholder.*`/`ports.out` reconciliation
   D-141 clause 3 asks for.** `mutation.ts`'s existing D-017/D-018 checks already resolve
   `nonDerivedSlotPaths`/`derivedSlots` PER OBJECT via `resolveNonDerivedSlotPaths`/
   `resolveDerivedSlots`, which my dynamic groups feed into generically — the SAME mechanism that
   already reconciles `table`'s `cells.*` reconciles `script`'s three families with zero new code in
   `mutation.ts` or `document.ts`. This is the payoff D-141's widening was explicitly for.
6. **`language` is a literal slot, not a bare structural field.** §5.8 fixes it to `"python"`, but it
   is still document state a formula could in principle read (`= script_1.language`), and every
   other primitive's fixed-per-object data is a slot (`image.opacity`, `text.style.font`), never a
   `GraphObject`-level field — `ports` is structural for the opposite reason (it SIZES a family,
   which a slot value may never do, D-046/Rule 6). `slotOptions` closes it to one legal value so the
   panel would offer a single choice rather than free text, the same mechanism `TEXT_SCHEMA` already
   uses for a real closed set.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npm test
 Test Files  35 passed (35)
      Tests  1844 passed (1844)
$ npx vite build
✓ built in 362ms
$ grep -rnE "\.(only|skip|todo)\(" src --include=*.test.ts
(no matches)
$ grep -rn "PROVISIONAL(" src | grep -v "Q-008\|Q-012"
(no matches — no new PROVISIONAL tags; Q-026 is answered, not deferred)
```

Before touching test fixtures, I ran the suite once with only `stub.ts`/`stub.test.ts`/
`SCRIPT_SCHEMA`/the parser+commands wiring in place, to see the real failures rather than guess at
them: 9 failures, all traced to one of two root causes (documented in "Decisions I made" #4) —
`command/prompt.test.ts`'s/`command/commands.test.ts`'s coverage-sweep tests missing the new `script`
entry (mechanical, one line each), and pre-existing hand-built `script`/ports fixtures in
`mutation.test.ts`/`document.test.ts` that predate `SCRIPT_SCHEMA` and are now schema-inconsistent.
Every one of those 9 was root-caused to an actual line before I touched it — none was patched by
guessing at the assertion.

## Acceptance criteria status

Phase 6 criterion: *"`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to
`script_1.out.result`, and changing the placeholder output value moves the polygon — with no
script-specific code in `eval.ts`"* — **NOT YET, and not claimed here.** `command/commands.test.ts`'s
new integration test demonstrates this EXACT shape passing at the mutation/command layer today (real
output above), which is the phase's whole engine-side mechanism proven working — but the criterion
as PROJECT_BRIEF §6 states it is a Phase-gate claim (§6.1 trigger 1, its own mandatory review, its
own D-016 table), and this cycle built only D-141 clause 7's next slice, not a gate entry. What
remains before that claim can honestly be made: nothing at the engine level that I can see, but I
have not gone looking for a gap — that audit belongs to whoever writes the gate entry, not to a
slice that was scoped in three sentences before this test existed.

## Where I got stuck / what is unfinished

- The three-way tangle between `out.<port>`'s dependency list, D-013's read-gating, and D-018's
  derived-slot-presence check took a failed first pass to see fully: my first version of the
  `mutation.test.ts`/`document.test.ts` fixture fixes only added the MISSING `out.<name>` derived
  slot (satisfying D-018 alone) and still failed, with a dangling-reference message rather than a
  D-018 one, because `in.*`/`placeholder.*` also needed to be real slots for the edges themselves to
  resolve. I did not guess at a second fix — I ran `mutate` directly against a minimal repro
  (`tsx` against the real fixture) to read the actual rejection message before touching anything
  further, which is what surfaced decision #4 above. Recorded so it doesn't cost the next reader the
  same detour.
- `command/props.ts`'s D-077 walk does not summarise `script`'s two dynamic non-derived families
  (disclosed in that file's own header now, not fixed — see "Explicitly not in scope").
- No `addport`/`removeport` command exists; every port in this cycle's own tests is declared through
  raw `mutation.ts` operations. This is the brief's own gap (§5.10 names no grammar for it), not an
  oversight, and I did not invent one under §8's last bullet.

## Open questions raised

None. Q-026 stays answered at D-141; nothing here reopens it.

## Review point

Fired: **§6.1 trigger 2** (`engine/script/`'s first file — its own review point by D-141 clause 7's
own explicit instruction, independent of anything else) and **§6.1 trigger 5** (three pre-existing
tests' FIXTURES changed — zero assertions weakened or changed; see "Decisions I made" #4 for the root
cause and each file's own diff comment for exactly what changed and why). Cumulative diff since
0168-REVIEW: **~893 lines / 13 files** (11 tracked files + 2 new), already over the 800/10 cap on its
own — moot given trigger 2 already forces a stop, stated here per the self-check's own requirement.
