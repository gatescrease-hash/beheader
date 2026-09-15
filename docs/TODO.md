# TODO - Beheader

The open work, and nothing else. `STATUS.md` describes the code that exists,
and this file names the changes nobody has made yet.

Take an item, build it with its tests, run the four checks in `CLAUDE.md`, and
delete the item when it lands. Do not rewrite it into a record of the work.
Git holds what was done, and this file holds what is left.

[RUST_PORT.md](RUST_PORT.md) holds the future Rust engine migration plan and
its stable work register. Port packages are tracked there. They become active
when the spec releases that implementation scope from deferral.

A new item names the change, gives the reason, and says how a reader will know
it is finished. Anything else is a note, and a note belongs in the header of
the file it is about.

---

## Open

### 1. Finish the rename to Beheader

The package, the page title, the documents and the in-app strings all carry
Beheader, and `vite.config.ts` builds against `/beheader/`. Two things outside
this repository still carry the old name: the GitHub repository is
`beheader-clean`, and the working folder is named after it.

The base path and the repository name have to agree, because GitHub Pages serves
a project site under the repository name. So the repository is renamed to
`beheader` before the next merge to `main`, which is what deploys the site.

Done when the repository and the folder carry `beheader`, and a deploy from
`main` serves the page with its assets.

---

## Where the next items come from

Section 17 of `SPEC.md` lists what the team postponed on purpose. That list is
the boundary of the work, and an item moves here only when the spec releases
it. Python execution behind `evaluateScriptOutput` is the largest of them, and
section 11 of the spec holds the seam it arrives through.

An item that the spec does not cover needs the spec first. Write the
requirement there, then open the item here.
