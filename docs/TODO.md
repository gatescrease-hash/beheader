# TODO - Beheader

The open work, and nothing else. `STATUS.md` describes the code that exists,
and this file names the changes nobody has made yet.

Take an item, build it with its tests, run the four checks in `CLAUDE.md`, and
delete the item when it lands. Do not rewrite it into a record of the work.
Git holds what was done, and this file holds what is left.

[RUST_PORT.md](RUST_PORT.md) holds the Rust engine migration plan, its stable
work register, and the measurements behind leaving that migration unscheduled.
Port packages are tracked there. They become active only if the spec reopens
that choice.

A new item names the change, gives the reason, and says how a reader will know
it is finished. Anything else is a note, and a note belongs in the header of
the file it is about.

---

## Open

- Implement direct text and table editing, adaptive grid, persistent quick
  properties, and addressable layers as specified in Direct editing and layers.
  Verify inheritance, overrides, visibility, ordering, save/load, resizing and
  formatting in tests and in the browser.

The four items below carry out Rule 5 of `SPEC.md`, which the engine does not
meet. The first stands alone. The second gates the two after it, because an
evaluation pass over part of a graph can leave a stale value where a pass over
all of it cannot, and a test that compares the two is what finds that.

- Resolve an address through a lookup keyed by object ID in `deriveEdges` and
  `validateIntegrity` of `src/engine/mutation.ts`. Each formula reference now
  scans the object array, which makes both phases grow with the square of the
  object count. A reader will know it is finished when both phases grow in
  proportion to the object count over a generated document, measured across at
  least three sizes, with every existing test still passing.
- Build the generator and the comparator for a differential test. It generates
  documents and mutation batches, applies each batch through two evaluation
  strategies it is given, and compares the resulting objects, journal, broken
  slots and refusal. The comparison rules in `RUST_PORT.md` describe the shapes
  to compare and where a tolerance is allowed. Both strategies are the full
  recomputation until the item below supplies a second one. A reader will know
  it is finished when a strategy carrying a deliberate staleness fault turns it
  red, and it runs in `npm test`.
- Evaluate the part of the graph that a mutation dirties, rather than every
  slot. Rule 6 supplies the affected set, because the slot set is fixed before
  evaluation begins. A reader will know it is finished when the differential
  test passes and the cost of one mutation over a generated document stops
  growing with the count of slots the mutation does not reach.
- Replace the deep clone of a transaction with sharing of the objects a batch
  does not touch. Rule 2 asks that a batch commit in full or leave the state
  untouched, which the clone currently makes true by construction, so this item
  carries tests for a refused batch leaving every object identical. A reader
  will know it is finished when those tests pass, the differential test passes,
  and the cost of a refused batch stops growing with the size of the document.

---

## Where the next items come from

Section 17 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
