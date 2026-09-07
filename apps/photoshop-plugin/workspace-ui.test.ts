import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ui = require("./workspace-ui.js");
async function fixture() {
  const { document, window } = parseHTML(await readFile(resolve("apps/photoshop-plugin/index.html"), "utf8"));
  document.body.classList.remove("is-initializing");
  const id = (name: string) => document.getElementById(name)! as HTMLElement;
  id("workspace").hidden = false;
  id("startup-state").hidden = true;
  const rows = ["text", "content", "structure", "appearance", "document"].map((domain, i) => {
    const row = document.createElement("div");
    row.className = "change-row"; row.dataset.domain = domain;
    row.textContent = `${i === 0 ? "Title" : "Artwork"} Layer #${i + 1} ${domain}`;
    id("changes").appendChild(row);
    return row;
  });
  const navigate = vi.fn(); const openCommands = vi.fn();
  const options = { navigate, openCommands };
  const controls = ui.setup(document, options);
  const input = id("changes-search") as HTMLInputElement;
  const search = (value: string) => { input.value = value; input.dispatchEvent(new window.Event("input")); };
  const chip = (type: string) => document.querySelector(`[data-change-filter="${type}"]`)! as HTMLElement;
  const visible = () => rows.filter(row => !row.hidden);
  const key = (target: HTMLElement, value: string, extra: object = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, ...extra }); target.dispatchEvent(event); return event;
  };
  return { document, window, id, rows, input, search, chip, visible, key, navigate, openCommands, controls, options };
}

describe("Studio workspace interactions", () => {
  it("combines type and case-insensitive text filters without changing the source rows", async () => {
    const p = await fixture();
    p.chip("visual").click(); expect(p.visible()).toHaveLength(3);
    p.search(" #2 "); expect(p.visible()).toEqual([p.rows[1]]);
    expect(p.id("change-filter-count").textContent).toBe("1 of 5 listed edits · display filter only");
    expect(p.id("changes").children).toHaveLength(5);
    p.chip("text").click(); p.search("TITLE"); expect(p.visible()).toEqual([p.rows[0]]);
    p.chip("structure").click(); p.search(""); expect(p.visible()).toEqual([p.rows[2]]);
  });
  it("shows a distinct no-match state and resets both filters with one action", async () => {
    const p = await fixture(); p.chip("text").click(); p.search("missing");
    expect(p.id("change-filter-empty").hidden).toBe(false);
    const focus = vi.spyOn(p.input, "focus");
    p.id("reset-change-filters").click();
    expect(p.visible()).toHaveLength(5);
    expect(p.chip("all").getAttribute("aria-pressed")).toBe("true");
    expect(p.id("change-filter-count").hidden).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });
  it("treats markup in a search as text, never as HTML or a selector", async () => {
    const p = await fixture(); p.search('<img src=x onerror="alert(1)">');
    expect(p.visible()).toHaveLength(0); expect(p.id("changes").querySelector("img")).toBeNull();
  });
  it("retains the filter after a fresh scan and clears stale filters once no edits remain", async () => {
    const p = await fixture(); p.chip("text").click();
    p.rows[0].dataset.domain = "structure"; p.controls.refreshChanges();
    expect(p.visible()).toHaveLength(0);
    p.id("changes").innerHTML = ""; p.controls.refreshChanges();
    expect(p.id("change-filters").hidden).toBe(true);
    expect(p.id("change-filter-empty").hidden).toBe(true);
    expect(p.chip("all").getAttribute("aria-pressed")).toBe("true");
  });
  it("supports keyboard filters and branch navigation without invoking a Git operation", async () => {
    const p = await fixture();
    p.key(p.chip("text"), " "); expect(p.visible()).toHaveLength(1);
    const link = p.document.querySelector("[data-destination]")! as HTMLElement;
    const focus = vi.spyOn(p.id("branches-tab"), "focus");
    p.key(link, "Enter"); expect(p.navigate).toHaveBeenCalledWith("branches");
    expect(focus).toHaveBeenCalledOnce();
  });
  it("opens commands with slash or Cmd/Ctrl K but never steals slash from text fields", async () => {
    const p = await fixture();
    p.key(p.id("changes-tab"), "/");
    p.key(p.input, "/"); expect(p.openCommands).toHaveBeenCalledTimes(1);
    p.key(p.input, "k", { metaKey: true }); p.key(p.input, "k", { ctrlKey: true });
    expect(p.openCommands).toHaveBeenCalledTimes(3);
    p.key(p.input, "k", { metaKey: true, repeat: true });
    p.key(p.input, "k", { metaKey: true, isComposing: true });
    expect(p.openCommands).toHaveBeenCalledTimes(3);
  });
  it.each(["detail-sheet", "tag-sheet", "tools-menu"])("does not replace an open %s with a shortcut", async sheet => {
    const p = await fixture(); p.id(sheet).hidden = false;
    p.key(p.id("changes-tab"), "/"); p.chip("text").click();
    expect(p.openCommands).not.toHaveBeenCalled(); expect(p.visible()).toHaveLength(5);
  });
  it.each(["is-initializing", "is-busy"])("does not open commands during %s", async state => {
    const p = await fixture(); p.document.body.classList.add(state);
    p.key(p.id("changes-tab"), "/");
    expect(p.openCommands).not.toHaveBeenCalled();
  });
  it("binds listeners once even when setup is repeated", async () => {
    const p = await fixture(); ui.setup(p.document, p.options);
    p.key(p.id("changes-tab"), "/"); expect(p.openCommands).toHaveBeenCalledOnce();
  });
});

describe("Version-message presentation controls", () => {
  it("tracks typed and programmatically reset messages against the actual 500-character limit", async () => {
    const p = await fixture(); const message = p.id("message") as HTMLInputElement;
    expect(message.getAttribute("maxlength")).toBe("500");
    expect(p.id("message-count").textContent).toBe("0/500");
    message.value = "Color 🎨"; message.dispatchEvent(new p.window.Event("input"));
    expect(p.id("message-count").textContent).toBe(`${message.value.length}/500`);
    message.value = ""; p.controls.refreshChanges();
    expect(p.id("message-count").textContent).toBe("0/500");
  });
  it("appends literal suggestions, updates the count, and focuses the draft without running a command", async () => {
    const p = await fixture(); const message = p.id("message") as HTMLInputElement;
    const preset = p.document.querySelector<HTMLElement>("[data-message-preset]")!;
    const focus = vi.spyOn(message, "focus");
    preset.click();
    expect(message.value).toBe(preset.dataset.messagePreset);
    message.value = "Existing draft";
    p.key(preset, "Enter");
    expect(message.value).toBe(`Existing draft · ${preset.dataset.messagePreset}`);
    expect(p.id("message-count").textContent).toBe(`${message.value.length}/500`);
    expect(focus).toHaveBeenCalledTimes(2);
    expect(p.navigate).not.toHaveBeenCalled(); expect(p.openCommands).not.toHaveBeenCalled();
  });
  it("accepts an exact-limit suggestion but never truncates a draft that is already too long to append", async () => {
    const p = await fixture(); const message = p.id("message") as HTMLInputElement;
    const preset = p.document.querySelector<HTMLElement>("[data-message-preset]")!;
    message.value = "x".repeat(500 - preset.dataset.messagePreset!.length - 3);
    preset.click(); expect(message.value).toHaveLength(500);
    expect(p.id("message-count").textContent).toBe("500/500");
    const preserved = message.value; preset.click();
    expect(message.value).toBe(preserved);
  });
  it("preserves an existing draft exactly when adding a suggestion", async () => {
    const p = await fixture(); const message = p.id("message") as HTMLInputElement;
    const preset = p.document.querySelector<HTMLElement>("[data-message-preset]")!;
    message.value = "  Spaced draft  "; preset.click();
    expect(message.value).toBe(`  Spaced draft   · ${preset.dataset.messagePreset}`);
  });
  it.each(["is-busy", "is-initializing", "detail-sheet", "tag-sheet", "tools-menu", "hidden", "disabled"])("does not change the draft or steal focus while %s", async state => {
    const p = await fixture(); const message = p.id("message") as HTMLInputElement;
    const preset = p.document.querySelector<HTMLElement>("[data-message-preset]")!;
    const focus = vi.spyOn(message, "focus"); message.value = "Keep my draft";
    if (state.startsWith("is-")) p.document.body.classList.add(state);
    else if (state === "hidden") p.id("changes-view").hidden = true;
    else if (state === "disabled") preset.setAttribute("aria-disabled", "true");
    else p.id(state).hidden = false;
    preset.click(); p.key(preset, " ");
    expect(message.value).toBe("Keep my draft"); expect(focus).not.toHaveBeenCalled();
  });
  it("ignores key repeats and composition events and does not duplicate listeners", async () => {
    const p = await fixture(); const message = p.id("message") as HTMLInputElement;
    const preset = p.document.querySelector<HTMLElement>("[data-message-preset]")!;
    ui.setup(p.document, p.options);
    p.key(preset, "Enter", { repeat: true });
    p.key(preset, "Enter", { isComposing: true });
    expect(message.value).toBe("");
    p.key(preset, " "); expect(message.value).toBe(preset.dataset.messagePreset);
  });
});

describe("Shared command-row renderer", () => {
  const command = { id: "branch", label: "Create a branch", example: "branch My direction", description: "Explore another design." };
  it("renders dynamic command content as text with one decorative icon", async () => {
    const p = await fixture(); const activate = vi.fn();
    const row = ui.commandRow(p.document, { id: "<img src=x>", label: "<img src=x onerror=fail()>", example: "save <b>Draft</b>", description: "<script>fail()</script>" }, activate);
    p.document.body.appendChild(row);
    expect(row.querySelector("strong").textContent).toBe("<img src=x onerror=fail()>");
    expect(row.querySelector("code").textContent).toBe("/save <b>Draft</b>");
    expect(row.querySelector(".command-copy > span").textContent).toBe("<script>fail()</script>");
    expect(row.querySelector("img, script, b")).toBeNull();
    expect(row.querySelectorAll("svg")).toHaveLength(1);
    expect(row.querySelector(".command-glyph").getAttribute("aria-hidden")).toBe("true");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(activate).not.toHaveBeenCalled();
  });
  it("supports click, Enter and Space exactly once without handling navigation keys", async () => {
    const p = await fixture(); const activate = vi.fn();
    const row = ui.commandRow(p.document, command, activate); p.document.body.appendChild(row);
    row.querySelector("code").click();
    expect(p.key(row, "Enter").defaultPrevented).toBe(true);
    expect(p.key(row, " ").defaultPrevented).toBe(true);
    p.key(row, "ArrowDown"); p.key(row, "Escape"); p.key(row, "Enter", { repeat: true });
    expect(activate).toHaveBeenCalledTimes(3);
  });
  it.each(["disabled", "hidden", "is-busy", "is-initializing", "composing"])("does not activate a command while %s", async state => {
    const p = await fixture(); const activate = vi.fn();
    const row = ui.commandRow(p.document, command, activate); p.document.body.appendChild(row);
    if (state === "disabled") row.setAttribute("aria-disabled", "true");
    else if (state === "hidden") row.hidden = true;
    else if (state.startsWith("is-")) p.document.body.classList.add(state);
    if (state !== "composing") row.click();
    p.key(row, "Enter", { isComposing: state === "composing" });
    expect(activate).not.toHaveBeenCalled();
  });
});
