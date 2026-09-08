# 0178 — `addport` / `removeport`: §5.8's ports, declarable by a person
Date: 2026-09-07   Phase: 6   Model: reviewer acting as implementer (Opus 5)
Previous entry: 0177-REVIEW-phase6-scope   Last review: 0177-REVIEW-phase6-scope
Batch: cycle 1 of 2 in D-146's build; ~330 lines / 6 files changed so far.

## Declared scope

Build D-146 clauses 2–4: `addport script_1.in.factor` / `removeport script_1.out.result`, each
writing the slots its port implies in the same batch as the name, so Phase 6's ✅ line can be
performed at the command line by a person. Also D-146 clause 1's proof — the criterion, typed.

## Explicitly not in scope

§5.8's RENDERING (D-146 clause 5) — entry 0179. Any port UI on the properties panel: D-146
clause 2 keeps that out, because a panel that declares ports collides with **Q-014**, which is
the human's alone. A `force` flag on `removeport`. `script`'s `source` slot doing anything.

## What I did

**`engine/graph/node.ts`** — `SCRIPT_TYPE`, joining `TABLE_TYPE`/`TEXT_TYPE`/`IMAGE_TYPE`. The
handlers below compare `object.type`, so D-009 applies and the constant exists.

**`command/parser.ts`** — two registry entries and two `Command` arms. The argument is the SLOT
ADDRESS the port will occupy, not an object plus two words: `addport script_1.in.factor` and the
`link script_1.in.factor …` that follows it then spell the port identically (D-010), and there is
no second way to name one. Nothing is split here — D-069 keeps the parser out of address
semantics, so `commands.ts` decides what is a legal family and a legal port name.

**`command/commands.ts`** — `resolvePortTarget` (shared, so the two commands cannot refuse
differently) plus the two handlers.

- `addport` emits the `addPort` operation AND the slots the port implies, in ONE batch: an `in`
  port gets a `literal` `in.<name>`; an `out` port gets its `derived` `out.<name>` (D-018) and a
  `literal` `placeholder.<name>`. This is the reconciliation `mutation.ts`'s `AddPortOperation`
  doc defers to "the `script` schema/command cycle", and it makes **entry 0169's ordering hazard
  unreachable by any sequence of typed lines** — there is no order of `addport` lines that leaves
  a node in the state that check rejects.
- A new port's value is `null`, not a made-up `0`: §5.8 calls placeholders "user-editable" stub
  values. The echo names the exact `set` that fills it, so the operator is not left guessing.
- `removeport` is ONE operation. Removing an out port something still reads is refused by no new
  mechanism — the dropped `out.<name>` dangles the dependent formula and §5.1.1's existing check
  refuses the batch, naming it.

**`command/props.ts`** — a dynamic non-derived family is now ENUMERATED unless it is a table's
`cells.*`. D-077's "summarise, never enumerate" is about a cell grid — 64 rows of noise, sized by
`rows`/`cols` — not about dynamic-ness as such. A port is a distinct thing the operator declared
by name, there are a handful, and `props` is the only way to see one from the command line.
Without this, an operator could declare a port and then not find it.

**Tests** — `commands.test.ts` +13, including **"Phase 6's acceptance criterion, TYPED"**, the
sibling of the existing engine-level criterion test: it reaches `mutate` through nothing but
parsed command lines — no `mutateOrThrow`, no hand-built operation, no fixture.

## Decisions I made

1. **`addport`/`removeport` rather than `addport`/`delport`.** §5.10's own pairs are
   `addvertex`/`delvertex`, which argues for `delport`. D-141 named the operations
   `addPort`/`removePort`, and PROCESS_BRIEF §5.1's vocabulary lock says one word per concept —
   so the command word matches the ruling that created the mechanism rather than a different
   subsystem's convention. A coin-flip, decided by the lock and recorded here because it is one.
2. **A `placeholder` OUTLIVES its port, and `addport` restores it.** I first made
   `RemovePortOperation` drop the placeholder too, and reverted it: an existing `mutation.test.ts`
   case documents the surviving placeholder deliberately, and D-017 part 2 states why it is legal
   ("an undeclared literal has no inbound edges either way"). So `addport` writes a placeholder
   only when there is not one, and `removeport` then `addport` gives the operator their stub value
   back. Smaller diff, no load-bearing file touched, no reviewed test changed, and better
   behaviour — I went the wrong way first and the existing test is what caught it.
3. **`props` enumerates ports.** See above. This narrows D-077 to its actual subject rather than
   extending it, and the test says so.

## Verification (real output)

```
$ npx tsc --noEmit                            -> 0
$ npx tsc --noEmit -p tsconfig.engine.json    -> 0
$ npx vitest run
 Test Files  36 passed (36)
      Tests  1947 passed (1947)
```

The criterion, typed at the command line, every line one a person can enter:

```
$ script x=0 y=0                             -> created script_1
$ addport script_1.in.factor                 -> added input port script_1.in.factor —
                                                bind it with `link script_1.in.factor <address>`
$ link script_1.in.factor table_1.A1         -> script_1.in.factor = table_1.A1
$ addport script_1.out.result                -> added output port script_1.out.result —
                                                set its stub value with `set script_1.placeholder.result <value>`
$ set script_1.placeholder.result 10         -> script_1.placeholder.result = 10
$ link polygon_1.radius script_1.out.result  -> polygon_1.radius = script_1.out.result
   RADIUS = 10
$ set script_1.placeholder.result 25            RADIUS = 25
$ set table_1.A1 7                              in.factor = 7
```

Compare 0177-REVIEW §2, where every one of those lines was refused.

**D-016 mutation check** — `addport`'s companion `setSlot` for an `in` port removed: RED, 3
failures, including the typed-criterion test. Reverted from a file copy (not `git checkout` — see
0176-REVIEW §2 for why); tree re-verified green.

## Acceptance criteria status

Phase 6 criterion: **PASSING, and now performable.** The engine-level proof is unchanged
(0172-REVIEW §2/§6); this cycle adds the operator-level one D-146 clause 1 requires. **The GATE is
NOT claimed** — D-146 clause 5's rendering is entry 0179's, and D-142 clause 2 still needs the
human's look.

## Where I got stuck / what is unfinished

- **I went the wrong way on the placeholder lifetime first** (decision 2), touching load-bearing
  `mutation.ts` before checking whether the existing behaviour was deliberate. It was, and the
  file's own D-017 comment said so. Reverted with nothing lost, but the order was backwards: read
  the invariant, then decide, not the reverse.
- **No `force` on `removeport`.** `delete <object> force` exists because §5.1.1 gives whole
  objects a repair path; §5.8 asks for no such thing for a port, so an operator whose out port is
  referenced must `unlink` the dependent first. Deliberate, and possibly annoying in practice.
- **A port cannot be RENAMED.** `removeport` + `addport` loses any binding on an in port. §5.8
  names no rename and I did not invent one.
- **The properties panel shows ports now** (it reads `buildSlotDescriptors` too) but has no way to
  ADD one — D-146 clause 2 keeps that with Q-014. An operator inspects ports by mouse and declares
  them by keyboard, which is a seam worth the human's eye.

## Open questions raised

None. **Q-029 is ANSWERED — D-146**, by the human at 0177-REVIEW.

## Review point

**Fired: §6.1 trigger 6** (two new command words are a grammar extension, §5.10 names neither) and
**§6.1 trigger 5** (two registry-completeness lists gained entries — `parser.test.ts`'s
`DOCUMENTED_EXAMPLES` and `commands.test.ts`'s `EVERY_REGISTRY_EXAMPLE`/`COMMANDS_WITH_HANDLERS`;
both are additive registrations, which is exactly what those guards exist to force). Both are
authorised in advance by D-146. Cycles since last review: **1/3**.
