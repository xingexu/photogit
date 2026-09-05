// Run with scripts/photoshop-panel-evaluate.mjs --file after connecting to UXP.
// Requires an initialized disposable child project and its running helper.
// These actions modify only documents created by this harness. They never close
// a user's document or replace the previously connected project's saved history.
(() => {
  const ps = require("photoshop");
  const results = window.__photoGitAcceptance?.results || [];
  const name = "PhotoGit acceptance — disposable";
  let testDocumentId = ps.app.documents.find(doc => doc.name === name)?.id || null;
  const testDoc = () => {
    const doc = ps.app.activeDocument;
    if (!doc || doc.id !== testDocumentId) throw new Error("The disposable acceptance document is not active.");
    return doc;
  };
  const modal = callback => ps.core.executeAsModal(callback, { commandName: "PhotoGit disposable acceptance test" });
  const record = async (label, work) => {
    try { const value = await work(); results.push({ label, ok: true, value: value ?? null }); }
    catch (error) { results.push({ label, ok: false, error: String(error) }); }
  };
  window.__photoGitAcceptance = {
    results,
    connect: () => record("connect", async () => {
      await cancelScan();
      const old = projectFolder;
      const child = await old.getEntry(".photogit/bridge/acceptance-20260904");
      window.__priorProject = old;
      helperToken = null;
      projectStatus = null;
      projectFolder = child;
      await loadPairing();
      await refreshWorkspace(true);
      return { project: child.name, online: helperOnline };
    }),
    create: () => record("create", () => modal(async () => {
      // Reuse only a harness-named document left by a prior failed test setup.
      let doc = ps.app.documents.find(doc => doc.name === name);
      if (doc) ps.app.activeDocument = doc;
      else doc = await ps.app.createDocument({ name, width: 320, height: 240, resolution: 72, mode: ps.constants.NewDocumentMode.RGB, fill: ps.constants.DocumentFill.WHITE });
      testDocumentId = doc.id;
      if (!doc.layers.some(layer => String(layer.kind).toLowerCase().includes("text"))) await doc.createTextLayer({ name: "Title", contents: "Version one", fontSize: 24, position: { x: 30, y: 80 } });
      return { id: doc.id, layers: doc.layers.length };
    })),
    edit: operation => record(operation, () => modal(async () => {
      const doc = testDoc();
      const pixel = doc.layers.find(layer => layer.name.startsWith("Paint"));
      const title = doc.layers.find(layer => String(layer.kind).toLowerCase().includes("text"));
      if (operation === "add") await doc.createPixelLayer({ name: "Paint" });
      else if (operation === "rename") pixel.name = "Paint renamed";
      else if (operation === "hide") pixel.visible = false;
      else if (operation === "opacity") pixel.opacity = 63;
      else if (operation === "text") title.textItem.contents = "Version two";
      else if (operation === "move") await title.translate(12, 9);
      else if (operation === "reorder") await pixel.move(title, ps.constants.ElementPlacement.PLACEAFTER);
      else if (operation === "paint") {
        pixel.visible = true;
        doc.activeLayers = [pixel];
        await doc.selection.selectRectangle({ left: 20, top: 130, right: 120, bottom: 180 }, ps.constants.SelectionType.REPLACE, 0, false);
        await ps.action.batchPlay([{ _obj: "fill", using: { _enum: "fillContents", _value: "black" }, opacity: { _unit: "percentUnit", _value: 100 }, mode: { _enum: "blendMode", _value: "normal" } }], {});
        await doc.selection.deselect();
      } else if (operation === "delete") await pixel.delete();
      else throw new Error(`Unknown edit ${operation}`);
      return { documentId: doc.id, layers: doc.layers.length };
    })),
    save: message => record("save", async () => {
      testDoc();
      document.getElementById("message").value = message;
      await saveVersion();
      return { result: document.getElementById("result").textContent, versions: historyEntries.map(version => version.shortId), count: lastScanCount };
    }),
    inspect: () => ({
      results,
      branch: document.getElementById("branch-name").textContent,
      status: document.getElementById("watch-status").textContent,
      count: lastScanCount,
      changes: document.getElementById("changes").innerText,
      result: document.getElementById("result").textContent,
      document: ps.app.documents.length ? { id: ps.app.activeDocument.id, name: ps.app.activeDocument.name } : null
    })
  };
})();
