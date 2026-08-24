# STATUS — as of entry 0056-RULINGS

STATE: GREEN (compiles under both configs, 653/653 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 2 GATE CLEARED — PHASE 3 IS OPEN.** Entry 0054-REVIEW-phase2 reviewed
entries 0052 + 0053: verdict **ACCEPT WITH EDITS**, no fix list. All five §6 Phase 2 acceptance
clauses re-proved against the built code, clause 5 against the brief's own two-table wording.

**Entry 0055 is an out-of-band AUDIT pass, not an implementer cycle.** It condensed every source
file's header to a present-tense contract and deleted cycle-by-cycle narration from source —
comments only, zero executable lines, 653/653 unchanged.

**Entry 0056 records the human's ruling that settles it: D-060 — comments describe the PRESENT;
they are not diaries.** D-058 is superseded in its first half (its dating rule survives inside
D-060). Q-011 is CLOSED. DECISIONS.md and the tree now agree. **Read D-060's three tiers before
writing your first comment** — note that the `(D-0XX)` citation form is ranked *Okay*, not *Good*:
a citation supplements a stated reason, it never replaces one.

Current phase: **3 — canvas, camera, geometry, command line.** Nothing in it is started.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."*

Last review point: **0054-REVIEW-phase2, ACCEPT WITH EDITS** (covering 0052 + 0053).
Cycles since last review: **0/3** · diff since last review: **0 executable lines** / 0 files
(cap 800/10). Convention: insertions + deletions (settled 0042).

**The batch counter is deliberately 0, and here is exactly why** — audit it, do not assume it.
Entry 0055's raw diff is **2,973 changed lines across 16 source files**, far past the cap. Every
one is a comment line; both typechecks are clean and the test count did not move. §6.3's cap bounds
unreviewed *executable* risk, and this pass carries none, so the implementer allowance starts
clean. The prose diff is NOT waived: the next review should audit it for dropped rationale, which
is the one real risk it carries.

## Next slice (recommended)

`render/camera.ts` — world↔screen, pan/zoom — with its tests, and nothing else. It is the smallest
first file of Phase 3, it has no canvas dependency at all (pure coordinate math), and it is the one
that closes **Q-007**: widen `document.ts`'s `CameraState` rather than replacing it, keep it plain
and serializable, do not add a second reader of it in `document.ts`, keep `deserializeDocument`'s
malformed-camera rejection, and remove the `PROVISIONAL(Q-007)` tag in that same cycle. Expect a
review point at the end of it: §6.1 trigger 2, first file of a new subsystem — which every Phase 3
subsystem's first file fires separately (`render/renderer.ts`, `command/parser.ts`,
`primitives/geometry.ts`).

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048/0049) · row/column DELETION (0050, reviewed 0051, fix list closed 0052) ·
`delete <table>` reject-until-`force` + D-057's broken-slot report channel (0053) — **all reviewed
and accepted at 0054-REVIEW-phase2**.

## Built this batch, not yet reviewed

No CODE. Entry 0055's comment-and-header condensation is unreviewed prose across all 16 non-test
source files, plus PROCESS_BRIEF §5.2/§5.4 additions and entry 0056's ruling (D-060). **Still
outstanding for the next review, and NOT discharged by D-060:** audit 0055's prose diff for
dropped rationale. D-060 sanctions the practice; it does not certify that all 16 rewritten headers
kept everything worth keeping.

## Not started

All of Phase 3 (canvas, camera, hit-testing, drag interaction, command line, geometry primitive and
presets — including a table-creation COMMAND; the engine primitive already suffices via
`createObject`) · Phases 4–7.

## Known problems

- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells": the address-repair pass is unbounded while the slot walk is
  extent-bounded, so a reference to an out-of-extent cell slot shifts to an empty position and
  dangles. Reachable only through a raw `setSlot` writing an out-of-extent cell. **Pinned by a test**
  (`mutation.test.ts`, "KNOWN INCOHERENCE" describe block, entry 0052). **D-053's companion ruling
  forbids fixing one side** — insertion has the identical divergence (0048-REVIEW case 4); both
  close together or not at all. Does NOT affect `delete <table> force` (pure identity checks, no
  extent or shifting involved).
- **A dimension write is not checked for COHERENCE with the cells that exist, in general.** D-046
  settles the KIND; D-053 makes a resize reject unless BOTH dimensions are literal. Still unguarded:
  (a) a raw `setSlot` writing an INCOHERENT `literal` count, (b) a `setSlot` EARLIER IN THE SAME
  BATCH that changes a table's `rows`/`cols` value/kind AFTER `findInvalidTableResizes` has seeded
  its per-table tracked state.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed/accepted at
  0043-REVIEW §7 Q1. Do not "fix" it; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only**
  — total TODAY, but §5.4 requires the pass to cover text boxes too once Phase 5 lands (block-tree
  content, a different AST shape). Do not build for it now; do not forget it.
- **Carried unchanged:** `camera` has no WRITE-side guard (D-027) · journal STRUCTURE deliberately
  unvalidated beyond `Array.isArray` · `lexer.ts`'s two disclosed edge cases · §5.11's `style` field
  · `nextObjectId` reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-060**) is binding without restatement here.
D-060 is the newest: comments describe the present and are not diaries — **D-058 is superseded in
its first half** by it, though D-058's dating rule survives inside it.

## Live PROVISIONAL tags and open questions

**Q-011 is ANSWERED → D-060** (human, entry 0056). Zero open questions block any phase.
**Q-007 is LIVE.** `PROVISIONAL(Q-007)` →
`document.ts`'s `CameraState`: the cycle that builds `render/camera.ts` MUST reconcile and remove
this tag (0054-REVIEW §7 restates the binding constraints). `PROVISIONAL(Q-008)` →
`graph/node.ts`'s `isIllegalNumber`, still deferred, blocking nothing — but if a Phase 3 drag can
author `-0` into `origin.x`/`origin.y`, that cycle raises it rather than assuming the deferral
holds. Next free: **Q-012**.

## Gotchas for the next model

- **Phase 3 is the first non-`engine/` code.** Rule 1 stops being free: the canvas lives in
  `render/`, `TextMeasurer` is injected, and `npx tsc --noEmit -p tsconfig.engine.json` is the
  mechanical check. Run BOTH configs, every cycle.
- **Every Phase 3 subsystem's first file is its own §6.1 trigger-2 review point** —
  `render/camera.ts`, `render/renderer.ts`, `command/parser.ts`, `primitives/geometry.ts`. Do not
  batch them.
- **Dragging calls the mutation API, per component (§5.9).** A `formula`/`derived` component is
  SKIPPED with feedback, never written. All-or-nothing dragging is the normalisation this rule
  exists to prevent, and Phase 4(c) grades it.
- **A repair report never names a slot the batch removed (D-059)** — filtered once in `mutate`
  against committed state, checking the slot, not just the object.
- **D-057's report shape: `Address[]`, recovered via schema-forward resolution
  (`resolveSlotPathForKey`), never by inverting a `slotKey` (D-010).** A future repair site that
  must report a broken slot calls `repairObjectFormulaAddresses` (generic over its callbacks)
  rather than reinventing tracking — its per-slot `broke` flag is the reference shape.
- **A range endpoint's role is decided by comparing its VALUE against the OTHER endpoint's, never by
  which AST field it occupies** (D-055) — `primitives/table.ts`'s `clampRangeEndpointValue` is the
  reference implementation.
- **A precondition check that reads document state must simulate the batch, and when TWO operation
  kinds change the SAME tracked quantity they share ONE simulation** — `findInvalidTableResizes` is
  the standing example (D-050, widened at 0052 for D-053).
- **`applyOperation`'s `insertTableLine`/`deleteTableLine`/`deleteObject`-with-`force` branches all
  touch EVERY object in the document**, per §5.1.1/§5.4. Do not add an "is this object relevant"
  pre-filter.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and no
  function in `mutation.ts` inverts a `slotKey` (D-010) — forward-resolve and match instead.
- **Comments describe the PRESENT (D-060, binding).** State the behaviour and the reason. A
  `(D-0XX)` citation is a supplement to that reason, never a substitute — ranked *Okay*, not
  *Good*. Never narrate your cycle in a comment; the log entry is for that. Headers are budgeted:
  20-40 lines ordinary, ~80 load-bearing (PROCESS_BRIEF §5.2).
- **State every file you touched in the log entry, comment-only edits included.** If you DO date a
  design decision in a comment, name the entry number, never a bare "this cycle" (D-058's
  surviving half, carried into D-060).
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
