/**
 * groups.ts
 *
 * A group is a graph object that holds other objects. It carries an origin,
 * a Python source and the in.* and out.* ports of a script node, so a group is
 * a script node with members: its ports are the interface the rest of the
 * document reads and writes it through, and an empty source makes it a plain
 * group. Its script never writes a member. A member follows the group through
 * ordinary formulas that read the group's outputs or its origin, so every
 * relation inside a group is an edge of the one graph, under the same cycle
 * check as any other.
 *
 * Membership sits on the member, as a literal view.group slot holding the ID
 * of its group, the same way a layer membership does. A member list kept on
 * the group would go stale whenever a member was deleted, and a slot on the
 * member is written by one setSlot. Each object has one group at most, and a
 * group can sit inside another, so membership forms a tree. groupProblem is
 * the integrity rule over the whole document: a membership is a literal ID or
 * null, it names a group, and no group sits inside itself through any chain.
 *
 * Coordinates stay absolute. Moving a group writes its origin and the literal
 * coordinates of every object inside it, which the interaction layer does as
 * one batch, so a formula anywhere that reads circle_1.origin.x keeps reading
 * a position on the canvas rather than one inside a frame.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
import { getSlot, slotKey, type GraphObject, type Slot } from "./graph/node.ts";
import type { Operation } from "./mutation.ts";
import { ORIGIN_X_PATH, ORIGIN_Y_PATH } from "./primitives/geometry.ts";
import { SCRIPT_LANGUAGE_PATH, SCRIPT_SOURCE_PATH } from "./script/script.ts";

export const GROUP_TYPE = "group";
export const GROUP_MEMBERSHIP_PATH: readonly string[] = ["view", "group"];

/** The ID of the group an object belongs to, or undefined for one that belongs to none. */
export function groupOf(object: GraphObject): string | undefined {
  const value = getSlot(object, GROUP_MEMBERSHIP_PATH)?.value;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function createGroupObject(id: string, name: string, originX: number, originY: number): GraphObject {
  const literal = (value: string | number): Slot => ({ kind: "literal", value });
  return {
    id,
    name,
    type: GROUP_TYPE,
    slots: {
      [slotKey(ORIGIN_X_PATH)]: literal(originX),
      [slotKey(ORIGIN_Y_PATH)]: literal(originY),
      [slotKey(SCRIPT_LANGUAGE_PATH)]: literal("python"),
      [slotKey(SCRIPT_SOURCE_PATH)]: literal(""),
    },
  };
}

/**
 * The membership rule for one object: its view.group is a literal group ID or
 * null, and the ID names a group. It reads the group through objectById, which
 * is how both the whole-document check and the indexed path of mutation.ts
 * reach it.
 */
export function membershipProblem(object: GraphObject, objectById: (id: string) => GraphObject | undefined): string | undefined {
  const membership = getSlot(object, GROUP_MEMBERSHIP_PATH);
  if (membership === undefined) {
    return undefined;
  }
  if (membership.kind !== "literal" || (membership.value !== null && typeof membership.value !== "string")) {
    return `${object.name}: group membership must be a literal group ID`;
  }
  const id = groupOf(object);
  if (id !== undefined && objectById(id)?.type !== GROUP_TYPE) {
    return `${object.name}: the group it belongs to does not exist`;
  }
  return undefined;
}

/** The whole-document rule: every membership holds, and no group sits inside itself. */
export function groupProblem(objects: readonly GraphObject[]): string | undefined {
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    const problem = membershipProblem(object, (id) => byId.get(id));
    if (problem !== undefined) {
      return problem;
    }
  }
  for (const object of objects) {
    if (object.type !== GROUP_TYPE) continue;
    const seen = new Set([object.id]);
    for (let parent = groupOf(object); parent !== undefined; parent = groupOf(byId.get(parent)!)) {
      if (seen.has(parent)) {
        return `${object.name}: a group cannot sit inside itself`;
      }
      seen.add(parent);
    }
  }
  return undefined;
}

/** The groups an object sits in, from its own group outward. */
export function ancestorGroups(object: GraphObject, objectById: (id: string) => GraphObject | undefined): readonly GraphObject[] {
  const chain: GraphObject[] = [];
  const seen = new Set<string>([object.id]);
  for (let id = groupOf(object); id !== undefined && !seen.has(id); ) {
    const group = objectById(id);
    if (group === undefined) break;
    chain.push(group);
    seen.add(id);
    id = groupOf(group);
  }
  return chain;
}

/** Every object inside a group at any depth, in list order. */
export function groupDescendants(groupId: string, objects: readonly GraphObject[]): readonly GraphObject[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return objects.filter((object) => ancestorGroups(object, (id) => byId.get(id)).some((group) => group.id === groupId));
}

/**
 * The operations that gather objects into a new group. The group takes the
 * group the members already share, if they share one, so grouping inside a
 * group nests rather than lifting the members out of it.
 */
export function groupingOperations(group: GraphObject, members: readonly GraphObject[]): readonly Operation[] {
  const parents = new Set(members.map(groupOf));
  const shared = parents.size === 1 ? [...parents][0] : undefined;
  const created: GraphObject = shared === undefined
    ? group
    : { ...group, slots: { ...group.slots, [slotKey(GROUP_MEMBERSHIP_PATH)]: { kind: "literal", value: shared } } };
  return [
    { kind: "createObject", object: created },
    ...members.map((member): Operation => ({ kind: "setSlot", address: { objectId: member.id, path: GROUP_MEMBERSHIP_PATH }, slot: { kind: "literal", value: group.id } })),
  ];
}

/**
 * The operations that dissolve a group: its direct members move to the group
 * it sat in, or to none, and the group goes. Deleting a group does the same,
 * so removing the box never removes what was in it.
 */
export function ungroupingOperations(group: GraphObject, objects: readonly GraphObject[], force: boolean): readonly Operation[] {
  const parent = groupOf(group) ?? null;
  const members = objects.filter((object) => groupOf(object) === group.id);
  return [
    ...members.map((member): Operation => ({ kind: "setSlot", address: { objectId: member.id, path: GROUP_MEMBERSHIP_PATH }, slot: { kind: "literal", value: parent } })),
    { kind: "deleteObject", objectId: group.id, force },
  ];
}
