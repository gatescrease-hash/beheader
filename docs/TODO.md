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

The item below is the rest of the baseline that section 22 of `SPEC.md` opens.
Unsaved work, the clipboard and `import csv` are built.

- Export a picture of the document or the selection, as specified in Moving data
  in and out. A reader will know it is finished when an exported raster of a
  document holding notation carries that notation, which a test asserts against
  the same document without it, and when the vector form and the canvas form
  share their geometry, text layout and measurement.

---

## Where the next items come from

Section 17 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python packages beyond the standard library, and port discovery from the
reads a script makes, are the next of them that section 11 points at.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
