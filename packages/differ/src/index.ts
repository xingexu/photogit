import { validateProjectState, type LayerNode, type ProjectState } from "@photogit/schema";

export type ChangeDomain = "document" | "structure" | "appearance" | "text" | "content";
export type Mergeability = "automatic" | "manual" | "unsupported";

export type SemanticChange = {
  domain: ChangeDomain;
  category: "added" | "removed" | "modified" | "reordered" | "moved";
  layerUuid: string | null;
  photoshopId: number | null;
  layerName: string;
  propertyPath: string;
  baseValue: unknown;
  currentValue: unknown;
  summary: string;
  mergeability: Mergeability;
  confidence: number;
  warnings: string[];
};

export function diffStates(base: ProjectState, current: ProjectState): SemanticChange[] {
  validateProjectState(base);
  validateProjectState(current);
  const changes: SemanticChange[] = [];
  diffObject("document", null, "Document", base.document, current.document, changes, ["schemaVersion", "warnings", "compatibility"]);

  const baseLayers = new Map(base.structure.layers.map((layer) => [layer.uuid, layer]));
  const currentLayers = new Map(current.structure.layers.map((layer) => [layer.uuid, layer]));
  const allUuids = new Set([...baseLayers.keys(), ...currentLayers.keys()]);

  for (const uuid of [...allUuids].sort()) {
    const before = baseLayers.get(uuid);
    const after = currentLayers.get(uuid);
    if (!before && after) {
      changes.push(layerLifecycle("added", after));
      continue;
    }
    if (before && !after) {
      changes.push(layerLifecycle("removed", before));
      continue;
    }
    if (!before || !after) continue;

    const metadata = { uuid, photoshopId: after.photoshopId, name: after.name };
    diffObject("structure", metadata, after.name, before, after, changes, ["uuid", "photoshopId", "children"]);
    diffObject("appearance", metadata, after.name, base.appearance[uuid], current.appearance[uuid], changes, ["schemaVersion", "layerUuid"]);
    diffObject("text", metadata, after.name, base.text[uuid], current.text[uuid], changes, ["schemaVersion", "layerUuid"]);
    diffObject("content", metadata, after.name, base.content[uuid], current.content[uuid], changes, ["schemaVersion", "layerUuid"]);
  }

  return changes.sort((a, b) => a.domain.localeCompare(b.domain) || a.layerName.localeCompare(b.layerName) || a.propertyPath.localeCompare(b.propertyPath));
}

function diffObject(
  domain: ChangeDomain,
  layer: { uuid: string; photoshopId: number; name: string } | null,
  label: string,
  before: unknown,
  after: unknown,
  changes: SemanticChange[],
  ignoredKeys: string[] = [],
  prefix = ""
): void {
  if (same(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (ignoredKeys.includes(key)) continue;
      diffObject(domain, layer, label, before[key], after[key], changes, ignoredKeys, prefix ? `${prefix}.${key}` : key);
    }
    return;
  }

  const unsupported = domain === "content";
  const action = prefix === "order" ? "reordered" : prefix === "parentUuid" ? "moved" : "modified";
  changes.push({
    domain,
    category: action,
    layerUuid: layer?.uuid ?? null,
    photoshopId: layer?.photoshopId ?? null,
    layerName: safeInline(label, 1_024) || "Unnamed layer",
    propertyPath: prefix,
    baseValue: before,
    currentValue: after,
    summary: summarize(label, prefix, before, after),
    mergeability: unsupported ? "unsupported" : "automatic",
    confidence: unsupported ? 0.75 : 1,
    warnings: unsupported ? ["Content changes require Photoshop artifact handling and cannot be merged as JSON alone."] : []
  });
}

function layerLifecycle(category: "added" | "removed", layer: LayerNode): SemanticChange {
  return {
    domain: "structure",
    category,
    layerUuid: layer.uuid,
    photoshopId: layer.photoshopId,
    layerName: safeInline(layer.name, 1_024) || "Unnamed layer",
    propertyPath: "layer",
    baseValue: category === "removed" ? layer : null,
    currentValue: category === "added" ? layer : null,
    summary: `${category === "added" ? "Added" : "Removed"} layer ${safeInline(JSON.stringify(layer.name), 120)}`,
    mergeability: "automatic",
    confidence: 1,
    warnings: []
  };
}

function summarize(label: string, path: string, before: unknown, after: unknown): string {
  const friendly = path.replaceAll(".", " ").replace(/([A-Z])/g, " $1").toLowerCase();
  return `${safeInline(label, 120)}: ${safeInline(friendly, 120)} changed from ${display(before)} to ${display(after)}`;
}

function display(value: unknown): string {
  if (value === undefined) return "not set";
  const serialized = JSON.stringify(value);
  return safeInline(serialized === undefined ? String(value) : serialized, 160);
}

function safeInline(value: string, maximum: number): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized.length <= maximum ? sanitized : `${sanitized.slice(0, maximum - 1)}…`;
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && Object.prototype.hasOwnProperty.call(right, key) && same(left[key], right[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
