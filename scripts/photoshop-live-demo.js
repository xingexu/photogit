(async () => {
  const { app, action, constants, core } = require("photoshop");

  const CANVAS = { width: 1400, height: 900 };
  const NAMES = {
    document: "PhotoGit Poster — Live Take",
    background: "INK / BACKGROUND",
    moon: "MOON / PRIMARY",
    orbit: "ORBIT / LINE",
    form: "FORM / SHADOW",
    grid: "GRID / STRUCTURE",
    headline: "TYPE / HEADLINE",
    kicker: "TYPE / KICKER",
    footer: "TYPE / FOOTER",
    proof: "PROOF / VERSION 02"
  };

  const modal = (commandName, callback) => core.executeAsModal(callback, { commandName });

  async function setForeground(red, green, blue) {
    await action.batchPlay([{
      _obj: "set",
      _target: [{ _ref: "color", _property: "foregroundColor" }],
      to: { _obj: "RGBColor", red, green, blue }
    }], {});
  }

  async function fillSelection() {
    await action.batchPlay([{
      _obj: "fill",
      using: { _enum: "fillContents", _value: "foregroundColor" },
      opacity: { _unit: "percentUnit", _value: 100 },
      mode: { _enum: "blendMode", _value: "normal" }
    }], {});
  }

  async function addRectangle(doc, name, bounds, color, opacity = 100) {
    const layer = await doc.createPixelLayer({ name, opacity });
    await setForeground(...color);
    await doc.selection.selectRectangle(bounds, constants.SelectionType.REPLACE, 0, false);
    await fillSelection();
    await doc.selection.deselect();
    return layer;
  }

  async function addEllipse(doc, name, bounds, color, opacity = 100) {
    const layer = await doc.createPixelLayer({ name, opacity });
    await setForeground(...color);
    await doc.selection.selectEllipse(bounds, constants.SelectionType.REPLACE, 0, true);
    await fillSelection();
    await doc.selection.deselect();
    return layer;
  }

  async function addPolygon(doc, name, points, color, opacity = 100) {
    const layer = await doc.createPixelLayer({ name, opacity });
    await setForeground(...color);
    await doc.selection.selectPolygon(points, constants.SelectionType.REPLACE, 0, true);
    await fillSelection();
    await doc.selection.deselect();
    return layer;
  }

  async function addText(doc, options, color) {
    await setForeground(...color);
    const layer = await doc.createTextLayer(options);
    layer.name = options.name;
    return layer;
  }

  function activeDemoDocument() {
    if (!app.documents.length) throw new Error("The PhotoGit live poster is not open.");
    const doc = app.activeDocument;
    if (!doc.name.startsWith(NAMES.document)) throw new Error(`Expected ${NAMES.document}, found ${doc.name}.`);
    return doc;
  }

  async function createCanvas() {
    return modal("PhotoGit Live Demo — Create canvas", async () => {
      const doc = await app.createDocument({
        name: NAMES.document,
        width: CANVAS.width,
        height: CANVAS.height,
        resolution: 144,
        mode: constants.NewDocumentMode.RGB,
        fill: constants.DocumentFill.WHITE
      });
      if (doc.layers.length) doc.layers[0].name = NAMES.background;
      return { name: doc.name, width: doc.width, height: doc.height };
    });
  }

  async function addGeometry() {
    return modal("PhotoGit Live Demo — Build geometry", async () => {
      const doc = activeDemoDocument();

      await addRectangle(doc, NAMES.grid, { left: 74, top: 74, right: 78, bottom: 826 }, [20, 20, 20], 35);
      await addRectangle(doc, "GRID / TOP RULE", { left: 74, top: 74, right: 1326, bottom: 78 }, [20, 20, 20], 35);
      await addRectangle(doc, "GRID / BOTTOM RULE", { left: 74, top: 822, right: 1326, bottom: 826 }, [20, 20, 20], 35);
      await addEllipse(doc, NAMES.moon, { left: 902, top: 132, right: 1268, bottom: 498 }, [12, 12, 12]);

      const orbit = await doc.createPixelLayer({ name: NAMES.orbit, opacity: 72 });
      await setForeground(36, 36, 36);
      await doc.selection.selectEllipse({ left: 844, top: 76, right: 1326, bottom: 558 }, constants.SelectionType.REPLACE, 0, true);
      await doc.selection.selectBorder(4);
      await fillSelection();
      await doc.selection.deselect();

      await addPolygon(doc, NAMES.form, [
        { x: 690, y: 822 },
        { x: 1030, y: 418 },
        { x: 1326, y: 822 }
      ], [224, 224, 221]);

      return { layers: doc.layers.length, orbit: orbit.name };
    });
  }

  async function addTypography() {
    return modal("PhotoGit Live Demo — Add typography", async () => {
      const doc = activeDemoDocument();

      await addText(doc, {
        name: NAMES.kicker,
        contents: "PHOTOGIT / LIVE STUDY 001",
        position: { x: 112, y: 150 },
        fontName: "CourierNewPS-BoldMT",
        fontSize: 20
      }, [12, 12, 12]);

      await addText(doc, {
        name: NAMES.headline,
        contents: "FORM\rFOLLOWS\rFEELING",
        position: { x: 104, y: 266 },
        fontName: "Arial-Black",
        fontSize: 102
      }, [12, 12, 12]);

      await addText(doc, {
        name: NAMES.footer,
        contents: "VERSIONED INSIDE PHOTOSHOP    /    03 SEP 2026",
        position: { x: 112, y: 786 },
        fontName: "CourierNewPSMT",
        fontSize: 17
      }, [12, 12, 12]);

      return { layers: doc.layers.length, headline: "FORM / FOLLOWS / FEELING" };
    });
  }

  async function refineDesign() {
    return modal("PhotoGit Live Demo — Refine direction", async () => {
      const doc = activeDemoDocument();
      const layers = Array.from(doc.layers);
      const headline = layers.find((layer) => layer.name === NAMES.headline);
      const moon = layers.find((layer) => layer.name === NAMES.moon);
      if (!headline || !moon) throw new Error("Baseline poster layers are missing.");

      headline.textItem.contents = "FORM\rFOLLOWS\rFUNCTION";
      moon.opacity = 78;
      await addRectangle(doc, NAMES.proof, { left: 1112, top: 690, right: 1268, bottom: 698 }, [12, 12, 12]);
      return { layers: doc.layers.length, headline: "FORM / FOLLOWS / FUNCTION", moonOpacity: moon.opacity };
    });
  }

  async function addVersionLabel() {
    return modal("PhotoGit Live Demo — Add version label", async () => {
      const doc = activeDemoDocument();
      const existing = Array.from(doc.layers).find((layer) => layer.name === "TYPE / VERSION LABEL");
      if (existing) return { label: "already present" };
      await addText(doc, {
        name: "TYPE / VERSION LABEL",
        contents: "V.02",
        position: { x: 1120, y: 760 },
        fontName: "Arial-Black",
        fontSize: 54
      }, [12, 12, 12]);
      return { label: "V.02" };
    });
  }

  function state() {
    const doc = activeDemoDocument();
    return {
      name: doc.name,
      width: doc.width,
      height: doc.height,
      layers: Array.from(doc.layers).map((layer) => ({ name: layer.name, kind: layer.kind, opacity: layer.opacity }))
    };
  }

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function runTake() {
    try {
      window.__PHOTO_GIT_TAKE_DONE__ = { done: false, step: "Building geometry" };
      await delay(1200);
      await addGeometry();
      await delay(2600);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Adding editable typography";
      await addTypography();
      await delay(3200);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Scanning baseline";
      selectTab("changes");
      await refreshWorkspace();
      await scanChanges();
      await delay(3800);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Saving baseline";
      document.getElementById("message").value = "LIVE DEMO — Editorial poster baseline";
      await saveVersion();
      await delay(4500);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Refining design";
      selectTab("changes");
      await delay(1500);
      await refineDesign();
      await addVersionLabel();
      await delay(3000);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Scanning revision";
      await scanChanges();
      await delay(3800);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Saving revision";
      document.getElementById("message").value = "LIVE DEMO — Refined hierarchy and moon";
      await saveVersion();
      await delay(4800);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Filtering history";
      document.getElementById("history-search").value = "LIVE DEMO";
      filterHistory();
      await delay(4200);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Showing branches";
      selectTab("branches");
      await delay(3600);

      window.__PHOTO_GIT_TAKE_DONE__.step = "Showing activity";
      selectTab("activity");
      await delay(4200);

      selectTab("history");
      await delay(4500);
      window.__PHOTO_GIT_TAKE_DONE__ = { done: true, step: "Complete" };
    } catch (error) {
      window.__PHOTO_GIT_TAKE_DONE__ = { done: true, step: "Failed", error: error?.message || String(error) };
      show(error?.message || String(error), true);
    }
  }

  window.__photoGitLiveDemo = {
    createCanvas,
    addGeometry,
    addTypography,
    refineDesign: async () => {
      const result = await refineDesign();
      await addVersionLabel();
      return result;
    },
    state,
    runTake
  };

  return "PhotoGit live demo controls installed.";
})()
