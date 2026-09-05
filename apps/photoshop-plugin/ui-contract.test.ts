import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

const pluginRoot = resolve(process.cwd(), "apps/photoshop-plugin");
const localRequire = createRequire(resolve(pluginRoot, "index.js"));
const model = localRequire("./panel-model.js");

// These tests execute the production panel and model with synthetic DOM/host APIs.
// They do not establish native UXP layout, Photoshop imaging fidelity, or PSD opening.
async function panel() {
  const [html, source] = await Promise.all([
    readFile(resolve(pluginRoot, "index.html"), "utf8"),
    readFile(resolve(pluginRoot, "index.js"), "utf8")
  ]);
  const { document, window } = parseHTML(html);
  let focused: unknown = document.body;
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focused });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  let modalDepth = 0;
  const executionContext = { isCancelled: false };
  const pixels = { width: 2, height: 2, components: 4, getData: vi.fn(async () => new Uint8Array([0, 1, 2, 255])), dispose: vi.fn() };
  const app: { documents: unknown[]; activeDocument: any; open: ReturnType<typeof vi.fn> } = { documents: [], activeDocument: null, open: vi.fn() };
  const core = { executeAsModal: vi.fn(async (work: (context: { isCancelled: boolean }) => unknown) => {
    modalDepth++;
    try { return await work(executionContext); }
    finally { modalDepth--; }
  }) };
  const action = { batchPlay: vi.fn(async (_commands: Array<Record<string, unknown>>) => []), addNotificationListener: vi.fn(async () => undefined) };
  const imaging = { getPixels: vi.fn(async (_options?: Record<string, unknown>) => {
    if (modalDepth === 0) throw new Error("Photoshop imaging.getPixels requires executeAsModal");
    return { imageData: pixels };
  }) };
  const entrypoints = { setup: vi.fn() };
  const storage = { localFileSystem: {}, formats: { binary: "binary", utf8: "utf8" } };
  const context: Context = createContext({
    document, window: { document, setInterval: vi.fn() }, Uint8Array, console: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), log: vi.fn() },
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    requestAnimationFrame: (callback: () => void) => callback(),
    setTimeout: (callback: () => void, delay = 0) => {
      const id = ++timerId;
      if (delay === 0) queueMicrotask(callback);
      else timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    require: (name: string) => {
      if (name === "photoshop") return { app, core, action, imaging };
      if (name === "uxp") return { storage, entrypoints, shell: { openExternal: vi.fn() } };
      if (name.startsWith("./")) return localRequire(name);
      throw new Error(`Unexpected host dependency: ${name}`);
    }
  });
  runInContext(source, context, { filename: "photogit-production-panel.js" });
  const evaluate = (code: string, values: Record<string, unknown> = {}): any => {
    Object.assign(context, values);
    return runInContext(code, context);
  };
  const id = <T extends HTMLElement = HTMLElement>(name: string) => document.getElementById(name)! as T;
  const keyboard = (element: any, key: string, shiftKey = false) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key, shiftKey });
    element.dispatchEvent(event);
    return event;
  };
  const connect = (doc = syntheticDocument()) => {
    app.documents = [doc]; app.activeDocument = doc;
    evaluate('projectFolder = { name: "Synthetic project", nativePath: "/synthetic-project" }; helperToken = "host-mock-token"; projectStatus = { branch: "main", changeCount: 0, baselineMissing: false, documentBinding: panelModel.documentIdentity(app.activeDocument) }; helperOnline = true;');
    return doc;
  };
  return { document, context, evaluate, id, keyboard, connect, app, core, action, imaging, pixels, timers, entrypoints, executionContext, inModal: () => modalDepth > 0 };
}

function syntheticLayer(id = 1, name = "Layer", kind = "pixel") {
  return { id, name, kind, visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", layers: [], bounds: { left: 0, top: 0, right: 32, bottom: 32 } };
}
function syntheticDocument(id = 1, layers = [syntheticLayer()]) {
  return { id, name: `Artwork ${id}.psd`, path: `/synthetic-project/artwork-${id}.psd`, width: 256, height: 256, resolution: 72, mode: "RGB", bitsPerChannel: 8, layers, activeHistoryState: { id: 1 } };
}
function change(index = 1, extra: Record<string, unknown> = {}) {
  return { domain: "appearance", category: "modified", photoshopId: index, layerName: `Layer ${index}`, summary: `Layer ${index}: Opacity changed`, ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
async function settle() { for (let turn = 0; turn < 16; turn++) await Promise.resolve(); }

function memoryFolder() {
  const entries = new Map<string, any>();
  return {
    entries,
    async createFile(name: string) {
      const file = { content: "", async write(value: string) { this.content = value; }, async read() { return this.content; }, async delete() { entries.delete(name); } };
      entries.set(name, file);
      return file;
    },
    async getEntry(name: string) { const file = entries.get(name); if (!file) throw new Error("Entry not found"); return file; }
  };
}

async function bridgePanel(body?: unknown) {
  const p = await panel();
  p.connect();
  const requests = memoryFolder();
  const responses = memoryFolder();
  p.context.createRequestId = () => "host-mock-request";
  p.context.ensureFolder = async (_root: unknown, path: string) => path.endsWith("requests") ? requests : responses;
  if (body !== undefined) {
    const response = await responses.createFile("host-mock-request.json");
    await response.write(typeof body === "string" ? body : JSON.stringify(body));
    await responses.createFile("host-mock-request.ready");
  }
  return { ...p, requests, responses };
}

describe("PhotoGit command palette — production behavior with mocked host", () => {
  it("opens setup documentation before a project has been connected", async () => {
    const p = await panel();
    await p.evaluate('executeCommand("docs")');
    expect(p.id("workspace").hidden).toBe(false);
    expect(p.id("docs-view").hidden).toBe(false);
    expect(p.id("onboarding").hidden).toBe(true);
  });
  it("marks overlay state to suppress background native fields without losing their values", async () => {
    const p = await panel(); p.connect(); p.id<HTMLInputElement>("message").value = "Keep my draft";
    p.evaluate("openCommandPalette()");
    expect(p.document.body.classList.contains("has-surface")).toBe(true);
    p.evaluate("closeDetail()");
    expect(p.document.body.classList.contains("has-surface")).toBe(false);
    expect(p.id<HTMLInputElement>("message").value).toBe("Keep my draft");
  });
  it.each(["changes", "history", "branches", "reviews", "activity", "docs"])("navigates to %s without a helper mutation", async section => {
    const p = await panel(); p.connect();
    const helper = vi.fn(); p.context.callHelper = helper;
    p.evaluate("openCommandPalette()");
    await p.evaluate("executeCommand(command)", { command: `/${section}` });
    expect(p.id(`${section}-view`).hidden).toBe(false);
    expect(p.id("detail-sheet").hidden).toBe(true);
    expect(helper).not.toHaveBeenCalled();
  });
  it("searches aliases and renders a browsable command directory", async () => {
    const p = await panel();
    p.id<HTMLInputElement>("docs-search").value = "commit";
    p.evaluate("renderCommandDocs()");
    expect(p.id("command-directory").textContent).toContain("Save a version");
    expect(p.id("command-directory").querySelectorAll(".command-row")).toHaveLength(1);
    (p.id("command-directory").firstElementChild as HTMLElement).click();
    expect(p.id<HTMLInputElement>("command-input").value).toBe("save ");
    expect(p.document.activeElement).toBe(p.id("command-input"));
  });
  it("browses palette results with arrows and closes with Escape", async () => {
    const p = await panel(); p.id("global-search").focus();
    p.document.addEventListener("keydown", p.context.handleGlobalKeyboard);
    p.evaluate("openCommandPalette()");
    p.keyboard(p.id("command-input"), "ArrowDown");
    expect(p.document.activeElement).toBe(p.id("command-results").firstElementChild);
    p.keyboard(p.document.activeElement, "ArrowUp");
    expect(p.document.activeElement).toBe(p.id("command-input"));
    p.keyboard(p.id("command-input"), "Escape");
    expect(p.id("detail-sheet").hidden).toBe(true);
    expect(p.document.activeElement).toBe(p.id("global-search"));
  });
  it.each(["/save", "/merge", "/switch", "/branch", "/compare", "/status extra", "rm -rf anything", "/save " + "x".repeat(501)])("rejects invalid command %s without mutation", async input => {
    const p = await panel(); p.connect();
    p.evaluate("openCommandPalette()");
    const helper = vi.fn(); p.context.callHelper = helper;
    await p.evaluate("executeCommand(input)", { input });
    expect(p.id("command-error").textContent).not.toBe("");
    expect(helper).not.toHaveBeenCalled();
  });
  it.each(["save", "commit"])("routes /%s through the existing save guard with a literal message", async name => {
    const p = await panel(); p.connect();
    const save = vi.fn(); p.context.saveVersion = save;
    await p.evaluate("executeCommand(input)", { input: `/${name} Refine <img src=x> & title` });
    expect(p.id<HTMLInputElement>("message").value).toBe("Refine <img src=x> & title");
    expect(save).toHaveBeenCalledOnce();
    expect(p.document.querySelector("#message img")).toBeNull();
  });
  it.each([["branch alternate", "createBranch"], ["compare alternate", "compareBranch"], ["merge alternate", "mergeReview"], ["scan", "scanChanges"], ["tag", "openTagSheet"], ["status", "openRepositorySettings"], ["conflicts", "openConflicts"], ["connect", "chooseProject"], ["reconnect", "reconnectHelper"]])("routes %s through its guarded workflow", async (command, handler) => {
    const p = await panel(); p.connect(); const run = vi.fn(); p.context[handler!] = run;
    await p.evaluate("executeCommand(command)", { command });
    expect(run).toHaveBeenCalledOnce();
    if (command!.startsWith("merge") || command!.startsWith("compare")) expect(run).toHaveBeenCalledWith("alternate");
    if (command!.startsWith("branch")) expect(p.id<HTMLInputElement>("new-branch-name").value).toBe("alternate");
  });
  it.each(["pull", "push", "switch alternate"])("requires confirmation for %s", async command => {
    const p = await panel(); p.connect();
    const helper = vi.fn(async () => ({})); p.context.callHelper = helper;
    p.context.openAfterGit = vi.fn(async () => true); p.context.refreshWorkspace = vi.fn(async () => undefined);
    const pull = vi.fn(); p.context.pull = pull; const push = vi.fn(); p.context.push = push;
    await p.evaluate("executeCommand(command)", { command });
    expect(helper).not.toHaveBeenCalled(); expect(pull).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
    expect(p.id("detail-sheet").hidden).toBe(false);
    await p.evaluate("detailAction()");
    if (command === "pull") expect(pull).toHaveBeenCalledOnce();
    else if (command === "push") expect(push).toHaveBeenCalledOnce();
    else expect(helper).toHaveBeenCalledWith("switchBranch", { branch: "alternate" });
  });
  it("rejects a sync confirmation after the project changes", async () => {
    const p = await panel(); p.connect(); const push = vi.fn(); p.context.push = push;
    await p.evaluate('executeCommand("push")');
    p.evaluate('projectFolder = { name: "different" }');
    await p.evaluate("detailAction()");
    expect(push).not.toHaveBeenCalled();
  });
  it("leaves Photoshop modifier shortcuts alone and preserves an existing confirmation", async () => {
    const p = await panel(); p.connect();
    const preventDefault = vi.fn();
    p.evaluate('handleGlobalKeyboard({key:"k",metaKey:true,preventDefault})', { preventDefault });
    expect(p.id("command-input")).toBeNull(); expect(preventDefault).not.toHaveBeenCalled();
    p.evaluate('openDetail("Confirm merge", "Do not replace me")');
    p.evaluate('handleGlobalKeyboard({key:" ",ctrlKey:true,shiftKey:true,preventDefault})', { preventDefault });
    expect(p.id("detail-title").textContent).toBe("Confirm merge");
    p.evaluate("closeDetail()"); const save = vi.fn(); p.context.saveVersion = save;
    p.evaluate('handleGlobalKeyboard({key:"Enter",ctrlKey:true,shiftKey:true,preventDefault})', { preventDefault });
    expect(save).not.toHaveBeenCalled();
  });
  it("refuses commands while an exclusive operation is running", async () => {
    const p = await panel(); p.connect(); p.evaluate("openCommandPalette(); busy(true)");
    const helper = vi.fn(); p.context.callHelper = helper;
    await p.evaluate('executeCommand("merge alternate")');
    expect(helper).not.toHaveBeenCalled();
    expect(p.id("command-error").textContent).toContain("running");
  });
});

describe("PhotoGit production panel behavior — host mocked", () => {
  it("registers the native panel without starting IO before DOM readiness", async () => {
    const p = await panel();
    expect(p.entrypoints.setup).toHaveBeenCalledOnce();
    expect(p.entrypoints.setup.mock.calls[0]![0].panels.photogitPanel.show).toBeTypeOf("function");
    expect(p.imaging.getPixels).not.toHaveBeenCalled();
  });

  it("navigates all tabs with arrow/Home/End keys and keeps one selected tab", async () => {
    const p = await panel();
    p.id("section-nav").addEventListener("keydown", p.context.handleTabKeyboard);
    p.keyboard(p.id("changes-tab"), "ArrowLeft");
    expect(p.id("docs-tab").getAttribute("aria-selected")).toBe("true");
    expect(p.document.activeElement).toBe(p.id("docs-tab"));
    p.keyboard(p.id("docs-tab"), "Home");
    expect(p.id("changes-view").hidden).toBe(false);
    p.keyboard(p.id("changes-tab"), "ArrowRight");
    expect(p.id("history-view").hidden).toBe(false);
    expect(p.id("changes-view").hidden).toBe(true);
    p.keyboard(p.id("history-tab"), "End");
    expect([...p.document.querySelectorAll('[role="tab"][aria-selected="true"]')]).toHaveLength(1);
    expect(p.id("docs-view").hidden).toBe(false);
    for (const section of ["changes", "history", "branches", "reviews", "activity", "docs"]) {
      p.evaluate("selectTab(section, false)", { section });
      expect(p.id(`${section}-view`).hidden).toBe(false);
      // linkedom's tabIndex getter maps zero to -1; inspect the reflected attribute.
      expect(p.id(`${section}-tab`).getAttribute("tabindex")).toBe("0");
    }
  });

  it("binds Enter and Space activation and rejects disabled controls", async () => {
    const p = await panel();
    const action = vi.fn();
    p.evaluate('bind("save-version", "click", testAction)', { testAction: action });
    p.keyboard(p.id("save-version"), "Enter");
    p.keyboard(p.id("save-version"), " ");
    expect(action).toHaveBeenCalledTimes(2);
    p.id("save-version").setAttribute("aria-disabled", "true");
    p.keyboard(p.id("save-version"), "Enter");
    p.id("save-version").click();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("keeps dialog content literal, traps focus, and returns focus on Escape", async () => {
    const p = await panel();
    p.id("header-menu").focus();
    p.evaluate('openDetail("Version <img>", "<img src=x onerror=alert(1)>", "Open copy", () => {})');
    expect(p.id("detail-sheet").hidden).toBe(false);
    expect(p.id("detail-content").querySelector("img")).toBeNull();
    expect(p.id("detail-content").textContent).toContain("<img");
    p.document.addEventListener("keydown", p.context.handleGlobalKeyboard);
    p.keyboard(p.id("detail-action"), "Tab");
    expect(p.document.activeElement).toBe(p.id("close-detail"));
    p.keyboard(p.id("close-detail"), "Tab", true);
    expect(p.document.activeElement).toBe(p.id("detail-action"));
    p.keyboard(p.id("close-detail"), "Escape");
    expect(p.id("detail-sheet").hidden).toBe(true);
    expect(p.document.activeElement).toBe(p.id("header-menu"));
  });

  it("renders escaped change rows with the full count while limiting visible rows", async () => {
    const p = await panel();
    const changes = Array.from({ length: 800 }, (_, index) => change(index + 1));
    changes[0] = change(1, { layerName: '<img src=x onerror="fail()">', summary: "<script>fail()</script>" });
    p.evaluate("renderChanges(testChanges, { changeCount: 1200 })", { testChanges: changes });
    expect(p.document.querySelectorAll("#changes .change-row")).toHaveLength(500);
    expect(p.id("changes-count").textContent).toBe("1200");
    expect(p.id("changes").querySelector("img, script")).toBeNull();
    expect(p.id("changes").textContent).toContain('<img src=x onerror="fail()">');
    expect(p.id("changes").textContent).toContain("Showing 500 of 1200 changes");
    expect(p.id("changes-empty").hidden).toBe(true);
  });

  it("keeps Save version before a large change list in reading and keyboard order", async () => {
    const p = await panel();
    p.evaluate("renderChanges(testChanges)", { testChanges: Array.from({ length: 600 }, (_, index) => change(index + 1)) });
    const sections = [...p.id("changes-view").children];
    expect(sections.indexOf(p.document.querySelector(".capture-panel")!)).toBeLessThan(sections.indexOf(p.document.querySelector(".changes-card")!));
    const controls = [...p.id("changes-view").querySelectorAll('[tabindex="0"], input')];
    expect(controls.indexOf(p.id("save-version"))).toBeLessThan(controls.indexOf(p.document.querySelector(".change-row")!));
    expect(p.id<HTMLInputElement>("message").disabled).toBeFalsy();
  });

  it("selects a changed layer without unhiding it and clears the previous selection", async () => {
    const p = await panel();
    p.connect();
    p.evaluate("renderChanges(testChanges)", { testChanges: [change(10), change(11)] });
    const rows = p.document.querySelectorAll<HTMLElement>("#changes .change-row");
    rows[0]!.click(); p.keyboard(rows[1], " ");
    await settle();
    expect(rows[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(rows[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(p.action.batchPlay.mock.calls[1]![0][0]).toMatchObject({ _target: [{ _ref: "layer", _id: 11 }], makeVisible: false });
  });

  it("does not offer layer selection for deleted layers or document-level changes", async () => {
    const p = await panel();
    p.connect();
    p.evaluate("renderChanges(testChanges)", { testChanges: [
      change(10, { category: "removed", domain: "structure", summary: "Layer 10: Removed layer" }),
      change(0, { photoshopId: null, domain: "document", layerName: "Document", summary: "Document width changed" })
    ] });
    for (const row of p.document.querySelectorAll<HTMLElement>("#changes .change-row")) {
      expect(row.getAttribute("role")).not.toBe("button");
      expect(row.getAttribute("tabindex")).not.toBe("0");
      row.click(); p.keyboard(row, "Enter");
    }
    await settle();
    expect(p.action.batchPlay).not.toHaveBeenCalled();
  });

  it("keeps an existing layer selectable when its name contains Removed or Deleted", async () => {
    const p = await panel();
    p.connect();
    p.evaluate("renderChanges(testChanges)", { testChanges: [change(12, { category: "modified", layerName: "Removed headline", summary: "Removed headline: Opacity changed" })] });
    const row = p.document.querySelector<HTMLElement>("#changes .change-row")!;
    expect(row.getAttribute("role")).toBe("button");
    row.click();
    await settle();
    expect(p.action.batchPlay).toHaveBeenCalledOnce();
  });

  it("labels fingerprints as rendered appearance and distinguishes the first version from clean state", async () => {
    const p = await panel();
    p.evaluate("renderChanges(testChanges)", { testChanges: [change(1, { domain: "content", summary: "Painted pixels changed" })] });
    expect(p.id("changes").textContent).toContain("Rendered appearance changed");
    expect(p.id("changes").textContent).not.toContain("Painted pixels changed");
    p.evaluate("renderChanges([], { baselineMissing: true, changeCount: 0 })");
    expect(p.id("change-summary").textContent).toBe("Ready for your first version");
    p.evaluate("renderChanges([])");
    expect(p.id("change-summary").textContent).toBe("No detected changes");
    expect(p.id("changes-count").textContent).toBe("0");
  });

  it("preserves interleaved author chronology and opens actual version details on click", async () => {
    const p = await panel();
    p.connect();
    const versions = ["A", "B", "A"].map((author, index) => ({ id: String(index + 1).repeat(40), shortId: String(index + 1).repeat(8), author, date: "2026-09-04T12:00:00Z", message: `Design ${index + 1}` }));
    const helper = vi.fn(async () => ({ changes: [{ summary: "Layer renamed" }], files: [{ status: "M", path: "snapshot/document.psd" }], snapshotAvailable: true }));
    p.context.callHelper = helper;
    p.evaluate("renderHistory(versions)", { versions });
    expect([...p.document.querySelectorAll(".history-row strong")].map(node => node.textContent)).toEqual(["Design 1", "Design 2", "Design 3"]);
    expect(p.document.querySelectorAll(".history-group")).toHaveLength(3);
    p.document.querySelector<HTMLElement>(".history-row")!.click();
    await settle();
    expect(helper).toHaveBeenCalledWith("versionDetails", { version: versions[0]!.id });
    expect(p.id("detail-title").textContent).toBe("Design 1");
    expect(p.id("detail-content").textContent).toContain("Layer renamed");
    expect(p.id("detail-content").textContent).toContain("snapshot/document.psd");
    expect(p.id("detail-content").textContent).not.toContain("[object Object]");
    expect(p.id("detail-action").textContent).toBe("Open version copy");
  });

  it("filters history by author without changing retained chronological order", async () => {
    const p = await panel();
    const versions = ["A", "B", "A"].map((author, index) => ({ id: String(index + 1).repeat(40), shortId: String(index + 1).repeat(8), author, date: "2026-09-04", message: `Version ${index + 1}` }));
    p.evaluate("historyEntries = versions", { versions });
    p.id<HTMLInputElement>("history-search").value = "A";
    p.evaluate("filterHistory()");
    expect([...p.document.querySelectorAll(".history-row strong")].map(node => node.textContent)).toEqual(["Version 1", "Version 3"]);
    p.id<HTMLInputElement>("history-search").value = "no such version";
    p.evaluate("filterHistory()");
    expect(p.document.querySelectorAll(".history-row")).toHaveLength(0);
    expect(p.id("history-empty").hidden).toBe(false);
  });

  it("hides GitHub actions for local and other remotes", async () => {
    const p = await panel();
    for (const provider of ["local", "other", "github"]) {
      await p.evaluate("loadReviews(testReviews)", { testReviews: { repository: { provider, currentBranch: "feature", baseBranch: "main", remoteConfigured: provider !== "local" }, reviews: [], conflicts: [], tags: [] } });
      expect(p.id("new-pull-request").hidden).toBe(provider !== "github");
      expect(p.id("tool-new-pr").hidden).toBe(provider !== "github");
    }
  });

  it("opens a semantic comparison and keeps blocked merge controls inert", async () => {
    const p = await panel();
    p.connect();
    const merge = vi.fn();
    const helper = vi.fn(async () => ({ baseBranch: "main", incomingBranch: "feature", ahead: 1, behind: 0, changes: [{ summary: "Headline text changed" }], files: [{ status: "M", path: "snapshot/document.psd" }], conflicts: ["snapshot/document.psd"], warnings: ["Both branches changed the PSD."], gitMergeable: false }));
    p.context.callHelper = helper; p.context.mergeReview = merge;
    p.evaluate('renderReviews([{ branch: "feature", ahead: 1, changeCount: 1, changes: ["snapshot/document.psd"], mergeable: false }], [])');
    p.document.querySelector<HTMLElement>(".merge-action")!.click();
    expect(merge).not.toHaveBeenCalled();
    p.document.querySelector<HTMLElement>(".compare-action")!.click();
    await settle();
    expect(helper).toHaveBeenCalledWith("compareBranches", { branch: "feature" });
    expect(p.id("detail-content").textContent).toContain("main ← feature");
    expect(p.id("detail-content").textContent).toContain("Headline text changed");
    expect(p.id("detail-content").textContent).toContain("Git merge blocked");
  });

  it("reports a PSD opening failure after Git changed and refreshes before recovery", async () => {
    const p = await panel();
    p.connect();
    const refresh = vi.fn(async () => undefined);
    p.context.refreshWorkspace = refresh;
    p.context.openSnapshot = vi.fn(async () => { throw new Error("Photoshop rejected the PSD"); });
    expect(await p.evaluate('openAfterGit("Switched to feature")')).toBe(false);
    expect(refresh).toHaveBeenCalledOnce();
    expect(p.id("detail-title").textContent).toBe("Git updated; document not opened");
    expect(p.id("detail-content").textContent).toContain("Do not repeat the Git operation");
    expect(p.id("detail-action").textContent).toBe("Retry opening PSD");
  });

  it("loads fresh merge context before confirmation and preserves its expected base", async () => {
    const p = await panel();
    p.connect();
    const comparison = { baseBranch: "main", incomingBranch: "feature", ahead: 1, behind: 0, changes: [{ summary: "Title position changed" }], files: [{ status: "M", path: "snapshot/document.psd" }], conflicts: [], warnings: ["Ordinary Git merge only"], gitMergeable: true };
    const helper = vi.fn(async (operation: string) => operation === "compareBranches" ? comparison : { branch: "main" });
    p.context.callHelper = helper;
    const merge = vi.fn(async () => undefined); p.context.performMerge = merge;
    await p.evaluate('mergeReview("feature")');
    expect(helper).toHaveBeenCalledExactlyOnceWith("compareBranches", { branch: "feature" });
    expect(p.id("detail-title").textContent).toBe("Merge this branch?");
    expect(p.id("detail-content").textContent).toContain("Base: main");
    expect(p.id("detail-content").textContent).toContain("Incoming: feature");
    expect(p.id("detail-content").textContent).toContain("Title position changed");
    expect(p.id("detail-content").textContent).toContain("snapshot/document.psd");
    expect(merge).not.toHaveBeenCalled();
    await p.evaluate("detailAction()");
    expect(merge).toHaveBeenCalledExactlyOnceWith("feature", "main");
    expect(p.id("detail-sheet").hidden).toBe(true);
  });

  it("removes merge confirmation when the fresh comparison finds a conflict", async () => {
    const p = await panel();
    p.connect();
    p.context.callHelper = vi.fn(async () => ({ baseBranch: "main", incomingBranch: "feature", changes: [], files: [], conflicts: ["snapshot/document.psd"], warnings: ["Both branches changed the PSD"], gitMergeable: false }));
    await p.evaluate('mergeReview("feature")');
    expect(p.id("detail-title").textContent).toBe("Git merge blocked");
    expect(p.id("detail-content").textContent).toContain("snapshot/document.psd");
    expect(p.id("detail-action").hidden).toBe(true);
    expect(p.evaluate("detailAction")).toBeNull();
  });

  it("refuses a confirmed merge when its base branch changed and refreshes state", async () => {
    const p = await panel();
    p.connect();
    const helper = vi.fn(async () => ({ branch: "other-direction" })); p.context.callHelper = helper;
    const refresh = vi.fn(async () => undefined); p.context.refreshWorkspace = refresh;
    const open = vi.fn(); p.context.openAfterGit = open;
    await p.evaluate('performMerge("feature", "main")');
    expect(helper).toHaveBeenCalledExactlyOnceWith("status");
    expect(refresh).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(p.id("result").textContent).toContain("The base branch changed");
    expect(p.id("workspace").getAttribute("aria-busy")).toBe("false");
  });

  it("merges only after confirming the expected base, then opens and refreshes the result", async () => {
    const p = await panel();
    p.connect();
    const events: string[] = [];
    const helper = vi.fn(async (operation: string) => { events.push(operation); return { branch: "main" }; }); p.context.callHelper = helper;
    p.context.openAfterGit = vi.fn(async () => { events.push("open PSD"); return true; });
    p.context.refreshWorkspace = vi.fn(async () => { events.push("refresh"); });
    await p.evaluate('performMerge("feature", "main")');
    expect(events).toEqual(["status", "mergeBranch", "open PSD", "refresh"]);
    expect(helper).toHaveBeenNthCalledWith(2, "mergeBranch", { branch: "feature" });
    expect(p.id("history-view").hidden).toBe(false);
    expect(p.id("result").textContent).toContain("Merged feature");
  });

  it("refreshes repository state after a typed partial-operation failure and unlocks controls", async () => {
    const p = await panel();
    p.connect();
    const refresh = vi.fn(async () => undefined);
    p.context.refreshWorkspace = refresh;
    await p.evaluate('run("Merging", async () => { const error = new Error("Git changed; recovery required"); error.details = { gitChanged: true }; throw error; })');
    expect(refresh).toHaveBeenCalledOnce();
    expect(p.id("detail-title").textContent).toBe("Repository recovery needed");
    expect(p.id("save-version").getAttribute("aria-disabled")).toBe("false");
    expect(p.id("workspace").getAttribute("aria-busy")).toBe("false");
  });

  it("blocks a foreign active document from scanning or saving", async () => {
    const p = await panel();
    p.connect();
    p.app.activeDocument = syntheticDocument(2);
    p.app.documents.push(p.app.activeDocument);
    const helper = vi.fn(); p.context.callHelper = helper;
    p.id<HTMLInputElement>("message").value = "This must not save";
    await p.evaluate("scanChanges()");
    await p.evaluate("saveVersion()");
    expect(helper).not.toHaveBeenCalled();
    expect(p.imaging.getPixels).not.toHaveBeenCalled();
    expect(p.id("document-connection").hidden).toBe(false);
    expect(p.id("changes-count").textContent).toBe("0");
    expect(p.id("change-summary").textContent).toBe("Connect a document");
  });

  it("adopts a document only after confirmation and reports a completed connection", async () => {
    const p = await panel();
    p.connect();
    const replacement = syntheticDocument(2);
    p.app.activeDocument = replacement;
    p.app.documents.push(replacement);
    const helper = vi.fn(async () => ({})); p.context.callHelper = helper;
    const refresh = vi.fn(async () => undefined); p.context.refreshWorkspace = refresh;
    p.evaluate("connectDocument()");
    expect(p.id("detail-title").textContent).toBe("Connect this document?");
    expect(helper).not.toHaveBeenCalled();
    await p.evaluate("detailAction()");
    expect(helper).toHaveBeenCalledWith("connectDocument", { documentIdentity: model.documentIdentity(replacement), adopt: true });
    expect(refresh).toHaveBeenCalledOnce();
    expect(p.id("detail-sheet").hidden).toBe(true);
    expect(p.id("result").textContent).toContain("Connected document");
  });

  it.each(["document", "project"])("rejects adoption if the %s changes while confirmation is open", async (target) => {
    const p = await panel();
    p.connect();
    const helper = vi.fn(); p.context.callHelper = helper;
    p.evaluate("connectDocument()");
    if (target === "document") p.app.activeDocument = syntheticDocument(2);
    else p.evaluate('projectFolder = { name: "Different project", nativePath: "/different-project" }');
    await p.evaluate("detailAction()");
    expect(helper).not.toHaveBeenCalled();
    expect(p.id("result").textContent).toContain("The active document or project changed. Connect again.");
  });

  it("discards capture completion after the active document changes", async () => {
    const p = await panel();
    p.connect();
    const capture = deferred<unknown>();
    const helper = vi.fn(); p.context.callHelper = helper;
    p.context.captureDocument = vi.fn(() => capture.promise);
    const pending = p.evaluate("scanChanges()");
    p.app.activeDocument = syntheticDocument(2);
    capture.resolve({ document: {}, layers: [] });
    await pending;
    expect(helper).not.toHaveBeenCalled();
    expect(p.id("cancel-scan").hidden).toBe(true);
    expect(p.id("change-summary").textContent).not.toBe("No detected changes");
  });

  it("discards helper completion after the project changes", async () => {
    const p = await panel();
    p.connect();
    const response = deferred<unknown>();
    p.context.captureDocument = vi.fn(async () => ({ document: {}, layers: [] }));
    p.context.callHelper = vi.fn(() => response.promise);
    const pending = p.evaluate("scanChanges()");
    await settle();
    p.evaluate('projectFolder = { name: "Different project", nativePath: "/different-project" }');
    response.resolve({ changes: [], changeCount: 0, baselineMissing: false });
    await pending;
    expect(p.id("change-summary").textContent).not.toBe("No detected changes");
  });

  it("cancels an in-flight scan and never applies its later result", async () => {
    const p = await panel();
    p.connect();
    const capture = deferred<unknown>();
    p.context.captureDocument = vi.fn(() => capture.promise);
    const helper = vi.fn(); p.context.callHelper = helper;
    const pending = p.evaluate("scanChanges()");
    const cancelled = p.evaluate("cancelScan()");
    capture.resolve({ document: {}, layers: [] });
    await Promise.all([pending, cancelled]);
    expect(helper).not.toHaveBeenCalled();
    expect(p.id("watch-status").textContent).toContain("Scan paused");
    expect(p.id("cancel-scan").hidden).toBe(true);
  });

  it("reports imaging failure as incomplete without a false clean scan", async () => {
    const p = await panel();
    p.connect();
    p.imaging.getPixels.mockRejectedValue(new Error("imaging unavailable"));
    const helper = vi.fn(); p.context.callHelper = helper;
    await p.evaluate("scanChanges()");
    expect(helper).not.toHaveBeenCalled();
    expect(p.id("change-summary").textContent).toBe("Scan needs attention");
    expect(p.id("watch-status").textContent).toContain("Scan incomplete");
    expect(p.id("result").textContent).toContain("Could not read pixels");
    expect(p.evaluate("lastScanCount")).toBeNull();
  });

  it("scans pixels inside Photoshop modal scope and suppresses its own notifications", async () => {
    const p = await panel();
    p.connect();
    const modalChecks: boolean[] = [];
    p.imaging.getPixels.mockImplementation(async () => {
      modalChecks.push(p.inModal());
      if (!p.inModal()) throw new Error("Photoshop imaging.getPixels requires executeAsModal");
      p.evaluate('onPhotoshopNotification("imaging-read")');
      return { imageData: p.pixels };
    });
    const helper = vi.fn(async () => ({ changes: [], changeCount: 0, baselineMissing: false }));
    p.context.callHelper = helper;
    await p.evaluate("scanChanges()");
    expect(modalChecks).toEqual([true, true]);
    expect(p.core.executeAsModal).toHaveBeenCalledOnce();
    expect(helper).toHaveBeenCalledOnce();
    expect(p.id("change-summary").textContent).toBe("No detected changes");
    expect(p.evaluate("suppressNotifications")).toBe(false);
    expect([...p.timers.values()].filter(timer => timer.delay === 700)).toHaveLength(0);
  });

  it("honors Photoshop modal cancellation before capturing or comparing pixels", async () => {
    const p = await panel();
    p.connect();
    p.executionContext.isCancelled = true;
    const helper = vi.fn(); p.context.callHelper = helper;
    await p.evaluate("scanChanges()");
    expect(p.imaging.getPixels).not.toHaveBeenCalled();
    expect(helper).not.toHaveBeenCalled();
    expect(p.evaluate("suppressNotifications")).toBe(false);
    expect(p.id("cancel-scan").hidden).toBe(true);
    expect(p.id("change-summary").textContent).not.toBe("No detected changes");
  });

  it("captures groups through the document composite without unsupported direct group imaging", async () => {
    const p = await panel();
    const child = syntheticLayer(11, "Child");
    const group = { ...syntheticLayer(10, "Masked group", "group"), layers: [child] };
    const doc = { ...syntheticDocument(), layers: [group] };
    const captured = await p.evaluate("core.executeAsModal(() => captureDocument(testDocument))", { testDocument: doc });
    expect(captured.layers.map((layer: any) => layer.photoshopId)).toEqual([10, 11]);
    expect(captured.layers[0].content.fingerprint).toBeNull();
    expect(captured.layers[1].content.fingerprint).toMatch(/^pixels-v1:/);
    expect(captured.document.renderedFingerprint).toMatch(/^pixels-v1:/);
    expect(p.imaging.getPixels.mock.calls.map(([options]) => options?.layerID)).toEqual([11, undefined]);
    expect(p.imaging.getPixels.mock.calls[1]![0]).toMatchObject({ documentID: doc.id, sourceBounds: { left: 0, top: 0, right: 256, bottom: 256 } });
    expect(p.imaging.getPixels.mock.calls.every(([options]) => options?.applyAlpha === false)).toBe(true);
    expect(captured.layers[1].parentPhotoshopId).toBe(10);
  });

  it("falls back to the document composite only for an unsupported opaque layer type", async () => {
    const p = await panel();
    const doc = syntheticDocument(1, [syntheticLayer(20, "Smart object", "smartObject")]);
    p.imaging.getPixels.mockImplementation(async options => {
      expect(p.inModal()).toBe(true);
      if (options?.layerID === 20) throw new Error("Unsupported layer type");
      return { imageData: p.pixels };
    });
    const captured = await p.evaluate("core.executeAsModal(() => captureDocument(testDocument))", { testDocument: doc });
    expect(captured.layers[0].content.fingerprint).toBeNull();
    expect(captured.layers[0].content.opaque).toBe(true);
    expect(captured.layers[0].content.reason).toContain("compared at document level");
    expect(captured.document.renderedFingerprint).toMatch(/^pixels-v1:/);
    expect(p.imaging.getPixels.mock.calls.map(([options]) => options?.layerID)).toEqual([20, undefined]);
    expect(p.pixels.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ["smartObject", "Out of memory"],
    ["pixel", "Unsupported layer type"]
  ])("does not suppress an imaging error for %s: %s", async (kind, message) => {
    const p = await panel();
    p.connect(syntheticDocument(1, [syntheticLayer(20, "Layer", kind)]));
    p.imaging.getPixels.mockRejectedValue(new Error(message));
    const helper = vi.fn(); p.context.callHelper = helper;
    await p.evaluate("scanChanges()");
    expect(helper).not.toHaveBeenCalled();
    expect(p.id("change-summary").textContent).toBe("Scan needs attention");
    expect(p.id("result").textContent).toContain(message);
    expect(p.evaluate("lastScanCount")).toBeNull();
  });

  it("marks composite imaging failure incomplete and never compares a partial capture", async () => {
    const p = await panel();
    p.connect();
    p.imaging.getPixels.mockImplementation(async options => {
      if (options?.layerID === undefined) throw new Error("Composite image unavailable");
      return { imageData: p.pixels };
    });
    const helper = vi.fn(); p.context.callHelper = helper;
    p.evaluate("renderChanges([])");
    await p.evaluate("scanChanges()");
    expect(helper).not.toHaveBeenCalled();
    expect(p.pixels.dispose).toHaveBeenCalledOnce();
    expect(p.id("change-summary").textContent).toBe("Scan needs attention");
    expect(p.id("watch-status").textContent).toContain("Scan incomplete");
    expect(p.id("result").textContent).toContain("Composite image unavailable");
    expect(p.evaluate("lastScanCount")).toBeNull();
  });

  it("shows baseline migration warnings even when no layer changes are detected", async () => {
    const p = await panel();
    p.connect();
    const warning = "This saved version has no document composite fingerprint. Save a new version to establish the rendered baseline.";
    p.context.callHelper = vi.fn(async () => ({ changes: [], changeCount: 0, baselineMissing: false, comparisonWarnings: [warning] }));
    await p.evaluate("scanChanges()");
    expect(p.id("change-summary").textContent).toBe("No layer changes · Review scan limits");
    expect(p.id("last-scan").textContent).toContain(warning);
    expect(p.id("changes-count").textContent).toBe("0");
    expect(p.id("change-summary").textContent).not.toBe("No detected changes");
  });

  it("keeps pixel capture and PSD/PNG export within one save modal", async () => {
    const p = await panel();
    const events: string[] = [];
    const doc = { ...syntheticDocument(), saveAs: {
      psd: vi.fn(async () => { expect(p.inModal()).toBe(true); events.push("psd"); }),
      png: vi.fn(async () => { expect(p.inModal()).toBe(true); events.push("png"); })
    } };
    p.connect(doc);
    p.imaging.getPixels.mockImplementation(async () => { expect(p.inModal()).toBe(true); events.push("pixels"); return { imageData: p.pixels }; });
    p.context.ensureFolder = async () => memoryFolder();
    p.context.callHelper = vi.fn(async () => { expect(p.inModal()).toBe(false); events.push("version"); return { versionId: "a".repeat(40), shortId: "aaaaaaaa", warningCount: 0 }; });
    for (const name of ["loadStatus", "loadBranches", "loadHistory", "loadReviews"]) p.context[name] = vi.fn(async () => undefined);
    p.id<HTMLInputElement>("message").value = "Save modal regression";
    await p.evaluate("saveVersion()");
    expect(events).toEqual(["pixels", "pixels", "psd", "png", "version"]);
    expect(p.core.executeAsModal).toHaveBeenCalledOnce();
    expect(p.id("changes-count").textContent).toBe("0");
    expect(p.evaluate("suppressNotifications")).toBe(false);
  });

  it.each(["document during cancellation", "project during cancellation", "document during preparation", "project during preparation"])("keeps the clicked first-save target fixed: %s", async (scenario) => {
    const p = await panel();
    p.connect();
    p.evaluate("projectStatus.documentBinding = null; projectStatus.baselineMissing = true");
    const pause = deferred<any>();
    const preparing = scenario.includes("preparation");
    p.context.cancelScan = preparing ? vi.fn(async () => undefined) : vi.fn(() => pause.promise);
    p.context.ensureFolder = preparing ? vi.fn(() => pause.promise) : vi.fn(async () => memoryFolder());
    const helper = vi.fn(); p.context.callHelper = helper;
    p.id<HTMLInputElement>("message").value = "Save the document I clicked";
    const pending = p.evaluate("saveVersion()");
    await settle();
    if (scenario.startsWith("document")) {
      p.app.activeDocument = syntheticDocument(2);
      p.app.documents.push(p.app.activeDocument);
    } else p.evaluate('projectFolder = { name: "Other project", nativePath: "/other-project" }');
    pause.resolve(preparing ? memoryFolder() : undefined);
    await pending;
    expect(helper).not.toHaveBeenCalled();
    expect(p.imaging.getPixels).not.toHaveBeenCalled();
    expect(p.id("result").textContent).toContain("The document or project changed. No version was written.");
    expect(p.evaluate("busyNow")).toBe(false);
  });

  it("refuses helper reconnection during a save or other exclusive operation", async () => {
    const p = await panel();
    p.connect();
    const pairing = vi.fn(); p.context.loadPairing = pairing;
    const refresh = vi.fn(); p.context.refreshWorkspace = refresh;
    p.evaluate("busy(true)");
    await p.evaluate("reconnectHelper()");
    expect(pairing).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(p.id("result").textContent).toContain("Wait for the current operation");
  });

  it("captures leaf pixels plus the document composite, disposes images, and reports bounded batch progress", async () => {
    const p = await panel();
    const doc = syntheticDocument(1, Array.from({ length: 9 }, (_, index) => syntheticLayer(index + 1)));
    const progress = vi.fn();
    const result = await p.evaluate("core.executeAsModal(() => captureDocument(testDocument, { progress: testProgress }))", { testDocument: doc, testProgress: progress });
    expect(result.layers).toHaveLength(9);
    expect(result.layers.every((layer: any) => layer.content.fingerprint.startsWith("pixels-v1:"))).toBe(true);
    expect(result.document.renderedFingerprint).toMatch(/^pixels-v1:/);
    expect(p.imaging.getPixels).toHaveBeenCalledTimes(10);
    expect(p.pixels.dispose).toHaveBeenCalledTimes(10);
    expect(progress.mock.calls).toEqual([[4, 9], [8, 9], [9, 9]]);
  });

  it("coalesces repeated notifications into one pending automatic scan", async () => {
    const p = await panel();
    p.connect();
    const scan = vi.fn(async () => undefined); p.context.scanChanges = scan;
    p.evaluate('onPhotoshopNotification("make"); onPhotoshopNotification("move"); onPhotoshopNotification("set")');
    const pending = [...p.timers.values()].filter(timer => timer.delay === 700);
    expect(pending).toHaveLength(1);
    pending[0]!.callback();
    expect(scan).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith({ automatic: true, eventName: "set" });
  });

  it("keeps activity text literal and resets its count", async () => {
    const p = await panel();
    p.evaluate('log("<img src=x>"); log("Second event"); clearActivity()');
    expect(p.id("activity-count").textContent).toBe("0");
    expect(p.id("activity").textContent).toBe("Ready.");
    expect(p.id("activity").querySelector("img")).toBeNull();
  });
  it("collapses technical activity details and bounds the visible log", async () => {
    const p = await panel();
    p.evaluate('log("Long event ".repeat(40))');
    const toggle = p.id("activity").querySelector('[role="button"]') as HTMLElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    p.keyboard(toggle, "Enter");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    p.evaluate('for (let i = 0; i < 60; i++) log("Event " + i)');
    expect(p.id("activity").children.length).toBe(50);
  });
});

describe("PhotoGit appearance — shared startup and preference behavior", () => {
  async function appearance(saved: string | null = null, fails = false) {
    const { document, window } = parseHTML(await readFile(resolve(pluginRoot, "index.html"), "utf8"));
    const localStorage = { getItem: () => { if (fails) throw new Error("Unavailable"); return saved; }, setItem: vi.fn((_key: string, value: string) => { if (fails) throw new Error("Unavailable"); saved = value; }) };
    const source = await readFile(resolve(pluginRoot, "appearance.js"), "utf8");
    const context = createContext({ document, localStorage });
    runInContext(source, context);
    return { document, window, localStorage, reload: () => runInContext(source, context) };
  }
  it.each([null, "invalid", "dark"])("defaults safely from %s", async saved => {
    const p = await appearance(saved);
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
  it("applies light synchronously, changes via keyboard, and persists after reload", async () => {
    const p = await appearance("light");
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    const toggle = p.document.getElementById("appearance-toggle")!;
    expect(toggle.getAttribute("aria-label")).toBe("Switch to Dark mode");
    const event = new p.window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: "Enter" }); toggle.dispatchEvent(event);
    expect(p.localStorage.setItem).toHaveBeenCalledWith("photogit.appearance", "dark");
    p.reload();
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(toggle.getAttribute("aria-label")).toBe("Switch to Light mode");
    expect(p.document.querySelector(".appearance-group")).toBeNull();
  });
  it("survives unavailable preference storage and explains session-only appearance", async () => {
    const p = await appearance(null, true);
    (p.document.getElementById("appearance-toggle") as HTMLElement).click();
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.document.getElementById("appearance-note")!.textContent).toContain("storage is unavailable");
    expect(p.document.getElementById("appearance-note")!.hidden).toBe(false);
  });
  it("toggles when the icon is clicked, updates its action name and keeps success quiet", async () => {
    const p = await appearance("dark");
    p.document.querySelector(".theme-sun path")!.dispatchEvent(new p.window.Event("click", { bubbles: true }));
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.document.getElementById("appearance-toggle")!.getAttribute("title")).toBe("Switch to Dark mode");
    expect(p.document.getElementById("appearance-note")!.hidden).toBe(true);
  });
  it("supports Space without repeating the toggle when the key is held", async () => {
    const p = await appearance("dark");
    const toggle = p.document.getElementById("appearance-toggle")!;
    for (const repeat of [false, true]) {
      const event = new p.window.Event("keydown", { bubbles: true, cancelable: true });
      Object.assign(event, { key: " ", repeat }); toggle.dispatchEvent(event);
    }
    expect(p.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(p.localStorage.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("PhotoGit production helper result validation — host mocked", () => {
  it.each([
    ["status", { branch: "main", changeCount: -1 }],
    ["history", { versions: [{ id: "x", shortId: "x", author: "A", date: "2026", message: "bad\u001bcontrol" }] }],
    ["refresh", { changes: [change(1, { domain: "not-a-domain" })] }],
    ["refresh", { changes: [change(1, { photoshopId: -2 })] }],
    ["refresh", { changes: [], comparisonWarnings: "not an array" }],
    ["refresh", { changes: [], comparisonWarnings: ["invalid\u001bcontrol"] }],
    ["openVersion", { snapshotPath: "/private/secret.psd" }],
    ["openVersion", { snapshotPath: ".photogit/recovered/../../secret.psd" }],
    ["openVersion", { snapshotPath: ".photogit/recovered/file.psd/extra" }],
    ["pullRequestLink", { url: "https://github.com.evil.example/person/project/compare/main...branch" }],
    ["pullRequestLink", { url: "http://github.com/person/project/compare/main...branch" }],
    ["versionDetails", { files: [], changes: [], snapshotAvailable: "yes" }],
    ["compareBranches", { baseBranch: "main", incomingBranch: "feature", ahead: -1, behind: 0, files: [], changes: [], conflicts: [], warnings: [], gitMergeable: true }]
  ])("rejects malformed %s data", async (operation, value) => {
    const p = await panel();
    expect(() => p.evaluate("validateHelperResult(operation, value)", { operation, value })).toThrow();
  });

  it("accepts only safe local recovery paths and typed version details", async () => {
    const p = await panel();
    const recovered = { snapshotPath: ".photogit/recovered/version-123.psd" };
    expect(p.evaluate('validateHelperResult("openVersion", value)', { value: recovered })).toEqual(recovered);
    const details = { files: [{ status: "M", path: "snapshot/document.psd" }], changes: [{ summary: "Layer changed" }], snapshotAvailable: true };
    expect(p.evaluate('validateHelperResult("versionDetails", value)', { value: details })).toEqual(details);
  });
});

describe("PhotoGit production bridge client lifecycle — filesystem mocked", () => {
  it("writes an authenticated request and ready marker and consumes its matching response", async () => {
    const p = await bridgePanel({ protocolVersion: 1, requestId: "host-mock-request", ok: true, result: { branch: "main", changeCount: 2 } });
    expect(await p.evaluate('callHelper("status")')).toMatchObject({ branch: "main", changeCount: 2 });
    const envelope = JSON.parse(p.requests.entries.get("host-mock-request.json").content);
    expect(envelope.token).toBe("host-mock-token");
    expect(envelope.request).toMatchObject({ operation: "status", projectRoot: "/synthetic-project", requestId: "host-mock-request" });
    expect(envelope.expiresAt).toBeGreaterThan(Date.now());
    expect(p.requests.entries.has("host-mock-request.ready")).toBe(true);
    expect(p.responses.entries.size).toBe(0);
  });

  it("cleans both request and response files after a timeout", async () => {
    const p = await bridgePanel();
    await expect(p.evaluate('callHelper("status", {}, 0)')).rejects.toThrow("offline or did not answer");
    expect(p.requests.entries.size).toBe(0);
    expect(p.responses.entries.size).toBe(0);
  });

  it.each(["capture", "switchBranch", "createBranch", "pull", "push", "mergeBranch", "createTag", "connectDocument"])("marks %s timeout as an unknown outcome requiring recovery", async (operation) => {
    const p = await bridgePanel();
    await expect(p.evaluate("callHelper(operation, {}, 0)", { operation })).rejects.toMatchObject({
      details: { outcome: "recovery_required", outcomeUnknown: true, operation }
    });
    expect(p.requests.entries.size).toBe(0);
    expect(p.responses.entries.size).toBe(0);
  });

  it("refreshes and routes an unknown mutation outcome to history instead of retrying it", async () => {
    const p = await bridgePanel();
    const refresh = vi.fn(async () => undefined); p.context.refreshWorkspace = refresh;
    await p.evaluate('run("Saving", () => callHelper("capture", {}, 0))');
    expect(refresh).toHaveBeenCalledOnce();
    expect(p.id("detail-title").textContent).toBe("Repository recovery needed");
    expect(p.id("detail-content").textContent).toContain("The final state is not confirmed");
    expect(p.id("detail-content").textContent).toContain("may already have completed");
    expect(p.id("detail-action").textContent).toBe("View history");
    p.evaluate("detailAction()");
    expect(p.id("history-view").hidden).toBe(false);
    expect(p.id("detail-sheet").hidden).toBe(true);
    expect(p.id("workspace").getAttribute("aria-busy")).toBe("false");
  });

  it("preserves typed Git mutation details from the actual helper error envelope", async () => {
    const p = await bridgePanel({ protocolVersion: 1, requestId: "host-mock-request", ok: false, error: {
      code: "RECOVERY_REQUIRED", message: "Checkout changed Git before snapshot opening failed", outcome: "recovery_required", gitChanged: true, branch: "feature"
    } });
    await expect(p.evaluate('callHelper("switchBranch", { branch: "feature" })')).rejects.toMatchObject({
      code: "RECOVERY_REQUIRED", details: { outcome: "recovery_required", gitChanged: true, branch: "feature" }
    });
    expect(p.responses.entries.size).toBe(0);
  });

  it("rejects mismatched response IDs and cleans received files", async () => {
    const p = await bridgePanel({ protocolVersion: 1, requestId: "someone-else", ok: true, result: { branch: "main", changeCount: 0 } });
    await expect(p.evaluate('callHelper("status")')).rejects.toThrow("invalid response");
    expect(p.responses.entries.size).toBe(0);
  });

  it("cleans malformed JSON and oversized response files", async () => {
    for (const body of ["{bad-json", "x".repeat(5 * 1024 * 1024 + 1)]) {
      const p = await bridgePanel(body);
      await expect(p.evaluate('callHelper("status")')).rejects.toThrow();
      expect(p.responses.entries.size).toBe(0);
    }
  });

  it("bounds request bytes before publishing any bridge file", async () => {
    const p = await bridgePanel();
    await expect(p.evaluate('callHelper("refresh", { huge: text })', { text: "é".repeat(3 * 1024 * 1024) })).rejects.toThrow("too large");
    expect(p.requests.entries.size).toBe(0);
  });
});

describe("PhotoGit production scan coordinator — host independent", () => {
  it("runs only the latest queued request and discards an obsolete result", async () => {
    const coordinator = new model.ScanCoordinator();
    const gate = deferred<void>();
    const events: string[] = [];
    const first = coordinator.request(async (check: () => void) => { events.push("first started"); await gate.promise; check(); events.push("first applied"); });
    coordinator.request(async () => { events.push("middle applied"); });
    const latest = coordinator.request(async () => { events.push("latest applied"); });
    gate.resolve();
    await Promise.all([first, latest]);
    expect(events).toEqual(["first started", "latest applied"]);
    expect(coordinator.running).toBeNull();
  });

  it("settles a failing batch before releasing the scan gate", async () => {
    const gate = deferred<void>();
    const events: string[] = [];
    const operation = model.inBatches([1, 2], async (item: number) => {
      if (item === 1) throw new Error("pixel failure");
      await gate.promise; events.push("second settled");
    }, { batchSize: 2 });
    const failed = expect(operation).rejects.toThrow("pixel failure");
    await settle();
    expect(events).toEqual([]);
    gate.resolve();
    await failed;
    expect(events).toEqual(["second settled"]);
  });

  it("honors cancellation between batches and enforces the scan time budget", async () => {
    const visited: number[] = [];
    let cancelled = false;
    await expect(model.inBatches([1, 2, 3], async (value: number) => { visited.push(value); }, {
      batchSize: 2,
      check: () => { if (cancelled) throw new model.StaleScanError(); },
      progress: () => { cancelled = true; }
    })).rejects.toThrow("Scan cancelled");
    expect(visited).toEqual([1, 2]);
    let clock = 0;
    await expect(model.inBatches([1], async () => undefined, { now: () => (clock += 31000), budgetMs: 30000 })).rejects.toThrow("Scan paused");
  });

  it("matches saved documents by path and unsaved documents only by session identity", () => {
    expect(model.sameDocument({ documentId: "1", sourcePath: "/a.psd" }, { documentId: "2", sourcePath: "/a.psd" })).toBe(true);
    expect(model.sameDocument({ documentId: "1", sourcePath: "/a.psd" }, { documentId: "1", sourcePath: "/b.psd" })).toBe(false);
    expect(model.sameDocument({ documentId: "1", sourcePath: null }, { documentId: "2", sourcePath: null })).toBe(false);
    expect(model.sameDocument({ documentId: "1", sourcePath: null }, { documentId: "1", sourcePath: null })).toBe(true);
  });
});
