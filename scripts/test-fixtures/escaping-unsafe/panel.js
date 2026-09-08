// Fixture: one interpolation reaches markup without escaping.
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function render(node, item) {
  node.innerHTML = `<strong>${escapeHtml(item.name)}</strong><span>${item.count}</span>`;
}
