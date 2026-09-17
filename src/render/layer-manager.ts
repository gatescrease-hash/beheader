/**
 * The layer tree groups objects by membership and exposes bulk organization.
 * Callbacks route edits through the application's mutation channel. The tree
 * uses stable graph IDs while labels follow object renames.
 */
import { assignLayer, layerId, setLiteral, type GraphObject, type Operation } from "../engine/index.ts";

export interface LayerActions {
  select(id: string, extend: boolean): void;
  mutate(operations: readonly Operation[]): void;
  create(name: string): void;
  rename(id: string, name: string): void;
}

export function writeLayerTree(host: HTMLElement, objects: readonly GraphObject[], selected: readonly string[], query: string, actions: LayerActions): void {
  host.replaceChildren();
  const layers = objects.filter(object => object.type === "layer");
  const tools = document.createElement("form");
  tools.className = "layer-create";
  const name = document.createElement("input");
  name.placeholder = "New layer";
  name.setAttribute("aria-label", "New layer name");
  const add = document.createElement("button");
  add.textContent = "+";
  add.title = "Create layer";
  add.setAttribute("aria-label", "Create layer");
  tools.append(name, add);
  tools.addEventListener("submit", event => { event.preventDefault(); if (name.value.trim()) actions.create(name.value.trim()); });
  host.append(tools);

  if (selected.some(id => objects.find(object => object.id === id)?.type !== "layer")) {
    const assign = document.createElement("select");
    assign.className = "layer-assign";
    assign.setAttribute("aria-label", "Assign selected objects to layer");
    assign.add(new Option("Move selection to…", "", true, true));
    assign.add(new Option("Unassigned", "none"));
    for (const layer of layers) assign.add(new Option(layer.name, layer.id));
    assign.addEventListener("change", () => actions.mutate(objects.filter(object => selected.includes(object.id) && object.type !== "layer" && object.type !== "doc").flatMap(object => assignLayer(object, layers.find(layer => layer.id === assign.value)))));
    host.append(assign);
  }

  const row = (object: GraphObject): HTMLElement => {
    const wrapper = document.createElement("div");
    wrapper.className = "layer-object-row";
    const visibility = document.createElement("button");
    const visible = object.slots["view.visible"]?.value !== false;
    visibility.className = "layer-visibility";
    visibility.textContent = visible ? "◉" : "○";
    visibility.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${object.name}`);
    visibility.setAttribute("aria-pressed", String(visible));
    visibility.addEventListener("click", () => actions.mutate([setLiteral(object.id, ["view", "visible"], !visible)]));
    const button = document.createElement("button");
    button.className = object.type === "layer" ? "layer-name" : "object-item";
    button.setAttribute("aria-pressed", String(selected.includes(object.id)));
    const label = document.createElement("span");
    label.textContent = object.name;
    const type = document.createElement("small");
    type.textContent = object.type === "layer" ? String(objects.filter(item => layerId(item) === object.id).length) : object.type;
    button.append(label, type);
    button.addEventListener("click", event => actions.select(object.id, event.shiftKey));
    button.addEventListener("dblclick", () => {
      const field = document.createElement("input");
      field.value = object.name;
      field.setAttribute("aria-label", `Rename ${object.name}`);
      button.replaceWith(field);
      field.focus(); field.select();
      let done = false;
      const commit = () => { if (!done) { done = true; actions.rename(object.id, field.value); } };
      field.addEventListener("blur", commit);
      field.addEventListener("keydown", event => { if (event.key === "Enter") commit(); if (event.key === "Escape") { field.value = object.name; commit(); } });
    });
    wrapper.append(visibility, button);
    return wrapper;
  };
  for (const layer of [...layers, undefined]) {
    const members = objects.filter(object => object.type !== "layer" && layerId(object) === layer?.id && `${object.name} ${object.type}`.toLowerCase().includes(query));
    if (query && !members.length && !layer?.name.toLowerCase().includes(query)) continue;
    const group = document.createElement("section");
    group.className = "layer-group";
    if (layer) group.append(row(layer));
    else { const title = document.createElement("div"); title.className = "layer-heading"; title.textContent = "Unassigned"; group.append(title); }
    const children = document.createElement("div");
    children.className = "layer-children";
    for (const object of members) children.append(row(object));
    group.append(children);
    host.append(group);
  }
  if (selected.length) {
    const order = document.createElement("div");
    order.className = "layer-order";
    for (const [label, front] of [["Send to back", false], ["Bring to front", true]] as const) {
      const button = document.createElement("button"); button.textContent = label;
      button.addEventListener("click", () => {
        const values = objects.map(object => Number(object.slots["view.order"]?.value) || 0);
        const value = front ? Math.max(0, ...values) + 1 : Math.min(0, ...values) - 1;
        actions.mutate(selected.map(id => setLiteral(id, ["view", "order"], value)));
      });
      order.append(button);
    }
    host.append(order);
  }
}
