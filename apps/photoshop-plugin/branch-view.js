// Shared branch presentation. The caller owns confirmation, Git operations and PSD recovery.
(() => {
// Same strict rule as the version inspector: only helper-decoded base64 raster
// data, never remote URLs, SVG or arbitrary paths.
function safePreview(src) {
  return typeof src === "string" && src.length < 24_000_000 &&
    /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
}

// Local demo artwork, kept to the same restricted shape the version inspector
// allows: relative assets only, never remote URLs, SVG or data URIs.
function safeDemoPreview(src) {
  return typeof src === "string" &&
    /^(?:\.\/)?assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(src);
}

function render(container, { branches = [], current, onSwitch, previews, demoPreviews } = {}) {
  const document = container.ownerDocument;
  container.textContent = "";
  container.classList.add("branch-list");
  container.setAttribute("role", "list");
  container.setAttribute("aria-label", "Design directions");
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
    empty.textContent = "No saved branches yet. Save your first version to start a design direction.";
    container.appendChild(empty);
    return container;
  }
  for (const branch of ordered) {
    const isCurrent = branch.name === currentName;
    const row = document.createElement("div");
    row.className = `branch-row${isCurrent ? " current" : ""}`;
    row.setAttribute("role", "listitem");
    if (isCurrent) row.setAttribute("aria-current", "true");
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
    meta.textContent = "Local branch";
    copy.appendChild(meta);
    row.appendChild(copy);
    if (isCurrent) {
      const badge = document.createElement("span");
      badge.className = "meta-chip branch-current-label";
      badge.textContent = "Current";
      row.appendChild(badge);
    } else if (typeof onSwitch === "function") {
      const button = document.createElement("div");
      button.className = "button button-quiet button-small branch-switch";
      button.setAttribute("role", "button");
      button.setAttribute("aria-label", `Switch to ${branch.name}`);
      button.tabIndex = 0;
      button.textContent = "Switch";
      const activate = () => {
        if (button.getAttribute("aria-disabled") === "true" || button.closest("[hidden]") ||
          document.body.classList.contains("is-busy") || document.body.classList.contains("is-initializing")) return;
        onSwitch(branch.name);
      };
      button.addEventListener("click", activate);
      button.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key) || event.repeat || event.isComposing) return;
        event.preventDefault(); event.stopPropagation(); activate();
      });
      row.appendChild(button);
    }
    container.appendChild(row);
  }
  return container;
}
if (typeof module !== "undefined") module.exports = { render };
else window.PhotoGitBranches = { render };
})();
