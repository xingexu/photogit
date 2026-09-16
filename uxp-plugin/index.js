const { app, action, core, imaging } = require('photoshop')
const { entrypoints, storage } = require('uxp')

const fileSystem = storage.localFileSystem
const HELPER_URL = 'http://127.0.0.1:17371'
const PROJECT_TOKEN_KEY = 'photogit.projectFolderToken'

const state = {
  initialized: false,
  helperOnline: false,
  projectFolder: null,
  projectPath: null,
  baseline: null,
  current: null,
  changes: [],
  history: [],
  branches: [],
  branch: 'main',
  busy: false,
  refreshTimer: null,
  eventsAttached: false,
}

const elements = {}

entrypoints.setup({
  panels: {
    photogitPanel: {
      show() {
        initialize()
      },
    },
  },
})

function byId(id) {
  return document.getElementById(id)
}

function setHidden(element, hidden) {
  element.classList.toggle('is-hidden', hidden)
}

function safeRead(reader, fallback = null) {
  try {
    const value = reader()
    return value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

function numberValue(value) {
  if (typeof value === 'number') return roundNumber(value)
  if (value && typeof value.value === 'number') return roundNumber(value.value)
  if (value && typeof value._value === 'number') return roundNumber(value._value)
  const numeric = Number(value)
  return Number.isFinite(numeric) ? roundNumber(numeric) : null
}

function roundNumber(value) {
  return Math.round(value * 1000) / 1000
}

function enumValue(value) {
  if (value === null || value === undefined) return null
  return String(value)
}

function colorValue(color) {
  if (!color) return null
  const rgb = safeRead(() => color.rgb)
  if (!rgb) return null
  return {
    red: numberValue(rgb.red),
    green: numberValue(rgb.green),
    blue: numberValue(rgb.blue),
    hex: safeRead(() => rgb.hexValue),
  }
}

function boundsValue(bounds) {
  if (!bounds) return null
  return {
    left: numberValue(bounds.left),
    top: numberValue(bounds.top),
    right: numberValue(bounds.right),
    bottom: numberValue(bounds.bottom),
  }
}

function layerCollectionToArray(collection) {
  const layers = []
  if (!collection) return layers
  for (let index = 0; index < collection.length; index += 1) layers.push(collection[index])
  return layers
}

function serializeText(layer) {
  const textItem = safeRead(() => layer.textItem)
  if (!textItem) return null
  const characterStyle = safeRead(() => textItem.characterStyle)
  const paragraphStyle = safeRead(() => textItem.paragraphStyle)

  return {
    contents: safeRead(() => textItem.contents),
    mode: safeRead(() => (textItem.isParagraphText ? 'paragraph' : 'point')),
    orientation: enumValue(safeRead(() => textItem.orientation)),
    clickPoint: safeRead(() => ({
      x: numberValue(textItem.textClickPoint.x),
      y: numberValue(textItem.textClickPoint.y),
    })),
    style: characterStyle
      ? {
          fontName: safeRead(() => characterStyle.fontName),
          fontStyle: safeRead(() => characterStyle.fontStyle),
          size: numberValue(safeRead(() => characterStyle.size)),
          leading: numberValue(safeRead(() => characterStyle.leading)),
          tracking: numberValue(safeRead(() => characterStyle.tracking)),
          capitalization: enumValue(safeRead(() => characterStyle.capitalization)),
          color: colorValue(safeRead(() => characterStyle.color)),
          alignment: enumValue(safeRead(() => paragraphStyle.justification)),
        }
      : null,
  }
}

function serializeLayer(layer, parentId, order) {
  const id = String(safeRead(() => layer.id, `unknown-${parentId || 'root'}-${order}`))
  const kind = enumValue(safeRead(() => layer.kind, 'unknown'))
  return {
    id,
    photoshopId: safeRead(() => layer.id),
    parentId,
    order,
    name: safeRead(() => layer.name, 'Unnamed layer'),
    kind,
    visible: Boolean(safeRead(() => layer.visible, true)),
    opacity: numberValue(safeRead(() => layer.opacity, 100)),
    fillOpacity: numberValue(safeRead(() => layer.fillOpacity, 100)),
    blendMode: enumValue(safeRead(() => layer.blendMode)),
    clippingMask: Boolean(safeRead(() => layer.isClippingMask, false)),
    bounds: boundsValue(safeRead(() => layer.boundsNoEffects || layer.bounds)),
    locks: {
      all: Boolean(safeRead(() => layer.allLocked, false)),
      pixels: Boolean(safeRead(() => layer.pixelsLocked, false)),
      position: Boolean(safeRead(() => layer.positionLocked, false)),
      transparentPixels: Boolean(safeRead(() => layer.transparentPixelsLocked, false)),
    },
    mask: {
      density: numberValue(safeRead(() => layer.layerMaskDensity)),
      feather: numberValue(safeRead(() => layer.layerMaskFeather)),
      visualHash: null,
    },
    text: serializeText(layer),
    visualHash: null,
  }
}

function hashBytes(bytes) {
  let hash = 2166136261
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]
    hash = Math.imul(hash, 16777619)
  }
  return (`00000000${(hash >>> 0).toString(16)}`).slice(-8)
}

async function fingerprintPixels(documentId, layerId) {
  let result
  try {
    result = await imaging.getPixels({
      documentID: documentId,
      layerID: layerId,
      targetSize: { width: 32 },
      colorSpace: 'RGB',
      componentSize: 8,
      applyAlpha: false,
    })
    const bytes = await result.imageData.getData({ chunky: true })
    return `${result.sourceBounds.left}:${result.sourceBounds.top}:${result.imageData.width}x${result.imageData.height}:${hashBytes(bytes)}`
  } catch {
    return null
  } finally {
    if (result && result.imageData) result.imageData.dispose()
  }
}

async function fingerprintMask(documentId, layerId) {
  let result
  try {
    result = await imaging.getLayerMask({
      documentID: documentId,
      layerID: layerId,
      kind: 'user',
      targetSize: { width: 32 },
    })
    const bytes = await result.imageData.getData({ chunky: true })
    return `${result.sourceBounds.left}:${result.sourceBounds.top}:${result.imageData.width}x${result.imageData.height}:${hashBytes(bytes)}`
  } catch {
    return null
  } finally {
    if (result && result.imageData) result.imageData.dispose()
  }
}

async function captureDocument() {
  if (!app.documents.length) throw new Error('Open a Photoshop document first.')
  const document = app.activeDocument
  const layers = []

  function visit(collection, parentId = null) {
    layerCollectionToArray(collection).forEach((layer, order) => {
      const serialized = serializeLayer(layer, parentId, order)
      layers.push(serialized)
      const children = safeRead(() => layer.layers)
      if (children && children.length) visit(children, serialized.id)
    })
  }

  visit(document.layers)

  for (const layer of layers) {
    const kind = String(layer.kind || '').toLowerCase()
    if (!kind.includes('group')) layer.visualHash = await fingerprintPixels(document.id, layer.photoshopId)
    layer.mask.visualHash = await fingerprintMask(document.id, layer.photoshopId)
  }

  return {
    schemaVersion: 1,
    identityStrategy: 'photoshop-layer-id-prototype',
    document: {
      name: safeRead(() => document.name, 'Untitled'),
      width: numberValue(safeRead(() => document.width)),
      height: numberValue(safeRead(() => document.height)),
      resolution: numberValue(safeRead(() => document.resolution)),
      mode: enumValue(safeRead(() => document.mode)),
      bitsPerChannel: enumValue(safeRead(() => document.bitsPerChannel)),
      layerCount: layers.length,
    },
    layers,
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const sorted = {}
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sorted[key] = canonicalize(value[key])
    })
  return sorted
}

function valueChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after)
}

function describePosition(bounds) {
  if (!bounds) return 'Unknown'
  return `x ${bounds.left}, y ${bounds.top}`
}

function addChange(changes, layer, property, before, after, type = 'property') {
  changes.push({
    id: layer.id,
    photoshopId: layer.photoshopId,
    layer: layer.name,
    kind: layer.kind,
    property,
    before,
    after,
    type,
  })
}

function diffManifests(baseline, current) {
  if (!baseline || !current) return []
  const changes = []
  const beforeLayers = new Map(baseline.layers.map((layer) => [layer.id, layer]))
  const afterLayers = new Map(current.layers.map((layer) => [layer.id, layer]))

  for (const layer of current.layers) {
    const before = beforeLayers.get(layer.id)
    if (!before) {
      addChange(changes, layer, 'Layer', null, 'Added', 'added')
      continue
    }
    if (before.name !== layer.name) addChange(changes, layer, 'Name', before.name, layer.name)
    if (before.visible !== layer.visible) addChange(changes, layer, 'Visibility', before.visible ? 'Visible' : 'Hidden', layer.visible ? 'Visible' : 'Hidden')
    if (before.opacity !== layer.opacity) addChange(changes, layer, 'Opacity', `${before.opacity}%`, `${layer.opacity}%`)
    if (before.fillOpacity !== layer.fillOpacity) addChange(changes, layer, 'Fill opacity', `${before.fillOpacity}%`, `${layer.fillOpacity}%`)
    if (before.parentId !== layer.parentId || before.order !== layer.order) addChange(changes, layer, 'Layer order', `Position ${before.order + 1}`, `Position ${layer.order + 1}`)
    if (valueChanged(before.bounds, layer.bounds)) addChange(changes, layer, 'Position / bounds', describePosition(before.bounds), describePosition(layer.bounds))
    if (safeRead(() => before.text.contents) !== safeRead(() => layer.text.contents)) addChange(changes, layer, 'Text', safeRead(() => before.text.contents, ''), safeRead(() => layer.text.contents, ''))
    if (valueChanged(safeRead(() => before.text.style), safeRead(() => layer.text.style))) addChange(changes, layer, 'Text style', 'Previous style', 'Modified style')
    if (before.mask.visualHash !== layer.mask.visualHash) addChange(changes, layer, 'Layer mask', before.mask.visualHash ? 'Previous mask' : 'No mask', layer.mask.visualHash ? 'Modified mask' : 'No mask')
    if (before.visualHash !== layer.visualHash) addChange(changes, layer, 'Pixels / appearance', 'Previous appearance', 'Modified appearance')
  }

  for (const layer of baseline.layers) {
    if (!afterLayers.has(layer.id)) addChange(changes, layer, 'Layer', 'Present', 'Deleted', 'deleted')
  }

  return changes
}

async function helperRequest(endpoint, body = {}) {
  let response
  try {
    response = await fetch(`${HELPER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    setHelperOnline(false)
    throw new Error('Start the PhotoGit helper, then press Retry.')
  }

  const payload = await response.json()
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'The PhotoGit helper could not complete this action.')
  setHelperOnline(true)
  return payload
}

async function pingHelper() {
  try {
    await helperRequest('/health')
    setHelperOnline(true)
    return true
  } catch {
    setHelperOnline(false)
    return false
  }
}

function setHelperOnline(online) {
  state.helperOnline = online
  if (!elements.helperBanner) return
  setHidden(elements.helperBanner, online)
  elements.helperState.textContent = online ? 'Local Git connected' : 'Git helper offline'
}

async function ensureFolder(parent, name) {
  const entries = await parent.getEntries()
  const existing = entries.find((entry) => entry.isFolder && entry.name === name)
  return existing || parent.createFolder(name)
}

async function createOrReplaceFile(folder, name, contents) {
  const file = await folder.createFile(name, { overwrite: true })
  await file.write(contents)
  return file
}

async function nestedEntry(root, relativePath) {
  const segments = relativePath.split('/').filter(Boolean)
  let entry = root
  for (const segment of segments) {
    const entries = await entry.getEntries()
    entry = entries.find((candidate) => candidate.name === segment)
    if (!entry) throw new Error(`PhotoGit could not find ${relativePath}.`)
  }
  return entry
}

async function writeCapture(manifest) {
  const metadataFolder = await ensureFolder(state.projectFolder, 'photogit')
  const snapshotFolder = await ensureFolder(state.projectFolder, 'snapshot')
  await createOrReplaceFile(metadataFolder, 'manifest.json', `${JSON.stringify(canonicalize(manifest), null, 2)}\n`)
  await createOrReplaceFile(
    metadataFolder,
    'project.json',
    `${JSON.stringify({ schemaVersion: 1, name: manifest.document.name, format: 'photogit' }, null, 2)}\n`,
  )

  const snapshotFile = await snapshotFolder.createFile('document.psd', { overwrite: true })
  const document = app.activeDocument
  await document.saveAs.psd(snapshotFile, { embedColorProfile: true }, true)
}

async function captureAndCommit(message) {
  let manifest
  await core.executeAsModal(
    async (executionContext) => {
      executionContext.reportProgress({ value: 0.1, commandName: 'Reading Photoshop layers' })
      manifest = await captureDocument()
      executionContext.reportProgress({ value: 0.55, commandName: 'Saving exact PSD snapshot' })
      await writeCapture(manifest)
      executionContext.reportProgress({ value: 0.9, commandName: 'Preparing Git version' })
    },
    { commandName: 'Save PhotoGit version' },
  )

  const result = await helperRequest('/commit', {
    path: state.projectPath,
    message,
  })
  state.current = manifest
  state.baseline = manifest
  state.changes = []
  return result
}

async function refreshDocument() {
  if (state.busy || !state.projectFolder || !app.documents.length) return
  try {
    state.current = await captureDocument()
    state.changes = diffManifests(state.baseline, state.current)
    renderProject()
  } catch (error) {
    showToast(error.message, true)
  }
}

async function loadProjectData() {
  if (!state.projectPath || !state.helperOnline) {
    renderProject()
    return
  }
  const [head, log, branchData] = await Promise.all([
    helperRequest('/head', { path: state.projectPath }),
    helperRequest('/history', { path: state.projectPath }),
    helperRequest('/branches', { path: state.projectPath }),
  ])
  state.baseline = head.manifest
  state.history = log.history
  state.branches = branchData.branches
  state.branch = branchData.current
  await refreshDocument()
  renderProject()
}

function showEmptyState() {
  setHidden(elements.emptyState, false)
  setHidden(elements.projectView, true)
  const hasDocument = app.documents.length > 0
  elements.trackButton.disabled = !hasDocument || !state.helperOnline
  elements.emptyHint.textContent = !hasDocument
    ? 'Open a Photoshop document to begin.'
    : state.helperOnline
      ? 'Choose a folder for the local PhotoGit project.'
      : 'Start the PhotoGit helper to continue.'
}

function renderProject() {
  if (!state.projectFolder) {
    showEmptyState()
    return
  }

  setHidden(elements.emptyState, true)
  setHidden(elements.projectView, false)
  const documentName = app.documents.length ? app.activeDocument.name : 'No document open'
  elements.documentName.textContent = documentName
  elements.projectLocation.textContent = state.projectFolder.name

  const changeCount = state.changes.length
  elements.dirtyText.textContent = changeCount ? `${changeCount} unversioned ${changeCount === 1 ? 'change' : 'changes'}` : 'Document matches latest version'
  elements.dirtyState.classList.toggle('is-clean', changeCount === 0)
  elements.changesCount.textContent = String(changeCount)
  elements.historyCount.textContent = String(state.history.length)
  elements.saveVersionButton.disabled = state.busy || !state.helperOnline || !app.documents.length || changeCount === 0

  renderBranches()
  renderHistory()
  renderChanges()
}

function renderBranches() {
  elements.branchSelect.replaceChildren()
  const branches = state.branches.length ? state.branches : [{ name: state.branch, current: true }]
  branches.forEach((branch) => {
    const option = document.createElement('option')
    option.value = branch.name
    option.textContent = branch.name
    option.selected = branch.name === state.branch
    elements.branchSelect.appendChild(option)
  })
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || ''
  const elapsed = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.round(elapsed / 60000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return date.toLocaleDateString()
}

function renderHistory() {
  elements.historyList.replaceChildren()
  setHidden(elements.historyEmpty, state.history.length > 0)
  state.history.forEach((version, index) => {
    const row = document.createElement('div')
    row.className = 'history-item'

    const node = document.createElement('span')
    node.className = 'commit-node'
    row.appendChild(node)

    const copy = document.createElement('span')
    copy.className = 'history-copy'
    const title = document.createElement('span')
    title.className = 'history-title'
    title.textContent = version.subject
    const meta = document.createElement('span')
    meta.className = 'history-meta'
    meta.textContent = `${version.author} · ${formatDate(version.date)}${index === 0 ? ' · CURRENT' : ''}`
    const open = document.createElement('button')
    open.className = 'open-version-button'
    open.textContent = index === 0 ? 'Open exact snapshot' : 'Open this version'
    open.addEventListener('click', () => openVersion(version.hash))
    copy.appendChild(title)
    copy.appendChild(meta)
    copy.appendChild(open)
    row.appendChild(copy)

    const hash = document.createElement('span')
    hash.className = 'history-hash'
    hash.textContent = version.shortHash
    row.appendChild(hash)
    elements.historyList.appendChild(row)
  })
}

function changeIcon(change) {
  if (change.type === 'added') return '+'
  if (change.type === 'deleted') return '−'
  const kind = String(change.kind || '').toLowerCase()
  if (kind.includes('text')) return 'T'
  if (kind.includes('group')) return 'G'
  return 'L'
}

function renderChanges() {
  elements.changesList.replaceChildren()
  setHidden(elements.changesEmpty, state.changes.length > 0)
  elements.changesSummary.textContent = state.changes.length
    ? `${state.changes.length} changes since ${state.branch}`
    : 'No unversioned changes'

  state.changes.forEach((change) => {
    const row = document.createElement('button')
    row.className = 'change-item'
    row.addEventListener('click', () => selectLayer(change.photoshopId))

    const icon = document.createElement('span')
    icon.className = 'change-icon'
    icon.textContent = changeIcon(change)
    row.appendChild(icon)

    const copy = document.createElement('span')
    copy.className = 'change-copy'
    const title = document.createElement('span')
    title.className = 'change-title'
    title.textContent = change.layer
    const property = document.createElement('span')
    property.className = 'change-property'
    property.textContent = change.property
    const values = document.createElement('span')
    values.className = 'change-values'
    values.textContent = `${change.before ?? 'None'} → ${change.after ?? 'None'}`
    copy.appendChild(title)
    copy.appendChild(property)
    copy.appendChild(values)
    row.appendChild(copy)
    elements.changesList.appendChild(row)
  })
}

async function selectLayer(photoshopId) {
  if (!photoshopId || !app.documents.length) return
  try {
    await core.executeAsModal(
      () => action.batchPlay([
        {
          _obj: 'select',
          _target: [{ _ref: 'layer', _id: photoshopId }],
          makeVisible: false,
        },
      ], {}),
      { commandName: 'Select changed layer' },
    )
  } catch {
    showToast('That layer is no longer available in the active document.', true)
  }
}

function showToast(message, isError = false) {
  elements.toast.textContent = message
  elements.toast.classList.toggle('is-error', isError)
  setHidden(elements.toast, false)
  setTimeout(() => setHidden(elements.toast, true), 3600)
}

async function withBusy(actionName, callback) {
  if (state.busy) return
  state.busy = true
  elements.dirtyText.textContent = actionName
  renderProject()
  try {
    return await callback()
  } finally {
    state.busy = false
    renderProject()
  }
}

async function trackDocument() {
  if (!app.documents.length) {
    showToast('Open a Photoshop document first.', true)
    return
  }
  if (!(await pingHelper())) {
    showToast('Start the PhotoGit helper, then press Retry.', true)
    return
  }

  const folder = await fileSystem.getFolder()
  if (!folder) return
  state.projectFolder = folder
  state.projectPath = fileSystem.getNativePath(folder)
  const token = await fileSystem.createPersistentToken(folder)
  localStorage.setItem(PROJECT_TOKEN_KEY, token)

  await withBusy('Creating the first version…', async () => {
    await helperRequest('/init', { path: state.projectPath })
    const result = await captureAndCommit('Initial Photoshop version')
    await loadProjectData()
    showToast(`${result.message} ${result.hash}`)
  })
}

async function saveVersion() {
  const message = elements.commitMessage.value.trim()
  if (!message) {
    showToast('Enter a short version message.', true)
    return
  }
  elements.commitDialog.close()
  await withBusy('Saving version…', async () => {
    const result = await captureAndCommit(message)
    await loadProjectData()
    showToast(`${result.message} ${result.hash}`)
  })
}

async function openVersion(hash) {
  await withBusy('Preparing historical PSD…', async () => {
    const result = await helperRequest('/restore', { path: state.projectPath, commit: hash })
    const file = await nestedEntry(state.projectFolder, result.relativePath)
    await core.executeAsModal(() => app.open(file), { commandName: 'Open PhotoGit version' })
    showToast('Opened the exact historical PSD as a separate document.')
  })
}

async function createBranch() {
  const name = elements.branchName.value.trim()
  if (state.changes.length) {
    showToast('Save the current changes before creating a branch.', true)
    return
  }
  elements.branchDialog.close()
  await withBusy('Creating branch…', async () => {
    const result = await helperRequest('/branch/create', { path: state.projectPath, name })
    state.branch = result.current
    state.branches = result.branches
    renderProject()
    showToast(`Created and switched to ${name}.`)
  })
}

async function switchBranch(name) {
  if (name === state.branch) return
  if (state.changes.length) {
    showToast('Save the current changes before switching branches.', true)
    renderBranches()
    return
  }
  await withBusy(`Switching to ${name}…`, async () => {
    await helperRequest('/branch/switch', { path: state.projectPath, name })
    state.branch = name
    await loadProjectData()
    const snapshot = await nestedEntry(state.projectFolder, 'snapshot/document.psd')
    await core.executeAsModal(() => app.open(snapshot), { commandName: 'Open PhotoGit branch' })
    showToast(`Switched to ${name} and opened its PSD.`)
  })
}

function setTab(tab) {
  const historySelected = tab === 'history'
  elements.historyTab.classList.toggle('is-active', historySelected)
  elements.changesTab.classList.toggle('is-active', !historySelected)
  elements.historyTab.setAttribute('aria-selected', String(historySelected))
  elements.changesTab.setAttribute('aria-selected', String(!historySelected))
  setHidden(elements.historyView, !historySelected)
  setHidden(elements.changesView, historySelected)
}

function scheduleRefresh() {
  if (!state.projectFolder || state.busy) return
  clearTimeout(state.refreshTimer)
  state.refreshTimer = setTimeout(refreshDocument, 700)
}

async function attachPhotoshopEvents() {
  if (state.eventsAttached) return
  try {
    await action.addNotificationListener(
      ['make', 'set', 'move', 'delete', 'show', 'hide', 'transform', 'open', 'close'],
      scheduleRefresh,
    )
    state.eventsAttached = true
  } catch {
    // Manual refresh remains available if an event differs between Photoshop versions.
  }
}

function cacheElements() {
  ;[
    'helperBanner',
    'retryHelperButton',
    'emptyState',
    'trackButton',
    'emptyHint',
    'projectView',
    'branchSelect',
    'newBranchButton',
    'refreshButton',
    'documentName',
    'projectLocation',
    'dirtyState',
    'dirtyText',
    'saveVersionButton',
    'historyTab',
    'changesTab',
    'historyCount',
    'changesCount',
    'historyView',
    'changesView',
    'historyList',
    'historyEmpty',
    'changesSummary',
    'changesList',
    'changesEmpty',
    'helperState',
    'changeProjectButton',
    'commitDialog',
    'commitForm',
    'commitMessage',
    'commitSummary',
    'closeCommitButton',
    'cancelCommitButton',
    'confirmCommitButton',
    'branchDialog',
    'branchForm',
    'branchName',
    'closeBranchButton',
    'cancelBranchButton',
    'confirmBranchButton',
    'toast',
  ].forEach((id) => {
    elements[id] = byId(id)
  })
}

function attachUiEvents() {
  elements.retryHelperButton.addEventListener('click', async () => {
    const online = await pingHelper()
    showToast(online ? 'PhotoGit helper connected.' : 'The helper is still offline.', !online)
    showEmptyState()
  })
  elements.trackButton.addEventListener('click', () => trackDocument().catch((error) => showToast(error.message, true)))
  elements.refreshButton.addEventListener('click', () => withBusy('Refreshing changes…', refreshDocument))
  elements.saveVersionButton.addEventListener('click', () => {
    elements.commitMessage.value = ''
    elements.commitSummary.textContent = `${state.changes.length} unversioned ${state.changes.length === 1 ? 'change' : 'changes'} ready to save.`
    elements.commitDialog.showModal()
  })
  elements.closeCommitButton.addEventListener('click', () => elements.commitDialog.close())
  elements.cancelCommitButton.addEventListener('click', () => elements.commitDialog.close())
  elements.commitForm.addEventListener('submit', (event) => {
    event.preventDefault()
    saveVersion().catch((error) => showToast(error.message, true))
  })
  elements.confirmCommitButton.addEventListener('click', (event) => {
    event.preventDefault()
    saveVersion().catch((error) => showToast(error.message, true))
  })
  elements.historyTab.addEventListener('click', () => setTab('history'))
  elements.changesTab.addEventListener('click', () => setTab('changes'))
  elements.newBranchButton.addEventListener('click', () => {
    elements.branchName.value = ''
    elements.branchDialog.showModal()
  })
  elements.closeBranchButton.addEventListener('click', () => elements.branchDialog.close())
  elements.cancelBranchButton.addEventListener('click', () => elements.branchDialog.close())
  elements.branchForm.addEventListener('submit', (event) => {
    event.preventDefault()
    createBranch().catch((error) => showToast(error.message, true))
  })
  elements.confirmBranchButton.addEventListener('click', (event) => {
    event.preventDefault()
    createBranch().catch((error) => showToast(error.message, true))
  })
  elements.branchSelect.addEventListener('change', () => {
    switchBranch(elements.branchSelect.value).catch((error) => {
      showToast(error.message, true)
      renderBranches()
    })
  })
  elements.changeProjectButton.addEventListener('click', () => {
    localStorage.removeItem(PROJECT_TOKEN_KEY)
    state.projectFolder = null
    state.projectPath = null
    state.baseline = null
    state.current = null
    state.changes = []
    state.history = []
    showEmptyState()
  })
}

async function recoverProject() {
  const token = localStorage.getItem(PROJECT_TOKEN_KEY)
  if (!token) return false
  try {
    const folder = await fileSystem.getEntryForPersistentToken(token)
    state.projectFolder = folder
    state.projectPath = fileSystem.getNativePath(folder)
    await helperRequest('/init', { path: state.projectPath })
    await loadProjectData()
    return true
  } catch {
    localStorage.removeItem(PROJECT_TOKEN_KEY)
    state.projectFolder = null
    state.projectPath = null
    return false
  }
}

async function initialize() {
  if (state.initialized) {
    scheduleRefresh()
    return
  }
  state.initialized = true
  cacheElements()
  attachUiEvents()
  await attachPhotoshopEvents()
  await pingHelper()
  const recovered = state.helperOnline ? await recoverProject() : false
  if (!recovered) showEmptyState()
}

setTimeout(() => initialize().catch((error) => console.error(error)), 0)
