/**
 * reads.ts
 *
 * Every slot edge of the document as an operator reads the graph, which is
 * the edge set of mutation.ts with one addition: a formula or a text box that
 * reads an empty cell inside the extent of a table. The engine leaves that
 * edge out of evaluation, because an empty cell is a place with no slot to
 * order, and the reader still reads the table. A delete without force names
 * that reader when it refuses, and the graph queries and the dependency
 * overlay show it, so both read this one list.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access.
 */
import type { Edge } from "./graph/edge.ts";
import { slotKey, TEXT_TYPE, type GraphObject } from "./graph/node.ts";
import type { Address } from "./address.ts";
import { extractDependencies, type Dependency } from "./formula/deps.ts";
import { deriveEdges } from "./mutation.ts";
import { getObjectSchema, resolveNonDerivedSlotPaths } from "./primitives/schema.ts";
import { enumerateRangeCellAddresses, isInExtentTableCellAddressForObject, isRangeEnumerationError } from "./primitives/table.ts";
import { extractTextDependencies, parseTextContent, TEXT_CONTENT_PATH, TEXT_RESOLVED_CONTENT_PATH } from "./primitives/text.ts";

const readEdgesMemo = new WeakMap<readonly GraphObject[], readonly Edge[]>();

/**
 * Every slot edge of the document, with an edge added for each read of an
 * empty cell inside the extent of a table, from a formula slot or from the
 * content of a text box. The list is kept per object list, which is plain
 * data that never changes in place, so a renderer that paints the same
 * document many times derives it once.
 */
export function readEdges(objects: readonly GraphObject[]): readonly Edge[] {
  const memo = readEdgesMemo.get(objects);
  if (memo !== undefined) return memo;
  const edges = [...deriveEdges(objects)];
  const byId = new Map(objects.map((object) => [object.id, object]));
  const emptyCellReads = (dependencies: readonly Dependency[], dependentSlot: Address): void => {
    for (const dependency of dependencies) {
      if (dependency.kind === "reference") {
        const table = byId.get(dependency.address.objectId);
        if (table?.slots[slotKey(dependency.address.path)] === undefined && isInExtentTableCellAddressForObject(dependency.address, table)) {
          edges.push({ sourceSlot: dependency.address, dependentSlot });
        }
        continue;
      }
      const table = byId.get(dependency.start.objectId);
      if (table === undefined) continue;
      const cells = enumerateRangeCellAddresses(dependency.start, dependency.end, table);
      if (isRangeEnumerationError(cells)) continue;
      for (const cell of cells) {
        if (table.slots[slotKey(cell.path)] === undefined) edges.push({ sourceSlot: cell, dependentSlot });
      }
    }
  };
  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    for (const path of schema === undefined ? [] : resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)) {
      const slot = object.slots[slotKey(path)];
      if (slot?.kind === "formula") emptyCellReads(extractDependencies(slot.ast), { objectId: object.id, path });
    }
    const content = object.slots[slotKey(TEXT_CONTENT_PATH)];
    if (object.type === TEXT_TYPE && content?.kind === "literal" && typeof content.value === "string") {
      emptyCellReads(extractTextDependencies(parseTextContent(content.value, objects)), { objectId: object.id, path: TEXT_RESOLVED_CONTENT_PATH });
    }
  }
  readEdgesMemo.set(objects, edges);
  return edges;
}

