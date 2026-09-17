# Rust engine port

This document owns the plan and work register for moving the Beheader engine
from TypeScript to Rust. It gives each piece a stable name, a dependency, and
evidence that will establish completion. A session can resume from the handoff
without reconstructing decisions from conversation history.

**The migration is in implementation.** Section 2 of the spec has released the
Rust engine core, the runner that compares it against TypeScript, the browser
binding and the engine selection from the deferred list. `RUST-001`, `RUST-002`
and `RUST-003` have landed, so the contract inventory, the Cargo workspace, the
two runners, the comparator and the browser binding are in the repository and
the commands under [checks](#checks-over-the-rust-side) run. Gates A and B are
passed. The application still runs the TypeScript engine and the application
adapter is still a proposal, so a path or a command below that names the
adapter is a proposal until `RUST-014` lands.

The plan was written against commit
`2ba050dd583fcdb67902e51564c6462b538fb5dd`, inspected on 2026-09-14.
Implementation began against `0ca62a7cd72384a47464bdd4f402a1d0c52aa4b3`, which
every fixture records under `baselineCommit`. The suite at that commit has
2,743 Vitest tests and 23 tooling tests, and the Rust crates add 23 of their
own. Those counts describe the whole application, not the number of Rust tests
to produce.

## Contents

| Section | Purpose |
| --- | --- |
| [Document ownership](#document-ownership) | Responsibilities of the project documents |
| [Scope and existing boundary](#scope-and-existing-boundary) | Source inventory and migration scope |
| [Compatibility contract](#compatibility-contract) | Behavior that survives the port |
| [Runtime and ownership decisions](#runtime-and-ownership-decisions) | Host choices and committed state |
| [Measurement across the boundary](#measurement-across-the-boundary) | Browser layout as an engine input |
| [Rust structure](#rust-structure) | Crates and internal representations |
| [Application adapter](#application-adapter) | Consumer API and failure handling |
| [Verification strategy](#verification-strategy) | Fixtures, comparisons, and checks |
| [Work register](#work-register) | Stable packages and acceptance evidence |
| [Release gates and rollback](#release-gates-and-rollback) | Conditions for switching engines |
| [Risks and decision register](#risks-and-decision-register) | Unresolved choices and baseline issues |
| [Current handoff](#current-handoff) | The next session's starting point |
| [External references](#external-references) | Verified language and binding constraints |

## Document ownership

[SPEC.md](SPEC.md) remains the authority for product behavior.
[STATUS.md](STATUS.md) remains the description of the code that exists.
[TODO.md](TODO.md) remains the current product work list.
[STYLE.md](STYLE.md) governs prose. This document owns migration dependencies,
compatibility decisions, acceptance evidence, and the current Rust handoff.

The extra document has a specific purpose: migration tasks persist across
multiple implementation stages and need stable references after completion.
This register retains completed IDs and a short link to their evidence. Git
holds the narrative history. The handoff is replaced with the current state
instead of accumulating session notes.

Section 2 of the spec names the released Rust scope and the four limits over
it, and section 17 keeps Tauri, WebGPU and Python execution deferred. That
scope change is what activated this register. A later package that needs one of
the three still deferred needs its own release in the spec first.

A product change remains a product change even when discovered during the
port. Its requirement belongs in the spec, and its implementation belongs in
the ordinary work list. The Rust register links to that work rather than
silently inventing different behavior in the new engine.

The TypeScript baseline will move. Each active package records the commit it
compares against. A change to an engine contract updates the shared fixtures
and the affected package before the port is called equivalent again.

## Scope and existing boundary

### The intended result

One Rust core implements the engine behavior currently owned by `src/engine/`.
It runs headlessly and has a narrow adapter for the application. Existing
documents remain readable, and accepted operations produce equivalent state,
refusals, and derived values. The renderer and command interface can continue
in TypeScript while the engine changes underneath them.

The first port preserves the full evaluation pass and atomic mutation model.
Incremental evaluation, a different solver, a new file format, and a new
renderer each require their own justification after equivalence is established.
Rust is a language and ownership change, not evidence of a speed improvement.

The port includes the formula language, the distinct math language, text block
evaluation, schemas, completion, geometry, sparse tables, script placeholders,
persistence, and replay. The `value` and `add` object types remain useful
conformance fixtures with no ordinary command that creates them.

The following remain outside this plan's implementation scope:

- Canvas drawing, DOM layout, MathLive editing, and image decoding.
- Command syntax, interactive prompts, selection, cameras, menus, and panels.
- Tauri packaging, WebGPU rendering, and a real Python interpreter.
- Document variables and their canvas copies until their existing product
  work is implemented or explicitly added to the frozen port baseline.
- The undo and redo interface remains deferred. Replay remains an engine capability.

Camera data still travels through document persistence. Excluding camera
interaction from the Rust core does not permit dropping the saved camera.

### What the existing separation already provides

[STATUS.md](STATUS.md#2-the-layers-and-why-they-exist) describes an engine with
no browser dependency. [tsconfig.engine.json](../tsconfig.engine.json) checks
it without the DOM library. Graph state uses IDs and plain values. The only
host service in [EvalContext](../src/engine/eval-context.ts) is measurement.
Schema functions and temporary maps are runtime behavior, separate from the
plain graph state that gets saved.

[index.ts](../src/engine/index.ts) is the import boundary, but it exposes
internal helpers as well as application operations. Its tests enforce runtime
export completeness and the current consumer import convention. A suitable cross-language protocol still needs a separate consumer contract. The existing
export-surface TODO and the transport design are related but distinct tasks.

Consumers reach further into the engine than a single evaluate call:

- [commands.ts](../src/command/commands.ts) constructs objects and operation
  batches, resolves addresses, and installs returned objects and journals.
- [interaction.ts](../src/render/interaction.ts) reads geometry and performs
  synchronous mutations during drag, resize, and bend gestures.
- [props.ts](../src/command/props.ts) reads schema metadata and formats formulas.
- [main.ts](../src/main.ts) owns the document, coordinates mutation results,
  loads files, and reevaluates after fonts arrive.
- Rendering and hit testing consume geometry helpers and derived slot values.

The first implementation task therefore inventories actual imports, including
type-only imports and helper calls. A runtime export count alone misses types,
and a list copied into this document would become stale.

[tools/engine-contract.mjs](../tools/engine-contract.mjs) reads that inventory
out of the TypeScript source and writes
[inventory.json](../tests/conformance/contract/inventory.json). At
`0ca62a7cd72384a47464bdd4f402a1d0c52aa4b3` the barrel carries 435 exports, 297
of which have a runtime value, and production consumers in 19 source files
import 160 distinct names. The audit excludes test consumers and counts an
alias by the name the consumer imports. Every one of those 160 names carries a
disposition in
[dispositions.json](../tests/conformance/contract/dispositions.json), which is
the checklist `RUST-013` works through. The check runs inside `npm test`, so a
new export, a new consumer import or a disposition for a name that has gone
turns the suite red.

### Source-to-package map

These paths are the inspection checklist. Rust module names below are proposed
groupings, not a requirement for one source file per TypeScript file. Each
source file's adjacent test file travels with its behavior.

| TypeScript source under `src/engine/` | Proposed Rust home | Package |
| --- | --- | --- |
| [graph/node.ts](../src/engine/graph/node.ts) | `model` | `RUST-004` |
| [address.ts](../src/engine/address.ts) | `address` | `RUST-004` |
| [graph/edge.ts](../src/engine/graph/edge.ts) | `graph::edge` | `RUST-004` |
| [eval-context.ts](../src/engine/eval-context.ts) | `context` | `RUST-004` |
| [formula/ast.ts](../src/engine/formula/ast.ts) | `formula::ast` | `RUST-005` |
| [formula/lexer.ts](../src/engine/formula/lexer.ts) | `formula::lexer` | `RUST-005` |
| [formula/parser.ts](../src/engine/formula/parser.ts) | `formula::parser` | `RUST-005` |
| [formula/format.ts](../src/engine/formula/format.ts) | `formula::format` | `RUST-005` |
| [formula/deps.ts](../src/engine/formula/deps.ts) | `formula::deps` | `RUST-005` |
| [formula/eval.ts](../src/engine/formula/eval.ts) | `formula::eval` | `RUST-006` |
| [formula/functions.ts](../src/engine/formula/functions.ts) | `formula::functions` | `RUST-006` |
| [primitives/edge.ts](../src/engine/primitives/edge.ts) | `primitives::edge` | `RUST-007` |
| [primitives/geometry.ts](../src/engine/primitives/geometry.ts) | `primitives::geometry` | `RUST-007` |
| [primitives/table.ts](../src/engine/primitives/table.ts) | `primitives::table` | `RUST-007` |
| [primitives/image.ts](../src/engine/primitives/image.ts) | `primitives::image` | `RUST-007` |
| [primitives/doc.ts](../src/engine/primitives/doc.ts) | `primitives::doc` | `RUST-007` |
| [primitives/schema.ts](../src/engine/primitives/schema.ts) | `schema` | `RUST-007`, `RUST-010` |
| [script/stub.ts](../src/engine/script/stub.ts) | `script` | `RUST-007` |
| [math/ast.ts](../src/engine/math/ast.ts) | `math::ast` | `RUST-008` |
| [math/lexer.ts](../src/engine/math/lexer.ts) | `math::lexer` | `RUST-008` |
| [math/parser.ts](../src/engine/math/parser.ts) | `math::parser` | `RUST-008` |
| [math/names.ts](../src/engine/math/names.ts) | `math::names` | `RUST-008` |
| [math/eval.ts](../src/engine/math/eval.ts) | `math::eval` | `RUST-008` |
| [primitives/math.ts](../src/engine/primitives/math.ts) | `primitives::math` | `RUST-009` |
| [primitives/text.ts](../src/engine/primitives/text.ts) | `primitives::text` | `RUST-009` |
| [graph/cycles.ts](../src/engine/graph/cycles.ts) | `graph::cycles` | `RUST-010` |
| [graph/eval.ts](../src/engine/graph/eval.ts) | `graph::eval` | `RUST-010` |
| [mutation.ts](../src/engine/mutation.ts) | `mutation` | `RUST-010`, `RUST-011` |
| [document.ts](../src/engine/document.ts) | `document` | `RUST-012` |
| [journal.ts](../src/engine/journal.ts) | `journal` | `RUST-012` |
| [complete.ts](../src/engine/complete.ts) | `complete` | `RUST-013` |
| [index.ts](../src/engine/index.ts) | `lib` and application adapter | `RUST-013`, `RUST-014` |

## Compatibility contract

### Graph and mutation semantics

The dependency graph has a node for each slot. An edge points from the slot
supplying a value to the slot reading it. Object order remains observable in
drawing and completion. Stable IDs survive renames. An address retains its
object ID and ordered path segments.

The schema owns legal slot families, slot kinds, defaults, option sets, and
derived dependencies. Dynamic families resolve per object. Edge derivation and
integrity validation use that same resolution, including sparse table cells.
The Rust port cannot replace schema resolution with the set of keys currently
present in an object.

The mutation contract includes the following properties:

1. A batch commits in full or leaves the input objects and journal unchanged.
2. Operations run in their given order, including create and delete operations
   that change which IDs later operations in the batch can reach.
3. Structural and payload checks retain their observable precedence. The file
   header's staging outline does not replace the actual preflight checks.
4. Derived edges are rebuilt before integrity and cycle checks. A graph with
   dangling references cannot pass through cycle checking as if it were valid.
5. Evaluation errors become slot error values. A valid transaction producing
   a division error differs from an invalid transaction that is refused.
6. Evaluation changes values, with no additions or removals of slots.
7. One successful batch appends one journal entry. Failed batches append none.
8. Forced repairs return the affected addresses in `brokenSlots` and preserve
   the current address-repair rules.

The operation inventory has fifteen members: `createObject`, `deleteObject`,
`setSlot`, `clearSlot`, `renameObject`, `renameVariable`, `insertTableLine`,
`deleteTableLine`, `addPort`, `removePort`, `setMathSource`, `addVertex`,
`deleteVertex`, `explode`, and `splitEdge`. The generated
[inventory.json](../tests/conformance/contract/inventory.json) reads that list
out of the TypeScript union under `variants.Operation`, and it is the guard the
implementation works against rather than the list in this paragraph.

`renameVariable` is the one this document missed when it was written against
the earlier commit, because it is the only member of the union written inline
rather than as a named interface. It renames a document variable, and it
arrived with the document variable work. A count taken by hand is exactly what
the generated inventory replaces.

Deletion behavior is deliberately asymmetric. A referenced object normally
refuses deletion unless forced. Deleting a table line repairs references.
Deleting a vertex requires checks before its successor shifts into the same
index. Exploding a shape and splitting an edge each preserve their existing
geometry and reference behavior. A generic delete implementation loses these
distinctions.

### Values and numbers

The current `Value` union holds a number, string, boolean, point, list of
points, null, or error value. Rust should represent these as an enum, with
conversion code preserving the current JSON shapes. A missing slot differs
from a slot containing null. Optional fields differ from explicit null unless
the existing loader treats them alike.

Graph numbers remain binary64 values. Rust `f64` is the matching storage type.
The spec's deferral of a precision redesign does not imply conversion to
`f32`. Rust documents binary64 storage separately from the platform-dependent
precision of transcendental functions. [Rust floating-point reference](https://doc.rust-lang.org/std/primitive.f64.html)

Input validation rejects non-finite numbers and negative zero where the
TypeScript engine does. Computation normalizes zero at the same semantic
boundaries as the current implementation. Serialization cannot be the first
place a non-finite result is noticed, because a substituted null would change
the graph's meaning.

Specific compatibility cases include:

- Formula `ROUND` and math `round` use JavaScript rounding. Halfway values
  round toward positive infinity, while Rust `f64::round` rounds away from
  zero. `ROUND(-1.5, 0)` therefore needs a compatibility implementation, not a
  direct method rename. [ECMAScript rounding](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.round),
  [Rust rounding](https://doc.rust-lang.org/std/primitive.f64.html#method.round)
- Formula remainder and the math language's `mod` follow different formulas.
  Their negative-operand cases need separate fixtures.
- Numeric parsing retains the accepted grammar and full-input checks. A Rust
  parser accepting a different spelling does not extend the formula language.
- Number-to-text conversion affects formatted formulas, resolved text, and
  diagnostics. Equivalent numeric values can still produce different strings.
- ID counters and table indices need checked integer conversion. An internal
  `u64` does not make numbers above JavaScript's safe range valid on the bridge.
- Expression order, sum order, and solver branch selection remain stable.
  Algebraic simplification and fused operations can change results.

### Strings, ordering, and addresses

Formula tokens expose source positions, and completion uses them to mark
addresses in fields. JavaScript positions and `LEN` count UTF-16 code units.
Rust strings use UTF-8, so byte offsets and character counts cannot replace
those results. The bridge contract keeps UTF-16 offsets. Tests include an
astral character before a reference, combining marks, and escaped strings.
[Rust string representation](https://doc.rust-lang.org/std/string/struct.String.html)

JSON can also contain lone surrogate escapes that a JavaScript string retains.
A plain Rust `String` cannot preserve every such input. `D-005` decides between
a lossless compatibility representation and a documented input restriction
applied to both engines. Replacement characters are not a silent migration
policy. Serde documents the distinction for string and byte deserialization.
[Serde JSON string handling](https://docs.rs/serde_json/latest/serde_json/de/struct.Deserializer.html#method.deserialize_bytes)

Case-insensitive lookup retains its current rules and original display
spelling. Completion preserves document and schema order. Sorting a Rust map
can change the first candidate, first refusal, or reported cycle even when all
the same elements are present. `HashMap` iteration has arbitrary order, so
observable traversal order needs a separate ordered representation.
[Rust map iteration](https://doc.rust-lang.org/std/collections/struct.HashMap.html#method.iter)

`slotKey` joins segments but has no reliable inverse. The schema remains the
source of paths. A typed address is useful inside Rust, but changing address
equality from the current key semantics needs collision fixtures and an
explicit compatibility decision. Splitting keys on dots is not a port.

### Languages and bounded evaluation

The formula and math languages remain distinct. Formula ASTs are persisted.
Math source is parsed and bound to build input, output, and seed slots through
`setMathSource`. An edit that fails to parse leaves the previous source and
ports intact. Names stored as IDs remain rename-safe, while display formatting
uses current object names.

Lazy conditionals and boolean behavior follow the current evaluator. Dependency
extraction can include both branches even when evaluation reads only one.
Text blocks use that same formula machinery, including nested conditionals.
The port cannot infer dependencies only from the branch last evaluated.

Math binding preserves line order, local variables, input discovery, function
visibility, and the prohibition on recursive definitions. The solver keeps
its seed, root search order, and behavior when a root merely touches zero.
A different root with a small residual is not automatically an equivalent
answer for a document that expects the seed to select a branch.

Baseline limits belong in conformance fixtures:

| Limit | Baseline value | Source |
| --- | --- | --- |
| Formula AST depth | 1,000 | `formula/ast.ts` |
| Math AST depth | 64 | `math/ast.ts` |
| Math call depth | 64 | `math/eval.ts` |
| Expression evaluations per exported math line | 1,000,000, added after the planning baseline | `math/eval.ts` |
| Integral intervals | 512 | `math/eval.ts` |
| Series terms | 100,000 | `math/eval.ts` |
| Solver search rings | 60 | `math/eval.ts` |
| First solver radius | `1 / 256` times seed scale | `math/eval.ts` |
| Solver bisections | 80 | `math/eval.ts` |
| Table rows and columns | 1 through 1,000 each | `primitives/table.ts` |

Total document cost can remain large within these bounds. Nested series and
integrals share the per-line budget, but each exported line starts a fresh one.
`RUST-015` measures composed cases and records any proposed whole-document
budget as a behavior change, with a defined refusal or error and fixtures in
both implementations.

### Persistence and replay

Document format version 1 remains the first compatibility target. Its fields
are `formatVersion`, `nextObjectId`, `objects`, `journal`, and `camera`.
Literal slots retain values. Formula slots retain ASTs and currently serialized
values. Top-level derived slots serialize as `{ "kind": "derived" }`, and
loading reconstructs their values through evaluation.

There is a detail hidden by the broad statement that derived values are never
saved: `serializeDocument` passes the journal through unchanged. An operation
payload can therefore carry derived values inside the journal. Compatibility
tests inspect the complete file, not only the top-level object list. Removing
those payload values is a separate normalization decision.

The loader reconstructs ports and vertex counts, repairs the expected derived
slot set, and applies objects through mutation. Unknown versions are refused.
The file decoder's policy for omitted fields, extra fields, unknown kinds,
duplicate keys, malformed values, and oversized numeric tokens needs explicit
fixtures before a Serde derive is accepted as equivalent.

Serde supports tagged and untagged enum representations. Existing `kind` and
`type` discriminants need their existing spellings. Default Rust enum output
does not establish file compatibility. The untagged `Value` representation
needs shape checks that avoid accepting an error object as a point or dropping
unexpected data without the same TypeScript behavior.
[Serde enum representations](https://serde.rs/enum-representations.html)

The baseline deliberately accepts structurally malformed journal entries at
load time if their numbers pass validation. Replay then returns a refusal for
an entry that fails, including exceptions from malformed payloads. A Rust
document with `Vec<Operation>` as its only journal representation would reject
some files the TypeScript loader accepts. The proposed compatibility approach
retains loaded journal entries as validated raw data and decodes each entry
when replay reaches it. New mutations still emit typed, valid entries.

Replay reconstructs objects only. Camera and the object counter are retained
separately. Journal completeness compares the reconstructed object state with
the caller's state using the same measurement context. It can differ after
font metrics change, so it is not a general proof that the saved journal is
independent of the host.

Parser library recursion limits are another file compatibility boundary. A
formula accepted at the engine's depth limit may have a deeper JSON structure.
Disabling a decoder limit alone leaves recursive traversal, formatting, and
destruction exposed to stack overflow. The implementation needs explicit
bounded parsing and safe traversal on both native and Wasm targets.
[Serde depth guidance](https://docs.rs/serde_json/latest/serde_json/de/struct.Deserializer.html#method.disable_recursion_limit)

## Runtime and ownership decisions

### Recommended direction

The proposed architecture is a pure Rust core, a native conformance executable,
and a browser Wasm adapter for the first application integration. This is a
recommendation pending `RUST-003`, not a claim that a runtime has been selected.
It preserves the current browser application while exercising Rust behavior.
The eventual Tauri shell can reuse the core through a separate adapter if its
state and measurement protocol has been proven.

The core has no dependency on a browser binding, Tauri, a renderer, or process
management. A native test executable is not a commitment to a native application
host. `wasm32-unknown-unknown` has restricted host facilities, which reinforces
keeping file access, clocks, and subprocesses outside the core.
[Rust Wasm target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)

| Option | Benefit | Cost | Proposed role |
| --- | --- | --- | --- |
| Rust compiled to Wasm in the page | Preserves synchronous calls after startup | Conversion, callbacks, Wasm delivery | First application proof |
| Native Rust through Tauri commands | Matches the eventual desktop direction | Async state flow and measurement protocol | Later adapter decision |
| Rust in a worker | Can isolate expensive work from input handling | Async flow and no direct DOM measurement | Later responsiveness experiment |
| Native command-line runner | Reproducible headless comparison | Does not prove application integration | First conformance runner |

Tauri commands expose invocation and response across a process boundary.
Turning a Rust function into a synchronous command does not turn the frontend
call into an ordinary synchronous TypeScript return. Existing gesture and
command handlers therefore need an adapter design before a native switch.
[Tauri command interface](https://v2.tauri.app/develop/calling-rust/)

### State ownership

For the first Wasm proof, the TypeScript application owns the committed
document. An adapter passes a snapshot and batch to Rust, and installs the
successful result once. Rust has a private candidate state for that call.
The TypeScript view is not permitted to edit graph values around Rust's
validation. Camera and selection remain host state under their existing rules.

This simple approach copies more data than a persistent Rust engine handle.
That cost is measured before replacing it. A handle-based design moves
authoritative graph state into Rust and gives TypeScript an immutable view
with a revision. It also requires lifecycle, stale-view, and reload rules.
Both designs are viable, but mixing their ownership rules is not.

The proposed first facade preserves engine calls at the object-and-journal
level. ID allocation and document installation remain with the current host
call sites. Any later whole-document transaction API moves allocation and
commit ownership together and proves that a refusal cannot consume or reuse
an ID unexpectedly.

### Async requirements if native or worker hosting wins

The protocol then needs a document session, monotonically increasing revision,
and request ID. Requests are processed in order for a session. An old reply
cannot replace a newer document or a newly loaded file. Save waits for the
last acknowledged mutation. A timeout does not mean the operation was refused.

Retry handling either recognizes a previously committed request or requires
the host to obtain authoritative state before retrying. Blind retries can
append a batch twice. Preview motion can be coalesced separately from committed
operations, but changing journal granularity requires an explicit decision.

Cancellation and font invalidation also carry a session and revision. Native
execution cannot block waiting for a synchronous DOM callback from the page.
The measurement design below is a prerequisite, not a detail to patch after
the rest of the port is finished.

## Measurement across the boundary

### Existing contract

`TextMeasurer.measure` takes text, font, font size, line height, and an optional
maximum width. `measureMath` is optional and takes LaTeX and font size.
The methods return width and height synchronously. The core consumes their
results as graph values, so a changed measurement can change downstream
geometry and formulas.

The distinction between the null measurer and a real measurer is currently
partly based on object identity. Rust needs an explicit capability distinction.
A fake measurer returning zero is not automatically the null measurer. Missing
math support retains the existing measurement-error behavior.

MathLive stays in the host. Text layout and rendering continue to share their
existing line-breaking rules. Rust does not approximate browser glyph widths
with string length or replace notation layout with another library during
this port.

### Wasm proof

The adapter implements a core measurement trait using host callbacks. Callback
lifetime is bounded by the engine instance or call, and every callback result
is validated before entering state. An exception becomes a defined adapter or
measurement result, with no partial commit. The exact classification is fixed
by the proof's fixtures rather than by binding-library defaults.

The proof includes a text formula whose value changes its width, a math object,
and notation embedded in text. It changes a font after initial evaluation and
checks that the host invalidates measurements and reevaluates all affected
objects. The refresh changes derived values without adding a user mutation to
the journal, matching `main.ts`.

Callback execution has a reentrancy guard. A measurement callback cannot start
another mutation against the candidate being evaluated. Font notifications
arriving during evaluation schedule a later refresh.

### Native or worker proof

A proposed asynchronous alternative evaluates a private candidate against a
measurement table. If an entry is missing, the adapter requests measurements
from the host and retries the same candidate from the same committed revision.
No missing measurement is published as a guessed zero.

Each measurement key includes the exact text or LaTeX, every relevant style
field, the optional width, and a host metric epoch. The epoch changes when
fonts or layout conventions change. Different input revisions cannot reuse
stale request results merely because their object IDs match.

The protocol needs multiple rounds: upstream values can alter text, measured
width can alter geometry, and geometry can drive another measured object.
It records newly requested keys, rejects stale responses, and has explicit
request and round limits. Reaching a limit produces a defined result with no
partial commit. The limits and error behavior require agreement before this
route can replace the synchronous host contract.

This proposal remains unproven. `RUST-003` tests the smallest vertical example
that could invalidate it. A deadlock, an unbounded sequence of requests, or a
layout mismatch is a reason to revise the hosting choice early.

### Shared measurement fixtures

Headless parity uses deterministic measurement responses, not platform fonts.
Each fixture identifies its measurement implementation or exact response table.
An unexpected request fails the test. Both engines receive identical responses.
Browser tests then establish that the real host implementation still draws and
edits correctly. Numeric headless parity does not establish visual parity.

## Rust structure

The workspace separates the core, the comparison runner, and the host adapter.
A name marked as planned is a proposal that arrives with the package that needs
it, and everything else is in the repository now.

```text
Cargo.toml
Cargo.lock
rust-toolchain.toml
crates/
  beheader-engine/
    src/
      lib.rs
      model.rs           values, error codes, object types, slot keys
      address.rs         names, cell references, surface paths
      number.rs          the text JavaScript prints for a number
      wire.rs            the JSON codec the fixtures travel through
      measure.rs         the one service the engine takes from its host
      formula/           planned
      math/              planned
      primitives/        planned
      schema.rs          planned
      graph/             planned
      mutation.rs        planned
      document.rs        planned
      journal.rs         planned
      complete.rs        planned
  beheader-conformance/
    src/main.rs
  beheader-hostproof/    the disposable graph behind the hosting proof
    src/lib.rs
    src/exchange.rs      the route that was not chosen, kept as evidence
    src/main.rs          the cost comparison
  beheader-wasm/
    src/lib.rs           the browser binding and its measurement callback
tests/
  conformance/
    contract/            the frozen boundary and its dispositions
    fixtures/            the questions both engines answer
    comparator/          hand written results the comparator is tested on
    manifest.json
  hosting/
    index.html           the page the browser proof drives
tools/
  engine-contract.mjs    writes the contract inventory
  conformance-runner.mjs the TypeScript side of the comparison
  conformance-compare.mjs runs both engines and reports the difference
  hosting-proof.mjs      builds the binding and drives it in a browser
src/
  engine-adapter/        planned
```

The Wasm crate and application adapter arrive with the hosting proof, not as
empty permanent abstractions. A Tauri adapter is absent until desktop work is
released from deferral. `std` is acceptable in the core. A `no_std` conversion
has no demonstrated requirement here.

A Rust test sits beside the code it covers, in a `tests` module at the foot of
the file, which is where a Rust reader looks for it. The repository convention
of a test file beside each source file belongs to the TypeScript tree and its
bundler, and a second file for each Rust module would put the tests somewhere
the language does not expect them.

The core owns typed IDs, addresses, values, ASTs, slots, and operation enums.
An owned candidate graph provides transaction isolation. Evaluation reads a
stable source snapshot and records computed values in dependency order. Safe
Rust references can connect temporary computation, while persistent graph
relationships continue to use IDs.

Schemas can use static functions or typed dispatch. Dynamic dependencies are
resolved against an object at runtime. Closures are not serialized into graph
state, and code pointers are not sent over the adapter. Application schema
queries return plain descriptors such as paths, kinds, defaults, and options.

An ordered object sequence and explicit traversal order preserve application
behavior. Maps may accelerate lookup internally without deciding the order of
diagnostics, completion, aggregation, or serialization-sensitive arrays.

`serde_json` is the one dependency the workspace has. Its derive companion
remains a proposal rather than a decision: the value union is untagged in JSON
and the order a decoder tries its shapes in is the behavior, so
[wire.rs](../crates/beheader-engine/src/wire.rs) is written out by hand and
each refusal in it has a fixture. The document decoder of `RUST-012` decides
separately whether a derive can carry the file format. Browser bindings belong
to `beheader-wasm`. A general expression library, computer algebra system, or
graph framework is not required for the initial port and would add another
behavior contract to prove.

[rust-toolchain.toml](../rust-toolchain.toml) pins Rust 1.94.1, the two
components the checks need, and the browser target, so a formatting rule, a
lint or a floating point detail cannot change between two machines while the
two engines are being compared. `Cargo.lock` is committed. The workspace uses
edition 2024.

## Application adapter

### Capability families

The facade is defined from consumers, with a disposition for every imported
engine name. It distinguishes data declarations, pure queries, and mutations.
It does not expose every Rust function simply because the TypeScript barrel
currently exports it.

| Family | Contract evidence |
| --- | --- |
| Parse and format | Formula and math parsing, addresses, AST formatting, source spans |
| Queries and descriptors | Slot lookup, schema descriptors, completion, geometry queries |
| Apply | Ordered operation batch, refusal, resulting objects, journal, broken slots |
| Evaluate | Derived refresh under a host context, with no new user journal entry |
| Persist | Version 1 load and save, error mapping, camera and counter preservation |
| Replay | Entry boundary, indexed refusal, completeness under an explicit context |

TypeScript types can be generated or checked against transport declarations.
Neither strategy substitutes for runtime input validation. A malformed file
or callback still enters through untyped data.

The first comparison runner uses JSON to make requests reproducible and easy
to inspect. Production conversion may later use another representation if
profiling justifies it. File-format version, transport version, and fixture
version remain separate concepts. A binding change need not rewrite documents.

### Failure boundaries

The adapter distinguishes a refused mutation, a committed graph with error
values, and an infrastructure failure. Rust `Result` is appropriate internally,
but the host sees the existing discriminated result shape for domain refusals.
Exporting `Result` through wasm-bindgen can throw on `Err`, so the bridge needs
an intentional mapping. [wasm-bindgen result behavior](https://wasm-bindgen.github.io/wasm-bindgen/reference/types/result.html)

Panics and Wasm traps are implementation faults, not ordinary parse errors.
The host retains the last committed document, reports the failure, and treats
the failed engine instance as unusable until reinitialized. A blanket panic
catch is not proof of recovery, especially for aborting builds or stack
exhaustion.

Infrastructure errors never masquerade as a successful empty document. The
application can offer its existing save path from retained committed state.
Automatic replay in a different engine is only safe after the host establishes
whether the failed call committed, which is especially important for native
request timeouts.

## Verification strategy

### A shared executable contract

The comparison sends the same fixture to both engines and puts the two answers
side by side. A fixture records its source test or requirement, the baseline
commit it was taken at, a comparison policy, and its cases. Neither side holds
an expected result, so nothing in the repository can be patched to make a
difference disappear.

```
npm run conformance
```

That command runs [conformance-runner.mjs](../tools/conformance-runner.mjs)
over the TypeScript engine and `beheader-conformance` over the Rust one, and
then [conformance-compare.mjs](../tools/conformance-compare.mjs) reads the two
results files. Each runner also answers `--calls` with the calls it can reach,
and either one writes its results alone with `--fixtures` and `--out`.

A fixture in the shape the runners read now:

```json
{
  "fixtureVersion": 1,
  "id": "model.illegal-numbers",
  "sourceTest": "src/engine/graph/node.test.ts",
  "baselineCommit": "0ca62a7cd72384a47464bdd4f402a1d0c52aa4b3",
  "requirement": "SPEC.md section 4, the value union",
  "comparison": "exact",
  "cases": [
    { "name": "a negative zero", "call": "isIllegalNumber",
      "args": { "number": { "$number": "-0" } } },
    { "name": "an empty list of points", "call": "hasIllegalNumber",
      "args": { "value": [] } }
  ]
}
```

A case reaches one of three outcomes in each engine. An `ok` outcome carries
the answer. An `error` outcome carries a refusal of the arguments, worded the
same way by both runners, so a difference in the wording is a difference
between the two adapters rather than between the two engines. An `unsupported`
outcome says the engine has no implementation of that call, which is the
ordinary state of most of the vocabulary while the port runs. The report counts
an unsupported case apart from a pass and names the calls the Rust engine
cannot answer yet.

Three of the numbers the engine is tested against have no JSON spelling that
survives the trip. A non-finite number has none at all, and `JSON.stringify`
writes a negative zero as `0`. Each of those travels as a tagged object such as
`{"$number": "-0"}`, decoded by the runners alone. A document never holds one,
because a document never holds one of those numbers.

The comparison policy of a fixture is `exact` or an approximate one that
carries its own bounds. Two answers compare by structure: the key order of an
object is not part of an answer, because one engine sorts the keys of a JSON
object and the other keeps the order they were written in, while the order of
an array is part of an answer. A number compares by `Object.is`, so a negative
zero never passes for a zero.

[manifest.json](../tests/conformance/manifest.json) says which engine file each
fixture reaches and which files nothing reaches yet. The comparison checks it
against the fixtures on disk and against the module list in the contract
inventory, so a new engine file fails the comparison until somebody places it
in one of the two lists.

The fixture vocabulary grows as a package needs a new observable contract, and
it reaches parsing, evaluation, mutation sequences, load and save, replay, and
completion by the end. An example of the mutation fixture shape those packages
propose is:

```json
{
  "fixtureVersion": 1,
  "id": "mutation.value-refusal-preserves-state",
  "sourceTest": "src/engine/mutation.test.ts",
  "baselineCommit": "2ba050dd583fcdb67902e51564c6462b538fb5dd",
  "initial": { "objects": [], "journal": [] },
  "measurementContext": "null",
  "steps": [
    {
      "operations": [
        {
          "kind": "createObject",
          "object": {
            "id": "obj_1",
            "name": "value_1",
            "type": "value",
            "slots": { "value": { "kind": "literal", "value": 7 } }
          }
        }
      ],
      "expect": { "ok": true, "journalLength": 1 }
    },
    {
      "operations": [
        { "kind": "deleteObject", "objectId": "missing" }
      ],
      "expect": { "ok": false, "stateUnchanged": true, "journalLength": 1 }
    }
  ]
}
```

That second example describes a shape neither runner reads yet. It is not a
claim that the named TypeScript file holds this exact fixture. A mutation
fixture also compares the complete returned state and refusal, beyond the
abbreviated expectations shown there, and it carries a measurement context
which a fixture over a pure conversion has no use for.

### Comparison rules

Exact comparison is the default for structure, IDs, names, slot kinds, ASTs,
booleans, strings, nulls, array order, journal entries, broken-slot lists, and
document metadata. Map key order may be normalized for structural comparison.
Array order is retained. A serialization fixture separately checks any required
ordering or omission behavior.

Literal numeric values and exact arithmetic fixtures compare exactly. Tests
for rejected negative zero inspect the input sign before JSON can erase it.
Inputs such as non-finite values that are impossible in ordinary JSON use
explicit test-runner tags, decoded only by the runner. Those tags never become
part of the document format or production API.

Approximate comparisons require a per-fixture policy. A proposed policy uses
`abs(actual - expected) <= absTolerance + relTolerance * abs(expected)`.
There is no blanket tolerance over an entire document. The package chooses
and justifies bounds from the existing algorithm and assertions, and records
the units of each measured quantity. A near-zero denominator or solver branch
change receives a dedicated case rather than a wider tolerance.

Geometry and math fixtures can use tolerances for transcendental results while
still requiring identical error classifications, topology, seeds, and selected
root branches. Independent identities, residual checks, and analytically known
answers supplement agreement with TypeScript. Two implementations can agree
on the same defect.

Engine-authored diagnostic strings compare exactly initially because commands
display them directly. Platform-generated JSON parse details and exception
wording need an explicit normalization policy that retains the error class,
entry or address, and useful location. No normalizer drops arbitrary messages
merely to make a mismatch pass.

### Coverage matrix

| Area | Required examples |
| --- | --- |
| Model | Every value variant, missing versus null, invalid numeric payloads |
| Address | Names and IDs, case, dotted segments, cell boundaries, rename stability |
| Formula | Every AST variant and operator, lazy errors, ranges, parse/format round trips |
| Strings | UTF-16 positions, astral text, escapes, lone surrogate decision |
| Math | Bindings, definitions, inputs, seeds, integrals, series, solves, limit boundaries |
| Geometry | Arc and cubic extrema, area, length, split preservation, degenerate cases |
| Table | Sparse empties, full extents, insertion, deletion, repaired ranges |
| Text | Nested conditions, hidden-branch dependencies, wrapping, embedded notation |
| Mutation | Every operation, ordering, refused batches, forced repairs, unchanged inputs |
| Graph | Diamonds, cycles, self edges, disconnected slots, long chains |
| Persistence | Both save/load directions, derived rebuilding, malformed journals, old optional fields |
| Completion | Candidate order, spelling, longest prefix, marked source spans |
| Host | Font refresh, callback failure, reentrancy, failed initialization |
| Async host if selected | Stale replies, file replacement, retries, save ordering, cancellation |

The manifest maps each existing engine test to a Rust test, shared fixture, or
documented host-only case. Parameterized cases retain their distinct inputs.
Port completion is measured by behavior coverage and successful integration,
not by matching the TypeScript test count.

### Validation layers

1. Rust unit tests exercise local algorithms and malformed inputs.
2. Shared fixtures compare TypeScript, native Rust, and Wasm Rust.
3. Sequence tests compare state after every accepted and refused mutation.
4. Property tests cover round trips, stable references, transaction isolation,
   unchanged slot sets during evaluation, and preserved edge geometry.
5. Bounded fuzz cases exercise decoders, both parsers, and operation payloads.
   Reproducible seeds and reduced failures become committed fixtures.
6. Existing command, interaction, and application tests run through the selected
   adapter. A headless engine suite alone cannot finish the port.
7. Browser scenarios inspect real rendering, editing, font refresh, file I/O,
   and console errors. Screenshots and measurements accompany acceptance.

Boundary stress tests include accepted maximum AST depth, rejection just beyond
it, deep raw JSON, long graph chains, wide sparse tables, large journals, and
composed math workloads. Safe destruction of deep Rust data is tested as well
as parsing it. A test process that crashes does not satisfy a refusal test.

### Checks over the Rust side

The repository's four checks remain required, and `npm test` now also runs the
contract check and the comparator tests:

```text
npm test
npm run typecheck
npm run build
npm run prose
```

Four Rust commands run beside them, and one more compares the two engines:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo check -p beheader-engine --target wasm32-unknown-unknown --locked
npm run conformance
```

The browser proof is a sixth command, and it is separate because it needs more
than a Rust toolchain:

```text
npm install --prefix <scratch> playwright     # once
PLAYWRIGHT_DIR=<scratch> npm run hosting-proof
```

It builds `beheader-wasm` for the browser target, runs `wasm-bindgen` over the
result, copies a font off the system to load at run time, serves
`tests/hosting`, and drives the page in Chromium. `wasm-bindgen` comes from
`cargo install wasm-bindgen-cli --version 0.2.128 --locked`, which has to match
the `wasm-bindgen` crate version the binding depends on. The pull request
workflow does not run it yet, because a browser and that install add several
minutes to every pull request and the proof changes only when the binding does.

The pull request workflow runs the other five on Linux and on Windows. macOS joins
them before a macOS application is supported. The Wasm check compiles the core
for the browser target, and an executed browser conformance run arrives with
`RUST-003` rather than standing on a successful compile.

The chosen route into CI, when someone picks this up, is a Linux-only job
gated on the paths the proof actually covers: the Wasm crate, the binding, and
`tools/hosting-proof.mjs` itself. A pull request that touches none of those
pays nothing. One that touches any of them runs the proof and cannot merge
with a broken browser build. Windows stays manual, matching the fact that it
has never run the browser proof.

`npm run conformance` needs Cargo, so it is a command of its own rather than a
step inside `npm test`. A contributor with no Rust toolchain still runs the
four checks, and the comparator keeps its own tests inside `npm test` by
reading hand written results files instead of running either engine.

It also needs Node 22.18 or newer, because the TypeScript runner reads the
engine as TypeScript and Node strips the types itself from that version. That
keeps a build step out from between the two engines, so nothing in between can
be patched to make a difference disappear. The runner reports the version
before it reaches the import, because an older Node reports the same failure as
an unknown file extension.

The production browser build is tested under `/beheader/`, the current
Pages base path, including Wasm loading and asset failures. Pull-request checks
include the new suites before any Rust engine becomes selectable. Deployment
continues to use the established build and permission boundaries.

## Work register

Stable package IDs remain after completion. A package can be split into IDs
such as `RUST-011a` and `RUST-011b`, with the parent retaining its acceptance
gate. A completed package links to its commit or PR and validation evidence.
The status vocabulary is `planned`, `ready`, `active`, `blocked`, `done`, and
`superseded`. A blocked entry names the dependency or decision that releases it.

The spec has released implementation, so the dependencies below apply. A
heading that states completion criteria does not mean those criteria have been
met, and a package is done only where the status column says so.

| Package | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| `RUST-001` | Frozen contract and consumer inventory | Scope activation | done |
| `RUST-002` | Workspace and conformance runner | `001` | done |
| `RUST-003` | Hosting and measurement proof | `002` | done |
| `RUST-004` | Model, addresses, context, wire types | `002`, `003` | done |
| `RUST-005` | Formula syntax, formatting, dependencies | `004` | done |
| `RUST-006` | Formula evaluation and functions | `005` | active |
| `RUST-007` | Geometry, tables, basic schemas, script stub | `004`, `006` | in progress |
| `RUST-008` | Math language and evaluator | `004`, `005` | done |
| `RUST-009` | Text and math primitive integration | `006`, `007`, `008` | planned |
| `RUST-010` | Complete schemas and graph evaluation | `007`, `009` | planned |
| `RUST-011` | Atomic mutations and repairs | `010` | planned |
| `RUST-012` | Document persistence and journal replay | `011` | planned |
| `RUST-013` | Completion and consumer facade | `005`, `010`, `012` | planned |
| `RUST-014` | Application integration behind engine selection | `003`, `013` | planned |
| `RUST-015` | Stress, robustness, and workload measurements | `012`, `014` | planned |
| `RUST-016` | Cutover and rollback rehearsal | `014`, `015` | planned |
| `RUST-017` | Retire duplicate TypeScript implementation | `016` and acceptance period | planned |

### `RUST-001`: Freeze the contract

**Work.** Record the current baseline commit, generate the import and operation
inventories, and map tests to behaviors. Classify each exported name as a core
operation, host query, plain descriptor, type, temporary compatibility helper,
or unused export. Record unresolved behavior differences under decision IDs.

**Evidence.** Every production consumer import has a disposition. The manifest
covers all source modules, object kinds, operation kinds, value variants, and
persisted AST variants. Existing failing behavior is listed separately from
intended compatibility. The four repository checks pass at the selected base.

**Boundary.** The package produces contracts and fixtures, with no requirement
to shrink the TypeScript barrel or redesign commands first.

**Landed.** [engine-contract.mjs](../tools/engine-contract.mjs) writes
[inventory.json](../tests/conformance/contract/inventory.json) from the
TypeScript source: 435 exports with their file, their declaration form and
whether they have a runtime value, the 19 production consumers and the names
each imports, the members of eleven union types, and the engine modules with
whether a test sits beside each. Every one of the 160 imported names carries a
disposition in
[dispositions.json](../tests/conformance/contract/dispositions.json), which the
same tool folds into the inventory. An export nothing imports takes its
disposition from its shape.

The six dispositions of the paragraph above turned out to be enough, with no
name needing a seventh. The counts are 7 core operations, 52 host queries, 79
descriptors, 138 types and 159 unused exports, and no compatibility helper
exists yet. The line between a query and a descriptor is whether an object
reaches the call, so `findSlotFormat` reads a fixed table and is a descriptor
while `resolveDerivedSlots` takes an object and is a query, which tells the
adapter of `RUST-013` which calls have to carry document state across the
boundary.

`node tools/engine-contract.mjs --check` runs inside `npm test` and reports
drift in either direction. Its own tests drive a missing disposition, a
disposition for a name that has gone, a disposition outside the six, a type
recorded as an operation, and a changed variant in the committed inventory.

### `RUST-002`: Establish repeatable comparison

**Work.** This package adds the minimal Cargo workspace, pinned toolchain,
native runner, TypeScript runner, fixture schema, and comparator. The initial Rust capability
can be a small value or address conversion. Unsupported fixture operations
report unsupported explicitly, never success.

**Evidence.** CI proves a known match and a deliberate mismatch. Reports include
fixture ID, baseline, target, first differing field, expected result, and actual
result. Runner failures and malformed fixture files fail the command. Ordinary
application checks continue to pass.

**Boundary.** No placeholder evaluator claims to implement unavailable cases.
The runner distinguishes not-yet-implemented coverage from conformance passes.

**Landed.** The workspace holds `beheader-engine` and `beheader-conformance`
under a pinned toolchain and a committed lockfile. The first Rust capability is
the value model, the addressing arithmetic, the JavaScript number to text
conversion and the wire codec, which is what a fixture over a conversion can
already ask both engines. 23 Rust tests cover them.

Seven fixtures hold 127 cases. 122 of them reach both engines and agree, and
the five that call `parseFormula` come back unsupported from Rust, which is the
case that proves an unimplemented call is never reported as a pass. The
comparator is tested on hand written results files under
[comparator](../tests/conformance/comparator): a known match, a deliberate
difference that is reported with the field it happened at, a call the Rust
engine cannot answer, two runs that fell out of step, and a results file that
names the wrong engine. Those tests run without Cargo, so they sit inside `npm test`
while the end to end comparison runs in the Rust job.

The number to text conversion is the first compatibility helper the port
needed. Rust prints `1e21` as twenty two digits and JavaScript prints it as
`1e+21`, and that text reaches an operator through a formatted formula, the
resolved content of a text object and the wording of a diagnostic.
[number.rs](../crates/beheader-engine/src/number.rs) implements the ECMAScript
rules, and the fixture over it covers both notation boundaries, the smallest
and largest numbers, and the three that are not finite.

### `RUST-003`: Prove hosting and measurement

**Work.** Compare a browser Wasm call with the proposed native measurement
exchange. Prototypes remain small and disposable. Exercise a measurement-driven
value, a dependent measurement, font invalidation, and callback failure.
Choose `D-001`, `D-002`, and the initial ownership mode in `D-003`.

**Evidence.** The selected route completes a real browser scenario with correct
dimensions, no deadlock, and a defined failure path. A measured report records
startup, conversion, callback, and update costs. Native selection also proves
stale-response and multiple-round handling. The retained prototype becomes a
regression test and specifies actual adapter build commands.

**Boundary.** A recommendation in this document is not acceptance evidence.
The proof cannot be deferred until after the algorithm port.

**Landed.** `beheader-hostproof` holds the smallest graph that could invalidate
the proposal: an upstream number makes a piece of text, the width of that text
sets the width of a box, the width of the box makes another piece of text, and
that line carries notation beside the words. Each step needs the step above it
measured before its own text is known, which is what a binding that asks for
measurements in batches cannot get around. The same graph is evaluated both
ways, so the two routes differ in how a measurement arrives and in nothing
else.

`beheader-wasm` is the browser binding, and `npm run hosting-proof` builds it,
serves `tests/hosting`, and drives it in Chromium. Seventeen checks pass: real
font metrics reach the values below them, a font that arrives changes those
values with no input changing, a callback that throws becomes a measurement
error and leaves the engine usable, an answer that is not a pair of numbers is
refused, a host that cannot size notation says so rather than answering, and a
callback that starts another pass is refused while the outer pass finishes
unharmed. Removing the reentrancy guard turns the proof red, so it is a
regression test rather than a demonstration.

The measured costs, from a release build of the binding in a container rather
than on a developer machine: the module starts in about 8 milliseconds, the
engine is constructed in under 1, one pass over the proof graph takes about 26
microseconds against real canvas metrics and about 16 against a host that
answers without measuring, which puts a crossing at roughly 5 microseconds per
measurement. Those figures establish the shape of the cost rather than a
budget, and `RUST-015` is where a budget gets numbers from named hardware.

The exchange for the route that was not chosen is implemented and tested
anyway, in `exchange.rs`, because the decision rests on how it behaves rather
than on how it was expected to behave. `cargo run -p beheader-hostproof`
prints the comparison.

**Decisions.** `D-001`, `D-002` and `D-003` are resolved under the decision
register below.

### `RUST-004`: Port the data foundation

**Work.** Implement values, errors, slots, objects, address handling, edge data,
context capabilities, and the initial wire conversion. Settle `D-004` and
`D-005` before choosing representations that would make them costly to change.
Disk values remain distinct from computed runtime values.

**Evidence.** Round trips preserve every value variant, path, optional field,
and numeric boundary in the approved corpus. The representation distinguishes
missing slots from null values.
The fake, null, and math-capable measurement contexts produce expected results.
The core builds without host bindings.

**Landed.** The runtime model now includes the three slot variants, ordered
port families, optional targets and vertex counts, and graph objects whose
formula payload stays typed without pulling the next package forward.
Address parsing resolves case-insensitive object names and document variables,
normalizes table cells, preserves stored variable spelling, and returns the
same diagnostic suggestions as the TypeScript engine. Edge records and their
stable traversal key complete the graph data foundation. Unit tests distinguish
a missing slot from a present null and exercise the optional object fields.

The slots of an object sit in `SlotMap`, which gives its keys back in the order
they were written. A sorted map would answer three behaviours
differently. The topological pass seeds its node map from that order, so it
settles which of two independent slots reports a cycle first. The schema
enumerates slot paths in it for completion. A rename rebuilds the map entry by
entry, which leaves the renamed slot where it was.

A refusal from `parse_address` or `format_address` carries the `#REF` code
beside its wording, which is the shape `src/engine/address.ts` returns and the
shape a caller stores when a refusal reaches a slot.

Four fixtures reach the new behaviour: `model.port-names`,
`address.nearest-name`, `address.resolution` and `graph.address-key`. They take
the comparison from 122 cases to 164, and `src/engine/graph/edge.ts` leaves the
list of modules with no fixture. The address fixtures give the slot names of an
object as an ordered list rather than as a JSON object, because `serde_json`
holds the members of an object in a sorted map and the order of those names
decides which spelling of a document variable an address takes.

`D-004` and `D-005` are resolved below. The existing shared value fixtures cover every value variant and
numeric boundary. The generic formula payload is bound to the persisted AST and
gains its wire round trips in `RUST-005`, where that type is introduced rather
than represented temporarily as raw JSON.

### `RUST-005`: Port formula syntax and reference handling

**Work.** Port lexing, AST validation, parsing, formatting, dependency extraction,
and reference rewriting. Preserve precedence, associativity, ranges, name
resolution, source positions, and depth checks.

**Evidence.** AST fixtures and parse/format round trips pass. Table and vertex
rewrite helpers have direct fixtures before mutation consumes them. Unicode
source offsets match field marking. Malformed and maximum-depth inputs return
defined results without process failure.

**Landed.** The lexer, the node types with their shape and depth checks, the
parser, the printer, dependency extraction, the two rewrites a resize asks of a
stored tree, and the signature half of the function registry. What a function
computes arrives with `RUST-006`, because the parser needs only the name, the
argument count and whether a range may be handed to the function.

Six fixtures carry the package: `formula.lex`, `formula.ast-shape`,
`formula.parse`, `formula.format`, `formula.dependencies`, and the arity and
unknown-name cases inside `formula.parse` that reach the registry. The printer
is compared by reading its text back and comparing the tree, rather than by the
text alone, so a bracket in the wrong place shows as a different tree.
Dependency extraction answers both branches of an `IF`, because which branch is
live rests on a value evaluation has not produced.

The lexer scans UTF-16 code units, so the offset a token carries is the offset
a JavaScript string gives and the command line marks the faulty field of a
formula by the same number. Its refusal for an unrecognised character named the
one unit the scan sat on, which for a character outside the basic plane is the
lone surrogate that is half of it. Both engines now name the whole code point,
which is a change to the TypeScript recorded under `D-005`.

Two walks over a tree hold their own stack rather than recursing: the shape
check in `ast.rs` and the walk in `parser.rs` that places ranges. Both are
reached with a depth the input decides, and the limit that stops them is only
met part way down.

The descent in the parser stays recursive, because the nesting limit of 256
steps bounds it and an explicit stack would cost more than it saves. What that
costs was measured on this machine, by parsing a formula of nested brackets on
a thread of a named size. A release build reaches the full limit of 256 inside
a stack of one mebibyte, which is what the toolchain gives a Wasm module and
what `npm run hosting-proof` builds. A debug build of the same formula needs
about twice that, and holds between 64 and 96 bracket levels in one mebibyte,
which is why the native test threads that carry two mebibytes run it. Frame
sizes on `wasm32` differ from the native ones, so the figure that governs the
shipped engine is a browser measurement, and `RUST-015` takes it.

**An existing fault the port keeps.** A round trip over the formatter found a
fault that predates the port, and both engines answer it the same way. The
printer writes a number the way JavaScript writes one, which uses an exponent
at and past 1e21 and below 1e-6, while the lexer has no exponent form. So a
formula holding a small literal prints as text that will not parse: an
operator who types `0.0000001 + 1` reads `1e-7 + 1` back from the properties
panel, and submitting what they read refuses with a parse error. The
`formula.format` fixture carries the case, so the behaviour is recorded rather
than discovered again.

Closing it means either a grammar that reads an exponent or a printer that
writes none, and both change what an operator types or reads. The spec governs
that, so this is a finding rather than a change made here.

### `RUST-006`: Port formula evaluation

**Work.** Port the function registry, operator behavior, lazy evaluation,
argument validation, range reads, and error propagation. Implement JavaScript
rounding and string-length compatibility deliberately. The signature half of
the registry landed with `RUST-005`, so what arrives here is what each function
computes.

**Evidence.** Every registered function has normal, type-error, and arity cases
where applicable. Lazy branches containing errors remain unevaluated when the
current evaluator skips them. Numeric comparison policies are attached to
individual fixtures, including negative rounding and remainder cases.

### `RUST-007`: Port geometry and sparse primitives

**Work.** Port analytic edges, shape geometry, table arithmetic, image slot
metadata, and script placeholders. Establish schemas for the primitives ready
at this stage. Text and math schema integration remains for later packages.

**Evidence.** Exact and approximate geometry checks cover straight, arc, and
cubic edges. Edge splitting preserves the curve. Sparse empty cells remain
absent from storage and correctly readable. Table insertion and deletion
helpers preserve or repair references as specified. Script outputs remain
placeholders, with no interpreter execution.

**Landed so far.** `primitives::edge` carries the maths of one path edge and of
a path of them: the circle under a bulge, the cubic under a pair of control
points, length, the area over a chord, the lune moment behind a centroid, the
extreme points behind a bounding box, the split that leaves two edges holding
the shape of the one they replace, and the nonzero winding rule behind a hit
test.

`primitives.edge` asks both engines 221 questions about nine edges and eight
paths, and they answer alike on every one, exactly. The circle of two vertices
and two bulges of one is the case that shows nothing samples a curve: its area
comes back as the double nearest to twenty five pi and its perimeter as the
double nearest to ten pi, where a sampled circle would fall short of both.

`D-012` arrived with this package, because a shape reaches more of the
transcendental functions than any earlier one. The arithmetic under the geometry
now goes through one wrapper for each function, so a native run and a browser
run agree, and `number.javascript-arithmetic` pins the seven that also agree
with the answers a document carries.

`primitives::geometry` carries the rest of the shape layer that stands with no
schema under it: where the corners of a polygon and a rect fall, what a list of points
measures, the seven slots of a vertex and the two enumerations over them, the
three storage changes a path can take, the four address rewrites that keep a
reference pointing at the vertex it meant, and the explode that snapshots a
preset into a polyline.

`primitives.geometry` asks both engines 155 questions and they answer alike on
every one. Two of the cases carry the reason the fixture states a shape's slots
as an ordered list rather than as a JSON object. A delete takes every vertex
slot out of the map and writes the survivors back, so they return renumbered
and in their new order, with the slots that are not vertices keeping their
places at the front. An engine that wrote them back where they were would part
from the other one there and nowhere else.

Two findings came out of the fixture. A vertex count is a number rather than a
whole one, and a count of two and a half reaches three vertices in the
TypeScript loop, so the port carries the count as `f64` and names a slot through
`to_javascript_text` rather than rounding first. And the area of an exploded
circle comes within a part in 10^15 of pi r squared rather than landing on it,
because a lune contributes r squared times the sweep less its sine and the sine
of a sweep of pi is 1.2e-16 rather than 0. The residue rounds away at a radius
of five and shifts the last digit at a radius of three.

`schema`, `table`, `image` and `script::stub` complete the rest of the package
that stands clear of text measurement. The schema is the piece the contract
above singles out: edge derivation and the two integrity checks all resolve a
slot group through one resolver, and a dynamic group's size comes from the
object rather than from the type. `primitives.schema` asks both engines what
each type declares, what each derived slot reads, and what each one computes,
over 89 cases covering nine types, and they answer alike on every one.

The three dynamic groups are the ones worth naming. A table declares a slot for
each cell inside the size it holds now. A script node declares one slot for each
port it carries, and each output names every input of the node, so adding an
input recomputes all of them. A doc object declares the variables an operator
has written rather than a fixed set. None of the three lets evaluation change
the slot set, because each reads what a mutation already wrote.

`primitives.table` carries 169 more cases over cell arithmetic, range expansion
and the two resizes. A dimension slot holding a formula, a number that is not
whole, a negative number or text all read as no lines at all, which is what
stops a table from declaring cells out of a size that evaluation has yet to
settle.

**Still to come in this package.** `primitives::doc` and the `docref` schema,
which read through the measurer, and the text and math schema entries that
`RUST-009` owns. The registry answers nothing for a type it has yet to declare,
so a caller can tell that apart from a type declaring no slots.

### `RUST-008`: Port the math language

**Work.** Port math lexing, parsing, binding, evaluation, integration, series,
and root search. Preserve line visibility, free-name discovery, source
references, seeds, and every existing bounded-loop parameter.

**Evidence.** Each AST and line variant has coverage. Analytic integrals and
sums supplement baseline comparisons. Solver fixtures cover seed-selected
roots, no sign change, invalid domains, discontinuities, and exhausted bounds.
The parser, binder, and evaluator agree on reachable names.

**Landed.** All four stages, and the seam the graph calls the language through.
The lexer answers to the editor that writes its LaTeX rather than to a person,
so a subscript belongs to the name in front of it and a name of more than one
letter arrives wrapped. The parser runs two passes, because whether a name in
front of a bracket calls a function or multiplies by one rests on a definition
that may sit further down. The binder sorts every bare name into bound,
defined, free or called, which is what decides the slot set. The evaluator
reads inputs, references and seeds, integrates by a fixed rule, and solves an
implicit line by looking outward from its seed for a sign change.

Four fixtures carry it: `math.lex`, `math.parse`, `math.names` and
`math.evaluate`. The quadrature agrees to the last digit across the two
engines, because both run the same count of Simpson intervals over binary64 in
the same order.

`round`, `sign`, `min` and `max` answer the way JavaScript answers rather than
the way Rust does. Those four moved into `number.rs` with the number text, so
both languages read one copy of each and neither can drift from the other.

### `RUST-009`: Integrate text and math primitives

**Work.** Port text block parsing and dependencies, resolved text, text
measurement, math source application, and dynamic ports and seeds. Connect the
selected host measurement contract.

**Evidence.** Nested text conditions subscribe to both branches. An invalid
math source leaves previous ports intact. Renames preserve stored references
and update display spelling. Text, standalone notation, and embedded notation
pass deterministic measurement fixtures and the browser proof.

### `RUST-010`: Complete graph evaluation

**Work.** Finish schema resolution, edge derivation, integrity checks, cycle
reporting, and topological evaluation. Explicit traversal storage is used where
necessary to handle long chains safely, preserving observable order.

**Evidence.** Every object type resolves its slot set consistently. A mixed
table, geometry, text, and math graph reevaluates in one pass. Integrity errors
precede cycle errors. Evaluation preserves the slot set. Long-chain tests
exercise traversal and teardown on both targets.

### `RUST-011`: Port mutations

**Work.** Port operations in reviewable families: basic create/set/clear/rename,
deletion and forced repairs, table structure, ports and math source, then
vertex changes, explode, and split. Each family includes its preflight and
post-apply validation. Integration uses the graph pass from `RUST-010`.

**Evidence.** Every operation passes sequence fixtures, including multi-operation
batches. A late refusal leaves the original snapshot and journal unchanged.
Forced repairs return the expected addresses. Successful batches append exactly
one entry, and host measurements cannot expose a partially applied graph.

**Boundary.** Subpackages can finish independently, but the parent remains
incomplete until the operation inventory has no missing family.

### `RUST-012`: Port files and replay

**Work.** Implement version 1 decoding, reconstruction through mutation,
serialization, loaded journal preservation, indexed replay refusals, and
completeness checks. Resolve `D-006` and `D-007` at the compatibility boundary.

**Evidence.** TypeScript-save/Rust-load and Rust-save/TypeScript-load both pass.
Edited documents survive the reverse trip. Tests include old optional fields,
formula caches, derived payloads in journals, malformed entries, a partial
journal, and explicit measurement contexts. Counter and raw JSON decisions
have accepted fixtures in both engines.

### `RUST-013`: Complete the consumer facade

**Work.** Implement completion, source classification, metadata queries, and
the public adapter inventory. Rendering-specific helpers remain in TypeScript
with explicit ownership and a single source for each engine rule.
Shared constants and generated descriptors have consistency checks.

**Evidence.** Every production import from the old boundary has a replacement
or documented host disposition. Candidate order and source spans match.
Type checks cover the facade, and runtime fixtures cover its conversions.
No schema callback or Rust implementation object leaks into serialized state.

### `RUST-014`: Run the application against Rust

**Work.** This package adds an internal engine selection mechanism with
TypeScript as the initial default. Route command execution, gestures, file operations, properties,
completion, and font refresh through the selected adapter.

**Evidence.** Application tests run against both engines. Browser scenarios
create, link, edit, rename, resize, force-delete, save, reload, and edit again.
Math editing and font arrival have visual evidence. Startup and asset failures
retain a usable error path. Native or worker selection also passes the async
protocol tests. The production base path loads all required assets.

### `RUST-015`: Establish workload limits

**Work.** This package runs malformed-input, stack-depth, memory, journal-size,
and composed math cases. Record startup, transfer, evaluation, measurement, and rendering
cost separately for representative documents and long gestures.

**Evidence.** Native and browser runs complete without unexplained crashes or
unbounded memory growth. The report names hardware, build mode, target,
document sizes, and input sequences. Any budget or cap has an approved behavior
and a comparison fixture. Proposed optimizations respond to measured costs.

**Boundary.** This package does not promise that Rust will reduce the JavaScript
bundle substantially. MathLive and renderer code remain browser dependencies.

### `RUST-016`: Cut over with a tested return path

**Work.** Complete the release checklist below, choose the acceptance period,
and make Rust the default only after the required evidence exists. Record the
build artifact and commit that restore the TypeScript path.

**Evidence.** A rollback rehearsal opens a document edited and saved with Rust
in the retained TypeScript engine, preserves graph meaning and journal policy,
and continues editing. The release has no unresolved compatibility blocker,
and engine selection has a defined startup-failure behavior.

`D-012` arrives here for its remaining part. Nine transcendental functions
answer one unit in the last place apart in the two engines, so a document saved
by one of them can hold a number the other would not have written. The
rehearsal above is where that shows, and the acceptance criteria say whether
the difference blocks the default switch or travels with it.

### `RUST-017`: Retire the duplicate implementation

**Work.** This package removes TypeScript engine algorithms only after the
acceptance period and the rollback decision. Retain shared fixtures, historical document files,
and any deliberately host-owned helpers. Architecture enforcement and
the source map are updated to describe the resulting code.

**Evidence.** Production imports have no accidental fallback to duplicate
TypeScript algorithms. Rust is tested independently of an executable legacy
engine, while frozen expected results preserve the old contracts. Existing
behavioral tests remain represented or are replaced by stronger integration
tests, with a recorded mapping rather than deleted coverage.

## Release gates and rollback

### Gate A: implementation can start

The spec names the released Rust scope. `RUST-001` has a baseline and consumer
inventory. Product changes in flight have an explicit inclusion decision.
This document alone never passed this gate, and the spec change that released
the scope is what did.

**Passed.** Section 2 of the spec names the released scope and its four limits,
and section 17 keeps the rest of the future stack deferred. `RUST-001` records
the baseline commit `0ca62a7cd72384a47464bdd4f402a1d0c52aa4b3` and the consumer
inventory. `TODO.md` held nothing open at that commit, so no product change was
in flight to decide about.

### Gate B: architecture can support the application

`RUST-002` and `RUST-003` prove repeatable comparison, hosting, state ownership,
and measurement. The selected route has a failure model and target build.
Large-scale module translation begins after this gate, so the most uncertain
integration premise is tested while changing it is still inexpensive.

**Passed.** The comparison runs from one command and reports a match, a
difference and a call the Rust engine cannot answer. The browser route
completes a real scenario against real font metrics, with a defined result for
a host that throws, a host that answers with nothing usable, a host that cannot
size notation, and a callback that reenters. `D-001`, `D-002` and `D-003` are
resolved under the decision register, and the target build commands are in the
checks above.

### Gate C: engine behavior is equivalent

The work through `RUST-013` covers the full inventory. Bidirectional document
fixtures, operation sequences, error behavior, and target-specific numeric
checks pass. Each accepted difference has a decision entry and a fixture.
Unimplemented cases are not hidden behind successful no-op responses.

### Gate D: the application can switch

`RUST-014` and `RUST-015` pass the browser, production-asset, robustness, and
workload checks. The acceptance record includes representative screenshots,
console results, save/load files, baseline commits, and exact commands.

### Gate E: rollback is credible

Rust-produced documents still load in the retained TypeScript version under
the approved file contract. An engine rollback does not require undoing user
edits. If a format change made that impossible, cutover waits for a migration
and recovery design rather than claiming the old engine is a fallback.

TypeScript and Rust remain independently selectable during acceptance. Shadow
comparison, if used, runs on copies of the same committed inputs and never
commits the shadow result. Measurements are shared or recorded consistently.
Only the selected engine can publish committed document state.

The final acceptance record identifies the default engine, supported targets,
remaining host-only TypeScript modules, resolved decisions, known limitations,
rollback artifact, and the condition for removing the old implementation.

## Risks and decision register

### Known baseline issues affecting the port

The TypeScript counter defect is fixed after the planning baseline. Loading
requires a non-negative safe integer above generated `obj_` IDs in current
objects and journal creation or deletion entries, including deleted objects.
Only `obj_` followed by a decimal integer without leading zeros reserves a
counter value. The maximum safe integer is
an exhausted counter that still round-trips, with creation returning a refusal.
This terminal state preserves the last document without minting an unsafe ID.
The Rust fixtures include these cases from
[document.test.ts](../src/engine/document.test.ts) and the creation refusals in
[commands.test.ts](../src/command/commands.test.ts).

Loaded journals are structurally permissive by design in current tests. That
behavior is different from the counter defect. It needs a deliberate raw-data
strategy or a separately approved restriction, not an unannounced stricter
Serde model.

TypeScript graph sorting, cycle detection and raw journal number validation
now use explicit stacks. Regression tests cover 20,000-slot chains, a late
cycle and 20,000 nested journal arrays. Formula load and evaluation tests cover
binary, unary and function-call trees at the existing 1,000-level limit.

Math series reject unsafe integer endpoints. Each exported line now shares a
1,000,000-expression budget across function calls, integral samples, nested
series and solver samples. Exhaustion produces a `#MATH` value and leaves
independent lines evaluable. The simple 100,000-term series still succeeds.
These changes have regression coverage in
[math/eval.test.ts](../src/engine/math/eval.test.ts).

Native and Wasm stack sizes, file serialization depth, total document size and
whole-document workloads still need target-specific stress evidence under
`RUST-015`. The per-line budget is a deterministic work bound, not a promise
about elapsed time for every document. Rust alone does not remove these limits.

Browser measurement is a semantic dependency. Replacing it can change the
graph even when numeric evaluation is identical. Measurement errors and font
epochs therefore belong in conformance and application tests.

`main.ts` and the mutation channel concentrate many responsibilities. The
port can extract tested seams as needed, but a broad cleanup before collecting
fixtures would change the reference implementation while it is being measured.

### Decisions

The entries below distinguish recommendations from decisions that have been
accepted. Counter behavior and the TypeScript per-line work budget are resolved
below, while the other choices remain open. A resolved entry records the
choice, reason, evidence link, and affected packages in this table or directly
under it. Superseded choices remain linked through Git history.

| ID | Question | Recommendation or required evidence | Needed by |
| --- | --- | --- | --- |
| `D-001` | First application runtime | Resolved: browser Wasm. See below. | `RUST-003` |
| `D-002` | Measurement contract | Resolved: synchronous host callbacks. See below. | `RUST-003` |
| `D-003` | Authoritative state | Resolved for the first integration: the host owns the document. See below. | `RUST-003` |
| `D-004` | Numeric compatibility | Binary64, JavaScript rounding, fixture-specific tolerances | `RUST-004` |
| `D-005` | String representation | Preserve UTF-16 semantics. Part covered by fixtures, and the lone surrogate case is open. See below. | `RUST-004` |
| `D-006` | Loaded journal representation | Retain raw entries, validate each on replay | `RUST-012` |
| `D-007` | Counter and malformed-file policy | Counter behavior resolved in TypeScript as described above. Raw journal policy remains a separate compatibility decision. | `RUST-012` |
| `D-008` | Diagnostic equality | Resolved for the two adapters, and open for platform details. See below. | `RUST-002` |
| `D-009` | Product baseline drift | Pin each package and synchronize accepted behavior changes | `RUST-001` |
| `D-010` | Resource budgets | Preserve the TypeScript per-line expression budget. Measure total document workloads on each target before setting broader limits. | `RUST-015` |
| `D-011` | Cutover acceptance period | Define supported targets and rollback criteria before default switch | `RUST-016` |
| `D-012` | Transcendental function agreement | Part resolved: one wrapper for each call, reaching `libm` on every target. The nine that still differ carry into `RUST-016`. See below. | `RUST-007`, `RUST-016` |

`D-001` is resolved as browser Wasm, which is what the recommendation said and
now has evidence behind it. The deciding quantity is the count of host round
trips one evaluation needs, which is a property of the graph rather than of the
machine. A binding in the page makes one call for each measurement and never
leaves the pass, so it crosses no process boundary at all. A binding that
measures in rounds runs the whole pass again for each step of the longest
measured chain, and each of those rounds is a crossing.

The proof graph is three measurements deep, so the exchange settles in four
passes and three crossings against one pass and none. Two costs follow from
that and both were measured. The engine work of an evaluation is eight times
larger in the exchange, because the pass runs four times rather than once, and
that is before any boundary is crossed. The cost of crossing is not measured
here, because neither prototype has a real boundary to cross and a made up
latency would decide the question by assumption.

The second finding is the one that would have been expensive to learn later. A
pass over a graph with no cycle in it always settles, so the unbounded sequence
of requests this document worried about does not arise from an ordinary
document. What does arise is metrics that move faster than the exchange
settles: a font that finishes loading between a request and its answer moves
the epoch, the answer is refused because its key belongs to the epoch before,
and a host whose fonts keep arriving holds the exchange short of its last
measurement for as long as that goes on. A binding that measures inside the
pass cannot meet that case, because every measurement of one pass is taken
under one epoch. Fonts arrive during the first seconds of every document rather than
rarely, so the exchange would meet that case on an ordinary open.

`D-002` is resolved as synchronous host callbacks, held to four rules that the
browser proof exercises. A callback that throws becomes a measurement error
carrying the wording the host threw, and never an exception across the binding.
An answer that is not a pair of numbers is refused where it arrives rather than
downstream. A measurer states its capability, so a host that cannot size
notation says so rather than answering, and a fake that answers every question
with zero is still not the null measurer. A callback that starts another pass
against the candidate being measured is refused by a guard, and the outer pass
finishes with the values it would have had.

A domain refusal crosses the binding as data. Returning a Rust `Result` through
wasm-bindgen throws on the error side, which would turn every refused
measurement into a fault the host has to catch and leave a genuine fault of the
binding looking the same as a table cell holding a division error. The result
carries the discriminant shape the TypeScript engine already returns, and an
exception is reserved for a fault of the binding itself, such as a host that
handed over no measurer.

`D-003` is resolved for the first integration alone: the TypeScript application
owns the committed document, and the binding holds a candidate for the length
of one call. The proof needed nothing more, so nothing more was decided. A
handle based design that moves authoritative state into Rust stays open, and
`RUST-014` is where the cost of copying a snapshot is measured against it.

`D-004` is resolved as binary64 throughout the runtime model. Illegal-number
checks reject non-finite values and negative zero at graph boundaries, while
the wire fixture codec can still carry those values so the checks themselves
remain testable. Operator-facing conversion follows ECMAScript number text.
A comparison declares an allowed tolerance in its fixture, so exact comparison
remains the default.

`D-005` is resolved. Fixtures send a character outside the basic plane and a
letter carrying a combining mark through slot keys, object names and text
values, and the two engines agree on every one. The name pattern is the ASCII
alphabet, so neither engine accepts a name outside it.

The lone surrogate, which a JavaScript string holds and a Rust `String` cannot,
is refused where it crosses into Rust rather than replaced or normalized, and
the document decoder in `RUST-012` applies that same rule to escaped JSON input.
The operator took that choice over a representation that carries such a string
losslessly, which every later package would then hold. The cost is that a file
holding a lone surrogate stops opening, where today it opens. A lone surrogate
is half of a character that no editor produces on purpose, so the documents it
refuses are ones already holding a fault.

`D-012` is part resolved, and the rest of it carries into `RUST-016`.

A sine is not one function. V8 carries its own implementation, a native Rust
build reaches the system library, and a `wasm32-unknown-unknown` build reaches
a third one compiled in, and the three disagree about the last digit. The
engine an operator loads is the third of those, and every conformance run so
far has measured the second, so a green run said nothing about the browser.

The part that is resolved: every transcendental call in the engine now goes
through a named wrapper in `number.rs`, and each wrapper reaches `libm` rather
than the method its target supplies. A native run and a browser run now give
the same answer, so a conformance result means what it appeared to mean.
`js_hypot` carries out the ECMAScript algorithm here instead, because that
algorithm is plain arithmetic whose every step the binary64 rules fix, and the
library routine behind `f64::hypot` follows a different one and parts from V8
for about
a third of pairs.

The measurement, over 220,005 arguments in two populations: one of the numbers
a document actually carries, being integers, halves, quarters, tenths and
hundredths from -2000 to 2000, and one a wide pseudo-random sweep.

| Function | Differences | Rate |
| --- | --- | --- |
| `tan`, `atan`, `asin`, `acos`, `atan2` | none | 0 |
| `sqrt` | none, and binary64 fixes it | 0 |
| `hypot`, carried out here | none | 0 |
| `exp` | 5 | 1 in 44,000, and `exp(1)` is one of them |
| `cosh` | 2,123 | 1 in 104 |
| `tanh` | 19,208 | 1 in 11 |
| `ln` | 603 | 1 in 182 |
| `sin` | 1,331 | 1 in 165 |
| `cos` | 1,739 | 1 in 126 |
| `sinh` | 1,527 | 1 in 144 |
| `log10` | 9,021 | 1 in 12 |
| `pow` | 16,070 | 1 in 23 |

Every difference is one unit in the last place. The smallest reproduction, which
both engines answer through the shipped path: a math object holding
`y=\cos(0.1)` exports `0.9950041652780257` from TypeScript and
`0.9950041652780258` from Rust.

The operator chose to leave the nine as they are and to carry the difference
into `RUST-016`, where the acceptance criteria for the default switch are set.
So bit identity across the two engines is a condition of cutover rather than of
this package, and the paragraphs below are what that decision costs and what
paying it later would take. Closing the nine means porting V8's
own implementations, which are its `src/base/ieee754.cc`, into Rust and calling
those instead. That is a known body of public-domain code of a few thousand
lines, mechanical to port and testable against a fixture of V8 answers, and it
would make every number in a document identical across the two engines. Leaving them as they are, which is the choice on record, means a
shape, a math export or a `ROUND` result can differ in its last digit between
the two engines, which an operator sees in the properties panel and in a saved
file, and which stands between the port and a proof that a document survives a
change of engine unchanged.

`tanh`, `log10` and `pow` carry the three highest rates, and one argument in
eleven reaches a difference in the first of them. The measurement above is the
ground for choosing, in place of the estimate that stood here before it ran.

Until it is decided, `number.javascript-arithmetic` pins the seven functions
that agree, so a change that broke one of them fails a conformance run. The
nine are deliberately absent from it, because a case for one of them would
report a difference rather than a match.

`D-008` is resolved for the part the two adapters own. A refusal of the
arguments of a case is worded identically by both runners, and the comparator
compares that wording exactly, so a difference in it is a difference between
the adapters rather than between the engines. A wire error never quotes the
JSON it refused, because the two engines print a number differently and a
fixture that compared the wording would then be comparing their JSON writers.
Engine diagnostics keep the same exact rule. What is still open is the
normalization of a platform generated message, such as the text a JSON parser
produces, which arrives with `RUST-012`.

A decision about a public behavior is reflected in the spec when it changes
the requirement. A decision about a Rust module stays here until it is
implemented, then its lasting rationale belongs beside that code.

## Current handoff

| Field | Current value |
| --- | --- |
| Migration phase | Implementation, through Gate B |
| Active implementation package | `RUST-007`, ready and unstarted |
| TypeScript baseline commit | `0ca62a7cd72384a47464bdd4f402a1d0c52aa4b3` |
| Rust artifacts | `beheader-engine`, `beheader-conformance`, `beheader-hostproof`, `beheader-wasm` |
| Selected runtime | Browser Wasm, with synchronous host callbacks, resolved under `D-001` and `D-002` |
| Unresolved architecture decisions | `D-006`, `D-007`, `D-009`, `D-011`. `D-008` and `D-012` are part resolved, and `D-010` holds a recorded choice |
| Next implementation action | Port the primitives and the schema under `RUST-007` |
| Completion evidence | `RUST-001` through `RUST-006` and `RUST-008`, under their headings above |

### Handoff record for the active package

```text
Package: RUST-007, geometry, tables, basic schemas and the script stub
Status: in progress, with primitives::edge landed
Owner or current branch: claude/todo-quick-clears-994uv2
TypeScript baseline commit: 0ca62a7cd72384a47464bdd4f402a1d0c52aa4b3
Implementation commit: the commit that carries this document
Completed dependencies:
  RUST-004 supplies values, slots, objects, ports, vertex counts, addresses,
  edge data, measurement capabilities and the initial wire codec.
  RUST-005 and RUST-006 supply the whole formula language, from source text to
  a value, with the 23 function bodies.
  RUST-008 supplies the whole math language and the one seam the graph calls it
  through, which RUST-009 wires to the math primitive.
Remaining cases:
  primitives::doc and the docref schema, which read through the measurer, and
  the text and math entries of the registry, which RUST-009 owns. The schema is
  shared with RUST-010, which completes it. primitives::edge,
  primitives::geometry, primitives::table, primitives::image,
  primitives::schema and script::stub are landed, under the fixtures
  primitives.edge, primitives.geometry, primitives.table and
  primitives.schema.
Open decision IDs: D-012, whose remaining part the operator moved to RUST-016
Fixture and evidence paths:
  tests/conformance/fixtures, tests/conformance/manifest.json
  model.port-names, address.nearest-name, address.resolution and
  graph.address-key carry the RUST-004 surface
  formula.lex, formula.ast-shape, formula.parse, formula.format and
  formula.dependencies carry RUST-005, formula.evaluate carries RUST-006, and
  math.lex, math.parse, math.names and math.evaluate carry RUST-008
  number.javascript-arithmetic pins the seven functions D-012 found agreeing,
  and primitives.edge, primitives.geometry, primitives.table and
  primitives.schema carry RUST-007 so far
  tests/conformance/contract/inventory.json and dispositions.json
  tests/hosting, driven by tools/hosting-proof.mjs
Commands run and results, all on the pinned 1.94.1 toolchain:
  npm test                      2745 Vitest tests and 23 tooling tests pass
  npm run typecheck             both configs pass
  npm run build                 succeeds
  npm run prose                 exit code 0
  cargo fmt --all -- --check    clean
  cargo clippy --workspace --all-targets --locked -- -D warnings   clean
  cargo test --workspace --locked                                  199 pass
  cargo check -p beheader-engine --target wasm32-unknown-unknown   succeeds
  npm run conformance           1339 matched, 0 differed, 0 awaiting Rust
  npm run hosting-proof         17 checks pass in Chromium
Native and browser targets exercised:
  x86_64-unknown-linux-gnu for tests, wasm32-unknown-unknown built and run in
  Chromium. Windows runs the Rust checks in the pull request workflow and has
  not run the browser proof.
Known failures with smallest reproduction:
  Nine transcendental functions answer one unit in the last place apart in the
  two engines, under D-012, which the operator moved to RUST-016. A math object
  holding y=\cos(0.1) exports 0.9950041652780257 from TypeScript and
  0.9950041652780258 from Rust.

  A literal below 1e-6 prints with an exponent that the lexer cannot read back.
  parse_formula("0.0000001 + 1") prints as "1e-7 + 1", which refuses to parse.
  Both engines answer alike, the fault predates the port, and the RUST-005
  heading above says what closing it would take.
Next concrete action: port primitives/doc.ts with the docref derived slots,
  which needs the measurer seam of measure.rs wired into SlotComputeInputs,
  then hand the text and math registry entries to RUST-009.
Dependencies that can proceed independently: none. RUST-009 needs this package
  and RUST-008, and RUST-010 needs the schema this one begins.
```

A resumed session compares the recorded commits with the current branch,
reads the package's dependencies and acceptance criteria, and verifies the
smallest relevant fixture before extending the implementation. A finished
session updates the register, handoff, and evidence together. Product work
continues to update `TODO.md`, while migration status stays in this document.

## External references

These primary references were consulted on 2026-09-14. Their role is to verify
language and binding constraints. The migration choices above are project
recommendations, not requirements imposed by those projects. Toolchain and
binding details are checked again when the corresponding package begins.

- [Rust floating-point behavior](https://doc.rust-lang.org/std/primitive.f64.html)
  informs numeric representation and comparisons.
- [ECMAScript rounding](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.round)
  defines the baseline rounding behavior.
- [Rust strings](https://doc.rust-lang.org/std/string/struct.String.html)
  explain the UTF-8 representation used by ordinary Rust strings.
- [Rust map iteration](https://doc.rust-lang.org/std/collections/struct.HashMap.html#method.iter)
  explains why traversal order needs explicit ownership.
- [Serde enum representations](https://serde.rs/enum-representations.html)
  describe available encodings for Rust enums.
- [Serde JSON deserialization](https://docs.rs/serde_json/latest/serde_json/de/struct.Deserializer.html)
  documents depth and string conversion boundaries.
- [Rust Wasm target support](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)
  describes the host restrictions of the proposed browser target.
- [wasm-bindgen result conversion](https://wasm-bindgen.github.io/wasm-bindgen/reference/types/result.html)
  documents the exception behavior the adapter maps to domain results.
- [Tauri Rust calls](https://v2.tauri.app/develop/calling-rust/)
  describe the native command boundary considered by the hosting proof.
