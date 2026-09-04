export const SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof SCHEMA_VERSION;
export type LayerUuid = string;

export type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DocumentDomain = {
  schemaVersion: SchemaVersion;
  documentId: string;
  name: string;
  width: number;
  height: number;
  resolution: number;
  mode: string;
  bitDepth: number;
  colorProfile: string | null;
  compatibility: "supported" | "limited";
  warnings: string[];
};

export type LayerNode = {
  uuid: LayerUuid;
  photoshopId: number;
  parentUuid: LayerUuid | null;
  name: string;
  kind: string;
  order: number;
  children: LayerUuid[];
};

export type StructureDomain = {
  schemaVersion: SchemaVersion;
  roots: LayerUuid[];
  layers: LayerNode[];
};

export type AppearanceDomain = {
  schemaVersion: SchemaVersion;
  layerUuid: LayerUuid;
  visible: boolean;
  opacity: number;
  fillOpacity: number;
  blendMode: string;
  clipped: boolean;
  locks: {
    all: boolean;
    pixels: boolean;
    position: boolean;
    transparentPixels: boolean;
  };
  bounds: Bounds;
  boundsWithoutEffects: Bounds;
};

export type TextDomain = {
  schemaVersion: SchemaVersion;
  layerUuid: LayerUuid;
  contents: string;
  styleFingerprint: string | null;
};

export type ContentDomain = {
  schemaVersion: SchemaVersion;
  layerUuid: LayerUuid;
  fingerprint: string | null;
  opaque: boolean;
  reason: string | null;
};

export type IdentityRecord = {
  uuid: LayerUuid;
  photoshopId: number;
  parentUuid: LayerUuid | null;
  signature: string;
  confidence: "exact" | "confirmed" | "uncertain";
};

export type IdentitiesDomain = {
  schemaVersion: SchemaVersion;
  records: IdentityRecord[];
};

export type ProjectMetadata = {
  schemaVersion: SchemaVersion;
  projectId: string;
  displayName: string;
  createdWith: string;
};

export type ProjectState = {
  project: ProjectMetadata;
  document: DocumentDomain;
  identities: IdentitiesDomain;
  structure: StructureDomain;
  appearance: Record<LayerUuid, AppearanceDomain>;
  text: Record<LayerUuid, TextDomain>;
  content: Record<LayerUuid, ContentDomain>;
};

export type CaptureLayer = Omit<LayerNode, "uuid" | "parentUuid" | "children"> & {
  parentPhotoshopId: number | null;
  childrenPhotoshopIds: number[];
  appearance: Omit<AppearanceDomain, "schemaVersion" | "layerUuid">;
  text: Omit<TextDomain, "schemaVersion" | "layerUuid"> | null;
  content: Omit<ContentDomain, "schemaVersion" | "layerUuid">;
};

export type DocumentCapture = {
  document: Omit<DocumentDomain, "schemaVersion" | "compatibility" | "warnings">;
  layers: CaptureLayer[];
};

export class SchemaValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    const omitted = issues instanceof ValidationIssues ? issues.omitted : Math.max(0, issues.length - 100);
    const bounded = Array.from(issues.slice(0, 100));
    if (omitted) bounded.push(`${omitted} additional validation issue(s) omitted`);
    super(`Invalid PhotoGit state:\n${bounded.map((issue) => `- ${issue}`).join("\n")}`);
    this.issues = bounded;
    this.name = "SchemaValidationError";
  }
}

const SAFE_LAYER_UUID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const MAX_CAPTURE_LAYERS = 50_000;
const MAX_TEXT_LENGTH = 1_000_000;

class ValidationIssues extends Array<string> {
  omitted = 0;

  override push(...entries: string[]): number {
    for (const entry of entries) {
      if (this.length < 100) super.push(entry);
      else this.omitted += 1;
    }
    return this.length;
  }
}

export function isSafeLayerUuid(value: unknown): value is LayerUuid {
  return typeof value === "string" && SAFE_LAYER_UUID.test(value);
}

export function validateProjectMetadata(value: unknown): asserts value is ProjectMetadata {
  const issues: string[] = new ValidationIssues();
  if (!isRecord(value)) throw new SchemaValidationError(["project must be an object"]);
  checkAllowedKeys(value, "project", ["schemaVersion", "projectId", "displayName", "createdWith"], issues);
  checkVersion(value, "project", issues);
  checkBoundedString(value.projectId, "project.projectId", issues, 500);
  checkBoundedString(value.displayName, "project.displayName", issues, 1_024);
  checkBoundedString(value.createdWith, "project.createdWith", issues, 200);
  if (issues.length > 0) throw new SchemaValidationError(issues);
}

export function validateDocumentCapture(value: unknown): asserts value is DocumentCapture {
  const issues: string[] = new ValidationIssues();
  if (!isRecord(value)) throw new SchemaValidationError(["capture must be an object"]);
  checkAllowedKeys(value, "capture", ["document", "layers"], issues);
  const document = value.document;
  const layers = value.layers;
  if (!isRecord(document)) issues.push("capture.document must be an object");
  if (!Array.isArray(layers)) issues.push("capture.layers must be an array");
  if (isRecord(document)) {
    checkAllowedKeys(document, "capture.document", ["documentId", "name", "width", "height", "resolution", "mode", "bitDepth", "colorProfile"], issues);
    checkBoundedString(document.documentId, "capture.document.documentId", issues, 500);
    checkBoundedString(document.name, "capture.document.name", issues, 1_024);
    checkPositive(document.width, "capture.document.width", issues);
    checkPositive(document.height, "capture.document.height", issues);
    checkPositive(document.resolution, "capture.document.resolution", issues);
    checkInteger(document.bitDepth, "capture.document.bitDepth", issues, 1);
    checkBoundedString(document.mode, "capture.document.mode", issues, 100);
    checkNullableString(document.colorProfile, "capture.document.colorProfile", issues, 1_024);
  }
  if (Array.isArray(layers)) {
    if (layers.length > MAX_CAPTURE_LAYERS) issues.push(`capture.layers must contain at most ${MAX_CAPTURE_LAYERS} layers`);
    const byId = new Map<number, Record<string, unknown>>();
    const indexById = new Map<number, number>();
    for (const [index, layer] of layers.slice(0, MAX_CAPTURE_LAYERS).entries()) {
      const path = `capture.layers[${index}]`;
      if (!isRecord(layer)) {
        issues.push(`${path} must be an object`);
        continue;
      }
      checkAllowedKeys(layer, path, ["photoshopId", "parentPhotoshopId", "childrenPhotoshopIds", "name", "kind", "order", "appearance", "text", "content"], issues);
      checkInteger(layer.photoshopId, `${path}.photoshopId`, issues, 1);
      if (Number.isSafeInteger(layer.photoshopId) && (layer.photoshopId as number) > 0) {
        const id = layer.photoshopId as number;
        if (byId.has(id)) issues.push(`${path}.photoshopId duplicates ${id}`);
        byId.set(id, layer);
        indexById.set(id, index);
      }
      if (layer.parentPhotoshopId !== null) checkInteger(layer.parentPhotoshopId, `${path}.parentPhotoshopId`, issues, 1);
      checkInteger(layer.order, `${path}.order`, issues, 0);
      checkBoundedString(layer.name, `${path}.name`, issues, 1_024);
      checkBoundedString(layer.kind, `${path}.kind`, issues, 100);
      checkIntegerArray(layer.childrenPhotoshopIds, `${path}.childrenPhotoshopIds`, issues, true);
      checkAppearance(layer.appearance, `${path}.appearance`, issues, false);
      checkText(layer.text, `${path}.text`, issues, false);
      checkContent(layer.content, `${path}.content`, issues, false);
    }
    for (const [id, layer] of byId) {
      const parentId = layer.parentPhotoshopId;
      if (parentId !== null && Number.isInteger(parentId)) {
        const parent = byId.get(parentId as number);
        if (!parent) issues.push(`capture layer ${id} refers to missing parent ${String(parentId)}`);
        else if (!(parent.childrenPhotoshopIds as unknown[])?.includes(id)) issues.push(`capture layer ${id} is missing from parent ${String(parentId)} children`);
        if ((indexById.get(parentId as number) ?? Number.POSITIVE_INFINITY) >= (indexById.get(id) ?? -1)) issues.push(`capture layer ${id} must appear after its parent ${String(parentId)}`);
      }
      if (Array.isArray(layer.childrenPhotoshopIds)) {
        for (const childId of layer.childrenPhotoshopIds) {
          if (!Number.isInteger(childId)) continue;
          const child = byId.get(childId as number);
          if (!child) issues.push(`capture layer ${id} refers to missing child ${String(childId)}`);
          else if (child.parentPhotoshopId !== id) issues.push(`capture child ${String(childId)} does not refer back to parent ${id}`);
        }
      }
    }
    const rootIds = [...byId].filter(([, layer]) => layer.parentPhotoshopId === null).map(([id]) => id);
    checkReachable(rootIds, byId, (layer) => Array.isArray(layer.childrenPhotoshopIds) ? layer.childrenPhotoshopIds.filter(Number.isSafeInteger) as number[] : [], "capture layer", issues);
    checkSiblingOrdering(
      byId,
      (layer) => layer.parentPhotoshopId === null || Number.isSafeInteger(layer.parentPhotoshopId) ? layer.parentPhotoshopId as number | null : undefined,
      null,
      (layer) => Array.isArray(layer.childrenPhotoshopIds) ? layer.childrenPhotoshopIds.filter(Number.isSafeInteger) as number[] : [],
      "capture layer",
      issues
    );
  }
  if (issues.length > 0) throw new SchemaValidationError(issues);
}

export function validateProjectState(value: unknown): asserts value is ProjectState {
  const issues: string[] = new ValidationIssues();
  if (!isRecord(value)) throw new SchemaValidationError(["state must be an object"]);
  checkAllowedKeys(value, "state", ["project", "document", "identities", "structure", "appearance", "text", "content"], issues);

  const project = value.project;
  const document = value.document;
  const identities = value.identities;
  const structure = value.structure;
  const appearance = value.appearance;
  const text = value.text;
  const content = value.content;

  checkVersion(project, "project", issues);
  checkVersion(document, "document", issues);
  checkVersion(identities, "identities", issues);
  checkVersion(structure, "structure", issues);
  if (!isRecord(appearance)) issues.push("appearance must be an object");
  if (!isRecord(text)) issues.push("text must be an object");
  if (!isRecord(content)) issues.push("content must be an object");

  if (isRecord(project)) {
    checkAllowedKeys(project, "project", ["schemaVersion", "projectId", "displayName", "createdWith"], issues);
    checkBoundedString(project.projectId, "project.projectId", issues, 500);
    checkBoundedString(project.displayName, "project.displayName", issues, 1_024);
    checkBoundedString(project.createdWith, "project.createdWith", issues, 200);
  }
  if (isRecord(document)) {
    checkAllowedKeys(document, "document", ["schemaVersion", "documentId", "name", "width", "height", "resolution", "mode", "bitDepth", "colorProfile", "compatibility", "warnings"], issues);
    checkBoundedString(document.documentId, "document.documentId", issues, 500);
    checkBoundedString(document.name, "document.name", issues, 1_024);
    checkPositive(document.width, "document.width", issues);
    checkPositive(document.height, "document.height", issues);
    checkPositive(document.resolution, "document.resolution", issues);
    checkBoundedString(document.mode, "document.mode", issues, 100);
    checkInteger(document.bitDepth, "document.bitDepth", issues, 1);
    checkNullableString(document.colorProfile, "document.colorProfile", issues, 1_024);
    if (!["supported", "limited"].includes(String(document.compatibility))) issues.push("document.compatibility must be supported or limited");
    checkStringArray(document.warnings, "document.warnings", issues, true);
  }

  const uuids = new Set<string>();
  const photoshopIds = new Set<number>();
  const layersByUuid = new Map<string, Record<string, unknown>>();
  if (isRecord(structure) && Array.isArray(structure.layers)) {
    checkAllowedKeys(structure, "structure", ["schemaVersion", "roots", "layers"], issues);
    if (structure.layers.length > MAX_CAPTURE_LAYERS) issues.push(`structure.layers must contain at most ${MAX_CAPTURE_LAYERS} layers`);
    for (const [index, layer] of structure.layers.slice(0, MAX_CAPTURE_LAYERS).entries()) {
      if (!isRecord(layer)) {
        issues.push(`structure.layers[${index}] must be an object`);
        continue;
      }
      checkAllowedKeys(layer, `structure.layers[${index}]`, ["uuid", "photoshopId", "parentUuid", "name", "kind", "order", "children"], issues);
      checkLayerUuid(layer.uuid, `structure.layers[${index}].uuid`, issues);
      if (isSafeLayerUuid(layer.uuid)) {
        if (uuids.has(layer.uuid)) issues.push(`duplicate layer UUID: ${layer.uuid}`);
        uuids.add(layer.uuid);
        layersByUuid.set(layer.uuid, layer);
      }
      checkInteger(layer.photoshopId, `structure.layers[${index}].photoshopId`, issues, 1);
      if (Number.isSafeInteger(layer.photoshopId) && (layer.photoshopId as number) > 0) {
        if (photoshopIds.has(layer.photoshopId as number)) issues.push(`duplicate Photoshop layer ID: ${String(layer.photoshopId)}`);
        photoshopIds.add(layer.photoshopId as number);
      }
      checkBoundedString(layer.name, `structure.layers[${index}].name`, issues, 1_024);
      checkBoundedString(layer.kind, `structure.layers[${index}].kind`, issues, 100);
      checkInteger(layer.order, `structure.layers[${index}].order`, issues, 0);
      if (layer.parentUuid !== null) checkLayerUuid(layer.parentUuid, `structure.layers[${index}].parentUuid`, issues);
      checkLayerUuidArray(layer.children, `structure.layers[${index}].children`, issues);
    }
  } else if (isRecord(structure)) {
    issues.push("structure.layers must be an array");
  }

  if (isRecord(structure)) {
    checkLayerUuidArray(structure.roots, "structure.roots", issues);
    const roots = Array.isArray(structure.roots) ? new Set(structure.roots.filter(isSafeLayerUuid)) : new Set<string>();
    for (const [uuid, layer] of layersByUuid) {
      const parentUuid = layer.parentUuid;
      if (parentUuid === null && !roots.has(uuid)) issues.push(`root layer ${uuid} is missing from structure.roots`);
      if (isSafeLayerUuid(parentUuid)) {
        const parent = layersByUuid.get(parentUuid);
        if (!parent) issues.push(`layer ${uuid} refers to unknown parent ${parentUuid}`);
        else if (!(parent.children as unknown[])?.includes(uuid)) issues.push(`layer ${uuid} is missing from parent ${parentUuid} children`);
      }
      if (Array.isArray(layer.children)) {
        for (const childUuid of layer.children.filter(isSafeLayerUuid)) {
          const child = layersByUuid.get(childUuid);
          if (!child) issues.push(`layer ${uuid} refers to unknown child ${childUuid}`);
          else if (child.parentUuid !== uuid) issues.push(`child ${childUuid} does not refer back to parent ${uuid}`);
        }
      }
    }
    for (const root of roots) {
      const layer = layersByUuid.get(root);
      if (!layer) issues.push(`structure.roots refers to unknown layer ${root}`);
      else if (layer.parentUuid !== null) issues.push(`structure.roots includes non-root layer ${root}`);
    }
    checkReachable([...roots], layersByUuid, (layer) => Array.isArray(layer.children) ? layer.children.filter(isSafeLayerUuid) : [], "layer", issues);
    checkSiblingOrdering(
      layersByUuid,
      (layer) => layer.parentUuid === null || isSafeLayerUuid(layer.parentUuid) ? layer.parentUuid as string | null : undefined,
      Array.isArray(structure.roots) ? structure.roots.filter(isSafeLayerUuid) : [],
      (layer) => Array.isArray(layer.children) ? layer.children.filter(isSafeLayerUuid) : [],
      "layer",
      issues
    );
  }

  const identityUuids = new Set<string>();
  const identityPhotoshopIds = new Set<number>();
  if (isRecord(identities) && Array.isArray(identities.records)) {
    checkAllowedKeys(identities, "identities", ["schemaVersion", "records"], issues);
    if (identities.records.length > MAX_CAPTURE_LAYERS) issues.push(`identities.records must contain at most ${MAX_CAPTURE_LAYERS} entries`);
    for (const [index, identity] of identities.records.slice(0, MAX_CAPTURE_LAYERS).entries()) {
      const path = `identities.records[${index}]`;
      if (!isRecord(identity)) {
        issues.push(`${path} must be an object`);
        continue;
      }
      checkAllowedKeys(identity, path, ["uuid", "photoshopId", "parentUuid", "signature", "confidence"], issues);
      checkLayerUuid(identity.uuid, `${path}.uuid`, issues);
      if (isSafeLayerUuid(identity.uuid)) {
        if (identityUuids.has(identity.uuid)) issues.push(`duplicate identity UUID: ${identity.uuid}`);
        identityUuids.add(identity.uuid);
        if (!uuids.has(identity.uuid)) issues.push(`${path}.uuid refers to an unknown layer`);
        const layer = layersByUuid.get(identity.uuid);
        if (layer && identity.photoshopId !== layer.photoshopId) issues.push(`${path}.photoshopId does not match its structure layer`);
        if (layer && identity.parentUuid !== layer.parentUuid) issues.push(`${path}.parentUuid does not match its structure layer`);
      }
      checkInteger(identity.photoshopId, `${path}.photoshopId`, issues, 1);
      if (Number.isSafeInteger(identity.photoshopId) && (identity.photoshopId as number) > 0) {
        if (identityPhotoshopIds.has(identity.photoshopId as number)) issues.push(`duplicate identity Photoshop ID: ${String(identity.photoshopId)}`);
        identityPhotoshopIds.add(identity.photoshopId as number);
      }
      if (identity.parentUuid !== null) checkLayerUuid(identity.parentUuid, `${path}.parentUuid`, issues);
      checkBoundedString(identity.signature, `${path}.signature`, issues, 10_000);
      if (!["exact", "confirmed", "uncertain"].includes(String(identity.confidence))) issues.push(`${path}.confidence is invalid`);
    }
    for (const uuid of uuids) if (!identityUuids.has(uuid)) issues.push(`layer ${uuid} is missing an identity record`);
  } else if (isRecord(identities)) {
    issues.push("identities.records must be an array");
  }

  for (const [domainName, domain] of [["appearance", appearance], ["text", text], ["content", content]] as const) {
    if (!isRecord(domain)) continue;
    if (Object.keys(domain).length > MAX_CAPTURE_LAYERS) issues.push(`${domainName} must contain at most ${MAX_CAPTURE_LAYERS} entries`);
    for (const [uuid, entry] of Object.entries(domain).slice(0, MAX_CAPTURE_LAYERS)) {
      checkLayerUuid(uuid, `${domainName} key`, issues);
      if (!uuids.has(uuid)) issues.push(`${domainName}.${uuid} refers to an unknown layer`);
      if (isRecord(entry) && entry.layerUuid !== uuid) issues.push(`${domainName}.${uuid}.layerUuid does not match its file key`);
      if (domainName === "appearance") checkAppearance(entry, `${domainName}.${uuid}`, issues, true);
      if (domainName === "text") checkText(entry, `${domainName}.${uuid}`, issues, true);
      if (domainName === "content") checkContent(entry, `${domainName}.${uuid}`, issues, true);
    }
  }
  if (isRecord(appearance)) for (const uuid of uuids) if (!Object.prototype.hasOwnProperty.call(appearance, uuid)) issues.push(`layer ${uuid} is missing appearance data`);
  if (isRecord(content)) for (const uuid of uuids) if (!Object.prototype.hasOwnProperty.call(content, uuid)) issues.push(`layer ${uuid} is missing content data`);

  if (issues.length > 0) throw new SchemaValidationError(issues);
}

export function migrateProjectState(value: unknown): ProjectState {
  validateProjectState(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkAllowedKeys(value: Record<string, unknown>, path: string, allowed: readonly string[], issues: string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) issues.push(`${path}.${key} is not a recognized field`);
}

function checkVersion(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (value.schemaVersion !== SCHEMA_VERSION) issues.push(`${path}.schemaVersion must be ${SCHEMA_VERSION}`);
}

function checkBoundedString(value: unknown, path: string, issues: string[], maximum: number, allowEmpty = false): void {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum || value.includes("\0")) {
    issues.push(`${path} must be ${allowEmpty ? "a" : "a non-empty"} string of at most ${maximum} characters without null bytes`);
  }
}

function checkNullableString(value: unknown, path: string, issues: string[], maximum: number): void {
  if (value !== null) checkBoundedString(value, path, issues, maximum, true);
}

function checkInteger(value: unknown, path: string, issues: string[], minimum?: number): void {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && (value as number) < minimum)) issues.push(`${path} must be a safe integer${minimum === undefined ? "" : ` greater than or equal to ${minimum}`}`);
}

function checkRange(value: unknown, path: string, issues: string[], minimum: number, maximum: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) issues.push(`${path} must be a number from ${minimum} to ${maximum}`);
}

function checkBoolean(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "boolean") issues.push(`${path} must be a boolean`);
}

function checkStringArray(value: unknown, path: string, issues: string[], allowEmptyStrings = false): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (value.length > 1_000) issues.push(`${path} must contain at most 1000 entries`);
  value.slice(0, 1_000).forEach((entry, index) => checkBoundedString(entry, `${path}[${index}]`, issues, 10_000, allowEmptyStrings));
}

function checkIntegerArray(value: unknown, path: string, issues: string[], unique = false): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (value.length > MAX_CAPTURE_LAYERS) issues.push(`${path} must contain at most ${MAX_CAPTURE_LAYERS} entries`);
  const seen = new Set<number>();
  value.slice(0, MAX_CAPTURE_LAYERS).forEach((entry, index) => {
    checkInteger(entry, `${path}[${index}]`, issues, 1);
    if (unique && Number.isSafeInteger(entry)) {
      if (seen.has(entry as number)) issues.push(`${path} contains duplicate layer ${String(entry)}`);
      seen.add(entry as number);
    }
  });
}

function checkLayerUuid(value: unknown, path: string, issues: string[]): void {
  if (!isSafeLayerUuid(value)) issues.push(`${path} must be a filename-safe layer UUID`);
}

function checkLayerUuidArray(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return;
  }
  if (value.length > MAX_CAPTURE_LAYERS) issues.push(`${path} must contain at most ${MAX_CAPTURE_LAYERS} entries`);
  const seen = new Set<string>();
  value.slice(0, MAX_CAPTURE_LAYERS).forEach((entry, index) => {
    checkLayerUuid(entry, `${path}[${index}]`, issues);
    if (isSafeLayerUuid(entry)) {
      if (seen.has(entry)) issues.push(`${path} contains duplicate layer ${entry}`);
      seen.add(entry);
    }
  });
}

function checkReachable<Key>(
  roots: Key[],
  nodes: Map<Key, Record<string, unknown>>,
  children: (node: Record<string, unknown>) => Key[],
  label: string,
  issues: string[]
): void {
  const visited = new Set<Key>();
  const pending = [...roots];
  while (pending.length) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    const node = nodes.get(key);
    if (!node) continue;
    visited.add(key);
    for (const child of children(node)) if (!visited.has(child)) pending.push(child);
  }
  for (const key of nodes.keys()) if (!visited.has(key)) issues.push(`${label} ${String(key)} is not reachable from a document root`);
}

function checkSiblingOrdering<Key>(
  nodes: Map<Key, Record<string, unknown>>,
  parentOf: (node: Record<string, unknown>) => Key | null | undefined,
  declaredRoots: Key[] | null,
  childrenOf: (node: Record<string, unknown>) => Key[],
  label: string,
  issues: string[]
): void {
  const groups = new Map<Key | null, Array<{ key: Key; order: number }>>();
  for (const [key, node] of nodes) {
    const parent = parentOf(node);
    if (parent === undefined || (parent !== null && !nodes.has(parent)) || !Number.isSafeInteger(node.order) || (node.order as number) < 0) continue;
    const siblings = groups.get(parent) ?? [];
    siblings.push({ key, order: node.order as number });
    groups.set(parent, siblings);
  }
  for (const [parent, siblings] of groups) {
    siblings.sort((left, right) => left.order - right.order);
    siblings.forEach((sibling, index) => {
      if (sibling.order !== index) issues.push(`${label} ${String(sibling.key)} has non-contiguous sibling order ${sibling.order}; expected ${index}`);
    });
    const declared = parent === null ? declaredRoots : childrenOf(nodes.get(parent)!);
    if (!declared) continue;
    const expected = siblings.map((sibling) => sibling.key);
    if (declared.length !== expected.length || declared.some((key, index) => key !== expected[index])) {
      issues.push(`${parent === null ? "document roots" : `${label} ${String(parent)} children`} must follow sibling order`);
    }
  }
}

function checkBounds(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  checkAllowedKeys(value, path, ["left", "top", "right", "bottom"], issues);
  for (const key of ["left", "top", "right", "bottom"] as const) if (typeof value[key] !== "number" || !Number.isFinite(value[key])) issues.push(`${path}.${key} must be a finite number`);
  if ([value.left, value.top, value.right, value.bottom].every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    if ((value.left as number) > (value.right as number)) issues.push(`${path}.left must not exceed right`);
    if ((value.top as number) > (value.bottom as number)) issues.push(`${path}.top must not exceed bottom`);
  }
}

function checkAppearance(value: unknown, path: string, issues: string[], versioned: boolean): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  checkAllowedKeys(value, path, versioned
    ? ["schemaVersion", "layerUuid", "visible", "opacity", "fillOpacity", "blendMode", "clipped", "locks", "bounds", "boundsWithoutEffects"]
    : ["visible", "opacity", "fillOpacity", "blendMode", "clipped", "locks", "bounds", "boundsWithoutEffects"], issues);
  if (versioned) {
    checkVersion(value, path, issues);
    checkLayerUuid(value.layerUuid, `${path}.layerUuid`, issues);
  }
  checkBoolean(value.visible, `${path}.visible`, issues);
  checkRange(value.opacity, `${path}.opacity`, issues, 0, 100);
  checkRange(value.fillOpacity, `${path}.fillOpacity`, issues, 0, 100);
  checkBoundedString(value.blendMode, `${path}.blendMode`, issues, 100);
  checkBoolean(value.clipped, `${path}.clipped`, issues);
  if (!isRecord(value.locks)) issues.push(`${path}.locks must be an object`);
  else {
    checkAllowedKeys(value.locks, `${path}.locks`, ["all", "pixels", "position", "transparentPixels"], issues);
    for (const key of ["all", "pixels", "position", "transparentPixels"] as const) checkBoolean(value.locks[key], `${path}.locks.${key}`, issues);
  }
  checkBounds(value.bounds, `${path}.bounds`, issues);
  checkBounds(value.boundsWithoutEffects, `${path}.boundsWithoutEffects`, issues);
}

function checkText(value: unknown, path: string, issues: string[], versioned: boolean): void {
  if (value === null && !versioned) return;
  if (!isRecord(value)) {
    issues.push(`${path} must be ${versioned ? "an object" : "an object or null"}`);
    return;
  }
  checkAllowedKeys(value, path, versioned ? ["schemaVersion", "layerUuid", "contents", "styleFingerprint"] : ["contents", "styleFingerprint"], issues);
  if (versioned) {
    checkVersion(value, path, issues);
    checkLayerUuid(value.layerUuid, `${path}.layerUuid`, issues);
  }
  checkBoundedString(value.contents, `${path}.contents`, issues, MAX_TEXT_LENGTH, true);
  checkNullableString(value.styleFingerprint, `${path}.styleFingerprint`, issues, 100_000);
}

function checkContent(value: unknown, path: string, issues: string[], versioned: boolean): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  checkAllowedKeys(value, path, versioned ? ["schemaVersion", "layerUuid", "fingerprint", "opaque", "reason"] : ["fingerprint", "opaque", "reason"], issues);
  if (versioned) {
    checkVersion(value, path, issues);
    checkLayerUuid(value.layerUuid, `${path}.layerUuid`, issues);
  }
  checkNullableString(value.fingerprint, `${path}.fingerprint`, issues, 10_000);
  checkBoolean(value.opaque, `${path}.opaque`, issues);
  checkNullableString(value.reason, `${path}.reason`, issues, 10_000);
}

function checkPositive(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) issues.push(`${path} must be a positive number`);
}
