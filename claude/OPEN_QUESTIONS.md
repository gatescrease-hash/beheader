# OPEN QUESTIONS

Unresolved ambiguity in `PROJECT_BRIEF.md`. Raise one here rather than guessing whenever
the brief is silent, ambiguous, or self-contradictory on something load-bearing.

Procedure is in `PROCESS_BRIEF.md` §7. In short: write the question, take a **reversible**
provisional choice if one exists (tag it `// PROVISIONAL(Q-NNN)` at every affected site), stop
the cycle if the choice is not reversible. Answered questions are marked `ANSWERED → D-NNN` in
place here and are never deleted.

Next free ID: **Q-015**

> **Revision note (2026-08-22, Manager cleanup):** compacted to STE; every question, option,
> recommendation, reversibility call, and reviewer note is preserved in substance. Full original
> wording is in the untouched sacred copy — see `MANAGER_CHANGELOG.md`.

---

## Q-014 — Does §5.10's "no panels, no toolbars" still hold, now that the human has asked for a properties panel as an authoring surface?
Raised: entry 0091-REVIEW (reviewer, relaying the human's manual check)
**Restated: entry 0092-REVIEW**, after the human's argument that the brief has a gap. The gap is
real and is now ruled separately as **D-092** — this question is narrower than it was.
**Narrowed again: entry 0095-REVIEW.** The human directed, with a sketch, that a selected object show
a floating properties panel listing its slots. That half is ruled — **D-094**, display only — and
§5.10 is amended once, narrowly, for it. What is left of this question is **strictly the WRITING
half**.
Brief section: §5.10, §5.1, §5.3   Status: **OPEN — for the human only. No model may settle it.**

**WHAT REMAINS OPEN, as of 0095-REVIEW — read this before the options below, which predate D-094.**
Only these, and nothing else:
(i) may a click on a slot row EDIT it (a second authoring path — Q-014's design question 4, which
D-069 makes a real ruling and not a detail); (ii) may a click on a slot row in one panel and then in
another LINK them, which requires two panels open at once and therefore multi-selection, neither of
which exists; (iii) does approving (i) moot **Q-013**'s spelling by putting formula authoring in the
row. The DISPLAY questions below — where it floats, screen space, occlusion, whether the refusal
sentence survives into it — are answered by D-094's clauses or explicitly deferred there.
**Nothing is built against any of this. The read-only panel deliberately has `pointer-events: none`
so that approving (i) later is an addition, not an unwinding.**

**What this question is NOT, since 0092-REVIEW.** The human's argument was that an operator cannot
tell which circle is `circle_1`, cannot see an object's slots, and therefore cannot wire anything
together. That is correct and it is three holes, of which **D-092** closes two without touching the
brief: a name is drawn beside each object (object rendering, §5.9's feedback family), and `props
<object>` prints an object's slots with their kinds and values (§5.10's own "adding a command is one
registry entry"). Neither needs an amendment.

**What remains, and it is only this: EDITING and LINKING slots by mouse, in a panel.** §5.10 says
"Minimal UI chrome elsewhere — no panels, no toolbars." A panel that displays slots is chrome. A
panel that writes them is chrome AND a second authoring path. Only the human may allow it.

Options:

(a) **Floating panel, anchored per object, appearing on selection.** The human's own preference, and
    their stated reason is the strongest argument here: **linking is a binary operation between two
    slots on two different objects.** One fixed panel shows one object at a time, so linking means
    select A, memorise the path, select B, type it — which is the command line with extra steps. Two
    floating panels let the operator click a slot on A, click a slot on B, and be done. The
    interaction only makes sense if more than one can be open.
(b) **One fixed panel on the left, showing the selected object.** Conventional, less occlusion, no
    anchoring arithmetic. Loses the two-panel linking gesture in (a), which is the thing that made
    the request worth making.
(c) **Hold the brief as written.** D-092's label and `props` command are the whole answer, and
    linking stays typed. Cheapest, and defensible: the operator can now SEE both names and both slot
    paths, which is what they could not do before.

Recommendation: **(a)**, after D-068 and D-092 land. It is what the human asked for, its rationale
is a real interaction argument rather than a preference, and D-092's `props` command is exactly the
data such a panel displays — so the work composes rather than duplicating.

**Design questions (a) must answer, none of them blocking this ruling:**

1. **Screen space, not world space.** A panel that pans and zooms with its object becomes unreadable
   at low zoom and enormous at high zoom. It anchors to the object's PROJECTED position and holds a
   constant size, which makes it a consumer of the transform reset D-068 already owns.
2. **Occlusion.** Floating panels cover the canvas they describe. Needs a collapse, a drag, or a
   close, and that is UI furniture the brief has never had.
3. **Refusals must survive into the panel.** §5.10: "every rejection message must name the specific
   slots involved." A click on a `derived` slot that silently does nothing is WORSE than the command
   line's "radius is driven by table_x.A1" — the panel must say the same sentence the command says.
4. **It is a second caller of `mutate`, which Rule 2 permits** and D-069 does not: `executeCommand`
   is currently "the ONLY place a `Command` meets a `Document`". A panel either builds `Command`
   values and goes through that path (preferred, and it keeps D-069 true), or becomes a second
   authoring path that needs its own ruling.

**Consequence worth stating:** approving (a) or (b) largely moots **Q-013** (how a general formula is
authored at all, which §5.10 has no command for and Phase 4(b) requires). A formula gets typed into
the slot's own row, which is where a spreadsheet puts it.

Reversible? **The panel is. The direction is not.** Building it costs a cycle and deletes cleanly.
The human's framing at entry 0091 — most of the linking work happening in the panel rather than at
the command line — is a change to what this project IS, and that part is not a reversible choice.
Provisional choice taken: **none. Nothing is built against this.** Tagged at: nowhere.

---


## Q-013 — How is a general formula authored, given §5.10 has no command that takes one and Phase 4(b) requires one?
Raised: entry 0068 (implementer)   Brief section: §5.10, §5.4, §6 (Phase 4b)
Status: **ANSWERED → D-071.** The human ruled **option (a)** at entry 0070: `set <address> =
<formula source>`. Escalated at 0069-REVIEW-phase3 with the reviewer endorsing (a); the human
confirmed it and added the direction that became **D-072**. Built and reconciled at entry 0070 —
the `PROVISIONAL(Q-013)` tag is gone and `matchArguments`'s guard is now the formula path itself.
**Phase 4(b) has an authoring path.**

The reviewer's reasoning below is kept because its three constraints became D-071's clauses 1, 2
and 4 and still bind. Nothing here is open.

**Reviewer's position (0069-REVIEW-phase3) — the argument D-071 rests on.**

The question is correctly raised and correctly left open. It is *escalated, not answered*, because
it asks what the operator's command line should be able to SAY, and D-042 makes the operator the
arbiter of exactly that — the same reason Q-001/Q-002/Q-004/Q-010 were all ruled by the human
(D-041/D-040/D-039/D-038) rather than by a reviewer. §8's "**command-language gold-plating**" does
NOT forbid the answer: its own sentence is "Add commands as needed, one registry entry each," and a
surface Phase 4's gate cannot be reached without is needed, not gold-plating.

**Endorsed: (a), `set <address> = <formula source>`.** It is the spreadsheet's own gesture (typing
`=` into a cell is what makes it a formula, and §5.4's formula bar will do the same thing, so one
spelling serves both surfaces); D-040 has already settled what happens when `set` writes over a
formula slot, so (a) needs no new semantics, where (c)'s separate `formula` command would fork
D-040/D-041 across two command words for no gain the operator can see. (b) is rejected on the
ground the question already gives: it makes the project's validation moment hostage to an unbuilt,
unscheduled render slice.

**Three constraints hold whichever way the human rules — these ARE the reviewer's to state, and
they are binding now:**

1. **The formula source is the RAW SUBSTRING of the line from the `=` to the end, taken verbatim.**
   Never re-joined from tokens: re-joining discards the operator's own spacing and the character
   offsets that `CommandParseFailure.start` and `ParseError`'s position are built on, and D-038
   clause 4 forbids the layer that rejects a formula from discarding its source text.
2. **The parser stays document-free (D-069).** The command object carries the source; `commands.ts`
   calls `parseFormula`. D-038's four conditions come due at that call, wherever it lands.
3. **`link` and a formula-writing `set` build their slot through ONE shared path in `commands.ts`.**
   `link a.b c.d` is `set a.b = c.d`'s degenerate case (§5.1), and two code paths writing a formula
   slot will drift on what D-040 says they must report and on what D-041 leaves behind.

*(Superseded by the ruling: the provisional refusal described below is gone, replaced at entry 0070
by the formula path itself. Kept in place per §2 — an answered question is marked, not deleted.)*

Ambiguity: §5.10 lists no command that takes a formula EXPRESSION. `link polygon_1.origin.x
table_x.A1` makes only §5.1's degenerate formula `= other.slot`. `set polygon_1.radius 42` is shown
writing a literal, and D-040 describes it the same way ("the slot becomes a literal holding what was
typed"). `text x=0 y=0 "Hello {= table_x.A1 }"` embeds formula syntax inside a **literal** `content`
slot, parsed later by the text primitive (§5.6), not by the command line. But Phase 4(b) requires
`table_x.B1` to hold `= polygon_b.origin.x * 2`, and §5.4's formula bar / in-place cell editing —
the only other candidate surface the brief names — is unbuilt render work with no cycle scheduled.
So today nothing in the specified system can author that cell.

Options:
(a) **`set <address> = <formula source>`.** The command line grows the formula path: one registry
    entry's value-reading branch, plus one `Command` arm carrying the raw SOURCE text, with
    `commands.ts` calling `parseFormula` — which keeps `command/parser.ts` document-free (it takes
    no object list) and satisfies D-038 clause 4 structurally, since the rejected source is what the
    command object holds. D-038's other three conditions are met at that call site: validation runs
    on commit (a typed line is a commit), `ParseError` already carries name and position, and
    `FUNCTION_REGISTRY` is untouched.
(b) **§5.4's formula bar is the only formula surface**, and the command line never authors one.
    Faithful to §5.10 as written, but it makes Phase 4's gate depend on an unbuilt render slice
    (in-place cell editing), and leaves `link` — a binding with no arithmetic — as the only way to
    drive a slot from another one until then.
(c) **A separate command**, e.g. `formula <address> <source>`, keeping `set` literal-only and
    D-040's wording untouched. Same cost as (a), one more command word, and it makes "write a
    value" and "write a formula" visibly different acts.

Recommendation: **(a)**. It is the smallest thing that unblocks Phase 4 without waiting on render
work, it puts the formula where the operator is already typing, and D-040 already settled the
semantics of writing over a formula slot from the `set` path, so nothing new has to be ruled about
what happens to what was there. The reason this is a question and not an implementation decision:
§5.10's grammar does not show it, §8 defers "command-language gold-plating", and D-042 makes the
operator the arbiter of what the command line should be able to say.

Reversible? Yes — accepting a leading `=` later changes the meaning of nothing that parses today,
and no stored data depends on the answer either way.
Provisional choice taken: **refuse it**, at exactly one site. `matchArguments` rejects any unquoted
argument beginning with `=`, with a message naming `link` and this question — chosen over a generic
"not a value" so the refusal reads as a missing surface rather than a typo. Tagged at:
`src/command/parser.ts` (`matchArguments`'s formula guard).

---

## Q-012 — Is a stroke width (and the table's cell size / font size) measured in WORLD units or in SCREEN pixels?
Raised: entry 0062-REVIEW-phase3 (reviewer)   Brief section: §5.5 (`style.strokeWidth`), §5.9
Status: **OPEN — deferred to the cycle that declares real `style` slots.** Blocks nothing today:
`primitives/geometry.ts` declares no `style` slots at all, so nothing can yet author a width.

Ambiguity: `render/renderer.ts` applies the camera as a single canvas transform and then draws in
raw world coordinates (entry 0061 Decision 2 — the right call, and the reason `renderer.ts` cannot
compute a different mapping than `camera.ts` does). Everything downstream of that transform is
therefore in WORLD units, `ctx.lineWidth` and `ctx.font` included. §5.5 puts `strokeWidth` inside
the shape's own `style` block and never says which space it is in. §5.9 attaches the only
pixel-denominated measurement in the brief to a different thing: hit-testing's "distance-to-segment
with **pixel tolerance** for strokes."

The consequence is real and currently invisible only because nothing can create an object yet: a
1-unit stroke is 0.01 screen px at `MIN_ZOOM` and 100 px at `MAX_ZOOM`. Zoomed out, every shape's
outline vanishes; zoomed in, it becomes a slab.

Options:
(a) **World units.** A stroke is a property of the shape, so it scales with the shape. Nothing to
    build — this is what the tree does. §5.9's pixel tolerance stays a hit-testing concept and
    never touches drawing.
(b) **Screen pixels.** Stroke width (and the table's grid lines / font) stay constant on screen at
    every zoom — the CAD/Figma convention, and the one that keeps a hairline a hairline. Costs
    `ctx.lineWidth = width / camera.zoom` before each stroke, which reintroduces a per-draw-call
    dependency on `camera.zoom` in a file that currently has exactly one.
(c) **Split:** shape strokes in world units (a); table CHROME — grid lines, cell size, font — in
    screen pixels, on the grounds that a table is a widget rather than a drawing. Costs a second
    coordinate convention inside one file.

Recommendation: **(a)**, and note that (a) and §5.9's pixel-tolerance hit-testing do not conflict —
drawing and hit-testing are allowed to measure differently, and the brief already says they do.
Reason: it is what §5.5's own placement of `strokeWidth` implies, it is the smaller diff (zero),
and it is the easiest to reverse — (b) is a one-line change at two call sites, made once the width
comes from a slot instead of a constant. Flagging rather than ruling because "do outlines get
thinner as you zoom out" is a product-visual call, and PROCESS_BRIEF §1 makes the human the arbiter
of those.

Reversible? Yes — cheaply, and nothing in document state depends on it either way. Provisional
choice taken: yes, (a), already in the tree. Tagged at: `src/render/renderer.ts`
(`DEFAULT_SHAPE_STROKE_WIDTH` and the `TABLE_CELL_*` constants).

---

## Q-011 — Does **D-058** still stand, now that the practice it regulates has been removed from source?
Raised: entry 0055-AUDIT (auditor)   Brief section: PROCESS_BRIEF §5.2/§5.4
Status: **ANSWERED → D-060** (ruled by the human directly, 2026-08-24, option (a): supersede D-058.
Comments describe the present and are not diaries; a pointer back to a ruling is the one sanctioned
exception, and is a supplement to a stated reason, never a substitute for one. D-058's dating half
survives inside D-060. Recorded at entry 0056-RULINGS.)
Blocked: nothing. DECISIONS.md and the tree now agree.

Ambiguity: **D-058 (0051-REVIEW-phase2) ruled that "the per-cycle history paragraphs these file
headers carry are accepted practice in this repo and stay"**, requiring only that each one name its
entry number rather than saying "this cycle". The audit pass at entry 0055 — run at the human's
direct instruction, after presenting exactly this recommendation — **removed those paragraphs
instead.** That is a change to a binding ruling made by someone with no authority to make one: an
auditor is neither the reviewer nor the human, and DECISIONS.md says plainly "NEVER write to it."
So this question is raised rather than the ruling being edited.

Note that D-058's own RATIONALE argues for removal rather than against it. It records that
0048-REVIEW had to hand-correct 15 comment sites, and 0051-REVIEW another 8, because a dated
history paragraph drifts; it concludes "a comment that cannot be dated is worse than no comment,
because it reads as precise." Entry 0055 found the same class a third time in a different form —
headers that were internally self-contradicting, correct only when read start-to-finish as a
chronology (`mutation.ts` asserted both that `extractDependencies` did not exist yet and that the
code walked it, forty lines apart). D-058 fixed the DATING of the practice. The audit removed the
practice. Both are answers to the same recurring defect.

Options:
(a) **Supersede D-058.** Header history paragraphs are no longer accepted practice; headers state
    the present contract, and chronology lives in `entries/` + DECISIONS.md. PROCESS_BRIEF §5.2's
    new present-tense rule and line budget (added at 0055) become the standing convention.
(b) **Reaffirm D-058 and revert entry 0055's header pass.** The chronology returns to source, dated
    by entry number as D-058 requires.
(c) **Split.** D-058's dating requirement stands for any comment that does date a decision, but
    headers are exempted from carrying history at all. In practice this is (a) plus an explicit
    rule for the inline sites that remain.

Recommendation: (a), or (c) if the reviewer wants D-058's dating discipline preserved by name for
the ~46 inline provenance citations entry 0055 deliberately left in place. Reason: the defect
D-058 exists to prevent has now recurred three times under two different rules, and every recurrence
was found by hand. Removing the practice removes the class; dating it only slows the drift.

Reversible? Yes, but expensively — reverting is `git revert` of one commit, so it is cheap
mechanically, and the removed prose is fully preserved in git history and in `entries/` regardless
of which way this is ruled. Provisional choice taken: yes — the removal is already in the tree
(entry 0055). Tagged at: not tagged in source. Tagging every rewritten header `PROVISIONAL(Q-011)`
would reintroduce exactly the noise the pass removed; this entry, STATUS.md, and entry 0055 carry
the disclosure instead.

---

## Q-010 — Is a formula naming an unknown function, or calling a known one with the wrong argument count, REJECTED at authoring time or accepted and shown as an error value?
Raised: entry 0037-REVIEW-phase1 (reviewer)   Brief section: §5.3
Status: **ANSWERED → D-038** (ruled by the human directly, 2026-08-23, option (b) — with a binding
condition the question did not anticipate: it must not foreclose autocomplete/did-you-mean in the
formula entry later. See D-038 for the four constraints that follow from it.)
Blocks: nothing today (nothing can store a general formula yet — `mutation.ts`'s
`findUnsupportedFormulaAsts` still rejects every non-reference AST). **Must be settled by the
Phase 2 cycle that makes cell formulas storable**, because that is the cycle that decides what
happens when a user types one.

Ambiguity: §5.3 says "An unresolvable **reference** is a PARSE-time error regardless of branch,
because names are resolved to IDs at parse time" — and `parser.ts` implements exactly that. It says
nothing about an unresolvable FUNCTION name, even though the registry that would resolve one exists
at parse time too (`parser.ts` already imports `functions.ts` for range placement). So today the
two behave differently: `= nosuchobject.v` cannot be authored at all, while `= FOO(1)` parses
cleanly, and `= SUM()` — a call that can never be right at any runtime, with no values involved —
parses cleanly too. Both become an error VALUE at evaluation instead (`#TYPE`, entry 0036).

Options:
(a) **Split, following Excel** (D-030's tie-breaker): a wrong ARGUMENT COUNT is a parse-time
    rejection (Excel refuses the entry outright), while an UNKNOWN NAME is accepted and evaluates
    to an error value (Excel stores it and shows `#NAME?`).
(b) **Both are parse-time rejections** — `parseFormula` validates name and arity via
    `getFunctionEntry`/`checkArity`, matching how it already treats an unresolvable reference and
    an illegally placed range. One consistent rule: anything decidable from the AST alone, without
    reading a single value, fails at authoring time.
(c) **Both stay runtime error values** — today's behaviour, unchanged.

Recommendation: **(b)**, with (a) as the close second. (b) gives the user the error while they are
still typing rather than as a permanently broken cell, it matches the "anything static fails
early" line `parser.ts` already draws twice, and it needs no new machinery — the two functions it
would call were built in cycle 0034 and are still consumed by nothing else. Its cost is that the
project has no `#NAME`-style code, so (a)'s "accepted, shows an error" arm has nowhere natural to
land anyway. Deliberately NOT ruled at 0037-REVIEW: this is a product-facing behaviour question
(does the app refuse the keystroke or show a broken cell?), it is squarely the human's call, and
nothing is blocked while it waits.

Reversible? Yes, entirely — no stored data can depend on it while formulas are unstorable.
Provisional choice taken: **no** — current behaviour is (c) by default, not by decision. Pinned by
`parser.test.ts`'s "parses an unrecognised function name successfully" and `eval.test.ts`'s
"an unknown function name is #TYPE" / "a wrong argument count is #TYPE". Whichever option lands,
those three test expectations move with it — that is authorised in advance, so it is not a
§6.1 trigger 5 escalation for the cycle that does it.

---


## Q-009 — Are `AND`/`OR`/`NOT` infix/prefix OPERATORS, callable FUNCTIONS, or both?
Raised: entry 0028-formula-ast (implementer)   Brief section: §5.3
Status: **ANSWERED → D-029** (ruled at entry 0029-REVIEW-phase1, option (a) — with a
binding rider the question did not anticipate: see the reviewer note at the end)
Blocks: `parser.ts`/`functions.ts` (later Phase 1 cycles) — does NOT block `ast.ts` itself; see
below.

Ambiguity: §5.3's operator precedence chain lists `OR` and `AND` as INFIX operators ("Operators,
loosest to tightest: `OR` → `AND` → comparison → ..."), and its unary-operator list includes `NOT`.
The SAME section's built-ins list ALSO names `IF, AND, OR, NOT, SUM, MIN, ...` as callable
FUNCTIONS, alongside genuinely function-only entries like `SUM`/`ROUND`. The brief never says
whether `AND`/`OR`/`NOT` are operators, functions, or both — and if both, whether `AND(a,b,c)`
(N-ary) and `a AND b` (binary infix) are required to mean the same thing.

Options: (a) both forms exist and mean the same thing — `a AND b` desugars to (or is evaluated
identically to) `AND(a, b)`; `AND(a,b,c,...)` is the N-ary generalisation. (b) operators only —
drop `AND`/`OR`/`NOT` from the function registry; the built-ins list's mention of them is loose
prose, not a registry requirement. (c) functions only — parse `AND`/`OR`/`NOT` exclusively as
`FunctionCallNode`s, and do not give them infix/prefix grammar productions at all, contradicting
the precedence chain's own wording.

Recommendation: (a). It is the closest reading of BOTH cited passages taken literally (neither
would need to be explained away), it matches how spreadsheet languages this project is explicitly
modelled on (Excel) actually behave, and it costs nothing today: `formula/ast.ts`'s `BinaryOpNode`/
`UnaryOpNode`/`FunctionCallNode` already represent both forms without conflict (see `ast.ts`'s own
header) — this question decides `parser.ts`'s grammar productions and `functions.ts`'s registry
entries, not `ast.ts`'s shape, which is why it does not block this cycle.

Reversible? Yes — a parser-level and registry-level choice; no stored document state can depend on
it before `parser.ts` exists. Provisional choice taken: not yet (deferred to whichever cycle builds
`parser.ts`/`functions.ts`, since nothing today needs an answer).

> Reviewer note (0029-REVIEW-phase1): **(a) APPROVED — both forms, meaning the same thing.** The
> question was right that `ast.ts` does not need an answer, and right to decline a provisional
> choice. But answering it surfaced something the question did not ask, which is why D-029 rules on
> two things instead of one: §5.3's built-in registry is table-driven over **already-evaluated**
> arguments, while §5.3 ALSO requires `IF`/`AND`/`OR` to short-circuit. Both cannot be true of the
> same dispatch path. D-029: `IF`/`AND`/`OR` are evaluated lazily by `formula/eval.ts` at the call
> site and never computed by a `functions.ts` implementation, in either syntactic form; `NOT` is an
> ordinary registry entry; `deps.ts` stays eager and total over both forms. Binding before
> `parser.ts`/`functions.ts`/`eval.ts` are written.

---

## Q-008 — Is negative zero (`-0`) legal document state?
Raised: entry 0025-REVIEW-phase0 (reviewer)   Brief section: §5.1 (`Value`), §5.11, §6 clause 4
Status: OPEN (provisional choice taken, reversible — same standing as Q-005/Q-007)
Blocks: nothing outright — it WAS a live counterexample to §6 clause 4 ("round-trips to JSON and
back **identically**"); closed at entry 0026-phase0-revise-fix, same cycle that closed
0025-REVIEW-phase0's REVISE item 1, which touches the same predicate.

Ambiguity: D-025 settled the three non-finite numbers because JSON cannot represent them. `-0` is
the remaining member of `Value`'s `number` arm with the same defect, and D-025 does not cover it
(`Number.isFinite(-0)` is `true`). Verified by probe at 0025-REVIEW-phase0, through the real
public API:

```
mutate([setSlot value_1.value = -0])          -> ok: true, committed value Object.is(-0) -> true
saveDocument(...)                             -> ..."value":{"kind":"literal","value":0}...
loadDocument(...)                             -> reloaded Object.is(-0) -> false
```

So a document that `mutate` accepts does not round-trip identically. Nothing in Phase 0 can author
a `-0` except a hand-written literal (there is no parser until Phase 1, and `add` reaches `-0`
only from `-0` inputs), so the practical exposure today is nil — but the acceptance clause is a
bit-identity claim, and this is the exact reasoning that produced D-025.

Options: (a) illegal, rejected the same way and in the same place as a non-finite number — one
more arm on the same predicate, one more sentence in the same message. (b) legal, and
`document.ts` encodes the sign explicitly on save — rejected for the same reason Q-006 rejected
its own option (a): the on-disk format stops being plain JSON at exactly the point §5.11 says it
is. (c) legal and silently normalised to `0` on the way in — rejected: an accepted mutation that
changes a value the operation did not ask to change is the D-019 defect again, and clause 4 would
be true only because state was quietly rewritten.

Recommendation: (a). It is one branch, it is consistent with D-025's own rationale (a number that
does not survive the format is not document state), and it is forward-safe: no saved document can
contain `-0` today, so nothing existing becomes unloadable.

Reversible? Yes — one branch and one message; no stored data can depend on it.
Provisional choice taken: **(a)**, at entry 0026-phase0-revise-fix — the human had not ruled by
then. Tagged at exactly one site: `graph/node.ts`'s `isIllegalNumber`, the single leaf predicate
D-025 (non-finite) and Q-008 (`-0`) now share (widened, not duplicated — same "widen the existing
mechanism" stance D-020/D-026 already established). `mutate` rejects `-0` as a slot value (both a
freshly-written literal and one already sitting in the document, same as D-025) and as an
operation payload before staging; `document.ts`'s journal read-side check rejects it there too.
`add`'s compute needs no separate `-0` guard: its inputs are already-legal by the time it runs, and
IEEE 754 `+` of two finite, non-`-0` operands cannot itself produce `-0` — see 0026's own entry.

> Reviewer note (0027-REVIEW-phase0): **(a) APPROVED as provisional**, same standing as Q-005 and
> Q-007. Stays OPEN only because the human may still want to overrule it; nothing depends on that
> answer arriving. Single-site tagging is correct — D-004 asks for a tag wherever the CHOICE is
> encoded, and after cycle 0026 there is exactly one such site, which is an improvement over
> tagging every consumer. The `add` reasoning is correct as stated and correctly scoped to `+`;
> a compute using `*` or `/` must re-derive it (`-1 * 0` is `-0`), which 0026 says in the schema
> header. Widened by **D-027**: the same predicate now governs `camera` and `nextObjectId` too.

> Reviewer note 2 (0035-REVIEW-phase1): **narrowed on the compute side by D-033, still OPEN and
> still provisional on the storage side.** Cycle 0034 read option (a) as also binding COMPUTE
> results, and made `functions.ts` return `#TYPE` for any `-0` — so `CEIL(-0.5)` and
> `ROUND(-0.4, 0)` reported an error for a correct, exactly representable answer. D-033 splits the
> two: a computed `-0` normalises to `+0`; only a non-finite result errors. That is NOT this
> question's rejected option (c), which is about `mutate` rewriting a value an OPERATION asked to
> store (the D-019 defect). Nothing is asked for by a compute function. `mutate` still rejects an
> authored `-0` literal, in a slot value and in a journal payload, exactly as option (a) says.

---

## Q-007 — What shape does the document's serialized "camera state" (§5.11) have in Phase 0?
Raised: entry 0024-document (implementer)   Brief section: §5.11, §5.9
Status: **ANSWERED → D-061** (confirmed at entry 0058-REVIEW-phase3; resolved by implementation
at entry 0057). `render/camera.ts` now exists as the real consumer 0025-REVIEW-phase0 named,
and needs no widening: `{ x, y, zoom }` (camera.x/y as the world point at the screen's top-left
corner, zoom as a scale factor) is sufficient for `worldToScreen`/`screenToWorld`/
`panByScreenDelta`/`zoomAtScreenPoint`, because none of them need a viewport size. Every binding
constraint 0025-REVIEW-phase0 set is met: `CameraState` was not replaced with a differently-named
concept (only its doc comment changed); it stays plain and serializable; `document.ts` gained no
second reader of it (`render/camera.ts` is the sole interpreter of what the fields mean, imported
from `document.ts`, never redeclared); `deserializeDocument`'s malformed-camera rejection is
untouched. The `PROVISIONAL(Q-007)` tags (`document.ts`, 3 sites) are removed per 0054-REVIEW-
phase2 §7's explicit instruction to do so in this same cycle — but note an implementer cannot write
`DECISIONS.md` (PROCESS_BRIEF §2), so no `D-NNN` is minted here; this status line is not itself a
ruling, only a record that PROCESS_BRIEF §7 clause 4's tag-removal step ran ahead of the formal
answer, on the reviewer's own prior instruction. §6.1 trigger 2 (`render/camera.ts` is the first
file of a new subsystem) already forces a review point this cycle regardless, so formal closure
follows promptly.
Blocks: nothing — `render/camera.ts` is now built.

> Reviewer note (0058-REVIEW-phase3): **confirmed and closed as D-061**, which pins the CONVENTION
> (`camera.x`/`y` is the world point at the screen's top-left corner, never the viewport centre) as
> well as the shape — the shape was never the risk; a renderer written against a centre-based
> reading is. Entry 0057's tag removal ahead of a minted `D-NNN` was CORRECT: 0054-REVIEW-phase2 §7
> instructed it directly, and a review entry is binding authority.
>
> Separately, entry 0057 documented a guarantee the loader does not actually provide — a loaded
> `camera.zoom` of `0`, `-5`, or `1e-300` passes `deserializeDocument`. See **D-062**, which puts
> that guard on `render/` rather than on `document.ts`.

Ambiguity: §5.11 lists "camera state" as one of the document's top-level fields, but `render/
camera.ts` (§5.9: "world → screen and screen → world," pan/zoom) is Phase 3 work and does not exist
yet. The brief never states the camera's own data shape (a pan offset plus a zoom factor is the
obvious reading of §5.9's own description, but that's an inference, not a stated shape).

Options: (a) a minimal placeholder shape (`{ x, y, zoom }` — world-space pan offset plus zoom
factor) defined in `document.ts` itself, which Phase 3's `render/camera.ts` either adopts as-is or
widens. (b) skip serializing camera state entirely until Phase 3 needs it — **rejected**, §5.11
states it as part of the format from the first commit, same as `formatVersion`. (c) block this
cycle on a human ruling — rejected as disproportionate for a field nothing reads yet.

Recommendation: (a). Cheap, plain, serializable, and matches §5.9's own vocabulary closely enough
that Phase 3 is unlikely to need more than a widen.

Reversible? Yes — nothing outside `document.ts` reads or writes this shape yet; Phase 3 can freely
replace it. Provisional choice taken: (a). Tagged at: `document.ts`'s `CameraState` interface.

> Reviewer note (0025-REVIEW-phase0): **(a) APPROVED as provisional**, same standing as Q-005 —
> stays OPEN because it fully resolves only when Phase 3 builds `render/camera.ts`, which owns this
> shape. Binding constraints until then: Phase 3 **widens** `CameraState`, never replaces it with a
> differently-named concept; the field stays plain and serializable (Rule 5); and `document.ts` is
> not permitted to grow a second reader of it. `deserializeDocument` rejecting a malformed camera
> is right and should survive the widening — a document whose camera is garbage is a document that
> cannot be opened at the right place, which is a real failure, not a field to default away.

---

## Q-006 — Is a non-finite number (`NaN`, `Infinity`, `-Infinity`) legal document state?
Raised: entry 0018-REVIEW-phase0 (reviewer)   Brief section: §5.1 (`Value`), §5.11, §6 clause 4
Status: **ANSWERED → D-025** (ruled by the human directly, 2026-08-22, option (b))
Blocked: Phase 0 clause 4 — was blocking `document.ts`'s round-trip test; unblocked now.

Ambiguity: `Value`'s `number` arm admits all three, and they are reachable today with nothing but
literals — `add`'s compute over two `1e308` literals yields `Infinity`, and `set x 1e999` parses
to one directly. But §6 clause 4 requires a document to "round-trip to JSON and back
**identically**", and JSON has no representation for any of them. The brief never says which side
gives.

Options: (a) legal state — `document.ts` encodes them explicitly on save and decodes on load,
keeping `Value` as written. (b) illegal — `mutation.ts` rejects a literal that is not finite, and
every compute maps a non-finite result to an `ErrorValue` (`#TYPE`; §5.1 fixes the `ErrorCode`
union, so no new code). (c) legal but not persisted — **rejected outright**, it makes clause 4
false by construction.

Recommendation: (b). It is the smaller change, it keeps the serialized format plain JSON (§5.11,
Rule 5), and §5.1 already establishes that an `ErrorValue` in the graph is legitimate state rather
than a reason to reject. (a) means the on-disk format stops being plain JSON at exactly the point
§5.11 says it is. But this touches the value vocabulary and the visible behaviour of overflow, so
it wants the human's product call, not an implementer's.

Reversible? Yes at present — D-019 binds the step-1 clone to be faithful either way, and nothing
in the tree produces a non-finite value except a hand-written literal. Provisional choice taken:
no. Tagged at: `mutation.ts`'s `cloneObjects` doc comment, which points here (added when D-019 was
implemented at cycle 0019).

> Reviewer note (0021-REVIEW-phase0): the scope is wider than slot values. §5.11 puts **the
> mutation journal in the serialized document**, and a `MutationJournalEntry` holds `Operation`s
> whose `Slot` payloads carry the same `Value` union. So whatever this question settles applies to
> the journal too, not only to the object list — answer it once, for both.

> Reviewer note 2 (0025-REVIEW-phase0): that widening WAS carried into D-025's own ruling text
> ("in the object list AND in the serialized mutation journal") and then implemented over the
> object list only. See 0025-REVIEW-phase0 finding 1: a journal payload holding `Infinity` is
> saved as `null`, so the answer to this question is currently enforced on one of the two halves
> it was written for. Q-006 stays ANSWERED — the ruling is not in doubt, its implementation is.

> Implementer note (entry 0026-phase0-revise-fix): the journal half closed. `mutate` now rejects an
> illegal operation payload before it can reach the journal (write side); `document.ts` rejects a
> loaded file whose journal already holds one (read side, since a loaded journal never passes
> through `mutate`). Both halves of D-025 — object list and journal — are enforced now.

---

## Q-005 — What does `formula/ast.ts` contain before Phase 1 builds the real grammar?
Raised: entry 0005   Brief section: §5.1, §5.3, §6 (Phase 0)
Status: **ANSWERED → 0006-REVIEW-phase0's ruling, EXECUTED at entry 0028-formula-ast** (Phase 1
landed). `FormulaAst` is now the full §5.3 grammar (`LiteralNode`, `ReferenceNode`, `RangeNode`,
`BinaryOpNode`, `UnaryOpNode`, `FunctionCallNode`) — widened, not replaced, per 0006-REVIEW's own
binding constraint below: `ReferenceNode` is byte-for-byte what Phase 0 shipped (pinned by
`ast.test.ts`). Every `PROVISIONAL(Q-005)` tag (`formula/ast.ts`, `graph/eval.ts`, `mutation.ts`)
is removed. No fresh `DECISIONS.md` entry: 0006-REVIEW-phase0's own text already is the ruling —
"(a) APPROVED... remove PROVISIONAL(Q-005) tags and mark ANSWERED when Phase 1 lands" — this
entry is that execution, not a new decision.

Ambiguity: Phase 0's `graph/*` needs a `FormulaSlot` to hold *something*, but `formula/ast.ts` is
explicitly Phase 1 work. What Phase 0's own fixture needs is narrow: the `add` object's two
formula input slots are **bindings** — §5.1 defines a binding as "the degenerate formula `=
other.slot`" — not arbitrary arithmetic.

Options: (a) a one-variant `FormulaAst` (`{ type: "reference", address: Address }`), documented as
a Phase 0 stand-in Phase 1 *widens*, never replaces. (b) leave `FormulaSlot.ast` opaque until
Phase 1. (c) skip formula slots in Phase 0 entirely.

Recommendation: (a). (b) makes `FormulaSlot` useless for Phase 0's own eval/mutation work. (c)
contradicts §5.1's three slot kinds and §6's fixture, which needs formula slots. (a) composes
forward — a union gains variants, it isn't restructured.

Reversible? Yes. Provisional choice taken: (a). Tagged at `src/engine/formula/ast.ts`.

> Reviewer note (0006-REVIEW-phase0): **(a) APPROVED.** Stays OPEN only because it fully resolves
> once Phase 1 builds the real grammar. Binding constraint: **Phase 1 widens this union, never
> replaces it** — a binding must stay representable as a bare reference under the full §5.3
> grammar. Remove `PROVISIONAL(Q-005)` tags and mark ANSWERED when Phase 1 lands.

---

## Q-004 — Are lowercase cell references accepted, and if so are they normalised?
Raised: entry 0004-REVIEW-phase0 (reviewer)   Brief section: §5.4, §5.2
Status: **ANSWERED → D-039** (ruled by the human directly, 2026-08-23, option (b): accept both
cases, normalise to uppercase at one point). The recommendation below said "Phase 2 should settle
it holistically" — Phase 2 is now open, and it is settled.
Blocks: Phase 2 (table primitive). Not needed before then.

Ambiguity: §5.4 says "A1-style addressing"; every cell ref the brief writes is uppercase. It
doesn't say whether `table_x.a1` is legal, and §5.2's case-insensitivity rule is stated for
*object names*, not path segments. Accepting lowercase *without* normalising would store
`cells.a1` and `cells.A1` as two distinct slots for one cell — two sources of truth, which §5.1
doesn't tolerate.

Options: (a) uppercase only — a lowercase ref simply isn't a cell reference. (b) accept both,
normalise to uppercase at parse time. (c) accept both, store as written — **rejected outright**,
this is the two-slots bug.

Recommendation: (b) eventually — it's what a user expects — but it's a table-primitive decision
(belongs with range parsing generally), so Phase 2 should settle it holistically.

Reversible? Yes, deliberately. **Current behaviour is (a)** (D-008) — the forward-safe interim,
since moving to (b) later is purely additive. Pinned by test rather than a `PROVISIONAL` tag:
`address.test.ts::does not map a lowercase cell ref, pending Q-004`. Tagged at
`src/engine/address.ts` (`CELL_REFERENCE_PATTERN` doc comment).

---

## Q-001 — What does `unlink` store when the last computed value is not a plain scalar?
Raised: entry 0000 (reviewer)   Brief section: §5.10, §5.1
Status: **ANSWERED → D-041** (ruled by the human directly, 2026-08-23, option (a): keep whatever
was displayed, errors included). Safe because D-040 lets the operator type straight over it.

> Reviewer note (0002-REVIEW-phase0): deliberately not ruled — Phase 3 command-surface question,
> reversible, nothing in Phase 0/1 depends on it. If Phase 3 arrives before the next review, take
> the recommendation below as a `PROVISIONAL` choice under D-004 rather than blocking.

Ambiguity: `unlink polygon_1.origin.x` is specified as "revert to literal, keeping last computed
value." Undefined for an `ErrorValue` (formula was broken at unlink time) or a `Point`/`Point[]`.

Options: (a) store whatever the value was, errors included. (b) substitute the schema default if
it's an error. (c) reject the unlink when the value is currently an error.

Recommendation: (a) — least surprising: the value the user was looking at is the value they keep.
An `ErrorValue` in the graph is already legitimate state (§5.1). (b) silently changes a visible
value; (c) fails exactly when the user most wants `unlink`.

Reversible? Yes — one branch in one command handler. Provisional choice taken: not yet (Phase 3
hasn't begun).

---

## Q-002 — Does `set` on a formula slot implicitly unlink, or is it rejected?
Raised: entry 0000 (reviewer)   Brief section: §5.10, §5.1
Status: **ANSWERED → D-040** (ruled by the human directly, 2026-08-23, option (b): the write wins
and the formula is replaced). The reviewer recommended (a) and was overruled — see D-040, which
records why, and its three bounds (report what was replaced; dragging is NOT covered, §5.9 stands;
a derived slot is still rejected).

> Reviewer note (0002-REVIEW-phase0): same reasoning as Q-001. If Phase 3 arrives first, take
> option (a) below as `PROVISIONAL` rather than blocking — already consistent with §5.9's
> per-component drag rule, so it's the low-risk default.

Ambiguity: `set polygon_1.radius 42` writes a literal; `set` on a **derived** slot is rejected
(settled). Undefined: what `set` does when the target is already a **formula** slot.

Options: (a) reject — "radius is driven by table_x.A1; unlink first," matching §5.9's drag
behaviour. (b) implicitly unlink then set.

Recommendation: (a) — §5.9 already establishes "refuse, and say what drives it" for writes to a
driven slot; `set` should teach the same lesson the mouse does. (b) also destroys a formula with
no undo built.

Reversible? Yes — one branch in one command handler. Provisional choice taken: not yet (Phase 3
hasn't begun).

---

## Q-003 — Does `explode` preserve the object's ID and name?
Raised: entry 0000 (reviewer)   Brief section: §5.5, §5.2
Status: **ANSWERED → D-007** (ruled at entry 0002-REVIEW-phase0)

Ambiguity: §5.5 says `vertices` survives explode "re-sourced," and that "anything downstream
reading `vertices` is unaffected" — which only holds if the object keeps its identity.
Non-reversible: shapes the data model, so this was correctly escalated rather than guessed.
See D-007 for the full ruling and rationale.
