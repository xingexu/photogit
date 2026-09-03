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
  validateProjectState(result);
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

  if (isRecord(base) && isRecord(current) && isRecord(incoming)) {
    const result: Record<string, unknown> = {};
    const keys = [...new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(incoming)])].sort();
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const baseHas = key in base;
      const currentHas = key in current;
      const incomingHas = key in incoming;
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
  const hasLayerKey = ["appearance", "text", "content"].includes(domain);
  conflicts.push({ domain, layerUuid: hasLayerKey ? (parts[1] ?? null) : null, propertyPath: path, reason, baseValue: clone(base), currentValue: clone(current), incomingValue: clone(incoming) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
