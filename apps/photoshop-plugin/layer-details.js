// Host-independent. Turns one Photoshop layer descriptor into a flat map of
// named scalar facts: effects, masks, adjustment settings, smart filters, shape
// stroke and label. The differ compares these maps key by key, so an edit can
// be stated as "Drop shadow opacity changed from 35% to 50%" rather than
// "rendered appearance changed". Reading only: nothing here calls Photoshop.
(() => {
const MAX_DETAILS = 300;
const MAX_DEPTH = 8;
const MAX_LIST = 24;
const UNITS = { percentUnit: "%", pixelsUnit: " px", angleUnit: "°", pointsUnit: " pt", densityUnit: " ppi", distanceUnit: " pt", millimetersUnit: " mm", noneUnit: "" };
// Present on every effect and never an edit: whether the dialog lists the
// effect, and bookkeeping Photoshop rewrites on its own.
const IGNORED_KEYS = new Set(["present", "showInDialog", "_obj", "_target", "layerConceals", "ID", "documentID", "placed", "compsList", "nonLinear", "crop"]);

function round(value) { return Number(Number(value).toFixed(2)); }

function colorText(value) {
  const channel = (...names) => { for (const name of names) if (Number.isFinite(Number(value[name]))) return Number(value[name]); return null; };
  const red = channel("red"), green = channel("grain", "green"), blue = channel("blue");
  if (red === null || green === null || blue === null) return null;
  return `#${[red, green, blue].map(part => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function digest(value) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(value) || "") hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return `#digest:${hash.toString(16).padStart(8, "0")}`;
}

function segment(key) { return String(key).replace(/[^A-Za-z0-9]/g, "") || "value"; }

function extract(descriptor) {
  const details = {};
  let count = 0;
  const put = (key, value) => {
    if (count >= MAX_DETAILS || value === undefined || value === null) return;
    if (typeof value === "number") { if (!Number.isFinite(value)) return; value = round(value); }
    else if (typeof value === "string") value = value.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").slice(0, 200);
    else if (typeof value !== "boolean") return;
    details[key] = value; count += 1;
  };
  const flatten = (prefix, value, depth) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "object") return put(prefix, value);
    if ("_unit" in value && "_value" in value) return put(prefix, `${round(value._value)}${UNITS[value._unit] ?? ""}`);
    if ("_enum" in value && "_value" in value) return put(prefix, String(value._value));
    if ("_path" in value) return put(prefix, String(value._path).split(/[\\/]/).pop());
    const color = Array.isArray(value) ? null : colorText(value);
    if (color) return put(prefix, color);
    // Past the depth a key may have, or the length worth listing, the value is
    // still compared, as one digest: the edit is detected, just not itemised.
    if (depth >= MAX_DEPTH || (Array.isArray(value) && value.length > MAX_LIST)) return put(prefix, digest(value));
    if (Array.isArray(value)) return value.forEach((entry, index) => flatten(`${prefix}.${index}`, entry, depth + 1));
    for (const key of Object.keys(value).sort()) {
      if (IGNORED_KEYS.has(key)) continue;
      flatten(`${prefix}.${segment(key)}`, value[key], depth + 1);
    }
  };
  // Photoshop lists every effect a layer has ever been offered, switched off.
  // Only an effect that is on has settings worth comparing.
  const effect = (prefix, value) => {
    if (!value || typeof value !== "object") return;
    if (value.enabled === false) return put(`${prefix}.enabled`, false);
    flatten(prefix, value, 2);
  };
  const percentOf255 = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value) / 255 * 100)}%` : undefined;

  if (!descriptor || typeof descriptor !== "object") return details;
  flatten("label.color", descriptor.color, 2);

  const effects = descriptor.layerEffects;
  if (effects && typeof effects === "object") {
    put("effects.visible", descriptor.layerFXVisible !== false);
    flatten("effects.scale", effects.scale, 2);
    for (const name of Object.keys(effects).sort()) {
      if (name === "scale" || IGNORED_KEYS.has(name)) continue;
      const value = effects[name];
      // Several shadows or strokes arrive as "dropShadowMulti"; the single
      // "dropShadow" beside it repeats the first entry.
      if (Array.isArray(value)) value.forEach((entry, index) => effect(`effects.${segment(name.replace(/Multi$/, ""))}${index + 1}`, entry));
      else if (!Array.isArray(effects[`${name}Multi`])) effect(`effects.${segment(name)}`, value);
    }
  }

  put("mask.present", Boolean(descriptor.hasUserMask));
  if (descriptor.hasUserMask) {
    put("mask.enabled", descriptor.userMaskEnabled !== false);
    put("mask.linked", descriptor.userMaskLinked !== false);
    put("mask.density", percentOf255(descriptor.userMaskDensity));
    flatten("mask.feather", descriptor.userMaskFeather, 2);
  }
  put("vectorMask.present", Boolean(descriptor.hasVectorMask));
  if (descriptor.hasVectorMask) {
    put("vectorMask.enabled", descriptor.vectorMaskEnabled !== false);
    put("vectorMask.density", percentOf255(descriptor.vectorMaskDensity));
    flatten("vectorMask.feather", descriptor.vectorMaskFeather, 2);
  }
  if (descriptor.hasFilterMask) {
    put("filterMask.density", percentOf255(descriptor.filterMaskDensity));
    flatten("filterMask.feather", descriptor.filterMaskFeather, 2);
  }

  const adjustment = Array.isArray(descriptor.adjustment) ? descriptor.adjustment[0] : null;
  if (adjustment && typeof adjustment === "object") {
    put("adjustment.type", String(adjustment._obj || "unknown"));
    flatten("adjustment", adjustment, 1);
  }

  const smart = descriptor.smartObject;
  if (smart && typeof smart === "object") {
    put("smartObject.linked", Boolean(smart.linked));
    flatten("smartObject.fileReference", smart.fileReference, 2);
    const filters = Array.isArray(smart.filterFX) ? smart.filterFX : [];
    filters.slice(0, MAX_LIST).forEach((filter, index) => {
      const prefix = `smartFilters.filter${index + 1}`;
      put(`${prefix}.type`, String(filter?.filter?._obj || filter?.name || "filter"));
      put(`${prefix}.enabled`, filter?.enabled !== false);
      flatten(`${prefix}.blendMode`, filter?.blendOptions?.mode, 3);
      flatten(`${prefix}.opacity`, filter?.blendOptions?.opacity, 3);
      flatten(`${prefix}.settings`, filter?.filter, 3);
    });
  }
  const more = descriptor.smartObjectMore;
  if (more && typeof more === "object") {
    flatten("smartObject.size", more.size, 2);
    if (Array.isArray(more.transform)) put("smartObject.transform", more.transform.map(round).join(", "));
  }

  const stroke = descriptor.AGMStrokeStyleInfo;
  if (stroke && typeof stroke === "object") {
    flatten("stroke", stroke, 1);
    if (typeof descriptor.fillEnabled === "boolean") put("fill.enabled", descriptor.fillEnabled);
  }

  const ranges = descriptor.textKey?.textStyleRange;
  if (Array.isArray(ranges)) {
    put("text.styleRuns", ranges.length);
    // Formatting applied to part of the text lives only in these runs.
    if (ranges.length > 1) put("text.mixedFormatting", digest(ranges.map(range => [range.from, range.to, range.textStyle])));
  }
  return details;
}

if (typeof module !== "undefined") module.exports = { extract };
else window.PhotoGitLayerDetails = { extract };
})();
