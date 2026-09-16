import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helperPath = fileURLToPath(new URL('./server.mjs', import.meta.url))
const temporaryProject = await mkdtemp(path.join(os.tmpdir(), 'photogit-helper-'))
const child = spawn(process.execPath, [helperPath], { stdio: ['ignore', 'pipe', 'pipe'] })

async function waitForHelper() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:17371/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Helper did not start.')
}

async function call(endpoint, body) {
  const response = await fetch(`http://127.0.0.1:17371${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error)
  return payload
}

try {
  await waitForHelper()
  await mkdir(path.join(temporaryProject, 'photogit'), { recursive: true })
  await mkdir(path.join(temporaryProject, 'snapshot'), { recursive: true })
  await writeFile(path.join(temporaryProject, 'photogit', 'manifest.json'), '{"schemaVersion":1}\n')
  await writeFile(path.join(temporaryProject, 'snapshot', 'document.psd'), 'fake psd version one')

  const initialized = await call('/init', { path: temporaryProject })
  assert.equal(initialized.ok, true)
  assert.equal(initialized.current, 'main')

  const firstCommit = await call('/commit', { path: temporaryProject, message: 'Initial version' })
  assert.equal(firstCommit.created, true)

  await writeFile(path.join(temporaryProject, 'photogit', 'manifest.json'), '{"schemaVersion":1,"changed":true}\n')
  await writeFile(path.join(temporaryProject, 'snapshot', 'document.psd'), 'fake psd version two')
  const secondCommit = await call('/commit', { path: temporaryProject, message: 'Second version' })
  assert.equal(secondCommit.created, true)

  const log = await call('/history', { path: temporaryProject })
  assert.equal(log.history.length, 2)
  assert.equal(log.history[0].subject, 'Second version')

  const restored = await call('/restore', { path: temporaryProject, commit: firstCommit.hash })
  const restoredContents = await readFile(path.join(temporaryProject, restored.relativePath), 'utf8')
  assert.equal(restoredContents, 'fake psd version one')

  const branch = await call('/branch/create', { path: temporaryProject, name: 'test-branch' })
  assert.equal(branch.current, 'test-branch')

  console.log('PhotoGit helper integration test passed.')
} finally {
  child.kill('SIGTERM')
}
