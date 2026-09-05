// macOS visual inspection only. Requires a loaded PhotoGit debugger in UDT.
// Navigates tabs and changes panel appearance; never saves/switches/merges artwork.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const windowId = process.argv[2];
if (!/^\d+$/.test(windowId || "")) throw new Error("Pass the confirmed PhotoGit native window ID, then an artifact directory.");
const out = resolve(process.argv[3] || "artifacts/native-design");
mkdirSync(out, { recursive: true });
const evaluate = expression => JSON.parse(execFileSync(process.execPath, ["scripts/photoshop-panel-evaluate.mjs", expression, "--timeout-ms", "4000"], { encoding: "utf8", timeout: 6000 }));
const settle = () => new Promise(resolve => setTimeout(resolve, 150));
const original = evaluate(`({theme:document.documentElement.getAttribute("data-theme"),tab:Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.getAttribute("aria-selected")==="true").id})`);
const results = [];
try {
  for (const theme of ["dark", "light"]) {
    evaluate(`(() => { if(document.documentElement.getAttribute("data-theme")!==${JSON.stringify(theme)}) document.getElementById("appearance-toggle").dispatchEvent(new Event("click",{bubbles:true})); return true; })()`);
    await new Promise(resolve => setTimeout(resolve, 280));
    for (const view of ["changes", "history", "branches", "reviews", "activity", "docs"]) {
      const state = evaluate(`(() => {
        document.getElementById(${JSON.stringify(view + "-tab")}).dispatchEvent(new Event("click",{bubbles:true})); document.body.scrollTop=0;
        const body=document.body.getBoundingClientRect();
        return {theme:document.documentElement.getAttribute("data-theme"),view:${JSON.stringify(view)},active:!document.getElementById(${JSON.stringify(view + "-view")}).hidden,loading:!document.getElementById("startup-state").hidden,width:body.width,height:body.height};
      })()`);
      if (!state.active || state.loading || state.theme !== theme || !state.width) throw new Error(JSON.stringify(state));
      await settle();
      state.screenshot = `native-${theme}-${view}-${state.width}x${state.height}.png`;
      execFileSync("screencapture", ["-x", "-l", windowId, resolve(out, state.screenshot)]);
      results.push(state);
      console.log(`${theme} ${view}: ${state.width}×${state.height}`);
    }
  }
} finally {
  evaluate(`(() => { if(document.documentElement.getAttribute("data-theme")!==${JSON.stringify(original.theme)}) document.getElementById("appearance-toggle").dispatchEvent(new Event("click",{bubbles:true})); document.getElementById(${JSON.stringify(original.tab)}).dispatchEvent(new Event("click",{bubbles:true})); document.body.scrollTop=0; return true; })()`);
}
writeFileSync(resolve(out, "native-matrix.json"), JSON.stringify({ native: true, platform: "macOS", backingScale: 2, note: "Captured actual window without viewport overrides. Screenshots require visual inspection; this is not Photoshop mutation or physical keyboard acceptance.", results }, null, 2));
