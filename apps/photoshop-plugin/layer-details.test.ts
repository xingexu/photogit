import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { extract } = require("./layer-details.js");
const unit = (unit: string, value: number) => ({ _unit: unit, _value: value });
const shadow = (enabled: boolean, opacity = 35) => ({
  _obj: "dropShadow", enabled, present: true, showInDialog: true, mode: { _enum: "blendMode", _value: "multiply" },
  color: { _obj: "RGBColor", red: 0, grain: 127.5, blue: 255 }, opacity: unit("percentUnit", opacity), distance: unit("pixelsUnit", 8.004),
  localLightingAngle: unit("angleUnit", 120), transferSpec: { _obj: "shapeCurveType", name: "Linear" }
});

describe("layer details", () => {
  it("names an enabled effect's settings with their units and colour, and leaves bookkeeping out", () => {
    const details = extract({ color: { _enum: "color", _value: "red" }, layerFXVisible: true, layerEffects: { scale: unit("percentUnit", 100), dropShadow: shadow(true) } });
    expect(details).toMatchObject({
      "label.color": "red", "effects.visible": true, "effects.scale": "100%", "effects.dropShadow.enabled": true, "effects.dropShadow.opacity": "35%",
      "effects.dropShadow.distance": "8 px", "effects.dropShadow.localLightingAngle": "120°", "effects.dropShadow.mode": "multiply",
      "effects.dropShadow.color": "#0080FF", "effects.dropShadow.transferSpec.name": "Linear"
    });
    expect(Object.keys(details).some(key => key.startsWith("effects.") && /present|showInDialog|_obj/.test(key))).toBe(false);
  });

  it("records a switched-off effect only as switched off", () => {
    const details = extract({ layerEffects: { dropShadow: shadow(true), frameFX: { enabled: false, size: unit("pixelsUnit", 3) }, innerShadow: shadow(false, 80) } });
    expect(details["effects.frameFX.enabled"]).toBe(false);
    expect(details["effects.innerShadow.enabled"]).toBe(false);
    expect(Object.keys(details).filter(key => key.startsWith("effects.frameFX.") || key.startsWith("effects.innerShadow."))).toHaveLength(2);
  });

  it("numbers repeated effects and does not list the first one twice", () => {
    const details = extract({ layerEffects: { dropShadow: shadow(true, 10), dropShadowMulti: [shadow(true, 10), shadow(true, 60)] } });
    expect(details["effects.dropShadow1.opacity"]).toBe("10%");
    expect(details["effects.dropShadow2.opacity"]).toBe("60%");
    expect(details["effects.dropShadow.opacity"]).toBeUndefined();
  });

  it("describes masks, adjustment settings, smart filters and mixed text formatting", () => {
    const details = extract({
      hasUserMask: true, userMaskEnabled: false, userMaskLinked: true, userMaskDensity: 127.5, userMaskFeather: 2.5, hasVectorMask: false,
      adjustment: [{ _obj: "brightnessEvent", brightness: 40, center: 10, useLegacy: false }],
      smartObject: { linked: false, filterFX: [{ enabled: true, filter: { _obj: "gaussianBlur", radius: unit("pixelsUnit", 3) }, blendOptions: { opacity: unit("percentUnit", 100), mode: { _enum: "blendMode", _value: "normal" } } }] },
      textKey: { textStyleRange: [{ from: 0, to: 3, textStyle: { size: 12 } }, { from: 3, to: 8, textStyle: { size: 24 } }] }
    });
    expect(details).toMatchObject({
      "mask.present": true, "mask.enabled": false, "mask.density": "50%", "mask.feather": 2.5, "vectorMask.present": false,
      "adjustment.type": "brightnessEvent", "adjustment.brightness": 40, "adjustment.center": 10,
      "smartObject.linked": false, "smartFilters.filter1.type": "gaussianBlur", "smartFilters.filter1.enabled": true, "smartFilters.filter1.settings.radius": "3 px",
      "text.styleRuns": 2
    });
    expect(details["text.mixedFormatting"]).toMatch(/^#digest:[0-9a-f]{8}$/);
  });

  it("stays within what the schema accepts: safe keys, scalar values, a bounded count", () => {
    const wide = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`setting ${index}<img>`, index]));
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } };
    const details = extract({ adjustment: [{ _obj: "curves", ...wide, deep, list: Array.from({ length: 80 }, (_, index) => index), name: "x‮y".repeat(300) }] });
    const keys = Object.keys(details);
    expect(keys.length).toBeLessThanOrEqual(300);
    expect(keys.every(key => /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){0,7}$/.test(key))).toBe(true);
    expect(Object.values(details).every(value => ["string", "number", "boolean"].includes(typeof value) && String(value).length <= 500)).toBe(true);
    expect(extract(null)).toEqual({});
    expect(extract({})).toEqual({ "mask.present": false, "vectorMask.present": false });
  });
});
