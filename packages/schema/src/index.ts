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
  constructor(public readonly issues: string[]) {
    super(`Invalid PhotoGit state:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "SchemaValidationError";
  }
}

export function validateProjectState(value: unknown): asserts value is ProjectState {
  const issues: string[] = [];
  if (!isRecord(value)) throw new SchemaValidationError(["state must be an object"]);

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
    checkString(project.projectId, "project.projectId", issues);
    checkString(project.displayName, "project.displayName", issues);
  }
  if (isRecord(document)) {
    checkString(document.documentId, "document.documentId", issues);
    checkString(document.name, "document.name", issues);
    checkPositive(document.width, "document.width", issues);
    checkPositive(document.height, "document.height", issues);
    checkPositive(document.resolution, "document.resolution", issues);
  }

  const uuids = new Set<string>();
  if (isRecord(structure) && Array.isArray(structure.layers)) {
    for (const [index, layer] of structure.layers.entries()) {
      if (!isRecord(layer)) {
        issues.push(`structure.layers[${index}] must be an object`);
        continue;
      }
      checkString(layer.uuid, `structure.layers[${index}].uuid`, issues);
      if (typeof layer.uuid === "string") {
        if (uuids.has(layer.uuid)) issues.push(`duplicate layer UUID: ${layer.uuid}`);
        uuids.add(layer.uuid);
      }
      if (!Number.isInteger(layer.photoshopId)) issues.push(`structure.layers[${index}].photoshopId must be an integer`);
      checkString(layer.name, `structure.layers[${index}].name`, issues);
      if (!Array.isArray(layer.children)) issues.push(`structure.layers[${index}].children must be an array`);
    }
  } else if (isRecord(structure)) {
    issues.push("structure.layers must be an array");
  }

  for (const [domainName, domain] of [["appearance", appearance], ["text", text], ["content", content]] as const) {
    if (!isRecord(domain)) continue;
    for (const [uuid, entry] of Object.entries(domain)) {
      checkVersion(entry, `${domainName}.${uuid}`, issues);
      if (!uuids.has(uuid)) issues.push(`${domainName}.${uuid} refers to an unknown layer`);
      if (isRecord(entry) && entry.layerUuid !== uuid) issues.push(`${domainName}.${uuid}.layerUuid does not match its file key`);
    }
  }

  if (issues.length > 0) throw new SchemaValidationError(issues);
}

export function migrateProjectState(value: unknown): ProjectState {
  validateProjectState(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkVersion(value: unknown, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (value.schemaVersion !== SCHEMA_VERSION) issues.push(`${path}.schemaVersion must be ${SCHEMA_VERSION}`);
}

function checkString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string" || value.length === 0) issues.push(`${path} must be a non-empty string`);
}

function checkPositive(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) issues.push(`${path} must be a positive number`);
}
