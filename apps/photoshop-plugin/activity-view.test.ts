import { createRequire } from "node:module";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const view = require("./activity-view.js");
function fixture() {
  const { document, window } = parseHTML('<html><body><div id="feed"></div></body></html>');
  const feed = document.getElementById("feed")!;
  const key = (element: Element, value: string, extra = {}) => {
    const event = new window.Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, ...extra }); element.dispatchEvent(event);
  };
  return { document, feed, key };
}
const at = (time: string) => ({ now: new Date(`2026-10-01T${time}`) });

describe("activity feed", () => {
  it("starts and clears to the shared empty state rather than a bare word", () => {
    const p = fixture(); view.clear(p.feed);
    expect(p.feed.querySelector(".empty-state strong")!.textContent).toBe("No activity yet");
    view.log(p.feed, "Saved abc1234: Cover update", at("17:25:00"));
    expect(p.feed.querySelector(".empty-state")).toBeNull();
    view.clear(p.feed);
    expect(p.feed.querySelectorAll(".activity-row")).toHaveLength(0);
    expect(p.feed.querySelector(".empty-state")).not.toBeNull();
  });

  it("renders an event as a list row: glyph, literal text, and its time, newest first", () => {
    const p = fixture();
    view.log(p.feed, "Saved abc1234: Cover update", at("17:25:00"));
    view.log(p.feed, '<img src=x onerror="bad()">', at("17:26:00"));
    const rows = [...p.feed.querySelectorAll(".activity-row")];
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.classList.contains("list-row") && row.querySelector(".row-glyph svg") && row.querySelector("time"))).toBe(true);
    expect(rows[0]!.querySelector(".activity-copy")!.textContent).toBe('<img src=x onerror="bad()">');
    expect(p.feed.querySelector("img")).toBeNull();
    expect(rows[1]!.querySelector("time")!.getAttribute("datetime")).toBe(new Date("2026-10-01T17:25:00").toISOString());
    // No brackets, no underlined link text, no bare punctuation as an icon.
    expect(p.feed.textContent).not.toMatch(/[[\]]|details|·\s*$/);
    expect(p.feed.querySelector(".text-link")).toBeNull();
  });

  it("marks a failure with the error glyph and leaves ordinary events unmarked", () => {
    const p = fixture();
    view.log(p.feed, "Switched to cover-b.", at("17:00:00"));
    view.log(p.feed, "Error: The PhotoGit helper is offline or did not answer in time.", at("17:01:00"));
    const [failed, fine] = [...p.feed.querySelectorAll(".activity-row")];
    expect(failed!.classList.contains("is-error")).toBe(true);
    expect(failed!.querySelector(".activity-glyph.error")).not.toBeNull();
    expect(fine!.querySelector(".activity-glyph.error")).toBeNull();
  });

  it("folds consecutive scans into one row that opens to the individual scans", () => {
    const p = fixture();
    view.log(p.feed, "Read 7 layers and compared them with the last saved version.", at("17:24:00"));
    view.log(p.feed, "3 unsaved edits found.", at("17:24:01"));
    expect(p.feed.children).toHaveLength(1);
    const row = p.feed.querySelector(".activity-row")!;
    expect(row.querySelector("strong")!.textContent).toBe("Change detection");
    expect(row.querySelector(".activity-meta")!.textContent).toBe("3 unsaved edits found. · 2 recent events");
    const details = p.feed.querySelector(".activity-details") as HTMLElement;
    expect(details.hidden).toBe(true);
    expect(row.getAttribute("role")).toBe("button");
    (row as HTMLElement).click();
    expect(details.hidden).toBe(false);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect([...details.querySelectorAll("li")].map(line => line.lastElementChild!.textContent)).toEqual(["3 unsaved edits found.", "Read 7 layers and compared them with the last saved version."]);
    p.key(row, "Enter"); expect(details.hidden).toBe(true);
    p.key(row, " ", { repeat: true }); expect(details.hidden).toBe(true);
    // A user action in between starts a new group, so order stays truthful.
    view.log(p.feed, "Saved abc1234: Cover update", at("17:25:00"));
    view.log(p.feed, "0 unsaved edits found.", at("17:25:02"));
    expect(p.feed.children).toHaveLength(3);
    expect(p.feed.firstElementChild!.querySelector(".activity-meta")!.textContent).toBe("0 unsaved edits found.");
  });

  it("shortens a long event and makes the row the control that opens the full text", () => {
    const p = fixture();
    const long = "Long event ".repeat(40).trim();
    view.log(p.feed, long, at("17:30:00"));
    const row = p.feed.querySelector(".activity-row") as HTMLElement;
    expect(row.querySelector(".activity-copy")!.textContent!.length).toBe(161);
    const details = p.feed.querySelector(".activity-details") as HTMLElement;
    expect(details.textContent).toBe(long);
    row.click(); expect(details.hidden).toBe(false);
  });

  it("keeps the feed and each scan group bounded", () => {
    const p = fixture();
    for (let index = 0; index < 70; index += 1) view.log(p.feed, `Event ${index}`, at("17:00:00"));
    expect(p.feed.children).toHaveLength(50);
    expect(p.feed.firstElementChild!.textContent).toContain("Event 69");
    for (let index = 0; index < 70; index += 1) view.log(p.feed, `${index} unsaved edits found.`, at("17:00:00"));
    expect(p.feed.querySelectorAll(".activity-scan .activity-details li")).toHaveLength(50);
    expect(p.feed.children).toHaveLength(50);
  });
});
