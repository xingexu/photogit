// Host-independent state rules. Used by the real UXP panel and behavioral tests.
class StaleScanError extends Error {
  constructor() { super("Scan cancelled because the document or project changed."); this.name = "StaleScanError"; }
}

class ScanCoordinator {
  constructor() { this.generation = 0; this.running = null; this.pending = null; }
  invalidate() { this.generation += 1; }
  cancel() { this.pending = null; this.invalidate(); }
  request(work) {
    this.invalidate();
    this.pending = work;
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  async drain() {
    while (this.pending) {
      const work = this.pending;
      this.pending = null;
      const generation = this.generation;
      const check = () => { if (generation !== this.generation) throw new StaleScanError(); };
      try { await work(check); } catch (error) { if (!(error instanceof StaleScanError)) throw error; }
    }
  }
}

function documentIdentity(doc) {
  let sourcePath = null;
  try {
    const path = doc.path;
    sourcePath = typeof path === "string" && path ? path : path?.nativePath || null;
  } catch { /* Unsaved Photoshop documents have no path. */ }
  return { documentId: String(doc.id), name: doc.name, sourcePath };
}

function sameDocument(binding, identity) {
  if (!binding || !identity) return false;
  if (binding.sourcePath && identity.sourcePath) return binding.sourcePath === identity.sourcePath;
  return !binding.sourcePath && !identity.sourcePath && binding.documentId === identity.documentId;
}

function groupHistory(versions, dateLabel) {
  const groups = [];
  for (const version of versions) {
    const label = dateLabel(version.date);
    let group = groups[groups.length - 1];
    // Adjacent grouping preserves Git's chronological order, including A/B/A authors.
    if (!group || group.label !== label || group.author !== version.author) {
      group = { label, author: version.author, entries: [] };
      groups.push(group);
    }
    group.entries.push(version);
  }
  return groups;
}

async function inBatches(items, worker, { check = () => {}, progress = () => {}, batchSize = 4, yieldTask = () => Promise.resolve(), budgetMs = 30000, now = Date.now } = {}) {
  const started = now();
  for (let offset = 0; offset < items.length; offset += batchSize) {
    check();
    if (now() - started > budgetMs) throw new Error("Scan paused after 30 seconds. Reduce the document size or retry Scan now; no clean result was recorded.");
    // Settle the full batch before releasing the single-flight gate, even on failure.
    const outcomes = await Promise.all(items.slice(offset, offset + batchSize).map(async item => {
      try { await worker(item); return null; } catch (error) { return error; }
    }));
    check();
    const error = outcomes.find(Boolean);
    if (error) throw error;
    progress(Math.min(offset + batchSize, items.length), items.length);
    await yieldTask();
  }
  check();
}

module.exports = { ScanCoordinator, StaleScanError, documentIdentity, sameDocument, groupHistory, inBatches };
