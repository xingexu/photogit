import { validateProjectState, type ProjectState } from "@photogit/schema";

export type MergeConflict = {
  domain: string;
  layerUuid: string | null;
  propertyPath: string;
  reason: "same-property" | "delete-modify" | "opaque-content" | "structure";
  baseValue: unknown;
  currentValue: unknown;
  incomingValue: unknown;
};

export type MergePlan = {
  result: ProjectState | null;
  conflicts: MergeConflict[];
  automaticChangeCount: number;
};

export function planMerge(base: ProjectState, current: ProjectState, incoming: ProjectState): MergePlan {
  validateProjectState(base);
  validateProjectState(current);
  validateProjectState(incoming);
  const conflicts: MergeConflict[] = [];
  const counter = { value: 0 };
  const result = mergeValue(base, current, incoming, "", conflicts, counter) as ProjectState;
  if (conflicts.length > 0) return { result: null, conflicts, automaticChangeCount: counter.value };
  try {
    validateProjectState(result);
  } catch {
    addConflict("structure", base.structure, current.structure, incoming.structure, "structure", conflicts);
    return { result: null, conflicts, automaticChangeCount: counter.value };
  }
  return { result, conflicts, automaticChangeCount: counter.value };
}

function mergeValue(
  base: unknown,
  current: unknown,
  incoming: unknown,
  path: string,
  conflicts: MergeConflict[],
  counter: { value: number }
): unknown {
  if (same(current, incoming)) return clone(current);
  if (same(base, current)) {
    counter.value += 1;
    return clone(incoming);
  }
  if (same(base, incoming)) return clone(current);

  if ((path === "structure.layers" || path === "identities.records") && Array.isArray(base) && Array.isArray(current) && Array.isArray(incoming)) {
    const merged = mergeValue(keyByUuid(base), keyByUuid(current), keyByUuid(incoming), path, conflicts, counter) as Record<string, unknown>;
    const values = Object.values(merged);
    return path === "structure.layers" ? orderStructureLayers(values) : values.sort(compareUuid);
  }

  if (isRecord(base) && isRecord(current) && isRecord(incoming)) {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(incoming)])].sort();
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const baseHas = Object.prototype.hasOwnProperty.call(base, key);
      const currentHas = Object.prototype.hasOwnProperty.call(current, key);
      const incomingHas = Object.prototype.hasOwnProperty.call(incoming, key);
      if (baseHas && currentHas !== incomingHas) {
        const kept = currentHas ? current[key] : incoming[key];
        if (!same(kept, base[key])) {
          addConflict(childPath, base[key], current[key], incoming[key], "delete-modify", conflicts);
          continue;
        }
      }
      const merged = mergeValue(base[key], current[key], incoming[key], childPath, conflicts, counter);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }

  const reason = path.startsWith("content.") ? "opaque-content" : path.startsWith("structure.") && Array.isArray(current) ? "structure" : "same-property";
  addConflict(path, base, current, incoming, reason, conflicts);
  return clone(current);
}

function addConflict(path: string, base: unknown, current: unknown, incoming: unknown, reason: MergeConflict["reason"], conflicts: MergeConflict[]): void {
  const parts = path.split(".");
  const domain = parts[0] ?? "unknown";
  const domainLayerKey = ["appearance", "text", "content"].includes(domain) ? parts[1] : undefined;
  const arrayLayerKey = (domain === "structure" && parts[1] === "layers") || (domain === "identities" && parts[1] === "records") ? parts[2] : undefined;
  conflicts.push({ domain, layerUuid: domainLayerKey ?? arrayLayerKey ?? null, propertyPath: path, reason, baseValue: clone(base), currentValue: clone(current), incomingValue: clone(incoming) });
}

function keyByUuid(values: unknown[]): Record<string, unknown> {
  const keyed = Object.create(null) as Record<string, unknown>;
  for (const value of values) {
    if (!isRecord(value) || typeof value.uuid !== "string") continue;
    keyed[value.uuid] = value;
  }
  return keyed;
}

function compareUuid(left: unknown, right: unknown): number {
  const leftUuid = isRecord(left) && typeof left.uuid === "string" ? left.uuid : "";
  const rightUuid = isRecord(right) && typeof right.uuid === "string" ? right.uuid : "";
  return leftUuid.localeCompare(rightUuid);
}

function orderStructureLayers(values: unknown[]): unknown[] {
  const layers = values.filter(isRecord);
  const children = new Map<string | null, Record<string, unknown>[]>();
  for (const layer of layers) {
    const parent = typeof layer.parentUuid === "string" ? layer.parentUuid : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(layer);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => Number(left.order) - Number(right.order) || String(left.uuid).localeCompare(String(right.uuid)));
  const ordered: Record<string, unknown>[] = [];
  const pending = [...(children.get(null) ?? [])].reverse();
  while (pending.length) {
    const layer = pending.pop()!;
    ordered.push(layer);
    const descendants = children.get(String(layer.uuid)) ?? [];
    for (let index = descendants.length - 1; index >= 0; index -= 1) pending.push(descendants[index]!);
  }
  return ordered;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => same(value, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const leftKeys = Object.keys(a).sort();
  const rightKeys = Object.keys(b).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]));
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
