import { validateProjectState, type AppearanceDomain, type Bounds, type LayerNode, type ProjectState } from "@photogit/schema";

export type ChangeDomain = "document" | "structure" | "appearance" | "text" | "content";
export type Mergeability = "automatic" | "manual" | "unsupported";

export type SemanticChange = {
  domain: ChangeDomain;
  category: "added" | "removed" | "modified" | "reordered" | "moved";
  layerUuid: string | null;
  photoshopId: number | null;
  layerName: string;
  // "text layer", "Curves adjustment layer": what the edited layer is.
  layerKind?: string;
  propertyPath: string;
  baseValue: unknown;
  currentValue: unknown;
  summary: string;
  mergeability: Mergeability;
  confidence: number;
  warnings: string[];
};

type LayerRef = { uuid: string; photoshopId: number; name: string; kind: string };

const CONTENT_WARNING = "Content changes require Photoshop artifact handling and cannot be merged as JSON alone.";
// A group of related settings (one layer effect, one mask) lists this many
// individual edits before the rest are counted in a single closing line.
const MAX_GROUP_EDITS = 5;

export function layerKindLabel(kind: string): string {
  return kindLabel(kind);
}

export function diffStates(base: ProjectState, current: ProjectState): SemanticChange[] {
  validateProjectState(base);
  validateProjectState(current);
  const documentChanges: SemanticChange[] = [];
  // Photoshop assigns a new ID and filename when opening a saved recovery copy.
  // Project binding validates identity; neither value is a visible design edit.
  diffDocument(base, current, documentChanges);

  const baseLayers = new Map(base.structure.layers.map((layer) => [layer.uuid, layer]));
  const currentLayers = new Map(current.structure.layers.map((layer) => [layer.uuid, layer]));
  const restacked = restackedLayers(base.structure.layers, current.structure.layers);
  const canvas = canvasChange(base, current);
  const converted = convertedLayers(base, current);
  const layerChanges: SemanticChange[] = [];

  // Layers are reported in the order of the layer stack, top to bottom, and a
  // layer's edits stay together: structure, then appearance, text and content.
  for (const after of current.structure.layers) {
    const before = baseLayers.get(after.uuid);
    const layer: LayerRef = { uuid: after.uuid, photoshopId: after.photoshopId, name: after.name, kind: after.kind };
    if (!before) {
      const source = converted.get(after.uuid);
      if (source) layerChanges.push(change("structure", "modified", layer, layer.name, "kind", source.kind, after.kind, `Converted from ${article(kindLabel(source.kind))} to ${article(kindLabel(after.kind))}`));
      else layerChanges.push(layerLifecycle("added", after));
      continue;
    }
    diffStructure(layer, before, after, baseLayers, currentLayers, current.structure.layers, restacked, layerChanges);
    // Text is compared first: retyping or restyling resizes the layer, and
    // that new size is the same edit, not another one.
    const textChanges: SemanticChange[] = [];
    const textChanged = diffText(layer, base.text[after.uuid], current.text[after.uuid], textChanges);
    // With effects captured by name, the area they cover is not a separate edit.
    const effectsNamed = Boolean(base.content[after.uuid]?.details && current.content[after.uuid]?.details);
    const geometryState = diffAppearance(layer, after.kind, base.appearance[after.uuid], current.appearance[after.uuid], canvas, textChanged, effectsNamed, layerChanges);
    layerChanges.push(...textChanges);
    diffContent(layer, after.kind, base.content[after.uuid], current.content[after.uuid], textChanged || geometryState === "canvas", geometryState !== "same", layerChanges);
  }
  const convertedSources = new Set([...converted.values()].map((layer) => layer.uuid));
  for (const before of base.structure.layers) if (!currentLayers.has(before.uuid) && !convertedSources.has(before.uuid)) layerChanges.push(layerLifecycle("removed", before));

  // The document composite is the fallback detector for what no layer field
  // records (a group mask, a group effect). When a layer edit already accounts
  // for a different picture, repeating that as a second edit is noise.
  const explained = layerChanges.some(changesThePicture) || documentChanges.some((change) => change.propertyPath !== "renderedFingerprint");
  return [...documentChanges.filter((change) => change.propertyPath !== "renderedFingerprint" || !explained), ...layerChanges];
}

type CanvasChange = { before: Bounds; after: Bounds; shiftX: number; shiftY: number } | null;

// Resizing the canvas shifts every layer's coordinates by the same amount and
// stretches the layers that fill it. Those follow from the one canvas edit.
function canvasChange(base: ProjectState, current: ProjectState): CanvasChange {
  if (same(base.document.width, current.document.width) && same(base.document.height, current.document.height)) return null;
  const shifts = new Map<string, { count: number; x: number; y: number }>();
  for (const layer of current.structure.layers) {
    const before = base.appearance[layer.uuid]?.boundsWithoutEffects;
    const after = current.appearance[layer.uuid]?.boundsWithoutEffects;
    if (!before || !after || layer.kind.includes("group")) continue;
    if (!same(before.right - before.left, after.right - after.left) || !same(before.bottom - before.top, after.bottom - after.top)) continue;
    const x = Number((after.left - before.left).toFixed(3));
    const y = Number((after.top - before.top).toFixed(3));
    const key = `${x},${y}`;
    shifts.set(key, { count: (shifts.get(key)?.count ?? 0) + 1, x, y });
  }
  const common = [...shifts.values()].sort((left, right) => right.count - left.count)[0];
  return {
    before: { left: 0, top: 0, right: base.document.width, bottom: base.document.height },
    after: { left: 0, top: 0, right: current.document.width, bottom: current.document.height },
    shiftX: common?.x ?? 0,
    shiftY: common?.y ?? 0
  };
}

// Converting a layer (to a smart object, or rasterizing it) makes Photoshop
// replace it with a new layer in the same place under the same name.
function convertedLayers(base: ProjectState, current: ProjectState): Map<string, LayerNode> {
  const currentUuids = new Set(current.structure.layers.map((layer) => layer.uuid));
  const baseUuids = new Set(base.structure.layers.map((layer) => layer.uuid));
  const removed = base.structure.layers.filter((layer) => !currentUuids.has(layer.uuid));
  const pairs = new Map<string, LayerNode>();
  const used = new Set<string>();
  for (const added of current.structure.layers) {
    if (baseUuids.has(added.uuid)) continue;
    const box = current.appearance[added.uuid]?.boundsWithoutEffects;
    const matches = removed.filter((layer) => !used.has(layer.uuid) && layer.name === added.name && layer.kind !== added.kind && layer.parentUuid === added.parentUuid
      && box !== undefined && base.appearance[layer.uuid] !== undefined && sameBounds(base.appearance[layer.uuid]!.boundsWithoutEffects, box));
    if (matches.length !== 1) continue;
    used.add(matches[0]!.uuid);
    pairs.set(added.uuid, matches[0]!);
  }
  return pairs;
}

function changesThePicture(change: SemanticChange): boolean {
  if (change.domain === "structure") return change.propertyPath !== "name";
  if (change.domain === "appearance") return !change.propertyPath.startsWith("locks.");
  return change.propertyPath !== "details.label.color";
}

function diffDocument(base: ProjectState, current: ProjectState, changes: SemanticChange[]): void {
  const before = base.document;
  const after = current.document;
  const push = (propertyPath: string, baseValue: unknown, currentValue: unknown, detail: string, unsupported = false): void => {
    changes.push(change("document", "modified", null, "Document", propertyPath, baseValue, currentValue, detail, unsupported, false));
  };
  if (!same(before.width, after.width)) push("width", before.width, after.width, `Canvas width changed from ${px(before.width)} to ${px(after.width)}`);
  if (!same(before.height, after.height)) push("height", before.height, after.height, `Canvas height changed from ${px(before.height)} to ${px(after.height)}`);
  if (!same(before.resolution, after.resolution)) push("resolution", before.resolution, after.resolution, `Resolution changed from ${num(before.resolution)} ppi to ${num(after.resolution)} ppi`);
  if (modeLabel(before.mode) !== modeLabel(after.mode)) push("mode", before.mode, after.mode, `Color mode changed from ${modeLabel(before.mode)} to ${modeLabel(after.mode)}`);
  if (!same(before.bitDepth, after.bitDepth)) push("bitDepth", before.bitDepth, after.bitDepth, `Bit depth changed from ${before.bitDepth}-bit to ${after.bitDepth}-bit`);
  if (!same(before.colorProfile, after.colorProfile)) push("colorProfile", before.colorProfile, after.colorProfile, `Color profile changed from ${quote(before.colorProfile ?? "none")} to ${quote(after.colorProfile ?? "none")}`);
  // A legacy baseline or an unsupported scan has no comparable composite.
  // The helper reports that coverage gap; it is not evidence of a design edit.
  const oldRender = before.renderedFingerprint;
  const newRender = after.renderedFingerprint;
  if (typeof oldRender === "string" && typeof newRender === "string" && !samePixels(oldRender, newRender)) {
    push("renderedFingerprint", oldRender, newRender, "The artwork looks different, but no tracked layer setting changed. A group mask, group effect or another setting PhotoGit does not read was edited", true);
  }
}

function diffStructure(
  layer: LayerRef,
  before: LayerNode,
  after: LayerNode,
  baseLayers: Map<string, LayerNode>,
  currentLayers: Map<string, LayerNode>,
  currentOrder: LayerNode[],
  restacked: Set<string>,
  changes: SemanticChange[]
): void {
  if (before.name !== after.name) {
    changes.push(change("structure", "modified", layer, layer.name, "name", before.name, after.name, `Renamed from ${quote(before.name)} to ${quote(after.name)}`));
  }
  if (before.kind !== after.kind) {
    changes.push(change("structure", "modified", layer, layer.name, "kind", before.kind, after.kind, `Converted from ${article(kindLabel(before.kind))} to ${article(kindLabel(after.kind))}`));
  }
  if (before.parentUuid !== after.parentUuid) {
    const from = before.parentUuid ? baseLayers.get(before.parentUuid)?.name ?? null : null;
    const to = after.parentUuid ? currentLayers.get(after.parentUuid)?.name ?? null : null;
    const detail = from !== null && to !== null ? `Moved from group ${quote(from)} to group ${quote(to)}`
      : to !== null ? `Moved into group ${quote(to)}`
      : `Moved out of group ${quote(from ?? "unknown")} to the top level`;
    changes.push(change("structure", "moved", layer, layer.name, "parentUuid", before.parentUuid, after.parentUuid, detail));
    return;
  }
  if (!restacked.has(after.uuid)) return;
  const siblings = currentOrder.filter((candidate) => candidate.parentUuid === after.parentUuid).sort((left, right) => left.order - right.order);
  const index = siblings.findIndex((candidate) => candidate.uuid === after.uuid);
  const below = siblings[index + 1];
  const above = siblings[index - 1];
  const where = index === 0 ? "now at the top" : below ? `now above ${quote(below.name)}` : above ? `now below ${quote(above.name)}` : "position changed";
  const direction = after.order < before.order ? "Moved up" : after.order > before.order ? "Moved down" : "Moved";
  changes.push(change("structure", "reordered", layer, layer.name, "order", before.order, after.order, `${direction} in the layer stack, ${where}`));
}

// Adding or moving one layer shifts the index of every sibling after it. Only
// the layers that left their place relative to the others were reordered: the
// ones outside the longest run that kept its order.
function restackedLayers(before: LayerNode[], after: LayerNode[]): Set<string> {
  const beforeByUuid = new Map(before.map((layer) => [layer.uuid, layer]));
  const groups = new Map<string | null, LayerNode[]>();
  for (const layer of after) {
    const previous = beforeByUuid.get(layer.uuid);
    if (!previous || previous.parentUuid !== layer.parentUuid) continue;
    const siblings = groups.get(layer.parentUuid) ?? [];
    siblings.push(layer);
    groups.set(layer.parentUuid, siblings);
  }
  const moved = new Set<string>();
  for (const siblings of groups.values()) {
    siblings.sort((left, right) => left.order - right.order);
    const previousOrder = siblings.map((layer) => beforeByUuid.get(layer.uuid)!.order);
    const kept = longestIncreasingRun(previousOrder);
    siblings.forEach((layer, index) => { if (!kept.has(index)) moved.add(layer.uuid); });
  }
  return moved;
}

function longestIncreasingRun(values: number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < values[index]!) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const kept = new Set<number>();
  for (let index = tails.length ? tails[tails.length - 1]! : -1; index >= 0; index = previous[index]!) kept.add(index);
  return kept;
}

// "canvas" means the layer only followed a canvas resize: nothing about the
// layer itself was edited, so its re-rendered pixels are not an edit either.
function diffAppearance(layer: LayerRef, kind: string, before: AppearanceDomain | undefined, after: AppearanceDomain | undefined, canvas: CanvasChange, textChanged: boolean, effectsNamed: boolean, changes: SemanticChange[]): "same" | "changed" | "canvas" {
  if (!before || !after) return "same";
  const push = (propertyPath: string, baseValue: unknown, currentValue: unknown, detail: string): void => {
    changes.push(change("appearance", "modified", layer, layer.name, propertyPath, baseValue, currentValue, detail));
  };
  if (before.visible !== after.visible) push("visible", before.visible, after.visible, after.visible ? "Shown (was hidden)" : "Hidden (was visible)");
  if (!same(before.opacity, after.opacity)) push("opacity", before.opacity, after.opacity, `Opacity changed ${percentRange(before.opacity, after.opacity)}`);
  if (!same(before.fillOpacity, after.fillOpacity)) push("fillOpacity", before.fillOpacity, after.fillOpacity, `Fill changed ${percentRange(before.fillOpacity, after.fillOpacity)}`);
  if (before.blendMode !== after.blendMode) push("blendMode", before.blendMode, after.blendMode, `Blend mode changed from ${blendLabel(before.blendMode)} to ${blendLabel(after.blendMode)}`);
  if (before.clipped !== after.clipped) push("clipped", before.clipped, after.clipped, after.clipped ? "Clipped to the layer below" : "Released from its clipping mask");
  for (const [key, locked, unlocked] of [["all", "Fully locked", "Fully unlocked"], ["pixels", "Image pixels locked", "Image pixels unlocked"], ["position", "Position locked", "Position unlocked"], ["transparentPixels", "Transparent pixels locked", "Transparent pixels unlocked"]] as const) {
    if (before.locks[key] !== after.locks[key]) push(`locks.${key}`, before.locks[key], after.locks[key], after.locks[key] ? locked : unlocked);
  }
  // A group's bounds are the union of its children, which report themselves.
  const oldBox = before.boundsWithoutEffects;
  const newBox = after.boundsWithoutEffects;
  if (sameBounds(oldBox, newBox)) {
    if (!kind.includes("group") && !effectsNamed && !sameBounds(before.bounds, after.bounds)) push("bounds", before.bounds, after.bounds, `Layer effects now cover ${boxSize(after.bounds)} (was ${boxSize(before.bounds)})`);
    return "same";
  }
  if (kind.includes("group")) return "changed";
  const sameSize = same(oldBox.right - oldBox.left, newBox.right - newBox.left) && same(oldBox.bottom - oldBox.top, newBox.bottom - newBox.top);
  if (canvas) {
    if (sameSize && same(newBox.left - oldBox.left, canvas.shiftX) && same(newBox.top - oldBox.top, canvas.shiftY)) return "canvas";
    if (sameBounds(oldBox, canvas.before) && sameBounds(newBox, canvas.after)) return "canvas";
  }
  if (textChanged && !sameSize) return "changed";
  push("bounds", oldBox, newBox, geometry(oldBox, newBox));
  return "changed";
}

function geometry(before: Bounds, after: Bounds): string {
  const oldWidth = before.right - before.left;
  const oldHeight = before.bottom - before.top;
  const width = after.right - after.left;
  const height = after.bottom - after.top;
  if (width <= 0 || height <= 0) return `Emptied (was ${size2d(oldWidth, oldHeight)})`;
  if (oldWidth <= 0 || oldHeight <= 0) return `Now covers ${size2d(width, height)} at x ${num(after.left)}, y ${num(after.top)} (was empty)`;
  if (same(oldWidth, width) && same(oldHeight, height)) {
    const horizontal = after.left - before.left;
    const vertical = after.top - before.top;
    const parts = [
      same(horizontal, 0) ? "" : `${px(Math.abs(horizontal))} ${horizontal > 0 ? "right" : "left"}`,
      same(vertical, 0) ? "" : `${px(Math.abs(vertical))} ${vertical > 0 ? "down" : "up"}`
    ].filter(Boolean);
    return `Moved ${parts.join(" and ")}`;
  }
  return `Size changed from ${size2d(oldWidth, oldHeight)} to ${size2d(width, height)}, now at x ${num(after.left)}, y ${num(after.top)}`;
}

function diffText(layer: LayerRef, before: ProjectState["text"][string] | undefined, after: ProjectState["text"][string] | undefined, changes: SemanticChange[]): boolean {
  if (!before || !after) return false;
  const start = changes.length;
  const push = (propertyPath: string, baseValue: unknown, currentValue: unknown, detail: string): void => {
    changes.push(change("text", "modified", layer, layer.name, propertyPath, baseValue, currentValue, detail));
  };
  if (before.contents !== after.contents) push("contents", before.contents, after.contents, `Text changed from ${quote(before.contents)} to ${quote(after.contents)}`);
  if (before.styleFingerprint !== after.styleFingerprint) {
    const oldStyle = parseStyle(before.styleFingerprint);
    const newStyle = parseStyle(after.styleFingerprint);
    const edits: Array<[string, unknown, unknown, string]> = [];
    let unread = false;
    if (oldStyle && newStyle) {
      for (const section of ["character", "paragraph", "warp"]) {
        const oldSection = isRecord(oldStyle[section]) ? oldStyle[section] : {};
        const newSection = isRecord(newStyle[section]) ? newStyle[section] : {};
        for (const key of [...new Set([...Object.keys(oldSection), ...Object.keys(newSection)])].sort()) {
          if (same(oldSection[key], newSection[key])) continue;
          // Photoshop answers "unknown" for a setting it cannot read at that
          // moment (mixed formatting, an older capture). That is not an edit.
          if (oldSection[key] == null || newSection[key] == null) { unread = true; continue; }
          const label = TEXT_STYLE_LABELS[`${section}.${key}`] ?? sentence(`${section === "warp" ? "warp " : ""}${words(key)}`);
          edits.push([`style.${section}.${key}`, oldSection[key], newSection[key], `${label} changed from ${styleValue(oldSection[key])} to ${styleValue(newSection[key])}`]);
        }
      }
    }
    if (edits.length) for (const edit of edits) push(...edit);
    else if (!unread) push("styleFingerprint", before.styleFingerprint, after.styleFingerprint, "Text styling changed");
  }
  return changes.length > start;
}

const TEXT_STYLE_LABELS: Record<string, string> = {
  "character.font": "Font", "character.fontStyle": "Font style", "character.size": "Font size", "character.color": "Text color",
  "character.tracking": "Tracking", "character.leading": "Leading", "character.baselineShift": "Baseline shift",
  "character.horizontalScale": "Horizontal scale", "character.verticalScale": "Vertical scale", "character.antiAlias": "Anti-aliasing",
  "character.capitalization": "Capitalization", "character.underline": "Underline", "character.strikeThrough": "Strikethrough", "character.ligatures": "Ligatures",
  "paragraph.alignment": "Alignment", "paragraph.direction": "Text direction", "paragraph.firstLineIndent": "First-line indent",
  "paragraph.leftIndent": "Left indent", "paragraph.rightIndent": "Right indent", "paragraph.spaceBefore": "Space before paragraph",
  "paragraph.spaceAfter": "Space after paragraph", "paragraph.hyphenation": "Hyphenation",
  "warp.style": "Warp style", "warp.bend": "Warp bend", "warp.horizontalDistortion": "Warp horizontal distortion", "warp.verticalDistortion": "Warp vertical distortion"
};

function parseStyle(value: string | null): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function styleValue(value: unknown): string {
  if (value === undefined || value === null) return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return num(value);
  if (isRecord(value)) {
    if (["red", "green", "blue"].every((channel) => typeof value[channel] === "number")) return hex(value.red as number, value.green as number, value.blue as number);
    return safeInline(Object.entries(value).map(([key, entry]) => `${key} ${typeof entry === "number" ? num(entry) : String(entry)}`).join(", "), 120);
  }
  return quote(String(value));
}

function diffContent(layer: LayerRef, kind: string, before: ProjectState["content"][string] | undefined, after: ProjectState["content"][string] | undefined, textChanged: boolean, moved: boolean, changes: SemanticChange[]): void {
  if (!before || !after) return;
  const push = (propertyPath: string, baseValue: unknown, currentValue: unknown, detail: string): void => {
    changes.push(change("content", "modified", layer, layer.name, propertyPath, baseValue, currentValue, detail, true));
  };
  const oldPrint = before.fingerprint;
  const newPrint = after.fingerprint;
  // Full-resolution hashes compare new checkpoints. Legacy checkpoints can
  // only compare the retained thumbnail; upgrading alone is not an edit.
  // A text layer whose text or style changed renders differently by
  // definition, so that is not listed as a second edit.
  if (oldPrint !== newPrint && !(typeof oldPrint === "string" && typeof newPrint === "string" && samePixels(oldPrint, newPrint)) && !textChanged) {
    push("fingerprint", oldPrint, newPrint, oldPrint == null || newPrint == null ? "Rendered appearance fingerprint availability changed" : pixelSummary(kind));
  }
  // Versions saved before details were captured have nothing to compare.
  if (!before.details || !after.details) return;
  const groups = new Map<string, string[]>();
  for (const key of [...new Set([...Object.keys(before.details), ...Object.keys(after.details)])].sort()) {
    if (same(before.details[key], after.details[key])) continue;
    // A mask is read in document coordinates and travels with its layer, so
    // after a move its pixels differ without anyone having painted on it.
    if (moved && key.endsWith(".pixels")) continue;
    const group = detailGroup(key);
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }
  const toggled = [...groups.keys()].some((group) => group.startsWith("effects."));
  for (const [group, keys] of groups) {
    // An adjustment layer is named for its adjustment, so "Brightness changed"
    // says everything "Brightness/Contrast brightness changed" would.
    const type = after.details[`${group}.type`] ?? before.details[`${group}.type`];
    const label = group === "adjustment" && typeof type === "string" && !/Layer$/.test(type) ? "" : detailGroupLabel(group, type);
    const had = Object.keys(before.details).some((key) => detailGroup(key) === group);
    const has = Object.keys(after.details).some((key) => detailGroup(key) === group);
    // The container only says whether effects are shown at all; each effect
    // reports itself, and a smart filter brings its own mask along.
    if (group === "effects" && (toggled || !had || !has)) continue;
    if (group === "filterMask" && (!had || !has)) continue;
    // An effect or smart filter that is switched off is kept in the layer; a
    // mask that is switched off is still a mask, with settings of its own.
    const switchable = group.includes(".");
    const wasOn = had && before.details[`${group}.present`] !== false && !(switchable && before.details[`${group}.enabled`] === false);
    const isOn = has && after.details[`${group}.present`] !== false && !(switchable && after.details[`${group}.enabled`] === false);
    if (!wasOn && !isOn) continue;
    if (!wasOn && isOn) {
      const type = after.details[`${group}.type`];
      const detail = switchable && had ? `${label} turned on` : `${label} added${typeof type === "string" && group !== "adjustment" ? ` (${words(type)})` : ""}`;
      push(`details.${group}`, had ? pick(before.details, group) : null, pick(after.details, group), detail);
      continue;
    }
    if (wasOn && !isOn && (switchable || !has || after.details[`${group}.present`] === false)) {
      push(`details.${group}`, pick(before.details, group), has ? pick(after.details, group) : null, switchable && has ? `${label} turned off` : `${label} removed`);
      continue;
    }
    let listed = 0;
    for (const key of keys) {
      if (key === `${group}.type`) continue;
      if (listed === MAX_GROUP_EDITS && keys.length > MAX_GROUP_EDITS + 1) {
        push(`details.${group}`, null, null, `${label || "Adjustment"}: ${keys.length - listed} more settings changed`);
        break;
      }
      listed += 1;
      push(`details.${key}`, before.details[key], after.details[key], detailSummary(label, key.slice(group.length + 1), before.details[key], after.details[key]));
    }
  }
}

function pixelSummary(kind: string): string {
  if (kind.includes("text")) return "Rendered text changed in a way the tracked text settings do not explain, such as mixed formatting";
  if (kind.includes("smartobject")) return "Smart object contents changed";
  if (kind.includes("group")) return "Rendered appearance changed";
  if (kind === "pixel" || kind === "normal") return "Pixels changed (painted, erased, filled, transformed or filtered)";
  if (kind.includes("solid") || kind.includes("gradient") || kind.includes("pattern") || kind.includes("shape")) return "Fill or shape changed";
  return "Rendered appearance changed";
}

// "effects.dropShadow.opacity" belongs to the drop shadow, "mask.density" to
// the layer mask: effects and smart filters are grouped one level deeper.
function detailGroup(key: string): string {
  const parts = key.split(".");
  return (parts[0] === "effects" || parts[0] === "smartFilters") && parts.length > 2 ? `${parts[0]}.${parts[1]}` : parts[0]!;
}

const DETAIL_GROUP_LABELS: Record<string, string> = {
  effects: "Layer effects", mask: "Layer mask", vectorMask: "Vector mask", filterMask: "Smart filter mask", adjustment: "Adjustment",
  smartObject: "Smart object", smartFilters: "Smart filters", stroke: "Shape stroke", fill: "Shape fill", label: "Label", text: "Text",
  dropShadow: "Drop shadow", innerShadow: "Inner shadow", outerGlow: "Outer glow", innerGlow: "Inner glow", bevelEmboss: "Bevel & emboss",
  chromeFX: "Satin", solidFill: "Color overlay", gradientFill: "Gradient overlay", patternFill: "Pattern overlay", frameFX: "Stroke effect"
};

const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  brightnessEvent: "Brightness/Contrast", levels: "Levels", curves: "Curves", exposure: "Exposure", vibrance: "Vibrance", hueSaturation: "Hue/Saturation",
  colorBalance: "Color Balance", blackAndWhite: "Black & White", photoFilter: "Photo Filter", channelMixer: "Channel Mixer", colorLookup: "Color Lookup",
  invert: "Invert", posterization: "Posterize", thresholdClassEvent: "Threshold", gradientMapClass: "Gradient Map", selectiveColor: "Selective Color",
  solidColorLayer: "Fill", gradientLayer: "Gradient fill", patternLayer: "Pattern fill"
};

function detailGroupLabel(group: string, type?: unknown): string {
  const [section, name] = group.split(".");
  if (section === "adjustment" && typeof type === "string" && ADJUSTMENT_TYPE_LABELS[type]) return ADJUSTMENT_TYPE_LABELS[type];
  if (!name) return DETAIL_GROUP_LABELS[section!] ?? sentence(words(section!));
  if (section === "smartFilters") return `Smart filter ${name.replace(/^\D+/, "") || name}`;
  const match = /^(.*?)(\d+)?$/.exec(name)!;
  const label = DETAIL_GROUP_LABELS[match[1]!] ?? sentence(words(match[1]!));
  return match[2] && match[2] !== "1" ? `${label} ${match[2]}` : label;
}

const DETAIL_PROPERTY_LABELS: Record<string, string> = {
  chokeMatte: "spread", blur: "size", localLightingAngle: "angle", useGlobalAngle: "use global light", mode: "blend mode",
  linked: "link to layer", fileReference: "source file", userMaskDensity: "density", center: "contrast"
};

function detailSummary(group: string, property: string, before: unknown, after: unknown): string {
  if (property === "enabled" && typeof after === "boolean") return `${group} turned ${after ? "on" : "off"}`;
  if (property === "visible" && typeof after === "boolean") return `${group} ${after ? "shown" : "hidden"}`;
  if (property === "pixels") return `${group} was repainted`;
  const setting = property.split(".").map((part) => DETAIL_PROPERTY_LABELS[part] ?? (/^\d+$/.test(part) ? `#${Number(part) + 1}` : words(part))).join(" ");
  const name = group ? `${group} ${setting}` : sentence(setting);
  if (typeof before === "string" && before.startsWith("#digest:") || typeof after === "string" && after.startsWith("#digest:")) return `${name} changed`;
  if (before === undefined) return `${name} set to ${detailValue(after)}`;
  if (after === undefined) return `${name} cleared (was ${detailValue(before)})`;
  return `${name} changed from ${detailValue(before)} to ${detailValue(after)}`;
}

function detailValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return num(value);
  return safeInline(String(value), 120);
}

function pick(details: Record<string, unknown>, group: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => detailGroup(key) === group));
}

function change(
  domain: ChangeDomain,
  category: SemanticChange["category"],
  layer: LayerRef | null,
  label: string,
  propertyPath: string,
  baseValue: unknown,
  currentValue: unknown,
  detail: string,
  unsupported = false,
  prefixed = true
): SemanticChange {
  return {
    domain,
    category,
    layerUuid: layer?.uuid ?? null,
    photoshopId: layer?.photoshopId ?? null,
    layerName: safeInline(label, 1_024) || "Unnamed layer",
    ...(layer ? { layerKind: kindLabel(layer.kind) } : {}),
    propertyPath,
    baseValue,
    currentValue,
    summary: prefixed ? `${safeInline(label, 120)}: ${safeInline(detail, 600)}` : safeInline(detail, 600),
    mergeability: unsupported ? "unsupported" : "automatic",
    confidence: unsupported ? 0.75 : 1,
    warnings: unsupported ? [CONTENT_WARNING] : []
  };
}

function layerLifecycle(category: "added" | "removed", layer: LayerNode): SemanticChange {
  return {
    domain: "structure",
    category,
    layerUuid: layer.uuid,
    photoshopId: layer.photoshopId,
    layerName: safeInline(layer.name, 1_024) || "Unnamed layer",
    layerKind: kindLabel(layer.kind),
    propertyPath: "layer",
    baseValue: category === "removed" ? layer : null,
    currentValue: category === "added" ? layer : null,
    summary: `${category === "added" ? "Added" : "Deleted"} ${kindLabel(layer.kind)} ${quote(layer.name)}`,
    mergeability: "automatic",
    confidence: 1,
    warnings: []
  };
}

const KIND_LABELS: Record<string, string> = {
  pixel: "pixel layer", normal: "pixel layer", text: "text layer", group: "group", smartobject: "smart object",
  solidcolor: "solid color fill layer", solidfill: "solid color fill layer", gradientfill: "gradient fill layer", gradient: "gradient fill layer",
  patternfill: "pattern fill layer", pattern: "pattern fill layer", shape: "shape layer", video: "video layer", layer3d: "3D layer"
};
const ADJUSTMENT_LABELS: Record<string, string> = {
  levels: "Levels", curves: "Curves", colorbalance: "Color Balance", brightnesscontrast: "Brightness/Contrast", huesaturation: "Hue/Saturation",
  selectivecolor: "Selective Color", channelmixer: "Channel Mixer", gradientmap: "Gradient Map", inversion: "Invert", threshold: "Threshold",
  posterize: "Posterize", photofilter: "Photo Filter", exposure: "Exposure", blackandwhite: "Black & White", vibrance: "Vibrance", colorlookup: "Color Lookup"
};

function kindLabel(kind: string): string {
  const key = kind.toLowerCase();
  if (KIND_LABELS[key]) return KIND_LABELS[key];
  if (ADJUSTMENT_LABELS[key]) return `${ADJUSTMENT_LABELS[key]} adjustment layer`;
  return `${safeInline(words(kind), 60)} layer`;
}

const BLEND_LABELS: Record<string, string> = {
  passthrough: "Pass Through", colorburn: "Color Burn", linearburn: "Linear Burn", darkercolor: "Darker Color", colordodge: "Color Dodge",
  lineardodge: "Linear Dodge (Add)", lightercolor: "Lighter Color", softlight: "Soft Light", hardlight: "Hard Light", vividlight: "Vivid Light",
  linearlight: "Linear Light", pinlight: "Pin Light", hardmix: "Hard Mix"
};

function blendLabel(mode: string): string {
  return BLEND_LABELS[mode.toLowerCase()] ?? sentence(safeInline(words(mode), 60));
}

const MODE_LABELS: Record<string, string> = { rgb: "RGB", cmyk: "CMYK", lab: "Lab", grayscale: "Grayscale", bitmap: "Bitmap", indexedcolor: "Indexed Color", multichannel: "Multichannel", duotone: "Duotone" };

// Photoshop says "rgbColorMode" where a fixture or an older capture says "rgb".
function modeLabel(mode: string): string {
  const key = mode.toLowerCase().replace(/(?:color)?mode$/, "");
  return MODE_LABELS[key] ?? sentence(safeInline(words(mode), 60));
}

function article(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

// Photoshop stores opacity in 255 steps, so two different values can round to
// the same whole percent. Precision is added only until the two read apart.
function percentRange(before: number, after: number): string {
  for (const digits of [0, 1, 2, 3]) {
    const left = trim(before, digits);
    const right = trim(after, digits);
    if (left !== right) return `from ${left}% to ${right}%`;
  }
  return "by less than 0.001%";
}

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

function num(value: number): string {
  return trim(value, 2);
}

function px(value: number): string {
  return `${num(value)} px`;
}

function size2d(width: number, height: number): string {
  return `${num(width)} × ${num(height)} px`;
}

function boxSize(box: Bounds): string {
  return size2d(box.right - box.left, box.bottom - box.top);
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function words(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ").toLowerCase();
}

function sentence(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function quote(value: string): string {
  return `“${safeInline(value, 120)}”`;
}

type Fingerprint = { sample: string; full: string | null; relative: string | null };

function parseFingerprint(value: string): Fingerprint {
  const [sample, ...parts] = value.split("|");
  const part = (prefix: string): string | null => parts.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) || null;
  return { sample: sample!, full: part("full-v2:"), relative: part("rel-v1:") };
}

// The position-independent hash compares what the layer contains wherever it
// sits, so a move is not also reported as a pixel edit. Older checkpoints fall
// back to the absolute full-resolution hash, then to the thumbnail sample.
function samePixels(before: string, after: string): boolean {
  const left = parseFingerprint(before);
  const right = parseFingerprint(after);
  if (left.relative && right.relative) return left.relative === right.relative;
  if (left.full && right.full) return left.full === right.full;
  return left.sample === right.sample;
}

function sameBounds(left: Bounds, right: Bounds): boolean {
  return same(left.left, right.left) && same(left.top, right.top) && same(left.right, right.right) && same(left.bottom, right.bottom);
}

function safeInline(value: string, maximum: number): string {
  const sanitized = value.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized.length <= maximum ? sanitized : `${sanitized.slice(0, maximum - 1)}…`;
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  // Match serializer canonicalize(): HEAD stores six decimals, whereas UXP
  // reports values such as 161 / 255 * 100 at full floating-point precision.
  if (typeof left === "number" && typeof right === "number") return Number(left.toFixed(6)) === Number(right.toFixed(6));
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
