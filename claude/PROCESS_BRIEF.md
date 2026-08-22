# Process Brief — How This Codebase Gets Written and Reviewed
### Companion to `PROJECT_BRIEF.md` (Reactive Spatial Canvas / "Graphpaper")

Read this in full at the start of every work cycle. It governs *how* you work.
`PROJECT_BRIEF.md` governs *what* you build. Where they conflict, the project brief wins on
substance and this document wins on procedure.

**MUST** and **NEVER** are constraints. *Suggested* and *your call* mean judgement is expected.

> **Revision note (2026-08-22, Manager cleanup):** This document was compacted and its review
> cadence changed (§3, §6) to reduce implementer/reviewer round-trips — see `MANAGER_CHANGELOG.md`.
> No binding rule, rationale, or decision was removed; all `D-NNN` decisions in `DECISIONS.md`
> remain fully binding regardless of this document's wording.

---

## 1. Roles

**Implementer** — writes bulk code, tests, and docs. Optimises for legibility, small scope, and
honest reporting. Does not make architectural decisions; makes *implementation* decisions and
records them.

**Reviewer** — a senior model, invoked by the human between review points. Audits work against the
hard rules, answers open questions, issues binding rulings, and makes surgical edits. Does not do
bulk implementation.

**Human** — owns the project, routes work, and is final arbiter on product questions.

**The core asymmetry: the implementer is trusted with volume, not with judgement calls on
load-bearing structure.** When in doubt, produce less code and more questions.

---

## 2. Process artifacts

```
project-root/
├── PROJECT_BRIEF.md          # the spec. READ-ONLY to implementers.
├── PROCESS_BRIEF.md          # this document. READ-ONLY to implementers.
└── claude/
    ├── STATUS.md              # current state. Rewritten every cycle. Keep < 150 lines.
    ├── DECISIONS.md           # append-only rulings that extend the brief. Reviewer/human only.
    ├── OPEN_QUESTIONS.md      # Q-NNN questions awaiting an answer.
    └── entries/
        ├── 0001-scaffold-and-address.md
        ├── 0002-REVIEW-phase0.md
        └── ...
```

(This repo keeps all of the above flat under `claude/` rather than nesting a `claude-log/`
subdirectory — settled at 0002-REVIEW-phase0, restated here so it stops needing restating.)

Rules:

- `entries/` is **append-only**. NEVER edit or delete a past entry. If a past entry was wrong,
  say so in the new one.
- `STATUS.md` is **overwritten** each cycle — the single source of truth for "where are we right
  now," so the next implementer doesn't have to read the whole log.
- `DECISIONS.md` is binding spec-extension. Implementers **MUST** treat it as part of the brief
  and **MUST NEVER** write to it.
- `OPEN_QUESTIONS.md` holds unresolved ambiguity. Answered questions move to `DECISIONS.md` and
  are marked `ANSWERED → D-NNN` in place, not deleted.

### Reading budget at cycle start

Read, in order, and nothing else unless you have a reason:

1. `PROJECT_BRIEF.md` — all of it. Every cycle.
2. `PROCESS_BRIEF.md` — this document.
3. `claude/STATUS.md`
4. `claude/DECISIONS.md`
5. `claude/OPEN_QUESTIONS.md`
6. The most recent review entry (`*-REVIEW-*.md`) and every entry after it.

NEVER read the whole `entries/` history to get oriented. If `STATUS.md` doesn't orient you, that
is a defect in the previous cycle — say so and fix `STATUS.md`.

---

## 3. The work cycle, and how much happens before review

A **slice** is one coherent piece of work — "one module plus its tests," "one subsystem plus its
tests," or "one acceptance criterion." A **cycle** is one slice, ending in a green tree and one
log entry. Multiple cycles may complete **before** a review point — see §6 for exactly when a
review point is mandatory.

**Step 1 — Orient.** Read per §2. Identify the current phase and state within it.

**Step 2 — Declare scope, before writing code.** State the slice and what you are explicitly
*not* doing, in three sentences or fewer. Too big to state in three sentences means too big — cut
it.

**Step 3 — Check the gate.** If your declared slice would trigger a mandatory review point (§6)
and the prerequisite review hasn't landed, STOP: write the entry, set `STATUS: BLOCKED — awaiting
review`, end the cycle.

**Step 4 — Implement.** Code and tests together, to the standard in §5. A module without tests is
not done.

**Step 5 — Verify, don't assume.** Actually run the type checker (zero errors) and the full test
suite (zero failures, zero skips). If you claim a phase acceptance criterion passes, run the
executable test that demonstrates it and paste real output. NEVER write "should pass."

**Step 6 — Log.** Write a numbered entry (§11.1), then rewrite `STATUS.md` (§11.2).

**Step 7 — Decide: another slice, or a review point?** If nothing in §6 forces a review point,
you may declare and start the next slice in the same session, repeating steps 1–6. If anything in
§6 fires, or you've reached the batch cap, stop and end with the cycle summary block (§11.3) so
the human can route it to review.

**Never end mid-refactor.** The tree at end of cycle compiles and its tests pass, or `STATUS.md`'s
first line says it doesn't and exactly why.

---

## 4. Scope discipline

The single largest failure mode here is a well-meaning model that fixes things it wasn't asked
to fix. Therefore:

- **Finish the declared slice before starting the next.** Batching slices under §3 does not mean
  blurring them — each still gets its own log entry and its own honest scope statement.
- **NEVER refactor code you did not write in this batch** unless a review verdict instructed it.
  Something wrong in existing code goes in `STATUS.md`'s *Known problems*, not into a silent fix.
- **NEVER add a runtime dependency.** The brief says effectively none. Needing one is an
  escalation, not a decision.
- **NEVER build anything in the brief's §8 deferred list**, including a "small version" of it.
- **NEVER optimise.** Rule 5 is explicit: the dumbest correct implementation is the specified one.
- Finished early? Strengthen tests or docs, or end the cycle. Better than starting something
  unreviewed.

---

## 5. Documentation and legibility standard

Goal: **a reader who opens any one file, anywhere, understands what it is for, what it may do,
and which spec section it implements — without reading anything else.**

### 5.1 Vocabulary lock

Use the brief's exact domain words: *object, slot, literal, formula, derived, address, edge,
mutation, journal, preset, explode, port, block tree.* NEVER substitute a synonym — no "property"
for slot, no "field" for slot, no "node" for object, no "computed" for derived. Synonym drift is
how two models end up building two different mental models of the same system.

### 5.2 File header — required on every source file

```ts
/**
 * address.ts — Addressing scheme and resolver.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.2. Load-bearing per Rule 3.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Two layers of naming. Objects have opaque, stable, never-reused IDs (obj_7).
 *   Users write mutable names (polygon_1). Names resolve to IDs at parse time and
 *   stored ASTs hold IDs only, which is why renaming an object rewrites no formulas.
 *
 * INVARIANTS UPHELD HERE
 *   - A stored address NEVER contains a user-facing name.
 *   - Address strings are only ever produced by formatAddress(), never concatenated.
 *
 * NOT DONE HERE
 *   - Cycle detection (graph/cycles.ts), edge derivation (mutation.ts).
 */
```

### 5.3 Function docs

Document **why it exists, what it guarantees, how it fails** — never restate the signature.

```ts
/**
 * Resolves a user-written address string into a stored address.
 *
 * Why: formulas are authored against names but MUST be stored against IDs (§5.2),
 * so every parse path funnels through here.
 *
 * Rejects: unknown object name, malformed path, or a path naming a slot that does not
 * exist on that object's schema. Returns a #REF-shaped failure; NEVER throws — the
 * evaluation loop must not unwind (§5.1, "errors must never throw").
 */
```

### 5.4 Body comments

- Comment the **why**, and which rule it protects: `// Rule 6: slot set is fixed during
  evaluation — this list is rebuilt at mutation time, never here.` Ten lines of what-comments
  aren't worth one why-comment.
- NEVER comment the obvious (`// increment i`). NEVER leave commented-out code — git has it.
  NEVER write changelog comments in source — log entries are for that.
- Cross-reference the spec by section: `// §5.3: eager and TOTAL — both IF branches,
  deliberately.` Cheapest legibility mechanism available.

### 5.5 Code shape

- TypeScript strict. **NEVER use `any`** without an adjacent `// WHY-ANY:` — unjustified `any` is
  an automatic REVISE.
- Long explicit names beat short clever ones.
- A boring `switch` beats a clever dispatch table, except where the brief asks for a
  table-driven registry.
- One function, one job. A name needing "and" means split it.
- Graph state stays plain and serializable: **no closures, no class instances, no `Map`s of live
  objects, no object references used as identity.** Store IDs. This is the single easiest rule to
  violate by accident.

### 5.6 Tests

- Names are behaviour sentences: `rejects a self-inclusive range because A6 = SUM(A1:A6) is a
  genuine self-edge`.
- Every hard rule and every brief "deliberate"/"must" deserves a test that names the rule it
  defends.
- **NEVER delete, skip, weaken, or `.only` a test to reach green.** A test that looks wrong is an
  escalation (§6), not a cleanup task.

---

## 6. Review points — when a review is mandatory

Some things demand an immediate stop, no matter how much of the batch cap (§6.3) is left.
Everything else may accumulate into a batch and go to review together — the point of batching is
fewer, larger reviews instead of one review per file.

### 6.1 Always stop immediately — one of these fired

1. **A phase acceptance criterion is claimed complete.** Every phase gate is reviewed before the
   next phase begins. No exceptions — this is the backbone of the workflow.
2. **You created the *first* file of a new subsystem** (a module with no prior reviewed code to
   extend — e.g. the first file of `formula/`, `graph/`, or `mutation.ts` itself). The design
   choices baked into a subsystem's first file are the expensive ones to get wrong; later files
   extending an already-reviewed subsystem do not each need this.
3. You deviated from the brief, however small, or found it **ambiguous, silent, or
   self-contradictory** on something load-bearing.
4. You could not satisfy a hard rule cleanly and worked around it.
5. You changed a test's expectations, or a previously-passing test now fails.
6. You added a dependency, a build step, or a config file.
7. You attempted the same bug twice without fixing it. Stop on the third attempt.
8. You are about to touch anything in the brief's §8 deferred list.

### 6.2 Files that need a review before the *next* phase can start

`address.ts`, `mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts` are load-bearing
(Rules 2, 3, 6). Ongoing work on them does not force an immediate stop by itself (§6.1 already
covers the dangerous cases — new subsystems, deviations, broken rules) — but **no later phase may
begin while any load-bearing file touched this phase has unreviewed changes.** Phase gates (§6.1
trigger 1) always force the review that closes this out.

### 6.3 The batch cap — when accumulated work forces a review anyway, even with no §6.1 trigger

Stop and request review when **either**:

- **3 cycles** have completed since the last review point, or
- the **cumulative diff** since the last review point exceeds **~800 changed lines or 10 files**.

Whichever comes first. State the running total in each cycle's log entry so it's checkable without
re-deriving it.

### 6.4 `REVIEW: RECOMMENDED` / `NOT NEEDED`

For a cycle that hits neither §6.1 nor the §6.3 cap: `REVIEW: NOT NEEDED` is the normal, expected
verdict — additive work inside an already-reviewed structure, fully tested. `REVIEW: RECOMMENDED`
is for a cycle where you're genuinely unsure despite no trigger firing — say why in one sentence.
Either way, keep working the next slice unless you were told to stop.

---

## 7. Open questions

When you hit load-bearing ambiguity, you **MUST NOT** silently guess.

1. Add a question to `OPEN_QUESTIONS.md`: an ID (`Q-007`), the brief section, what's ambiguous,
   the options, and which you'd pick and why.
2. **Reversible** choice exists → take it, tag every affected site: `// PROVISIONAL(Q-007):
   assuming X pending ruling.`
3. **Not reversible** — shapes the data model, addressing, or mutation sequence — do not proceed.
   Stop the cycle and escalate (this is a §6.1 trigger).
4. When answered, the answer becomes `DECISIONS.md`'s `D-NNN`. The next implementer **MUST** grep
   `PROVISIONAL(Q-NNN)`, reconcile every site, and remove the tags.

Asking a good question costs one cycle. Guessing wrong on addressing costs the project.

---

## 8. Reviewer protocol

The reviewer receives: the diff since the last review point (which may span several batched
cycles), the new log entries, `STATUS.md`, `OPEN_QUESTIONS.md`.

**Report only what needs reporting.** A rule or invariant genuinely untouched by the diff gets one
line ("Rules 2, 4, 6 — not touched"), not a restated table entry. Spend the words on what changed.

1. **Rule audit.** Rules 1–7, upheld/violated/not-touched, one line each — expand only where
   something is actually at stake. Rule 1 (no DOM in `engine/`) and Rule 2 (mutation-only state
   change) are checked mechanically: grep for `document.`, `window.`, `canvas`, and for state
   assignment outside `mutation.ts`.
2. **Invariant audit.** Slot set fixed during evaluation; derived slots evaluated *inside* the
   topological pass, never a post-pass; dependency extraction eager/total; evaluation lazy;
   rejection leaves prior state bit-for-bit unchanged; no dangling edges; graph state plain and
   serializable.
3. **Spec conformance.** Does the code do what the cited brief section says — including the parts
   that look like over-specification? A brief "deliberate" note is the one most likely to be
   quietly normalised away.
4. **Legibility audit.** Headers present, vocabulary locked, comments explain why, no unjustified
   `any`, tests named as behaviour.
5. **Honesty audit.** Does the log match the diff? Are the claimed test results real — re-run
   them, don't just read them. Report a match in one line; only narrate a discrepancy. Hunt hardest
   for silent scope expansion and optimistic completion claims.
6. **Answer open questions.** Every `Q-NNN` gets an answer or an explicit, reasoned deferral.

**Verdicts:**

- `ACCEPT` — proceed.
- `ACCEPT WITH EDITS` — reviewer made small, explained edits.
- `REVISE` — a numbered, specific fix list. Never "clean this up."
- `REVERT` — structurally wrong; discard, re-approach per attached direction.

**Reviewer obligations:**

- Edits are small and explained. NEVER silently rewrite a module — that destroys the log's value
  and teaches the implementer nothing.
- A recurring misunderstanding becomes a `DECISIONS.md` entry, not just a code fix. The ruling
  fixes every future cycle; the code fix fixes only this one.
- Write your own log entry (`entries/NNNN-REVIEW-<phase>.md`): rule audit, verdict, edit list,
  answered questions.
- Do not expand scope. If the brief is wrong, say so to the human — don't amend the design
  mid-review.

---

## 9. Forbidden moves

Each of these has been observed in this class of work.

- **NEVER** reach for a canvas, DOM API, or `render/*` import inside `engine/`, including for text
  measurement — inject `TextMeasurer` (Rule 1).
- **NEVER** add a `recompute()` pass for derived slots. They evaluate inside the topological pass;
  a post-pass makes every reader of a derived value permanently one step stale, and it looks like
  flaky reactivity.
- **NEVER** make `extractDependencies` lazy or branch-aware. It is eager and total across both
  `IF` branches by design (§5.3). A cycle in an untaken branch is a real cycle.
- **NEVER** write a second expression evaluator for text (Rule 4).
- **NEVER** mutate document state outside `mutation.ts`, "just for the drag preview" included
  (Rule 2).
- **NEVER** hand-maintain the edge set — re-derive from stored ASTs and schema on every mutation.
- **NEVER** silently drop an edge or leave a reference pointing at a removed slot. Reject or
  repair; there is no third option (§5.1.1).
- **NEVER** introduce a `#CYCLE` value. Cycles are rejected at mutation time, never state.
- **NEVER** report a stub, `TODO`, or untested path as complete, or claim a criterion passes
  without an executable test.
- **NEVER** weaken a test to reach green.
- **NEVER** build a substitute for compound objects/containers. Phase 7 is hand-wired
  deliberately.

---

## 10. Self-check before writing the log entry

Any "no" not explained in the entry is a defect.

- [ ] Did I do only my declared slice(s)?
- [ ] Zero `tsc --strict` errors — did I actually run it?
- [ ] All tests pass, zero skipped, zero `.only` — did I actually run them?
- [ ] Every new engine file free of DOM/canvas/render imports?
- [ ] Does all state change flow through `mutation.ts`?
- [ ] Graph state plain, serializable, ID-referenced — no closures/class instances/live `Map`s?
- [ ] Every new file has a header stating layer, allowed imports, brief section?
- [ ] Locked vocabulary used everywhere?
- [ ] Every `any` justified with `// WHY-ANY:`?
- [ ] Any `PROVISIONAL(Q-NNN)` tag whose question is already answered?
- [ ] Does the entry describe what I actually did, including what I got wrong?
- [ ] Did I apply §6 honestly, not by how confident I feel?
- [ ] If batching (§3), is the running cycle-count/diff-size toward the §6.3 cap stated?

---

## 11. Templates

### 11.1 Log entry — `claude/entries/NNNN-<slug>.md`

```markdown
# NNNN — <short title>
Date: <date>   Phase: <n>   Model: <model name>
Previous entry: NNNN-<slug>   Last review: NNNN-REVIEW-<phase> (verdict: ACCEPT)
Batch: cycle <k> of up to 3 since last review; ~<n> lines / <n> files changed so far.

## Declared scope
Three sentences or fewer.

## Explicitly not in scope
Things noticed but deliberately not touched.

## What I did
File by file. Name the brief sections implemented.

## Decisions I made
Implementation-level choices and why.

## Verification (real output)
$ npx tsc --noEmit
<paste>
$ npm test
<paste — pass/fail counts>

## Acceptance criteria status
Phase N criterion: <quoted> — PASSING / NOT YET / N/A. Demonstrated by: <test>.

## Where I got stuck / what is unfinished
Specific and unflattering — the most valuable section in the file.

## Open questions raised
Q-007 — one line. Provisional choice: X. Tagged at: <files>.

## Review point
Fired: <§6.1 items, or "none — batching"> . If none: cycles since last review <k>/3, diff
<n> lines / <n> files (cap 800/10).
```

### 11.2 `claude/STATUS.md` — rewritten every cycle

```markdown
# STATUS — as of entry NNNN

STATE: GREEN (compiles, all tests pass) | BLOCKED — awaiting review | RED — <why>

Current phase: N — <name>
Phase N acceptance criterion: <quoted> — <passing / partial / not started>
Last review point: NNNN-REVIEW-<phase>, verdict <verdict>
Cycles since last review: <k>/3 · diff since last review: <n> lines / <n> files (cap 800/10)

## Built and reviewed
- ...

## Built this batch, not yet reviewed
- ...

## Not started
- ...

## Next slice (recommended)
One paragraph.

## Known problems
Observed, out of scope. File + one line each.

## Live PROVISIONAL tags
Q-007 → src/engine/formula/deps.ts, src/engine/mutation.ts

## Gotchas for the next model
Non-obvious things that cost this cycle time.
```

### 11.3 Cycle summary block — end of your response to the human

```
CYCLE NNNN COMPLETE
Slice: <one line>
Files: <n> changed (<list>)
Tests: <passing>/<total>, 0 skipped   Typecheck: clean
Phase N criterion: <status>
Review point: <§6.1 trigger(s) fired, or "none — batch k/3, diff n/800">
Open questions: <Q-NNN list or "none">
REVIEW: REQUIRED | RECOMMENDED | NOT NEEDED
Reason: <one line>
Questions for reviewer:
  1. ...
```

### 11.4 Open question — `OPEN_QUESTIONS.md`

```markdown
## Q-007 — <one-line question>
Raised: entry NNNN   Brief section: §5.4   Status: OPEN
Ambiguity: <what the brief does not settle>
Options: (a) ... (b) ...
Recommendation: (a), because ...
Reversible? yes/no. Provisional choice taken: yes/no. Tagged at: <files>
```

### 11.5 Decision — `DECISIONS.md` (reviewer only)

```markdown
## D-004 — <ruling, stated as a rule>
Answers: Q-007   Ruled: entry NNNN-REVIEW-phase2   Binding on: all future cycles
Ruling: <imperative statement, in brief voice>
Rationale: <why, including which hard rule or invariant it protects>
Reconciliation required: grep PROVISIONAL(Q-007) and resolve.
```

---

## 12. Phase gates

The brief's §6 acceptance criteria are the contract. For each phase:

1. The criterion **MUST** be expressed as executable test(s) before the phase is claimed
   complete. A criterion shown only by screenshot, description, or manual fiddling isn't shown.
   Where the criterion is inherently visual, test the engine-side consequence and describe the
   manual check separately and honestly.
2. The implementer reports the gate as `REVIEW: REQUIRED` — a phase gate is always a §6.1 trigger,
   never something a batch can absorb.
3. The reviewer runs the rule audit and either opens the next phase or issues `REVISE`.
4. The next phase does not begin before the gate clears.

Phase 0 is the highest-leverage gate: address resolution, the three slot kinds, transactional
rollback, and derived-slot participation in the topological pass are what everything later either
rests on or breaks against. Expect it to be reviewed strictly even under the batching in §6.3.

---

## 13. If you have to make a call

Where this document is silent, prefer, in order:

1. Whatever produces the smaller diff.
2. Whatever is easier for the *next* model to understand cold.
3. Whatever is easiest to delete later.
4. Whatever generates a question instead of a commitment.

Standing bias: **an honest, unfinished cycle with a clear log is worth more than a polished cycle
that misreports itself.** The log is the project's only continuity. Protect its accuracy above
your own apparent productivity.
