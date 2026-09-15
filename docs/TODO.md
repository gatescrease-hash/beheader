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

### 3. Decide what a fresh input port holds

A free name the source has not been given a value for starts at zero, so a
math object whose first line is a fraction shows a division by zero the moment
it is typed. Zero is the honest answer for a number nobody has entered, and it
is also the one value that makes a denominator fail.

Done when a new port either starts at a value that reads as unset rather than
as zero, or the reason zero is right is written into section 12.

### 4. Show a math source by the names it reads, in the panel

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

### 5. Say what the program understood, on a refusal

A refusal names the slot it is about, which the spec asks for, and it does not
say what was typed instead. An operator who misspells an object name is told
that no object carries that name, and the name they meant is one edit away and
on screen already.

`engine/complete.ts` already computes the candidates a name could have meant,
and a refusal is the other place those candidates belong. Done when a refusal
that names a missing object or slot also names the nearest one that exists.

### 6. Add the document variable

Section 13 of `SPEC.md` describes a named value that belongs to the document
rather than to an object, readable from any formula by its bare name. Nothing
of it is built. A document that wants one value today uses a table of one row
and one column, and every formula that reads it says `table_1.cells.A1`.

The doc object is a singleton with no origin, created by the first `docvar`
that names a variable, and each variable is one slot at the top of it. The
`value` primitive already sits in the graph with no place on the canvas, so the
schema and the renderer need nothing new for that part.

The bare name is the work. `parseAddress` refuses a single segment today, and
the one place a name with no dot in it resolves is the branch of
`formula/parser.ts` that reads `A1` as a cell of the enclosing table. The order
in that branch is what section 13 specifies: a cell of this table first, a
document variable second, a refusal third. The three names a variable may not
take each need their own refusal and their own test, because each one is a
collision that would otherwise be silent: a reserved word of the formula
language, a name of the `A1` form, and a name an object already carries.

Completion is the other half of the bare name. `engine/complete.ts` offers
slots by address, and a variable has to arrive there as a bare candidate, so a
tab completed `speed` gets the code font and the grey box that says the field
read it as an address rather than as a word.

Done when `docvar speed 12` creates a variable, `speed` reads it from a cell, a
text formula and a port, `docvar total =doc.a+doc.b` holds a formula and
re-evaluates when `doc.a` moves, a circle between two variables is refused by
the cycle check, deleting a variable something reads is refused with the reader
named, and `vars` opens the properties panel on the doc object.

### 7. Put a copy of a document variable on the canvas

This rides on item 6. A variable with no copy is reachable only through the
panel, and section 13 gives it a second object type: a copy that draws the
name, an equals sign and the value in a monospaced font, and that carries its
position and its target and nothing else.

The copy is derived from end to end, so the graph does the sharing: two copies
of one variable are two objects reading one slot, and neither holds a value of
its own. Deleting one deletes a drawing. The measurement follows the text
primitive of section 9, and the in place editor follows the table cell of
section 7, except that what it commits is a write to the variable rather than
to the object the editor sits on.

Done when `docvar speed x=200 y=140` puts a copy down, two copies of one
variable both move when the variable is set from anywhere, deleting a copy
leaves the variable and the other copies alone, editing a copy in place writes
the variable, and deleting the variable takes its copies with it.

---

## Where the next items come from

Section 17 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
