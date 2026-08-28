# 0095 — REVIEW (phase 4 territory, code from phase 3's tail)
Date: 2026-08-27   Phase: 4   Model: Claude Opus 5 (reviewer)
Reviewing: entries **0093** (visual feedback + name labels) and **0094** (chrome anchors to the
drawn extent) — the diff since 0090-REVIEW-phase3.
Also carries: **the human's directive and sketch at this entry** — a properties panel.

**VERDICT: ACCEPT.** No reviewer edits to source. Three rulings: **D-093** (the import cycle is
removed by the split entry 0094 designed), **D-094** (the properties panel, the human's directive,
specified), **D-095** (the chrome anchor is settled; no label collision avoidance).

---

## 1. Honesty audit — re-run, not read

```
$ npx tsc --noEmit                              → exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      → exit 0, no output
$ npx vitest run                                → Test Files 25 passed | Tests 1148 passed (1148)
```

Zero skipped, zero `.only`. Entry 0094's numbers are exactly right.

**Mutant re-check.** I re-seeded entry 0094's strongest claimed mutant myself — `chromeAnchorPoint`
returning `extent.maxY` instead of `extent.minY` — and got `Tests 12 failed | 1136 passed`, matching
the log's claimed 12 kills to the test. File restored and `diff`-confirmed byte-identical. The
mutation table in entry 0094 is trustworthy.

**Log against diff.** Every claim in both entries is in the diff and nothing is in the diff that is
not in an entry. The six changed tests in 0094 are each named with a reason that holds up under
reading: three table tests moved because the label's x genuinely moved from the origin corner to the
extent's centre (that IS the fix), one filter widened because a rect fixture now earns a label, one
was rewritten to pin an absolute position under a non-identity camera, and one was retired and
replaced with a test of the new stated rule. **None weakened.** The replaced test ("labels a circle
whose radius is missing at its origin") is the only one I checked closely for a weakening, because
retiring a test is where weakening hides: its replacement asserts a stricter thing (no label at all
for a shape with no `vertices`) and still checks the body draws from `origin`/`radius`. Fine.

**Scope.** Both entries stayed inside their declared slice. Entry 0094 explicitly declined the
restructuring its own fix argued for and escalated instead — that is exactly §4 and §6.1 working,
and it is the reason this review has a clean question to rule on rather than a fait accompli.

## 2. Rule audit

- **Rule 1 (no DOM in `engine/`)** — upheld. Grepped `document.`/`window.`/`canvas`/`render/` across
  `src/engine`: every hit is either the word "document" in prose or `document.nextObjectId` on the
  engine's own `Document` value. The diff touches `render/` and `main.ts` only.
- **Rule 2 (mutation-only state change)** — upheld, and strengthened by construction: every function
  added in both entries takes a `GraphObject` and calls `ctx` methods. Nothing in `render/` writes.
- **Rule 3 (two-layer addressing)** — not touched. The renderer resolves no name to an id; `main.ts`
  hands the renderer an **id** and D-082 clause 4's discipline holds on this side too.
- **Rule 4 (one expression evaluator)** — not touched.
- **Rule 5 (dumbest correct implementation)** — upheld, and honestly disclosed where it bites: the
  chrome constants are chosen, not measured, and entry 0094 says so rather than implying tuning.
  Declining to invent inter-object collision avoidance was the right call and is now D-095.
- **Rules 6, 7** — not touched.

**D-010 (never two readings of one question)** deserves its own line, because both entries are
essentially applications of it: `buildCirclePath`/`buildVerticesPath` exist so the highlight
re-strokes the *same* path the body drew, and `chromeAnchorPoint` calls `objectExtent` rather than
re-deriving a per-type anchor. Entry 0093's defect was the cost of the alternative, one cycle early.

## 3. Invariant audit

No engine invariant is in scope: the diff adds no mutation, no edge derivation, no evaluation, and no
serialized state. `renderDocument` remains a pure function of its arguments and still never throws —
every new branch (`chromeAnchorPoint` undefined, `objectHasError` over a flat slot map,
`formulaDrivenTicks` on absent slots) returns rather than assuming.

One invariant the diff *changed* and got right: `renderDocument` used to leave `ctx` holding the
camera transform and carried a HAZARD note saying the first screen-space-chrome cycle owned that
problem. This is that cycle, and it closed it by construction — the third pass resets to identity
last. The note was deleted rather than left to rot, which is D-065 applied to the author's own text.

## 4. Spec conformance

§5.9's three feedback items are built and read as the brief writes them. Two readings worth pinning:

- **"error badge on objects holding `ErrorValue`s"** is implemented as *any* slot holding one, not
  only the slots the renderer draws from. That is the wider and correct reading — a broken cell
  formula in an otherwise fine table is exactly the case an operator needs flagged.
- **"a subtle indicator on slots that are formula-driven"** is implemented narrowly, over
  `origin.x`/`origin.y` only, and the file says so in its NOT DONE HERE. Accepted: the brief's own
  §5.9 defines the per-component rule over those two slots, and a general "every writable slot"
  enumeration is D-094's `props.ts`, one cycle away. **When `props.ts` exists, the indicator's
  narrowness becomes a choice rather than a limitation** — revisit it there.

## 5. Legibility audit

Headers present and current on both changed files; the `renderer.ts` header's rewrite from two passes
to three is accurate to the code. Vocabulary is locked and consistent ("chrome", "pass", "extent").
Comments explain why, not what — `chromeAnchorPoint`'s doc in particular records the defect, the
screenshot, and why an offset assertion could not catch it, which is the single most useful comment
added in this batch. No `any`. Tests are named as behaviour.

One nit, not worth an edit: the chrome pass leaves `ctx.font`, `ctx.textAlign` and `ctx.textBaseline`
at chrome's values on return. Harmless today — `drawCellText` sets all three itself every call, and
D-094's panel is DOM, not canvas — but it is the same shape of hazard as the transform one that just
got closed. **Fix-list item, not a defect.**

## 6. The three questions entry 0094 asked — answered

**Q1, the import cycle: ruled — take the split. D-093.** `render/slots.ts` + `render/extent.ts`, one
mechanical cycle, no logic change, run FIRST. The cycle resolves today only because every cross-file
reference happens to sit inside a function body; that is not an invariant anyone stated, no test can
see it, and the failure is a blank application from a one-line edit. The disclosure was correct and
the escalation was correct — this is the ruling §4 requires, and it is the authorisation to touch two
reviewed files.

**Q2, the anchor: top-centre stands. D-095.** Not the top-left. The human saw the labels, objected to
the ones inside circles, and objected to nothing else.

**Q3, collision avoidance: build none. D-095.** Rule 5. And D-094 takes the selected object's label
off the canvas entirely, which is the case where two overlapping labels would matter most.

## 7. The human's directive at this entry — the properties panel

The human's note and sketch are ruled as **D-094**, in full, with fourteen clauses. The three things
that matter most for whoever implements it:

1. **It is display-only, and that is what makes it cheap.** No handlers, no `mutate`, `pointer-events:
   none`. Editing and linking by mouse are still **Q-014** and still the human's alone. The panel does
   not become a second authoring path, so D-069 stays true and none of the hard questions move.
2. **It amends the brief, once, narrowly.** §5.10's "no panels, no toolbars" is the human's own
   sentence and the human has amended it for this one surface. `PROJECT_BRIEF.md` §5.10 now carries a
   pointer. **Nothing else is thereby permitted.**
3. **One enumeration, shared with `props`.** `src/command/props.ts`, pure, feeding both the command's
   log lines and the panel's rows. The command and the panel must never be able to disagree about
   what slots an object has — the entire lesson of D-010, applied before there are two of them.

**Why the queue changes.** `props` was already next. D-094 makes it the *shared* substrate rather than
a standalone command, so the order is now: **D-093's split → `props.ts` + the `props` command →
the panel.** Each is a full cycle; the second and third are load-bearing enough to want reviews.

**Two traps the implementer will hit, both already recorded as D-094 clauses and repeated here
because they are the expensive ones:** `worldToScreen` returns BACKING pixels and a DOM panel is
positioned in CSS pixels (clause 12 — the same conversion that shipped as a bug once already), and a
table's non-derived slot paths number in the tens of thousands, so cells get one summary row and not
one row each (clause 8, D-077).

## 8. What I did NOT do

No source edits. Nothing in this batch needed one: the defect this batch contains was found by a
human, fixed by the implementer, and disclosed with the lesson attached. The one structural problem
is a design question, and a reviewer who quietly restructured two files instead of ruling would have
destroyed exactly the log value §8 protects.

## 9. Fix list — carried, with two added

Items 1–8 from 0090-REVIEW §9 / STATUS.md carry unchanged. Added here:

9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set** (§5 above). Owned by whichever
   cycle next touches `drawObjectChrome`; save/restore or set-every-call, implementer's choice.
10. **The formula-driven indicator's narrowness should be re-decided once `props.ts` exists** (§4
    above). Not a defect; a deliberate narrowness whose reason expires.

## 10. Gate state

Phase 3's gate is closed and stays closed. **Phase 4 remains open and unclaimed**, and the human
session it needs is still owed — but the reason to want it has sharpened: an operator who can click a
shape and read `origin.x` off a panel can attempt Phase 4's binding without reading
`primitives/schema.ts`. That is three cycles away, and they are the three now at the top of the
queue.
