# Process Brief — How This Codebase Gets Written and Reviewed
### Companion to `PROJECT_BRIEF.md` (Reactive Spatial Canvas / "Graphpaper")

Read this document in full at the start of every work cycle. It governs *how* you work.
`PROJECT_BRIEF.md` governs *what* you build. Where the two appear to conflict, the project
brief wins on substance and this document wins on procedure.

**MUST** and **NEVER** are constraints, not suggestions. *Suggested* and *your call* mean
judgement is expected.

---

## 1. Roles

**Implementer** — the model doing the work. Writes bulk code, tests, and documentation.
Optimises for legibility, small scope, and honest reporting. Does not make architectural
decisions; makes *implementation* decisions and records them.

**Reviewer** — a senior model, invoked by the human between cycles. Audits work against the
seven hard rules, answers open questions, issues binding rulings, and makes surgical edits.
Does not do bulk implementation.

**Human** — owns the project, routes work between implementer and reviewer, and is the final
arbiter on product questions ("should the system do X at all?").

The most important asymmetry: **the implementer is trusted with volume, not with
judgement calls on load-bearing structure.** When in doubt, produce less code and more
questions.

---

## 2. Process artifacts

```
project-root/
├── PROJECT_BRIEF.md          # the spec. READ-ONLY to implementers.
├── PROCESS_BRIEF.md          # this document. READ-ONLY to implementers.
└── claude-log/
    ├── STATUS.md             # current state of the world. Rewritten every cycle. Keep < 150 lines.
    ├── DECISIONS.md          # append-only rulings that extend the brief. Reviewer/human writes only.
    ├── OPEN_QUESTIONS.md     # Q-NNN questions awaiting an answer.
    └── entries/
        ├── 0001-scaffold-and-address.md
        ├── 0002-graph-data-model.md
        ├── 0003-REVIEW-phase0.md
        └── ...
```

Rules for these files:

- `entries/` is **append-only**. NEVER edit or delete a past entry, including your own from a
  previous cycle. If a past entry was wrong, say so in the new entry.
- `STATUS.md` is **overwritten** each cycle. It is the single source of truth for "where are we
  right now." It exists so the next implementer does not have to read forty log entries.
- `DECISIONS.md` is binding spec-extension. Implementers **MUST** treat it as part of the brief
  and **MUST NEVER** write to it. Only the reviewer or the human adds entries.
- `OPEN_QUESTIONS.md` holds unresolved ambiguity. Answered questions move to `DECISIONS.md`
  and are marked `ANSWERED → D-NNN` in place, not deleted.

### Reading budget at cycle start

Read, in this order, and nothing else unless you have a reason:

1. `PROJECT_BRIEF.md` — all of it. Every cycle. Yes, again.
2. `PROCESS_BRIEF.md` — this document.
3. `claude-log/STATUS.md`
4. `claude-log/DECISIONS.md`
5. `claude-log/OPEN_QUESTIONS.md`
6. The most recent review entry (`*-REVIEW-*.md`) and every entry written after it.

NEVER read the entire `entries/` history to get oriented. If `STATUS.md` is insufficient to
orient you, that is a defect in the previous cycle — say so in your entry and fix `STATUS.md`.

---

## 3. The work cycle

Each cycle is one coherent slice of work that ends in a green tree and one log entry.

**Step 1 — Orient.** Read per §2. Identify the current phase (from the brief's §6 build order)
and the current state within it.

**Step 2 — Declare scope, before writing any code.** Write down, in your entry draft, the
specific slice you intend to complete this cycle and what you are explicitly *not* doing. A
good slice is roughly "one module plus its tests" or "one acceptance criterion." If you cannot
state the slice in three sentences, it is too big — cut it.

**Step 3 — Check the gate.** If your declared slice would trigger a mandatory review (§6) *and*
the last review has not yet cleared the prerequisite, STOP. Write the entry, set
`STATUS: BLOCKED — awaiting review`, and end the cycle. Do not proceed hoping for forgiveness.

**Step 4 — Implement.** Write code and tests together, to the documentation standard in §5.
Tests are not a follow-up chore; a module without tests is not done.

**Step 5 — Verify, do not assume.** Actually run: the type checker (strict, zero errors), the
full test suite (zero failures, zero skips), and — if you claim a phase acceptance criterion
passes — the executable test that demonstrates it. Paste real output into your entry. NEVER
write "should pass" or "tests presumably green."

**Step 6 — Log.** Write a new numbered entry using the template in §11.1. Then rewrite
`STATUS.md` using §11.2.

**Step 7 — Self-assess and escalate.** Apply §6's trigger list honestly. End your response with
the cycle summary block (§11.3) so the human can route it. If any trigger fired, the verdict is
`REVIEW: REQUIRED`. You do not get to talk yourself out of a trigger.

**Never end a cycle mid-refactor.** The tree at end of cycle compiles and its tests pass, or
`STATUS.md` states in its first line that it does not and exactly why.

---

## 4. Scope discipline

The single largest failure mode in this workflow is a well-meaning model that fixes things it
was not asked to fix. Therefore:

- **One slice per cycle.** Finish it. Do not start the next one "since there was room."
- **NEVER refactor code you did not write this cycle** unless a review verdict instructed you
  to. If you see something wrong in existing code, write it in `STATUS.md` under
  *Known problems* and move on.
- **NEVER add a runtime dependency.** The brief says effectively none. If you believe you need
  one, that is an escalation, not a decision.
- **NEVER build anything in the brief's §8 deferred list**, including "just a small version of
  it," including compound objects, undo UI, dirty tracking, or a second viewport.
- **NEVER optimise.** Rule 5 is explicit: performance is a non-goal and the dumbest correct
  implementation is the specified implementation. Writing an incremental cycle checker
  because the naive one "felt wasteful" is a rule violation, not initiative.
- If you finish your slice early, the correct move is to strengthen tests, improve
  documentation on what you just wrote, or end the cycle. All three are better than starting
  something unreviewed.

---

## 5. Documentation and legibility standard

The goal: **a reader who opens any single file, at any random point, understands what it is
for, what it is allowed to do, and which part of the spec it implements — without reading
anything else.**

### 5.1 Vocabulary lock

The brief defines the domain vocabulary: *object, slot, literal, formula, derived, address,
edge, mutation, journal, preset, explode, port, block tree*. Use exactly these words in code,
comments, tests, and log entries. NEVER introduce a synonym — no "property" for slot, no
"field" for slot, no "node" for object (a node is a *slot*, per §5.1 of the brief), no "computed"
for derived. Synonym drift is how two models end up building two mental models of the same
system.

### 5.2 File headers — required on every source file

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

### 5.3 Function documentation

Document **why it exists, what it guarantees, and how it fails** — never restate the signature.

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

### 5.4 Comments in the body

- Comment the **why**, and above all the **which rule this protects**. `// Rule 6: slot set is
  fixed during evaluation — this list is rebuilt at mutation time, never here.` is worth ten
  comments explaining syntax.
- NEVER comment what a line obviously does (`// increment i`).
- NEVER leave commented-out code. Delete it; the journal and git have it.
- NEVER write changelog comments in source (`// updated 2026-08-21 to fix bug`). That is what
  the log entries are for.
- Cross-reference the spec by section when implementing a specified behaviour: `// §5.3: eager
  and TOTAL — both IF branches, deliberately.` This lets any reader jump from code to spec and
  back, which is the cheapest legibility mechanism available.

### 5.5 Code shape

- TypeScript strict. **NEVER use `any`** without an adjacent `// WHY-ANY:` comment justifying
  it; unjustified `any` is an automatic REVISE.
- Prefer long, explicit names over short clever ones. `derivedSlotsInTopologicalOrder` beats
  `sorted`.
- Prefer a boring `switch` over a clever dispatch table, *except* where the brief explicitly
  asks for a table-driven registry (formula functions §5.3, command parser §5.10).
- Functions do one thing and are named for that thing. If the name needs "and," split it.
- Graph state stays plain and serializable: **no closures, no class instances, no `Map`s of live
  objects, no object references used as identity.** Store IDs. This is a stack decision, not a
  style preference, and it is the single easiest rule to violate accidentally.

### 5.6 Tests

- Test names are sentences describing behaviour: `rejects a self-inclusive range because
  A6 = SUM(A1:A6) is a genuine self-edge`.
- Every hard rule and every "deliberate" or "must" in the brief deserves a test whose name
  says which rule it defends. The eager-dependencies/lazy-evaluation distinction (§5.3) and
  the "prior state is provably unchanged after rejection" property (§5.1) are the two most
  important; both must be tested explicitly, not implied.
- **NEVER delete, skip, weaken, or `.only` a test to reach green.** If a test appears wrong,
  that is an escalation (§6), not a cleanup task.

---

## 6. Escalation — when review is mandatory

Triggers are objective. If any of these is true, your verdict is `REVIEW: REQUIRED`.

1. **A phase acceptance criterion is claimed complete.** Every phase gate is reviewed before
   the next phase begins. No exceptions — this is the backbone of the whole workflow.
2. You created or modified any of: `address.ts`, `mutation.ts`, `graph/*`,
   `primitives/schema.ts`, `document.ts`. These are the load-bearing pieces (Rules 2, 3, 6).
3. You created any **new file** under `src/engine/`.
4. You deviated from the brief in any way, however small, or found the brief **ambiguous,
   silent, or self-contradictory** on something you had to decide.
5. You could not satisfy a hard rule cleanly and worked around it.
6. You changed a test's expectations, or a previously passing test now fails.
7. You added a dependency, a build step, or a config file.
8. You attempted the same bug twice without fixing it. Stop on the third attempt; a model
   looping on a bug is usually holding a wrong model of the system, and more attempts make
   the diff worse.
9. Your diff exceeds roughly 400 changed lines or 6 files. Large diffs are reviewed on
   principle, because they are where unnoticed drift accumulates.
10. You are about to touch anything in the brief's §8 deferred list for any reason.

`REVIEW: RECOMMENDED` is for work that fired no trigger but where you are genuinely unsure —
say why in one sentence.

`REVIEW: NOT NEEDED` is legitimate and should be common: additive work inside an
already-reviewed structure, fully covered by tests, no trigger fired. Examples: adding built-in
functions to the formula registry, adding a command to the command registry, adding
render-layer polish, extending test coverage.

---

## 7. Open questions

When you hit ambiguity on something load-bearing, you **MUST NOT** silently guess.

1. Add a question to `OPEN_QUESTIONS.md` with an ID (`Q-007`), the exact brief section, what is
   ambiguous, the options you see, and which you'd pick and why.
2. If you can proceed with a **reversible** provisional choice, do so, and mark every affected
   site in code with a greppable tag: `// PROVISIONAL(Q-007): assuming X pending ruling.`
3. If the choice is **not** reversible — it would shape the data model, the addressing scheme,
   or the mutation sequence — do not proceed. Stop the cycle and escalate.
4. When the reviewer answers, the answer is appended to `DECISIONS.md` as `D-NNN`. The next
   implementer **MUST** grep for `PROVISIONAL(Q-NNN)`, reconcile every site, and remove the tags.
   A cycle is not complete while a *resolved* question still has live `PROVISIONAL` tags.

Asking a good question costs one cycle. Guessing wrong on the addressing scheme costs the
project.

---

## 8. Reviewer protocol

The reviewer receives: the diff, the new log entries, `STATUS.md`, and `OPEN_QUESTIONS.md`.

Review in this order, and report in this order:

1. **Rule audit.** Walk hard Rules 1–7 explicitly, one line each: upheld / violated / not
   touched. Rule 1 (no DOM in `engine/`) and Rule 2 (all state change through `mutation.ts`)
   are checked mechanically — grep for `document.`, `window.`, `canvas`, and for any
   assignment to document state outside the mutation module.
2. **Invariant audit.** Slot set fixed during evaluation; derived slots evaluated *inside* the
   topological pass and never in a post-pass; dependency extraction eager and total;
   evaluation lazy; rejection leaves prior state bit-for-bit unchanged; no dangling edges;
   graph state plain and serializable.
3. **Spec conformance.** Does the code do what the cited brief section says, including the
   parts that look like over-specification? The brief's "deliberate" notes are the ones most
   likely to be quietly normalised away by a model trying to be sensible.
4. **Legibility audit.** File headers present, vocabulary locked, comments explain why, no
   unjustified `any`, tests named as behaviour.
5. **Honesty audit.** Does the log entry match the diff? Were the claimed test results real?
   Is anything reported "done" that is a stub? Silent scope expansion and optimistic
   completion claims are the two failure modes to hunt for hardest.
6. **Answer open questions.** Every `Q-NNN` gets an answer or an explicit deferral with a
   reason.

**Verdict vocabulary** — one of:

- `ACCEPT` — proceed to next slice.
- `ACCEPT WITH EDITS` — reviewer made surgical edits; each edit is listed with a one-line
  rationale so the next implementer learns the pattern.
- `REVISE` — returned with a numbered, specific fix list. Never "clean this up."
- `REVERT` — the slice is structurally wrong; discard and re-approach per attached direction.

**Reviewer obligations:**

- Edits MUST be small and explained. The reviewer NEVER silently rewrites a module — that
  destroys the log's value as an accurate history and teaches the implementer nothing.
- Any misunderstanding that could recur MUST become a `DECISIONS.md` entry, not just a code
  fix. Fixing the code fixes one cycle; writing the ruling fixes every future cycle.
- The reviewer writes its own log entry (`entries/NNNN-REVIEW-<phase>.md`) containing the rule
  audit, the verdict, the edit list, and the answered questions.
- The reviewer MUST NOT expand scope either. If the brief is wrong, say so to the human;
  do not amend the product design mid-review.

---

## 9. Forbidden moves

These are the specific ways this project fails. Each has been observed in this class of work.

- **NEVER** reach for a canvas, DOM API, or `render/*` import inside `engine/` — including for
  text measurement. Inject the `TextMeasurer` interface (Rule 1).
- **NEVER** add a `recompute()` pass for derived slots. They are evaluated inside the
  topological pass. A post-pass makes every formula reading a derived value permanently one
  step stale, and the bug looks like flaky reactivity.
- **NEVER** make `extractDependencies` lazy or branch-aware "to avoid unnecessary edges." It is
  eager and total across both `IF` branches by design (§5.3). A cycle found in an untaken
  branch is a real cycle and is correctly rejected.
- **NEVER** write a second expression evaluator for text (Rule 4).
- **NEVER** mutate document state outside `mutation.ts`, including "just for the drag preview"
  (Rule 2, §5.9).
- **NEVER** hand-maintain the edge set. Edges are re-derived from stored ASTs and schema
  declarations on every mutation.
- **NEVER** silently drop an edge or leave a reference pointing at a removed slot. Reject or
  repair — there is no third option (§5.1.1).
- **NEVER** introduce a `#CYCLE` value. Cycles are rejected at mutation time and never enter
  the graph as state.
- **NEVER** report a stub, a `TODO`, or an untested path as complete.
- **NEVER** claim an acceptance criterion passes without an executable test demonstrating it.
- **NEVER** weaken a test to reach green.
- **NEVER** build a substitute for compound objects/containers. Phase 7 is hand-wired
  deliberately.

---

## 10. Self-check before you write the log entry

Answer each honestly. Any "no" that is not explained in the entry is a defect.

- [ ] Did I do only my declared slice?
- [ ] Does `tsc --strict` report zero errors, and did I actually run it?
- [ ] Do all tests pass, with zero skipped and zero `.only`, and did I actually run them?
- [ ] Is every new engine file free of DOM/canvas/render imports?
- [ ] Does all state change flow through `mutation.ts`?
- [ ] Is all graph state plain, serializable, ID-referenced — no closures, class instances,
      or live-object `Map`s?
- [ ] Does every new file have a header stating layer, allowed imports, and brief section?
- [ ] Did I use the locked vocabulary everywhere?
- [ ] Is every `any` justified with `// WHY-ANY:`?
- [ ] Did I leave any `PROVISIONAL(Q-NNN)` tag whose question is already answered?
- [ ] Does my log entry describe what I *actually* did, including what I got wrong?
- [ ] Did I apply §6's triggers honestly rather than by how confident I feel?

---

## 11. Templates

### 11.1 Log entry — `claude-log/entries/NNNN-<slug>.md`

```markdown
# NNNN — <short title>
Date: <date>   Phase: <n>   Model: <model name>
Previous entry: NNNN-<slug>   Last review: NNNN-REVIEW-<phase> (verdict: ACCEPT)

## Declared scope
What I set out to do this cycle, in three sentences or fewer.

## Explicitly not in scope
Things I noticed but deliberately did not touch.

## What I did
Concrete, file by file. Name the brief sections implemented.
- `src/engine/address.ts` — new. Implements §5.2 ...
- `src/engine/graph/node.ts` — added the three slot kinds ...

## Decisions I made
Implementation-level choices and why. Anything a future reader would otherwise
wonder about. If it was load-bearing, it should have been a question instead.

## Verification (real output)
$ npx tsc --noEmit
<paste>
$ npm test
<paste — include the pass/fail counts>

## Acceptance criteria status
Phase N criterion: <quoted from brief> — PASSING / NOT YET / N/A
Demonstrated by: `test/xyz.test.ts::<test name>`

## Where I got stuck / what is unfinished
Be specific and unflattering. This is the most valuable section in the file.

## Open questions raised
Q-007 — <one line>. Provisional choice: <x>. Tagged at: <files>.

## Escalation triggers fired
List them by §6 number, or "none".
```

### 11.2 `claude-log/STATUS.md` — rewritten every cycle

```markdown
# STATUS — as of entry NNNN

STATE: GREEN (compiles, all tests pass) | BLOCKED — awaiting review | RED — <why>

Current phase: N — <name>
Phase N acceptance criterion: <quoted> — <passing / partial / not started>
Last review: NNNN-REVIEW-<phase>, verdict <verdict>

## Built and reviewed
- address.ts (§5.2) — complete, reviewed at 0003
- ...

## Built, not yet reviewed
- ...

## Not started
- ...

## Next slice (recommended)
One paragraph. What the next implementer should do first, and why that one.

## Known problems
Things observed but out of scope. Each with a file and a one-line description.

## Live PROVISIONAL tags
Q-007 → src/engine/formula/deps.ts, src/engine/mutation.ts

## Gotchas for the next model
Non-obvious things that cost this cycle time. Be generous here.
```

### 11.3 Cycle summary block — end of your response to the human

```
CYCLE NNNN COMPLETE
Slice: <one line>
Files: <n> changed (<list>)
Tests: <passing>/<total>, 0 skipped   Typecheck: clean
Phase N criterion: <status>
Triggers fired: <§6 numbers or "none">
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
My recommendation: (a), because ...
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

1. The criterion **MUST** be expressed as one or more executable tests before the phase is
   claimed complete. A criterion demonstrated only by a screenshot, a description, or manual
   fiddling is not demonstrated. Where the criterion is inherently visual (Phase 3's
   pan/zoom/drag, Phase 7's road network), test the engine-side consequence — that dragging
   emits the expected per-component mutations and that the resulting slot values are correct —
   and describe the manual check separately and honestly.
2. The implementer reports the gate as `REVIEW: REQUIRED`.
3. The reviewer runs the rule audit and either opens the next phase or issues `REVISE`.
4. The next phase does not begin before the gate clears. Rule: *do not start a phase before its
   predecessor's criterion passes.*

Phase 0 is the highest-leverage gate in the project. Do not rush it, and expect the reviewer to
be strictest there: address resolution, the three slot kinds, transactional rollback, and
derived-slot participation in the topological pass are the four things that everything later
either rests on or breaks against.

---

## 13. If you have to make a call

Where this document is silent, prefer, in order:

1. Whatever produces the smaller diff.
2. Whatever is easier for the *next* model to understand cold.
3. Whatever is easiest to delete later.
4. Whatever generates a question instead of a commitment.

And the standing bias for this workflow: **an honest, unfinished cycle with a clear log is
worth more than a polished cycle that misreports itself.** The log is the only continuity this
project has. Protect its accuracy above your own apparent productivity.
