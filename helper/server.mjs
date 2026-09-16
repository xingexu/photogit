import http from 'node:http'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'

const execFileAsync = promisify(execFile)
const PORT = 17371
const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 1024 * 1024

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function runGit(projectPath, args, options = {}) {
  const result = await execFileAsync('git', args, {
    cwd: projectPath,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  })
  return result.stdout
}

async function gitSucceeds(projectPath, args) {
  try {
    await runGit(projectPath, args)
    return true
  } catch {
    return false
  }
}

async function ensureFileLines(filePath, requiredLines) {
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf8')
  } catch {
    // A missing configuration file is expected for a new PhotoGit project.
  }

  const lines = new Set(existing.split(/\r?\n/).filter(Boolean))
  let changed = false
  for (const line of requiredLines) {
    if (!lines.has(line)) {
      lines.add(line)
      changed = true
    }
  }

  if (!existing || changed) {
    await writeFile(filePath, `${[...lines].join('\n')}\n`, 'utf8')
  }
}

async function requireProject(projectPath) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
    throw new HttpError(400, 'A valid absolute project path is required.')
  }

  const normalized = path.resolve(projectPath)
  await access(normalized)
  return normalized
}

function validateBranchName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/.test(name)) {
    throw new HttpError(400, 'Use letters, numbers, dots, slashes, underscores, or hyphens for the branch name.')
  }
  if (name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.')) {
    throw new HttpError(400, 'That branch name is not valid.')
  }
  return name
}

function validateCommit(commit) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/i.test(commit)) {
    throw new HttpError(400, 'A valid commit ID is required.')
  }
  return commit
}

async function ensureRepository(projectPath) {
  const gitDirectory = path.join(projectPath, '.git')
  try {
    await access(gitDirectory)
  } catch {
    try {
      await runGit(projectPath, ['init', '-b', 'main'])
    } catch {
      await runGit(projectPath, ['init'])
      await runGit(projectPath, ['branch', '-M', 'main'])
    }
  }

  const hasName = await gitSucceeds(projectPath, ['config', '--get', 'user.name'])
  if (!hasName) await runGit(projectPath, ['config', 'user.name', 'PhotoGit User'])

  const hasEmail = await gitSucceeds(projectPath, ['config', '--get', 'user.email'])
  if (!hasEmail) await runGit(projectPath, ['config', 'user.email', 'photogit@local'])

  await mkdir(path.join(projectPath, 'photogit', 'restores'), { recursive: true })
  await ensureFileLines(
    path.join(projectPath, '.gitattributes'),
    ['snapshot/*.psd -text -diff -merge', 'snapshot/*.psb -text -diff -merge'],
  )
  await ensureFileLines(path.join(projectPath, '.gitignore'), ['photogit/restores/'])
}

async function currentBranch(projectPath) {
  try {
    return (await runGit(projectPath, ['branch', '--show-current'])).trim() || 'main'
  } catch {
    return 'main'
  }
}

async function listBranches(projectPath) {
  const output = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(refname:short)%09%(HEAD)',
    'refs/heads',
  ])
  const current = await currentBranch(projectPath)
  const branches = output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split('\t')
      return { name, current: head === '*' || name === current }
    })

  if (!branches.length) branches.push({ name: current, current: true })
  return { current, branches }
}

async function readHeadManifest(projectPath) {
  if (!(await gitSucceeds(projectPath, ['rev-parse', '--verify', 'HEAD']))) return null
  try {
    const contents = await runGit(projectPath, ['show', 'HEAD:photogit/manifest.json'])
    return JSON.parse(contents)
  } catch {
    return null
  }
}

async function history(projectPath) {
  if (!(await gitSucceeds(projectPath, ['rev-parse', '--verify', 'HEAD']))) return []
  const format = '%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e'
  const output = await runGit(projectPath, ['log', `--pretty=format:${format}`, '--max-count=50'])
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, author, date, subject] = record.split('\x1f')
      return { hash, shortHash, author, date, subject }
    })
}

async function commitProject(projectPath, message) {
  const cleanMessage = String(message || '').trim()
  if (!cleanMessage) throw new HttpError(400, 'Enter a version message.')

  await ensureRepository(projectPath)
  await runGit(projectPath, ['add', '--all'])
  const hasChanges = !(await gitSucceeds(projectPath, ['diff', '--cached', '--quiet']))

  if (!hasChanges) {
    const hash = (await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])).trim()
    return { created: false, hash, message: 'No new changes to save.' }
  }

  await runGit(projectPath, ['commit', '-m', cleanMessage])
  const hash = (await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])).trim()
  return { created: true, hash, message: 'Version saved.' }
}

async function restoreSnapshot(projectPath, commit) {
  const safeCommit = validateCommit(commit)
  const outputPath = path.join(projectPath, 'photogit', 'restores', `${safeCommit.slice(0, 10)}.psd`)
  const { stdout } = await execFileAsync('git', ['show', `${safeCommit}:snapshot/document.psd`], {
    cwd: projectPath,
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 1024,
  })
  await writeFile(outputPath, stdout)
  return { relativePath: `photogit/restores/${path.basename(outputPath)}` }
}

async function parseBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'The request body must be valid JSON.')
  }
}

function send(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

async function route(pathname, body) {
  if (pathname === '/health') return { ok: true, version: '0.1.0' }

  const projectPath = await requireProject(body.path)

  if (pathname === '/init') {
    await ensureRepository(projectPath)
    return { ok: true, ...(await listBranches(projectPath)) }
  }
  if (pathname === '/commit') {
    return { ok: true, ...(await commitProject(projectPath, body.message)) }
  }
  if (pathname === '/history') {
    return { ok: true, history: await history(projectPath) }
  }
  if (pathname === '/head') {
    return { ok: true, manifest: await readHeadManifest(projectPath) }
  }
  if (pathname === '/branches') {
    return { ok: true, ...(await listBranches(projectPath)) }
  }
  if (pathname === '/branch/create') {
    const name = validateBranchName(body.name)
    await runGit(projectPath, ['checkout', '-b', name])
    return { ok: true, ...(await listBranches(projectPath)) }
  }
  if (pathname === '/branch/switch') {
    const name = validateBranchName(body.name)
    const dirty = (await runGit(projectPath, ['status', '--porcelain'])).trim()
    if (dirty) throw new HttpError(409, 'Save the current Photoshop version before switching branches.')
    await runGit(projectPath, ['checkout', name])
    return { ok: true, ...(await listBranches(projectPath)) }
  }
  if (pathname === '/restore') {
    return { ok: true, ...(await restoreSnapshot(projectPath, body.commit)) }
  }
  if (pathname === '/status') {
    return {
      ok: true,
      branch: await currentBranch(projectPath),
      dirty: Boolean((await runGit(projectPath, ['status', '--porcelain'])).trim()),
    }
  }

  throw new HttpError(404, 'Unknown PhotoGit helper operation.')
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    send(response, 204, {})
    return
  }
  if (request.method !== 'POST') {
    send(response, 405, { ok: false, error: 'Use POST for helper requests.' })
    return
  }

  try {
    const body = await parseBody(request)
    const payload = await route(new URL(request.url, `http://${HOST}:${PORT}`).pathname, body)
    send(response, 200, payload)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    send(response, status, { ok: false, error: error.message || 'Unexpected helper error.' })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`PhotoGit helper listening on http://${HOST}:${PORT}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
