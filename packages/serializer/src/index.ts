import {
  SCHEMA_VERSION,
  isSafeLayerUuid,
  validateDocumentCapture,
  validateProjectState,
  type AppearanceDomain,
  type ContentDomain,
  type DocumentCapture,
  type IdentityRecord,
  type LayerNode,
  type LayerUuid,
  type ProjectMetadata,
  type ProjectState,
  type TextDomain
} from "@photogit/schema";

export type ExistingIdentity = Pick<IdentityRecord, "uuid" | "photoshopId" | "parentUuid" | "signature">;

export class AmbiguousLayerIdentityError extends Error {
  constructor(public readonly photoshopId: number, public readonly layerName: string, public readonly candidateUuids: string[]) {
    super(`Layer “${layerName}” matches multiple existing identities and needs user confirmation.`);
    this.name = "AmbiguousLayerIdentityError";
  }
}

export function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return Object.is(value, -0) ? 0 : Number(value.toFixed(6));
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function stateFromCapture(
  capture: DocumentCapture,
  project: ProjectMetadata,
  uuidFactory: () => string,
  existing: ExistingIdentity[] = []
): ProjectState {
  validateDocumentCapture(capture);
  const byPhotoshopId = new Map(existing.map((record) => [record.photoshopId, record]));
  const uuidByPhotoshopId = new Map<number, LayerUuid>();
  const signatureByPhotoshopId = new Map<number, string>();
  const confidenceByPhotoshopId = new Map<number, IdentityRecord["confidence"]>();
  const usedUuids = new Set<string>();

  for (const layer of capture.layers) {
    const parentUuid = layer.parentPhotoshopId === null ? null : uuidByPhotoshopId.get(layer.parentPhotoshopId);
    if (layer.parentPhotoshopId !== null && !parentUuid) throw new Error("Capture layers must place each parent before its children.");
    const signature = identitySignature(layer.kind, layer.name, parentUuid ?? null, layer.appearance.bounds);
    const exact = byPhotoshopId.get(layer.photoshopId);
    let selected: ExistingIdentity | undefined;
    let confidence: IdentityRecord["confidence"] = "confirmed";
    if (exact && !usedUuids.has(exact.uuid)) {
      selected = exact;
      confidence = "exact";
    } else {
      const candidates = existing.filter((record) => !usedUuids.has(record.uuid) && record.signature === signature);
      if (candidates.length > 1) throw new AmbiguousLayerIdentityError(layer.photoshopId, layer.name, candidates.map((record) => record.uuid).sort());
      selected = candidates[0];
    }
    const uuid = selected?.uuid ?? uuidFactory();
    uuidByPhotoshopId.set(layer.photoshopId, uuid);
    signatureByPhotoshopId.set(layer.photoshopId, signature);
    confidenceByPhotoshopId.set(layer.photoshopId, confidence);
    usedUuids.add(uuid);
  }

  const identities: IdentityRecord[] = [];
  const layers: LayerNode[] = [];
  const appearance: Record<LayerUuid, AppearanceDomain> = {};
  const text: Record<LayerUuid, TextDomain> = {};
  const content: Record<LayerUuid, ContentDomain> = {};

  for (const layer of capture.layers) {
    const uuid = requireUuid(uuidByPhotoshopId.get(layer.photoshopId));
    const parentUuid = layer.parentPhotoshopId === null ? null : requireUuid(uuidByPhotoshopId.get(layer.parentPhotoshopId));
    const children = layer.childrenPhotoshopIds.map((id) => requireUuid(uuidByPhotoshopId.get(id)));
    const signature = requireUuid(signatureByPhotoshopId.get(layer.photoshopId));

    identities.push({ uuid, photoshopId: layer.photoshopId, parentUuid, signature, confidence: confidenceByPhotoshopId.get(layer.photoshopId) ?? "confirmed" });
    layers.push({ uuid, photoshopId: layer.photoshopId, parentUuid, name: layer.name, kind: layer.kind, order: layer.order, children });
    appearance[uuid] = { schemaVersion: SCHEMA_VERSION, layerUuid: uuid, ...layer.appearance };
    content[uuid] = { schemaVersion: SCHEMA_VERSION, layerUuid: uuid, ...layer.content };
    if (layer.text) text[uuid] = { schemaVersion: SCHEMA_VERSION, layerUuid: uuid, ...layer.text };
  }

  const warnings: string[] = [];
  const supported = capture.document.mode.toLowerCase() === "rgb" && capture.document.bitDepth === 8;
  if (!supported) warnings.push("Only RGB 8-bit documents are fully supported; this snapshot will merge conservatively.");

  const orderedLayers = orderLayers(layers);
  const state: ProjectState = {
    project,
    document: { ...capture.document, schemaVersion: SCHEMA_VERSION, compatibility: supported ? "supported" : "limited", warnings },
    identities: { schemaVersion: SCHEMA_VERSION, records: identities.sort((a, b) => a.uuid.localeCompare(b.uuid)) },
    structure: {
      schemaVersion: SCHEMA_VERSION,
      roots: orderedLayers.filter((layer) => layer.parentUuid === null).map((layer) => layer.uuid),
      layers: orderedLayers
    },
    appearance,
    text,
    content
  };
  validateProjectState(state);
  return state;
}

export function stateToFiles(state: ProjectState): Map<string, string> {
  validateProjectState(state);
  const files = new Map<string, string>([
    [".photogit/project.json", canonicalJson(state.project)],
    [".photogit/document.json", canonicalJson(state.document)],
    [".photogit/identities.json", canonicalJson(state.identities)],
    [".photogit/structure/layers.json", canonicalJson(state.structure)]
  ]);
  appendDomain(files, ".photogit/appearance", state.appearance);
  appendDomain(files, ".photogit/text", state.text);
  appendDomain(files, ".photogit/content", state.content);
  return new Map([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function appendDomain<T>(files: Map<string, string>, directory: string, domain: Record<string, T>): void {
  for (const uuid of Object.keys(domain).sort()) {
    if (!isSafeLayerUuid(uuid)) throw new Error(`Unsafe layer UUID in serialized state: ${uuid}`);
    files.set(`${directory}/${uuid}.json`, canonicalJson(domain[uuid]));
  }
}

function requireUuid(uuid: string | undefined): string {
  if (!uuid) throw new Error("Capture contains a parent or child Photoshop ID that is not present in its layer list");
  return uuid;
}

function orderLayers(layers: LayerNode[]): LayerNode[] {
  const children = new Map<string | null, LayerNode[]>();
  for (const layer of layers) {
    const siblings = children.get(layer.parentUuid) ?? [];
    siblings.push(layer);
    children.set(layer.parentUuid, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.order - right.order || left.uuid.localeCompare(right.uuid));
  const ordered: LayerNode[] = [];
  const pending = [...(children.get(null) ?? [])].reverse();
  while (pending.length) {
    const layer = pending.pop()!;
    ordered.push(layer);
    const descendants = children.get(layer.uuid) ?? [];
    for (let index = descendants.length - 1; index >= 0; index -= 1) pending.push(descendants[index]!);
  }
  return ordered;
}

function identitySignature(kind: string, name: string, parentUuid: string | null, bounds: { left: number; top: number; right: number; bottom: number }): string {
  return [kind, name, parentUuid ?? "root", bounds.left, bounds.top, bounds.right, bounds.bottom].join("|");
}
