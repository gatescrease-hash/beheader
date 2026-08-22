/**
 * address.ts — Addressing scheme and resolver.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.2. Load-bearing per Rule 3.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Two layers of naming. Objects have opaque, stable, never-reused IDs (obj_7, per
 *   D-002 — the counter itself lives in document.ts, not here). Users write mutable
 *   names (polygon_1). Names resolve to IDs at parse time and stored ASTs hold IDs
 *   only, which is why renaming an object rewrites no formulas.
 *
 *   graph/node.ts does not exist yet (Phase 0, later in this cycle set). Every
 *   function here therefore takes the object list it needs to resolve against as a
 *   plain `readonly AddressableObject[]` parameter, rather than reading a `document`
 *   this module does not own. This mirrors the eventual shape: the resolver reads
 *   document state, it does not own it (STATUS.md gotcha, cycle 0000).
 *
 * INVARIANTS UPHELD HERE
 *   - A stored Address NEVER contains a user-facing name — it is `{ objectId, path }`
 *     only. Renaming an object never touches a stored Address.
 *   - Address strings are only ever produced by formatAddress(); never concatenated
 *     ad hoc elsewhere.
 *
 * NOT DONE HERE
 *   - Validating that `path` names a slot that actually exists on the object's schema.
 *     `primitives/schema.ts` does not exist yet; that check is layered on top of
 *     parseAddress in a later cycle, per §5.1's mutation-loop step 4.
 *   - Bare cell references (`A1`) legal only inside table cell formulas (§5.3). That
 *     context-sensitive grammar belongs to formula/deps.ts, which calls into this
 *     module for the non-bare case.
 *   - Dependency extraction, cycle detection, mutation (formula/deps.ts,
 *     graph/cycles.ts, mutation.ts).
 */

/** The minimal shape address resolution needs from an object: its ID and current name. */
export interface AddressableObject {
  readonly id: string;
  readonly name: string;
}

/**
 * A resolved address. Always `{ objectId, path }` — an ID, never a name. This is the
 * only shape a stored formula AST or binding is allowed to hold (§5.2).
 */
export interface Address {
  readonly objectId: string;
  readonly path: readonly string[];
}

/**
 * The failure shape for parseAddress / formatAddress. Matches the `#REF` arm of the
 * engine's ErrorValue union (§5.1) — an address that cannot be resolved is exactly
 * the situation `#REF` exists to represent. This is a plain data value, not a thrown
 * exception: the evaluation loop must never unwind on a broken reference (§5.1).
 */
export interface AddressError {
  readonly error: "#REF";
  readonly message: string;
}

/** A name-validity or name-availability check that did not throw either way. */
export type NameCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Naming grammar (§5.2): starts with a letter or underscore, followed by any number
 * of letters, digits, or underscores.
 */
const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * A path segment's grammar is deliberately looser than an object name's: numeric
 * per-vertex indices (`vertex.0.x`, §5.5) and cell references (`cells.A1`, §5.4) are
 * both legal path segments, and neither matches NAME_PATTERN (a segment may start
 * with a digit). Any non-empty run of letters/digits/underscores is accepted; the
 * question of whether a given segment names a real slot is a schema-layer concern
 * (see NOT DONE HERE above).
 */
const PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Checks a candidate object name against the naming grammar (§5.2). Nothing else. */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

/**
 * Finds an object by name. Lookup is case-insensitive per §5.2 ("unique across the
 * document, case-insensitive for lookup") — "Table_X" and "table_x" name the same
 * object.
 */
export function findObjectByName(
  name: string,
  objects: readonly AddressableObject[],
): AddressableObject | undefined {
  const target = name.toLowerCase();
  return objects.find((object) => object.name.toLowerCase() === target);
}

/** Finds an object by its stable ID. IDs are compared exactly — case matters, unlike names. */
export function findObjectById(
  id: string,
  objects: readonly AddressableObject[],
): AddressableObject | undefined {
  return objects.find((object) => object.id === id);
}

/**
 * Whether `name` collides with an existing object's name, case-insensitively.
 * `excludeId` lets a rename check ignore the object's own current name.
 */
export function isNameTaken(
  name: string,
  objects: readonly AddressableObject[],
  excludeId?: string,
): boolean {
  const target = name.toLowerCase();
  return objects.some((object) => object.id !== excludeId && object.name.toLowerCase() === target);
}

/**
 * The single gate a create or rename mutation must pass before writing a name
 * (§5.2: unique, case-insensitive, `[a-zA-Z_][a-zA-Z0-9_]*`). Reports which rule
 * failed rather than a bare boolean, because §5.10 requires every rejection to name
 * the specific problem.
 *
 * Rejects: a name that fails the grammar, or a name already taken by another object
 * (case-insensitively). `excludeId` allows checking a rename against everything
 * except the object being renamed.
 */
export function checkNameAvailable(
  name: string,
  objects: readonly AddressableObject[],
  excludeId?: string,
): NameCheckResult {
  if (!isValidName(name)) {
    return {
      ok: false,
      message: `"${name}" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*`,
    };
  }
  if (isNameTaken(name, objects, excludeId)) {
    return { ok: false, message: `the name "${name}" is already in use` };
  }
  return { ok: true };
}

/**
 * Generates the next default name for a newly created object of a given type
 * (`polygon_1`, `polygon_2`, ...), per §5.2 ("auto-generate defaults on creation").
 *
 * Why it counts up from 1 and re-checks each candidate, rather than counting
 * existing objects of this type and adding one: names can be freed by delete or
 * changed by rename, so "count + 1" can collide (delete polygon_1, then this would
 * suggest polygon_1 again only by accident, or skip past a name that is actually
 * free). Checking each candidate against the live name set is the dumbest correct
 * implementation (Rule 5) and is never wrong.
 */
export function generateDefaultName(typePrefix: string, objects: readonly AddressableObject[]): string {
  let n = 1;
  // eslint-disable-next-line no-constant-condition -- terminates: n grows, name space is infinite.
  while (true) {
    const candidate = `${typePrefix}_${n}`;
    if (!isNameTaken(candidate, objects)) {
      return candidate;
    }
    n += 1;
  }
}

/**
 * Parses a user-written address string (`table_x.A1`, `polygon_1.origin.x`) into a
 * stored Address — resolving the leading name to an object ID (§5.2). This is the
 * only place a name is ever turned into an Address; every other consumer of
 * addresses (formulas, bindings, script ports) MUST funnel through here.
 *
 * Rejects: an empty or malformed string (no path segment, empty segment, a path
 * segment outside PATH_SEGMENT_PATTERN), or a name that does not resolve to any
 * object. Returns a `#REF`-shaped AddressError; NEVER throws — callers that reach
 * this from inside the evaluation loop must not have it unwind (§5.1).
 *
 * Does NOT validate that `path` names a real slot on the resolved object's schema —
 * see NOT DONE HERE above. A caller that needs that stronger guarantee layers it on
 * top of a successful result from this function.
 */
export function parseAddress(input: string, objects: readonly AddressableObject[]): Address | AddressError {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { error: "#REF", message: "empty address" };
  }

  const segments = trimmed.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    return { error: "#REF", message: `malformed address "${input}" — empty segment` };
  }
  if (segments.length < 2) {
    return {
      error: "#REF",
      message: `malformed address "${input}" — expected "name.path", e.g. "table_x.A1"`,
    };
  }

  const [namePart, ...pathParts] = segments as [string, ...string[]];
  const badSegment = pathParts.find((segment) => !PATH_SEGMENT_PATTERN.test(segment));
  if (badSegment !== undefined) {
    return {
      error: "#REF",
      message: `malformed address "${input}" — invalid path segment "${badSegment}"`,
    };
  }

  const object = findObjectByName(namePart, objects);
  if (object === undefined) {
    return { error: "#REF", message: `no object named "${namePart}"` };
  }

  return { objectId: object.id, path: pathParts };
}

/**
 * Formats a stored Address back into the string a user should see, by resolving the
 * ID to that object's *current* name (§5.2). This is why renaming is free: the
 * stored Address never changes, only what formatAddress prints for it does.
 *
 * Rejects: an Address whose objectId no longer resolves to any object (the object
 * was deleted out from under a stale reference somewhere the deletion logic missed —
 * see §5.1.1). Returns a `#REF`-shaped AddressError; NEVER throws, for the same
 * reason as parseAddress.
 */
export function formatAddress(address: Address, objects: readonly AddressableObject[]): string | AddressError {
  const object = findObjectById(address.objectId, objects);
  if (object === undefined) {
    return { error: "#REF", message: `no object with id "${address.objectId}"` };
  }
  return [object.name, ...address.path].join(".");
}
