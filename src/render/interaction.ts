/**
 * interaction.ts — Selection and drag, as a pure state machine over pointer
 * positions.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.9's interaction clause ("click to select, drag
 * to move, escape to deselect. Dragging calls the mutation API — it never
 * writes object state directly (Rule 2)") together with its "Dragging is
 * per-component, not all-or-nothing" subsection. Not on §6.2's load-bearing
 * list.
 * LAYER: render. Touches no canvas, DOM, or window — it converts screen points
 * through `camera.ts` and asks `hittest.ts` what is under them. May import:
 * engine/* , own layer. NEVER imported by engine/*.
 *
 * WHAT THIS IS
 *   `InteractionState` is what is selected, plus — while a drag runs — the
 *   world point the last committed step moved from. Four transitions
 *   (`pointerDown`, `pointerMove`, `pointerUp`, `deselect`), each returning new
 *   state instead of mutating it, so a caller can wire them straight onto DOM
 *   events without this file knowing DOM exists (`main.ts`'s job).
 *
 *   A drag builds `setSlot` operations and hands them to `mutate`; nothing here
 *   ever assigns to a slot (Rule 2). It does so PER COMPONENT (§5.9): a
 *   `literal` `origin.x`/`origin.y` moves, a `formula` or `derived` one stays
 *   put and says what drives it in `notices`. Dragging an object whose x is
 *   bound and whose y is not therefore slides it vertically — the brief's
 *   constrained-axis payoff, and the clause most likely to be normalised into
 *   all-or-nothing dragging (0064-REVIEW §10). **D-040 forbids the other
 *   tempting normalisation**: `set` may overwrite a formula slot, a drag may
 *   NEVER — "a drag is a continuous gesture, not a statement of intent."
 *
 *   §5.9's "independently" governs the per-component DECISION, not the number
 *   of mutations: the components that DO move go in ONE batch, because §5.1
 *   asks dragging to batch and one gesture step is one journal entry. So an
 *   illegal value in one component rejects the other too — reachable only
 *   through a non-finite coordinate (HAZARD below).
 *
 * INVARIANTS UPHELD HERE
 *   - A drag holds an object ID, NEVER a `GraphObject`. `mutate` returns new
 *     objects on every commit, so a held reference is a stale snapshot after
 *     the first step.
 *   - A rejected mutation advances nothing: `objects`, `journal`, and the
 *     drag's own `lastWorldPoint` all come back as they went in, so the
 *     accumulated delta is retried on the next move rather than lost.
 *   - No operation is built for a component that would not change (a zero
 *     delta), and `mutate` is never called with an empty batch — a journal
 *     entry for a mutation that moved nothing is a false record of history,
 *     which is `mutate`'s own reason for rejecting an empty batch.
 *   - Never throws.
 *   - HAZARD, inherited from `hittest.ts`/`camera.ts`: `camera.zoom` must be
 *     non-zero. A loaded document's camera can violate it (D-062) and every
 *     hit here then lands on the topmost object; the clamp belongs at
 *     `main.ts`'s boundary, once, not here (0062-REVIEW §9). A DRAG at
 *     `zoom: 0` at least fails LOUDLY: the delta is `NaN`, so `mutate` refuses
 *     it (D-025), nothing is corrupted, and no journal entry is written — but
 *     the message names the value, not the camera, and the drag can never
 *     succeed (probed at 0067-REVIEW).
 *
 * NOT DONE HERE
 *   - **Per-vertex dragging** for an object with no `origin` slot (§5.9's
 *     editable-path clause). Nothing can have per-vertex slots yet —
 *     `polyline` has no schema entry and `explode` is unbuilt — so this is a
 *     clause conditioned on a thing that cannot exist, the shape D-067 ruled
 *     correct to defer. Owner: the `polyline`/`explode` cycle. Until then such
 *     an object reports that it cannot be dragged rather than swallowing the
 *     gesture. A `table` reports the same today, for the different reason that
 *     `TABLE_SCHEMA` declares no `origin.x`/`origin.y` yet (entry 0061).
 *   - §5.9's visual feedback (selection highlight, error badge, formula-driven
 *     slot indicator). All three are draw-time work over a `ctx` this file
 *     never receives, and they belong together in one cycle, with the renderer.
 *   - §5.4's formula bar / in-place cell editing, which `renderer.ts` points
 *     here for. It is this file's kind of work — a pointer and a keyboard over
 *     a selected cell — and none of it is built.
 *   - Pan and zoom (`camera.ts` owns that math), and reading a keyboard, mouse
 *     or wheel at all — `main.ts` listens and calls in. `deselect` is what
 *     Escape calls.
 */
import { formatAddress, isAddressError, type Address } from "../engine/address.ts";
import { extractDependencies } from "../engine/formula/deps.ts";
import { getSlot, type DerivedSlot, type FormulaSlot, type GraphObject } from "../engine/graph/node.ts";
import { mutate, type MutationJournalEntry, type Operation } from "../engine/mutation.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH } from "../engine/primitives/geometry.ts";
import type { CameraState } from "../engine/document.ts";
import { screenToWorld, type ScreenPoint, type WorldPoint } from "./camera.ts";
import { hitTest } from "./hittest.ts";

/**
 * A drag in progress. `lastWorldPoint` is where the pointer was at the last
 * step this file COMMITTED (or deliberately skipped), not where it was at
 * `pointerDown`: each `pointerMove` moves the object by the delta since the
 * previous one, so a step `mutate` rejects simply leaves that delta on the
 * table for the next step to retry.
 */
export interface DragState {
  readonly objectId: string;
  readonly lastWorldPoint: WorldPoint;
}

/** §5.9's whole interaction state: what is selected, and what a drag is moving. Plain data — a caller may keep it anywhere. */
export interface InteractionState {
  readonly selectedObjectId: string | undefined;
  readonly drag: DragState | undefined;
}

/** Nothing selected, no drag running — where `main.ts` starts and where `deselect` returns to. */
export const INITIAL_INTERACTION_STATE: InteractionState = {
  selectedObjectId: undefined,
  drag: undefined,
};

/**
 * What one `pointerMove` produced. `objects`/`journal` are what the caller
 * should hold from here on — the committed result when `mutate` succeeded, and
 * otherwise the caller's OWN references handed straight back (Rule 2: a
 * rejected mutation leaves prior state bit-for-bit untouched, so there is
 * nothing to swap in).
 *
 * `notices` is §5.9's "non-blocking feedback": one line per component that did
 * not move, naming what drives it. Non-blocking means exactly that — the
 * components that COULD move already did.
 *
 * `rejection` is `mutate`'s own message when it refused the batch, and is a
 * different thing from a notice: a notice is a component that was never asked
 * to move, a rejection is the whole step failing.
 *
 * `mutate`'s `brokenSlots` (D-057) is deliberately not surfaced: only a repair
 * path can break a slot and a `setSlot` batch has none, so it is always empty
 * here.
 */
export interface PointerMoveOutcome {
  readonly state: InteractionState;
  readonly objects: readonly GraphObject[];
  readonly journal: readonly MutationJournalEntry[];
  readonly notices: readonly string[];
  readonly rejection: string | undefined;
}

/**
 * §5.9's "click to select", plus arming a drag on whatever was hit. Takes no
 * prior state because a press does not depend on any: what is under the pointer
 * decides the whole interaction state. A press on empty canvas therefore selects
 * nothing and arms nothing — "click to select" reading the selection off the hit
 * result, `undefined` included, rather than growing a branch that keeps a stale
 * selection alive. Escape (`deselect`) remains the keyboard path §5.9 names.
 *
 * A press is not itself a move: the object does not shift until `pointerMove`
 * reports a pointer position different from this one, so a click that never
 * moves commits no mutation at all.
 */
export function pointerDown(screenPoint: ScreenPoint, objects: readonly GraphObject[], camera: CameraState): InteractionState {
  const object = hitTest(screenPoint, objects, camera);
  if (object === undefined) {
    return INITIAL_INTERACTION_STATE;
  }
  // The ID, never the object — see the file header's INVARIANTS.
  return { selectedObjectId: object.id, drag: { objectId: object.id, lastWorldPoint: screenToWorld(camera, screenPoint) } };
}

/**
 * Advances the interaction to `screenPoint`. A no-op unless a drag is running,
 * which is what lets a caller wire this onto every pointer move unconditionally.
 *
 * §5.9's per-component rule in full: each of `origin.x`/`origin.y` moves by its
 * own component of the world-space delta if — and only if — its slot is
 * `literal` and holds a number. Everything else is reported and skipped, so an
 * object with one bound component slides along the other axis, and only an
 * object whose every component is driven does nothing at all.
 *
 * Never throws, and never writes: the one state change here is `mutate`'s
 * (Rule 2).
 */
export function pointerMove(
  state: InteractionState,
  screenPoint: ScreenPoint,
  objects: readonly GraphObject[],
  journal: readonly MutationJournalEntry[],
  camera: CameraState,
): PointerMoveOutcome {
  const drag = state.drag;
  if (drag === undefined) {
    return { state, objects, journal, notices: [], rejection: undefined };
  }

  const object = objects.find((candidate) => candidate.id === drag.objectId);
  if (object === undefined) {
    // The object went away between the press and this move (a `delete` from the
    // command line, a load). End the drag rather than carry an id resolving to
    // nothing. D-023: the raw id is printed LABELLED as an id, because there is
    // no name left to resolve it to.
    return {
      state: { selectedObjectId: state.selectedObjectId, drag: undefined },
      objects,
      journal,
      notices: [`the object being dragged (id "${drag.objectId}") no longer exists — drag ended`],
      rejection: undefined,
    };
  }

  const worldPoint = screenToWorld(camera, screenPoint);
  const deltaX = worldPoint.x - drag.lastWorldPoint.x;
  const deltaY = worldPoint.y - drag.lastWorldPoint.y;
  if (deltaX === 0 && deltaY === 0) {
    return { state, objects, journal, notices: [], rejection: undefined };
  }

  const plan = planOriginDrag(object, objects, deltaX, deltaY);
  const advanced: InteractionState = {
    selectedObjectId: state.selectedObjectId,
    drag: { objectId: drag.objectId, lastWorldPoint: worldPoint },
  };

  if (plan.operations.length === 0) {
    // §5.9: "Only when every component is driven does the drag do nothing." The
    // pointer still moved, so the drag advances — there is no delta left to
    // retry, because nothing here can ever move.
    return { state: advanced, objects, journal, notices: plan.notices, rejection: undefined };
  }

  const result = mutate(objects, plan.operations, journal);
  if (!result.ok) {
    // Prior state is untouched (Rule 2 / D-016) and `lastWorldPoint` is NOT
    // advanced, so this delta folds into the next move's instead of being
    // silently dropped. Nothing above pre-checks the value for legality:
    // `mutate` is the one channel that decides what may be stored (D-025,
    // D-027), and re-deciding it here would be a second source of truth.
    return { state, objects, journal, notices: plan.notices, rejection: result.message };
  }
  return { state: advanced, objects: result.objects, journal: result.journal, notices: plan.notices, rejection: undefined };
}

/** Ends a drag, keeping the selection — §5.9 separates selecting from moving, and releasing the button does not deselect. */
export function pointerUp(state: InteractionState): InteractionState {
  if (state.drag === undefined) {
    return state;
  }
  return { selectedObjectId: state.selectedObjectId, drag: undefined };
}

/**
 * §5.9's "escape to deselect" — clears the selection AND any drag in progress,
 * so a half-finished gesture cannot survive the key. Takes no prior state:
 * there is exactly one deselected state, and this is it.
 */
export function deselect(): InteractionState {
  return INITIAL_INTERACTION_STATE;
}

/** One component's contribution to a drag: an operation, a notice explaining why there is none, or neither. */
interface ComponentPlan {
  readonly operation: Operation | undefined;
  readonly notice: string | undefined;
}

/** Everything one drag step wants to do, gathered before any of it is attempted. */
interface DragPlan {
  readonly operations: readonly Operation[];
  readonly notices: readonly string[];
}

/**
 * Plans a drag of `object` by (`deltaX`, `deltaY`) against its `origin.x` /
 * `origin.y` slots, per §5.9's per-component rule.
 *
 * An object with NEITHER origin slot is §5.9's editable-path case, which this
 * file does not implement (header's NOT DONE HERE). It gets one notice naming
 * the object, not two naming absent slots, because what is missing is the drag
 * STRATEGY, not the individual slots.
 */
function planOriginDrag(object: GraphObject, objects: readonly GraphObject[], deltaX: number, deltaY: number): DragPlan {
  if (getSlot(object, ORIGIN_X_PATH) === undefined && getSlot(object, ORIGIN_Y_PATH) === undefined) {
    return {
      operations: [],
      notices: [`${object.name} has no origin slots, and dragging by vertex is not built yet — nothing moved`],
    };
  }
  const plans = [planComponent(object, ORIGIN_X_PATH, deltaX, objects), planComponent(object, ORIGIN_Y_PATH, deltaY, objects)];
  return {
    operations: plans.flatMap((plan) => (plan.operation === undefined ? [] : [plan.operation])),
    notices: plans.flatMap((plan) => (plan.notice === undefined ? [] : [plan.notice])),
  };
}

/**
 * One component of §5.9's per-component rule. Moves the slot only if it is
 * `literal` and holds a number; otherwise explains itself and stays put.
 *
 * A zero delta produces neither an operation nor a notice: nothing was
 * attempted, so there is nothing to report and nothing to write (file header's
 * invariant on no-op batches).
 */
function planComponent(object: GraphObject, path: readonly string[], delta: number, objects: readonly GraphObject[]): ComponentPlan {
  if (delta === 0) {
    return { operation: undefined, notice: undefined };
  }
  const address: Address = { objectId: object.id, path };
  const slot = getSlot(object, path);
  if (slot === undefined) {
    return { operation: undefined, notice: `${describeAddress(address, objects)} has no slot to move` };
  }
  if (slot.kind !== "literal") {
    return { operation: undefined, notice: `${describeAddress(address, objects)} did not move: ${describeSlotDriver(slot, objects)}` };
  }
  if (typeof slot.value !== "number") {
    return { operation: undefined, notice: `${describeAddress(address, objects)} did not move: it does not hold a number` };
  }
  return { operation: { kind: "setSlot", address, slot: { kind: "literal", value: slot.value + delta } }, notice: undefined };
}

/**
 * §5.9's own example of the feedback a skipped component owes the user ("x is
 * driven by `table_x.A1`").
 *
 * The addresses come from `formula/deps.ts`, which is EAGER and TOTAL by design
 * (§5.3) — so a branching formula names every slot it COULD read, not the one it
 * happens to be reading now. That is the honest answer to "what drives this":
 * all of them do, which is exactly why the graph subscribes to all of them.
 * Deduplicated only so `= A1 + A1` does not say `A1` twice.
 */
function describeSlotDriver(slot: FormulaSlot | DerivedSlot, objects: readonly GraphObject[]): string {
  switch (slot.kind) {
    case "derived":
      return "it is a derived slot, computed by its object's schema and never writable (§5.1)";
    case "formula": {
      const sources = [
        ...new Set(
          extractDependencies(slot.ast).map((dependency) =>
            dependency.kind === "reference"
              ? describeAddress(dependency.address, objects)
              : `${describeAddress(dependency.start, objects)}:${describeAddress(dependency.end, objects)}`,
          ),
        ),
      ];
      if (sources.length === 0) {
        return "it is driven by a formula";
      }
      return `it is driven by a formula reading ${sources.join(", ")}`;
    }
    default: {
      // Compile-time exhaustiveness without a throw — the idiom every
      // discriminated-union switch in this codebase carries.
      const exhaustive: never = slot;
      void exhaustive;
      return "it is not a literal slot";
    }
  }
}

/**
 * An address as the user should see it (D-015: never `addressKey`), degrading to
 * `formatAddress`'s own `#REF` message rather than throwing when the object no
 * longer resolves — the same shape `mutation.ts`'s `formatCycleRejection` uses,
 * for the same reason.
 */
function describeAddress(address: Address, objects: readonly GraphObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}
