// Scripted take for the PhotoGit demo video. Evaluated inside the live
// PhotoGit panel through UXP Developer Tools:
//
//   node scripts/photoshop-panel-evaluate.mjs --file scripts/demo/panel-take.js
//   node scripts/photoshop-panel-evaluate.mjs 'window.__photoGitDemoTake.run()' --no-await
//   node scripts/photoshop-panel-evaluate.mjs 'JSON.stringify(window.__photoGitDemoTake.status())'
//
// Every beat drives the real panel (commands are typed into the real command
// palette) and edits a real Photoshop document. Beat start times are recorded
// so captions can be placed against the screen recording afterwards.
(() => {
  const { app, action, constants, core } = require("photoshop");

  const modal = (commandName, callback) => core.executeAsModal(callback, { commandName });
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const take = { beats: [], step: "idle", done: false, error: null, startedAt: null };

  // ---- Photoshop artwork -------------------------------------------------

  async function setForeground(red, green, blue) {
    await action.batchPlay([{ _obj: "set", _target: [{ _ref: "color", _property: "foregroundColor" }], to: { _obj: "RGBColor", red, green, blue } }], {});
  }
  async function fillSelection() {
    await action.batchPlay([{ _obj: "fill", using: { _enum: "fillContents", _value: "foregroundColor" }, opacity: { _unit: "percentUnit", _value: 100 }, mode: { _enum: "blendMode", _value: "normal" } }], {});
  }
  async function shape(doc, kind, name, bounds, color, opacity = 100) {
    const layer = await doc.createPixelLayer({ name, opacity });
    await setForeground(...color);
    if (kind === "ellipse") await doc.selection.selectEllipse(bounds, constants.SelectionType.REPLACE, 0, true);
    else if (kind === "polygon") await doc.selection.selectPolygon(bounds, constants.SelectionType.REPLACE, 0, true);
    else await doc.selection.selectRectangle(bounds, constants.SelectionType.REPLACE, 0, false);
    await fillSelection();
    await doc.selection.deselect();
    return layer;
  }
  async function text(doc, options, color = [12, 12, 12]) {
    await setForeground(...color);
    const layer = await doc.createTextLayer(options);
    layer.name = options.name;
    return layer;
  }
  const layerNamed = (doc, name) => {
    const found = Array.from(doc.layers).find((layer) => layer.name === name);
    if (!found) throw new Error(`Layer ${name} is missing.`);
    return found;
  };

  const art = {
    canvas: () => modal("PhotoGit demo — New poster", async () => {
      const doc = await app.createDocument({ name: "Poster", width: 1400, height: 900, resolution: 144, mode: constants.NewDocumentMode.RGB, fill: constants.DocumentFill.WHITE });
      if (doc.layers.length) doc.layers[0].name = "PAPER";
    }),
    geometry: () => modal("PhotoGit demo — Geometry", async () => {
      const doc = app.activeDocument;
      await shape(doc, "rect", "GRID / TOP RULE", { left: 74, top: 74, right: 1326, bottom: 78 }, [20, 20, 20], 35);
      await shape(doc, "rect", "GRID / BOTTOM RULE", { left: 74, top: 822, right: 1326, bottom: 826 }, [20, 20, 20], 35);
      await shape(doc, "ellipse", "MOON", { left: 902, top: 132, right: 1268, bottom: 498 }, [12, 12, 12]);
      await shape(doc, "polygon", "MOUNTAIN", [{ x: 690, y: 822 }, { x: 1030, y: 418 }, { x: 1326, y: 822 }], [224, 224, 221]);
    }),
    typography: () => modal("PhotoGit demo — Typography", async () => {
      const doc = app.activeDocument;
      await text(doc, { name: "KICKER", contents: "PHOTOGIT / STUDY 001", position: { x: 112, y: 150 }, fontName: "CourierNewPS-BoldMT", fontSize: 20 });
      await text(doc, { name: "HEADLINE", contents: "FORM\rFOLLOWS\rFEELING", position: { x: 104, y: 266 }, fontName: "Arial-Black", fontSize: 102 });
      await text(doc, { name: "FOOTER", contents: "VERSIONED INSIDE PHOTOSHOP", position: { x: 112, y: 786 }, fontName: "CourierNewPSMT", fontSize: 17 });
    }),
    refine: () => modal("PhotoGit demo — Refine", async () => {
      const doc = app.activeDocument;
      layerNamed(doc, "HEADLINE").textItem.contents = "FORM\rFOLLOWS\rFUNCTION";
      layerNamed(doc, "MOON").opacity = 78;
      await text(doc, { name: "VERSION LABEL", contents: "V.02", position: { x: 1120, y: 760 }, fontName: "Arial-Black", fontSize: 54 });
    }),
    boldMoon: () => modal("PhotoGit demo — Bold moon", async () => {
      const doc = app.activeDocument;
      await shape(doc, "ellipse", "MOON / BLOSSOM", { left: 902, top: 132, right: 1268, bottom: 498 }, [236, 72, 120]);
      layerNamed(doc, "VERSION LABEL").textItem.contents = "V.03";
    }),
    quietType: () => modal("PhotoGit demo — Quiet type", async () => {
      const doc = app.activeDocument;
      layerNamed(doc, "HEADLINE").textItem.contents = "LESS\rBUT\rBETTER";
      layerNamed(doc, "VERSION LABEL").textItem.contents = "V.03";
    })
  };

  // ---- Driving the panel ---------------------------------------------------

  async function idle(timeoutMs = 60000) {
    const started = Date.now();
    await delay(250);
    while (busyNow || scans.running) {
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out during “${take.step}”.`);
      await delay(150);
    }
  }
  function input(field, value) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function typeInto(field, value, perCharacterMs = 60) {
    field.focus();
    for (let index = 1; index <= value.length; index++) {
      input(field, value.slice(0, index));
      await delay(perCharacterMs);
    }
  }
  // Opens the palette exactly as "/" does, types the command visibly, holds
  // so the matching row can be read, then runs it as Enter would.
  async function command(line, holdMs = 900) {
    await idle();
    openCommandPalette("");
    await delay(700);
    await typeInto(document.getElementById("command-input"), line);
    await delay(holdMs);
    await executeCommand(document.getElementById("command-input").value);
    await idle();
  }
  async function confirmDetail() {
    await delay(2200);
    if (typeof detailAction !== "function") throw new Error(`No confirmation was offered during “${take.step}”.`);
    await detailAction();
    await idle(90000);
  }
  async function closeSheet(holdMs) {
    await delay(holdMs);
    closeDetail(false);
    await delay(600);
  }
  function press(element) {
    if (!element) throw new Error(`A control is missing during “${take.step}”.`);
    element.dispatchEvent(new Event("click", { bubbles: true }));
  }

  // ---- The take --------------------------------------------------------------

  const beats = [
    ["panel-ready", async () => { selectTab("changes"); await delay(3500); }],
    ["poster-built", async () => { await art.canvas(); await delay(1500); await art.geometry(); await delay(1500); await art.typography(); await delay(1500); }],
    ["scan", async () => { await command("/scan"); await delay(4000); }],
    ["filters", async () => {
      for (const filter of ["text", "visual", "all"]) { press(document.querySelector(`[data-change-filter="${filter}"]`)); await delay(1800); }
    }],
    ["first-save", async () => {
      await typeInto(document.getElementById("message"), "Editorial poster baseline", 55);
      await delay(1000);
      await saveVersion(); await idle(); await delay(3500);
    }],
    ["edit-detected", async () => { await command("/changes", 600); await delay(800); await art.refine(); await delay(1200); await scanChanges({ automatic: false }); await idle(); await delay(4500); }],
    ["save-command", async () => { await command("/save Refined headline and moon"); await delay(3500); }],
    ["history-search", async () => {
      await command("/history", 600);
      await typeInto(document.getElementById("history-search"), "moon", 90);
      await delay(2200);
      input(document.getElementById("history-search"), "");
      await delay(1200);
    }],
    ["history-inspect", async () => {
      const latest = historyEntries[0];
      selectVersion(latest.id); await delay(2200);
      await inspectVersion(latest); await idle(); await closeSheet(5500);
    }],
    ["history-compare", async () => {
      const first = historyEntries[historyEntries.length - 1];
      selectVersion(first.id); await delay(1800);
      await compareWithCurrent(first, projectFolder); await idle(); await closeSheet(5500);
    }],
    ["branch", async () => { await command("/branch bold-moon"); await delay(1500); selectTab("branches"); await delay(3000); }],
    ["branch-edit", async () => { selectTab("changes"); await art.boldMoon(); await delay(1200); await scanChanges({ automatic: false }); await idle(); await delay(3000); }],
    ["commit-alias", async () => { await command("/commit Bold blossom moon"); await delay(3000); }],
    ["branches-tab", async () => { await command("/branches", 600); await delay(3500); }],
    ["switch", async () => { await command("/switch main"); await confirmDetail(); await delay(4000); }],
    ["second-branch", async () => {
      await command("/branch quiet-type"); selectTab("changes");
      await art.quietType(); await delay(1200); await scanChanges({ automatic: false }); await idle(); await delay(2000);
      await command("/save Quieter headline"); await delay(2000);
      await command("/switch main"); await confirmDetail(); await delay(2500);
    }],
    ["compare", async () => { await command("/compare bold-moon"); await closeSheet(7000); }],
    ["merge", async () => { await command("/merge bold-moon"); await confirmDetail(); await delay(4500); }],
    ["reviews", async () => {
      await command("/reviews", 600); await delay(2500);
      if (reviewEntries.some((review) => review.branch === "quiet-type")) { await toggleReview("quiet-type"); await idle(); }
      await delay(5000);
    }],
    ["conflicts", async () => { await command("/conflicts"); await delay(4000); }],
    ["tag", async () => {
      await command("/tag", 600);
      await typeInto(document.getElementById("tag-name"), "v1.0", 110);
      await delay(1000);
      await createTag(); await idle(); await delay(3000);
    }],
    ["push", async () => { await command("/push"); await confirmDetail(); await delay(3500); }],
    ["pull", async () => { await command("/pull"); await confirmDetail(); await delay(3500); }],
    ["activity", async () => { await command("/activity", 600); await delay(5000); }],
    ["status", async () => { await command("/status"); await closeSheet(6000); }],
    ["reconnect", async () => { await command("/reconnect"); await delay(3500); }],
    ["docs", async () => {
      await command("/docs", 600); await delay(2000);
      await typeInto(document.getElementById("docs-search"), "merge", 100);
      await delay(2500);
      input(document.getElementById("docs-search"), "");
      await delay(2500);
    }],
    ["finale", async () => { await command("/history", 600); await delay(6000); }]
  ];

  async function run(fromBeat) {
    const start = fromBeat ? beats.findIndex(([id]) => id === fromBeat) : 0;
    if (start < 0) throw new Error(`Unknown beat ${fromBeat}.`);
    Object.assign(take, { beats: [], done: false, error: null, startedAt: Date.now() });
    try {
      for (const [id, beat] of beats.slice(start)) {
        take.step = id;
        take.beats.push({ id, at: Date.now() });
        await beat();
      }
      take.step = "complete";
    } catch (error) {
      take.error = error?.message || String(error);
      show(take.error, true);
    } finally {
      take.done = true;
      take.endedAt = Date.now();
    }
  }

  window.__photoGitDemoTake = {
    run: (fromBeat) => { void run(fromBeat); return "Take started."; },
    status: () => ({ step: take.step, done: take.done, error: take.error, startedAt: take.startedAt, endedAt: take.endedAt, beats: take.beats }),
    beats: beats.map(([id]) => id),
    art
  };
  return `PhotoGit demo take installed: ${beats.length} beats.`;
})()
