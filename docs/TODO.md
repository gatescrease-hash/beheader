# TODO - Graphpaper

The open work, and nothing else. `STATUS.md` describes the code that exists,
and this file names the changes nobody has made yet.

Take an item, build it with its tests, run the four checks in `CLAUDE.md`, and
delete the item when it lands. Do not rewrite it into a record of the work.
Git holds what was done, and this file holds what is left.

A new item names the change, gives the reason, and says how a reader will know
it is finished. Anything else is a note, and a note belongs in the header of
the file it is about.

---

## Open

### 1. Decide the shape of the engine export surface

`src/engine/index.ts` re-exports every file in the engine with a star, so all
311 names cross the boundary while the layers outside use 114 of them. Replace
the stars with a hand written list of the names that are used, or write down
why the whole surface stays open. Either answer settles it.

The two tests in `index.test.ts` hold the boundary itself, and neither reads a
list that a person maintains, so a hand written list needs a third test that
fails when an export goes unused. Without one, the list rots the first time a
consumer drops an import.

Done when `index.ts` carries the decision in its header, and a test enforces
whichever shape wins.

### 2. Settle the name of the product

The spec calls the product Graphpaper. `package.json` carries `graphpaper`, and
the folder carries `beheader-clean`. Nothing in the code reads the folder name,
so the mismatch costs nothing today, and it costs a paragraph of explanation to
every person who clones the repository.

Done when one name reaches the folder, the package and the documents.

### 3. Build the math object

Section 12 of `SPEC.md` defines a math object. An operator can type one, see it
drawn, edit it in place, wire it to the document, read an address of the
document out of its notation, and choose whether it shows its formula, its
result or both. The two in-text forms and solving are open.

Each stage below lands with its tests, and each leaves the four checks clean.

1. **The block and inline forms inside a text object.** This is the largest of
   the three, because a text object is a string from end to end: `resolvedContent`
   is a string, `markdown.ts` parses a string, and `layOutText` breaks it into
   runs of text with a font each. Notation is none of those. Carrying it needs a
   piece kind that is not text threaded through that pipeline, and `STATUS.md`
   records that `measure.ts` and `renderer.ts` move together, so the change
   lands in both. Start by deciding what `resolvedContent` becomes when it can
   no longer be a string.
   Done when one text box holds a formula on its own line and another inside a
   sentence, the text around each lays out against the size of the notation
   rather than around a gap, and a free bare name inside a math run is refused
   at parse time.

2. **Solving.** The seed slots, the iteration bound, and the error value for a
   solve that finds no root. Nothing of this is built, and the `seed` family of
   section 12 has no slot yet. Done when an implicit line returns the root
   nearest its seed, a change to the seed moves the answer from one root to
   another, and a solve that runs out of iterations gives an error value rather
   than a hung frame.

**Done when** that stage has landed and this item is deleted.

### 4. Decide what a fresh input port holds

A free name the source has not been given a value for starts at zero, so a
math object whose first line is a fraction shows a division by zero the moment
it is typed. Zero is the honest answer for a number nobody has entered, and it
is also the one value that makes a denominator fail.

Done when a new port either starts at a value that reads as unset rather than
as zero, or the reason zero is right is written into section 12.

### 5. Show a math source by the names it reads, in the panel

A math object stores each address it reads as an object ID, so a rename
rewrites nothing. The drawn form and the editable field both map that ID back to
the name the object carries, and the `source` row of the properties panel does
not, so it shows `\gpref{obj_1.cells.A1}` where everything else shows
`\gpref{grid.A1}`.

That row is also offered as a text field an operator can type into, and a write
there is refused, because only the mutation that rebuilds the ports may write a
source. A row that cannot be written should not look like one.

Done when the panel shows a math source by the names it reads, and the row
opens the editor rather than a text field.

### 6. Say what the program understood, on a refusal

A refusal names the slot it is about, which the spec asks for, and it does not
say what was typed instead. An operator who misspells an object name is told
that no object carries that name, and the name they meant is one edit away and
on screen already.

This rides on the completion of item 5, which computes the candidates a name
could have meant. Done when a refusal that names a missing object or slot also
names the nearest one that exists.

---

## Where the next items come from

Section 16 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
