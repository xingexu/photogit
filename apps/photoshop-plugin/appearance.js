// Synchronous startup: apply preference before the panel's first paint.
// Shared by the native panel and the explicitly simulated browser preview.
(function () {
  const key = "photogit.appearance";
  function apply(value, persist = false) {
    const theme = value === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    const control = document.getElementById("appearance-toggle");
    if (control) {
      const label = theme === "light" ? "Switch to Dark mode" : "Switch to Light mode";
      control.setAttribute("aria-label", label);
      control.setAttribute("title", label);
    }
    if (persist) {
      try { localStorage.setItem(key, theme); }
      catch { return false; }
    }
    return true;
  }
  function restore() {
    let saved = "dark";
    try { saved = localStorage.getItem(key); } catch { /* Safe default. */ }
    apply(saved);
  }
  restore();
  document.addEventListener("DOMContentLoaded", restore);
  document.addEventListener("click", event => {
    const control = event.target.closest("#appearance-toggle");
    if (!control) return;
    const saved = apply(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light", true);
    const note = document.getElementById("appearance-note");
    if (note) { note.hidden = saved; note.textContent = saved ? "" : "Appearance changed for this session. Preference storage is unavailable."; }
  });
  document.addEventListener("keydown", event => {
    if (!["Enter", " "].includes(event.key) || event.repeat || !event.target.matches("#appearance-toggle")) return;
    event.preventDefault();
    event.stopPropagation();
    event.target.click();
  });
})();
