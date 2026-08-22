# Manager cleanup — 2026-08-22

A one-time archival cleanup pass, done by "the Manager" (an ephemeral role, not part of the
implementer/reviewer/human cycle this project normally runs). This is not a numbered cycle entry
and doesn't follow `PROCESS_BRIEF.md`'s cycle template — it predates the entries/ append-only
rule applying to *this kind* of change. Read this once; it explains why the process docs look
different from before, and where to find the untouched originals if anything here needs
double-checking.

## What happened, in order

1. **Cloned the repo twice**, both as plain `git clone`s of the working tree at commit `1a7bb3b`
   (15 REVIEW-phase0, "validate-integrity"):
   - `beheader-original/` — an untouched, permanent backup. Nothing in it will ever be edited.
   - `beheader-clean/` — this copy, where every change below was made.
   The original project directory (`beheader/`, the one open in the editor) was never touched —
   no file in it was read for editing purposes, only for reference, and none was written.
2. **Compacted the process documentation** (this directory, `claude/`) into Simplified Technical
   English: shorter sentences, less repeated rationale, no loss of binding content.
3. **Changed the implementer/reviewer review cadence** in `PROCESS_BRIEF.md` (§3, §6) so more
   work can happen between review points.
4. **Left `PROJECT_BRIEF.md` completely untouched** — byte-identical to the original. See
   "What was NOT touched, and why" below.
5. **Fixed a real, pre-existing bug**: every process doc referred to `claude-log/STATUS.md` etc.,
   but the actual layout (established at the seed commit, confirmed correct at 0002-REVIEW) has
   always been flat `claude/STATUS.md`. This was already known and previously worked around by
   every implementer reading it — now the docs just say the true path.

## What changed, file by file

- **`PROCESS_BRIEF.md`** (524 → ~350 lines): compacted prose throughout, kept every MUST/NEVER
  rule, every template, every numbered list. The one substantive change is §3/§6: the old rule
  was "any touch to a load-bearing file (`address.ts`, `mutation.ts`, `graph/*`,
  `primitives/schema.ts`, `document.ts`) forces an immediate review." In Phase 0 that's nearly the
  whole engine, so it fired almost every cycle — 8 implementer cycles, 7 review cycles, alternating
  almost 1:1. The new rule keeps an immediate stop for the things that actually caught real bugs
  in this project's own history (phase gates, a *new subsystem's* first file, brief deviations,
  broken hard rules, changed tests, new dependencies, repeated bugs — see `DECISIONS.md`'s
  F-1/F-2/D-013/D-016/D-017, every one of which came from exactly these) but lets *ongoing,
  additive* work on an already-reviewed load-bearing file accumulate across up to 3 cycles or
  ~800 changed lines before a review point is mandatory. Phase gates are never batchable.
  Also streamlined the reviewer's report format: a rule genuinely untouched by a diff gets one
  line instead of a restated table row, and a re-verified match gets one line instead of a
  re-pasted transcript — this alone accounts for a lot of each review entry's length in the
  history below.
- **`CLAUDE.md`**: fixed the stale `claude-log/` paths; updated the escalation section to match
  the new cadence; otherwise unchanged in substance.
- **`DECISIONS.md`** (507 → ~250 lines): every `D-001`–`D-017` ruling kept, word-for-word where the
  ruling itself is an imperative statement. Rationale sections compacted — the reviewer's
  extended narrative (probe transcripts, "verified during this review," multi-paragraph argument)
  reduced to the core reasoning. Nothing that changes what an implementer is bound to do.
- **`OPEN_QUESTIONS.md`** (200 → ~110 lines): same treatment — every question, every option,
  every recommendation, every reviewer deferral note kept; prose compacted.
- **`STATUS.md`**: compacted to match the STE standard used elsewhere; every fact (build state,
  known problems, live tags, gotchas) preserved — this is the live state document the next cycle
  depends on, so nothing here was cut for length alone. Added one line noting cycles 0001–0015
  predate the new batching cadence.
- **`entries/0000` through `entries/0015`** (16 files, ~3450 → ~950 lines combined): this is
  where most of the space came from. Each entry's *rationale* was, in almost every case, already
  captured in full in `DECISIONS.md` by the reviewer who found it — the entries mostly restated
  it. Compacted entries keep: declared scope, what was built (file by file), decisions made
  (with a pointer to the `D-NNN`/`Q-NNN` that fully covers it, where one exists), real
  verification numbers, acceptance-criterion status, what was left unfinished, and the
  escalation/review-point reasoning. Dropped: repeated rule-audit tables restating "not touched"
  for the same five rules cycle after cycle, full pasted test-runner output where a pass/fail
  count already says the same thing, and narrative color that doesn't change what a future reader
  needs to do.
- **`0000-SEED-reviewer.md`**: lightly trimmed, same content.

## What was NOT touched, and why

**`PROJECT_BRIEF.md` is byte-identical to the original.** This is the one file in the "sacred
unless justified" category I chose not to modify at all, and here's the argument for that choice
rather than against it: the project's own history shows this document's exact wording gets mined
for precision that survives to `DECISIONS.md`. D-005, D-008, and D-017 were each found by a
reviewer noticing a specific brief sentence said something narrower or wider than the code
assumed — "stored formula ASTs," the exact two-segment address table row, the A1-pattern
shorthand. That density is the point of the document; PROCESS_BRIEF already has the implementer
re-read it in full every single cycle regardless of length, so its size doesn't cost the
repetition problem this cleanup targets — only the process documents around it did. Compacting a
626-line specification written this precisely risks losing exactly the kind of detail that
already resolved three separate disputes, for a document that isn't where the implementer/
reviewer repetition actually lives. I judged that not worth the risk, so it stands untouched.
Verify with `diff beheader-original/claude/PROJECT_BRIEF.md beheader-clean/claude/PROJECT_BRIEF.md`
— empty output.

**`entries/` itself, as a mechanism, was not abolished** — new cycles still write append-only
entries exactly as before. This was a one-time backfill compaction of the *history that already
existed*, done outside the normal cycle by a role the process docs don't define, and is not a
precedent for a future implementer or reviewer editing a past entry. If you're a future cycle
reading this: your own entries are still append-only, starting now.

**No source code, test, or config file was touched.** `git diff` between this copy and the
untouched backup over `src/`, `package.json`, `tsconfig*.json`, `vite.config.ts`, `index.html` is
empty.

## Where to find what you need

- **The untouched original**, exactly as it stood at commit `1a7bb3b`, full git history included:
  `../beheader-original/` (and the still-live project directory itself, `../beheader/`, was never
  touched by any of this either).
- **This copy**, `beheader-clean/`, is a normal git repo with its own commit for this cleanup. If
  anything here reads as ambiguous, thinner than it should be, or plain wrong, the fix is to
  re-derive it from the untouched original's fuller prose — that copy is the tie-breaker, not
  this one, for exactly as long as a discrepancy is suspected.
