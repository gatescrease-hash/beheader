# CLAUDE.md

Read `docs/STATUS.md` first. It holds the state of the code and the structure
map of the repository. `docs/TODO.md` holds the open work, and it is where a
change starts. Read `docs/SPEC.md` when you need to know what the product must
do.

`docs/STYLE.md` holds the rules for prose, and one worked example of a file
header written badly and then written well. Read it before you write a comment.

`docs/RUST_PORT.md` owns the engine migration plan, work packages, and current
handoff. Read it for Rust port work. Its stable task register supports work
across sessions. The spec has released that scope, so the register is active
and a port package comes from it rather than from `docs/TODO.md`.

Those five files are the project documents. Add another only for a distinct
purpose. Do not write a log entry for each change. Git holds the history.

## What this is

Beheader is a spatial canvas. Every object on it is a live node in one shared
dependency graph. A table cell can drive a polygon. A polygon can drive a table
cell. Text can read both.

## Hard rules

These six rules make the design work. Do not break one for convenience.

1. `src/engine/` is pure logic. It must not touch the DOM, `window`,
   `document`, a canvas or `src/render/`. Text measurement comes in through the
   injected `TextMeasurer` interface.
2. All state change goes through `mutate` in `src/engine/mutation.ts`. No other
   code writes document state.
3. Graph state is plain data. Use IDs, not object references. Do not put a
   closure, a class instance or a live `Map` into graph state.
4. Evaluation never changes the slot set. Only a mutation adds or removes a
   slot.
5. Speed is not a goal. Write the simplest correct code.
6. Never weaken, skip or delete a test to get a green run.

## How to work

1. Pick one item from `docs/TODO.md`. Once Rust implementation is active,
   pick a migration package from `docs/RUST_PORT.md` for port work.
2. Write the code and the tests together.
3. Run the checks below. All must be clean.
4. Look at anything an operator can see, on screen. "Look at it on screen"
   below says how.
5. Delete the item from `docs/TODO.md` when it lands, and update the state
   table in `docs/STATUS.md` where the change moves it. Rust migration packages
   retain their IDs and completion evidence in `docs/RUST_PORT.md`.

```
npm test                          # engine, application and tooling tests
npm run typecheck                 # both TypeScript configs
npm run build                     # production build
npm run prose                     # prose checker, gives exit code 0
```

A change that touches the Rust side runs these as well. The toolchain is
pinned in `rust-toolchain.toml`.

```
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo check -p beheader-engine --target wasm32-unknown-unknown --locked
npm run conformance               # both engines over the shared fixtures
```

## Look at it on screen

A green suite says the code does what its author expected. It says nothing
about what an operator sees, and every operator surface built here so far has
shipped a bug that only a look on screen found. Drawing math found two in one
sitting: notation measured before its fonts arrived was a sixth too narrow and
hung out through the side of its box, and an editable math field drew nothing
at all because its own two buttons filled the space the formula needed. No test
could have failed on either.

So drive the real application in a real browser before calling an operator
surface done. Chromium is already installed in this environment, and Playwright
drives it. Take a screenshot and read it.

```
npm install --prefix <a scratch directory> playwright   # once
nohup npx vite --port 5173 --strictPort > /tmp/dev.log 2>&1 &
```

Then a script of about twenty lines does the rest. Launch Chromium, open
`http://localhost:5173/`, type into `#command` and press Enter for each line of
the scenario, then call `page.screenshot`. Read the image back.

`PLAYWRIGHT_BROWSERS_PATH` already points at the installed browsers. Where a
plain `chromium.launch()` cannot find one anyway, because the version Playwright
wants differs from the version installed, pass the binary directly as
`executablePath`. `ls /opt/pw-browsers` gives the folder to point at, and the
binary inside it is at `chrome-linux/chrome`. Never run `playwright install`.

Four things are worth doing every time.

- Collect `pageerror` and `console` messages and print them. A silent exception
  reads as an empty canvas.
- Read state back out with `page.evaluate`, such as the text of `#log` or the
  box of an element, so the numbers can be checked against the arithmetic the
  scenario expects.
- Drive the change end to end rather than in one step. Create the object, wire
  it to another one, change the upstream value, and look at what moved.
- Use `npm run dev` rather than `vite preview`. The production build sets a
  base path, and the preview server serves the page somewhere the assets are
  not.

A picture also answers a question no test result can: whether the thing looks
right. Read the screenshot as an operator would, and treat anything that looks
wrong in it as a fault to chase.

## How to write a comment

`docs/STYLE.md` holds the rules and the worked example. Read the example first.
It shows the same header written badly and then written well, with the reason
for each change.

The short version. Describe the code, and do not direct the reader. Give every
constraint its reason. State a concrete property rather than a value judgment.
Carry a negative with a preposition: "with no snapshots", not "it keeps no
snapshot". Do not announce a count before the content. Clarity beats brevity,
and there is no word limit.

`npm run prose` checks the rules a machine can judge. A person judges the rest
against the example in `docs/STYLE.md`.

This repository used to hold its prose to ASD-STE100 Simplified Technical
English. Section 5 of `docs/STYLE.md` says why that is gone.

## When the spec is silent

Prefer, in this order:

1. Whatever keeps `engine/` free of the DOM.
2. Whatever keeps graph state plain and serializable.
3. Whatever protects Rule 4.
4. Whatever is simplest to delete later.
