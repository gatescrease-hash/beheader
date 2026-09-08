# 0177 — REVIEW (Phase 6, scope): the script half of the gate. My own D-142 clause 3 was wrong
Date: 2026-09-07   Phase: 6   Model: reviewer (Opus 5)
Reviews: no diff — this entry reviews a **scope ruling**, not code. Prompted by the human's
question at 0176-REVIEW: *"Wouldn't this phase gate also include testing the placeholder script
node?"*
Previous entry: 0176-REVIEW-phase6
Verdict: **no code verdict. A FINDING, and Q-029 raised.** The Phase 6 gate is **blocked on a scope
call that is the human's**, in addition to the on-screen `image` check D-142 clause 2 already owed.
No source file was touched by this entry.

## 1. The question, and why it is not answerable by "the ✅ line passes"

Phase 6's criterion has been reported as PASSING since entry 0171, re-proved at 0172-REVIEW §2 with
two mutation checks, and cited as settled at 0173, 0174, 0175 and 0176-REVIEW. All of that is true
and none of it is withdrawn.

**What no one checked is whether a person can perform it.** The criterion is written as an operator
scenario — *"`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to
`script_1.out.result`, and changing the placeholder output value moves the polygon"* — and it is
proven by a test that reaches past the command line into `mutate` directly.

## 2. What I ran

The criterion, walked through `submitLine` exactly as a person at the command line would type it:

```
$ table x=0 y=0 rows=1 cols=1                -> created table_1
$ set table_1.A1 3                           -> table_1.A1 = 3
$ script x=0 y=0                             -> created script_1
  SCRIPT SLOTS: ["origin.x","origin.y","language","source"]
  SCRIPT PORTS: undefined
$ link script_1.in.factor table_1.A1         -> script_1 has no slot at "script_1.in.factor" —
                                                object type "script" does not declare one
$ addport script_1 in factor                 -> unknown command "addport"
$ set script_1.placeholder.result 10         -> script_1 has no slot at "script_1.placeholder.result"
$ polygon sides=5 x=0 y=0 r=1                -> created polygon_1
$ link polygon_1.radius script_1.out.result  -> polygon_1.radius references a slot that does not exist
```

**Every step of the ✅ line is refused.** A created `script` object has four slots and
`ports: undefined`. `addPort`/`removePort` — built and reviewed at 0167/0168-REVIEW under D-141 —
have **no operator-facing surface whatsoever**: §5.10 names no grammar, no UI declares one, and the
criterion test reaches them through `mutateOrThrow` in a fixture (`commands.test.ts:395-440`).

The probe file was deleted; the tree is unchanged (`git status --porcelain` clean apart from this
entry and its `STATUS`/`OPEN_QUESTIONS` updates).

## 3. The finding — D-142 clause 3 rests on a misreading, and it is mine

At 0172-REVIEW I wrote clause 3 to keep §5.8's rendering out of this gate:

> *"§5.8 is explicitly a **STUB ONLY** section whose gate clause is engine-side and passes, and the
> phase heading's word is 'Script *stub*'."*

**The section's very next sentence after that heading is:** *"Build the node as a **real,
first-class graph citizen** whose execution is fake."*

STUB ONLY scopes the **execution** — no Python runs, the seam returns a placeholder — not the node's
existence as a thing an operator can make and use. I took a modifier that the brief attaches to one
noun and applied it to the whole section. That is the same class of error D-142 was written to
correct in entry 0171, made by the ruling that corrected it, one clause later.

Two §5.8 clauses are unbuilt on any reading of the section:

1. **"Ports are declared manually in the UI for now."** Nothing declares them.
2. **"Render as a labelled box with input ports on the left and output ports on the right."**

and §5.9 separately expects *"bounding box for text/tables/images/**scripts**"* among its hit tests.

Clause 1 is the one that bites hardest, and it is not a rendering question at all — it is the
difference between a criterion that is true of the product and one that is true of a test fixture.
D-142 clause 1 says a subsystem the phase heading names is part of the gate even where the ✅ line is
silent. *"Declared manually in the UI for now"* is as explicit and as unbuilt as a clause gets.

## 4. What I am NOT doing

**Not re-ruling D-142 clause 3 on my own authority.** Its own last sentence says: *"Where a heading
and a §5 section genuinely leave the scope ambiguous, that is a §6.1 trigger 3 stop, not a call an
implementer makes alone."* That binds the reviewer too — PROCESS_BRIEF §1 makes the human final
arbiter on "is this phase done", which is exactly what I wrote at 0172-REVIEW §3 when overturning
entry 0171 for making this same kind of call alone. Making it alone in the opposite direction now
would be the same mistake with better intentions.

**Not touching source.** No implementer has done anything wrong here. Entry 0169 built what
0170-REVIEW accepted; entries 0173–0175 built what D-142's fix list asked for. The gap is in my
ruling, not in their code.

## 5. Q-029 — raised, blocking the gate

*Does the Phase 6 gate require the script node's ports to be declarable BY AN OPERATOR, and does it
require §5.8's rendering?* Options in full in `OPEN_QUESTIONS.md`:

- **(a)** ports operator-declarable, the ✅ line walkable by hand; rendering stays out.
- **(b)** (a) plus §5.8's labelled box, its `extent.ts` arm and its `hittest.ts` arm — shipped
  together per D-066, the same shape the `image` slice took.
- **(c)** D-142 clause 3 stands; the engine-side criterion suffices and both are a later slice.

**Recommendation: (a)**, with (b) a close and defensible second. A phase criterion no operator can
reach is proven in a fixture rather than in the product. Rendering is the weaker half of the case —
one sentence of §5.8 and one word of §5.9 — but "invisible and unselectable" is a strained reading
of "real, first-class graph citizen", so (b) is not wrong, only bigger.

**If (a) or (b):** §5.10 names no port grammar, so inventing one is a brief deviation and a §6.1
trigger 3 in its own right — the ruling should name the shape (a command word, or D-094's panel
being allowed to write for this one case, which collides with **Q-014** and is the human's alone).
Do not let an implementer pick it.

## 6. What this does and does not change

- **The ✅ line still passes.** Nothing in §2 falsifies 0172-REVIEW §2's mutation checks. What is in
  question is whether passing it is *sufficient*, not whether it passes.
- **The `image` half is unaffected** — built, reviewed at 0176-REVIEW, still waiting only on the
  human's look under D-142 clause 2.
- **0176-REVIEW's own verdict stands.** ACCEPT WITH EDITS was about entries 0173–0175, and this
  finding is about neither them nor their code.
- **STATUS is corrected by this entry**: it said the gate waits only on the human's look. It now
  says it waits on that *and* Q-029.
