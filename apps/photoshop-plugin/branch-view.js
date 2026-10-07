// Shared branch presentation. The caller owns confirmation, Git operations and PSD recovery.
(() => {
// Same strict rule as the version inspector: only helper-decoded base64 raster
// data, never remote URLs, SVG or arbitrary paths.
function safePreview(src) {
  return typeof src === "string" && src.length <= 8_000_000 &&
    /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}

// Local demo artwork, kept to the same restricted shape the version inspector
// allows: relative assets only, never remote URLs, SVG or data URIs.
function safeDemoPreview(src) {
  return typeof src === "string" &&
    /^(?:\.\/)?assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(src);
}

// What a branch last holds, in the words it was saved with: the latest
// version's message and day. A record without either says only what is known.
function latestVersion(branch, dateLabel) {
  const subject = typeof branch.subject === "string" ? branch.subject.trim() : "";
  const day = typeof dateLabel === "function" && typeof branch.date === "string" && /^\d{4}-\d{2}-\d{2}T/.test(branch.date) ? String(dateLabel(branch.date)) : "";
  return [subject, day].filter(Boolean).join(" · ") || "Local branch";
}

function render(container, { branches = [], current, onSwitch, previews, demoPreviews, dateLabel } = {}) {
  const document = container.ownerDocument;
  container.textContent = "";
  container.classList.add("branch-list");
  container.setAttribute("role", "list");
  container.setAttribute("aria-label", "Branches");
  const entries = Array.isArray(branches) ? branches.filter(branch => typeof branch?.name === "string" && branch.name.trim()) : [];
  const currentName = typeof current === "string" && current ? current : entries.find(branch => branch.current === true)?.name;
  const ordered = [...entries.filter(branch => branch.name === currentName), ...entries.filter(branch => branch.name !== currentName)];
  const previewFor = name => {
    const src = previews && typeof previews === "object" ? previews[name] : undefined;
    if (safePreview(src)) return src;
    const demo = demoPreviews && typeof demoPreviews === "object" ? demoPreviews[name] : undefined;
    return safeDemoPreview(demo) ? demo : null;
  };
  container.classList.toggle("branch-list-cards", ordered.some(branch => previewFor(branch.name)));
  if (!ordered.length) {
    const empty = document.createElement("p");
    empty.className = "branch-list-empty fine-print";
    empty.setAttribute("role", "status");
    empty.textContent = "Save a version to create your first branch.";
    container.appendChild(empty);
    return container;
  }
  // The row is the control: pressing a branch switches to it, and the current
  // branch is the highlighted row. There is no separate button or badge.
  for (const branch of ordered) {
    const isCurrent = branch.name === currentName;
    const row = document.createElement("div");
    row.className = `branch-row${isCurrent ? " current" : ""}`;
    row.setAttribute("role", "listitem");
    const switchable = !isCurrent && typeof onSwitch === "function";
    if (isCurrent) {
      row.setAttribute("aria-current", "true");
      row.setAttribute("aria-label", `${branch.name}, current branch`);
    }
    const previewSrc = previewFor(branch.name);
    if (previewSrc) {
      row.classList.add("has-preview");
      const figure = document.createElement("figure");
      figure.className = "branch-row-preview";
      const image = document.createElement("img");
      image.alt = `Latest saved preview on ${branch.name}`;
      image.addEventListener("error", () => { row.classList.remove("has-preview"); figure.remove(); });
      image.src = previewSrc;
      figure.appendChild(image);
      row.appendChild(figure);
    }
    const icon = document.createElement("span");
    icon.className = "branch-row-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m2-2c6 0 8-2 8-6"/></svg>';
    row.appendChild(icon);
    const copy = document.createElement("div");
    copy.className = "branch-row-copy";
    const name = document.createElement("strong");
    name.textContent = branch.name;
    copy.appendChild(name);
    const meta = document.createElement("span");
    meta.textContent = latestVersion(branch, dateLabel);
    meta.title = meta.textContent;
    copy.appendChild(meta);
    row.appendChild(copy);
    if (switchable) {
      row.classList.add("is-switchable");
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Switch to ${branch.name}`);
      row.setAttribute("aria-pressed", "false");
      row.tabIndex = 0;
      const activate = () => {
        if (row.getAttribute("aria-disabled") === "true" || row.closest("[hidden]") ||
          document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
        onSwitch(branch.name);
      };
      row.addEventListener("click", activate);
      row.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
        event.preventDefault(); event.stopPropagation(); activate();
      });
    }
    container.appendChild(row);
  }
  // Decoration over a list that is already complete and interactive: the
  // cards step in on the same capped stagger as the change and history rows.
  const reveal = globalThis.PhotoGitReveal;
  if (reveal && typeof reveal.stagger === "function") reveal.stagger(container.querySelectorAll(".branch-row"));
  return container;
}
if (typeof module !== "undefined") module.exports = { render };
else window.PhotoGitBranches = { render };
})();
