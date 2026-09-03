import type { LayerNode, ProjectState } from "@photogit/schema";

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
    layerName: label,
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
    layerName: layer.name,
    propertyPath: "layer",
    baseValue: category === "removed" ? layer : null,
    currentValue: category === "added" ? layer : null,
    summary: `${category === "added" ? "Added" : "Removed"} layer “${layer.name}”`,
    mergeability: "automatic",
    confidence: 1,
    warnings: []
  };
}

function summarize(label: string, path: string, before: unknown, after: unknown): string {
  const friendly = path.replaceAll(".", " ").replace(/([A-Z])/g, " $1").toLowerCase();
  return `${label}: ${friendly} changed from ${display(before)} to ${display(after)}`;
}

function display(value: unknown): string {
  if (value === undefined) return "not set";
  if (typeof value === "string") return `“${value}”`;
  return JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
