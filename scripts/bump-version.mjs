#!/usr/bin/env node

/**
 * bump-version.mjs — Single Source of Truth version propagation
 *
 * Usage:
 *   node scripts/bump-version.mjs          # propagate current api version to all files
 *   node scripts/bump-version.mjs 1.19.0   # set new version everywhere
 */

import { readFile, writeFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const TODAY_UTC = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`

function repoPath(...parts) {
  return path.join(ROOT, ...parts)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function replaceInFile(filePath, pattern, replacement) {
  const content = await readFile(filePath, 'utf8')
  const updated = content.replace(pattern, replacement)
  if (content === updated) return false
  await writeFile(filePath, updated, 'utf8')
  return true
}

// ── Target definitions ───────────────────────────────────────────────────────

function targets(oldVer, newVer) {
  return [
    // package.json files — replace "version": "X.Y.Z"
    {
      file: 'apps/web/package.json',
      pattern: `"version": "${oldVer}"`,
      replacement: `"version": "${newVer}"`,
    },
    {
      file: 'apps/live/package.json',
      pattern: `"version": "${oldVer}"`,
      replacement: `"version": "${newVer}"`,
    },
    {
      file: 'apps/mcp-server/package.json',
      pattern: `"version": "${oldVer}"`,
      replacement: `"version": "${newVer}"`,
    },
    {
      file: 'packages/sdk/package.json',
      pattern: `"version": "${oldVer}"`,
      replacement: `"version": "${newVer}"`,
    },

    // server.json — two version fields
    {
      file: 'apps/mcp-server/server.json',
      pattern: new RegExp(`"version":\\s*"${oldVer.replace(/\./g, '\\.')}"`, 'g'),
      replacement: `"version": "${newVer}"`,
    },

    // Discovery / catalog
    {
      file: 'apps/web/public/.well-known/crossfin.json',
      pattern: `"version": "${oldVer}"`,
      replacement: `"version": "${newVer}"`,
    },
    {
      file: 'apps/web/public/.well-known/crossfin.json',
      pattern: /"updatedAt":\s*"[^"]+"/,
      replacement: `"updatedAt": "${TODAY_UTC}"`,
    },
    {
      file: 'catalog/crossfin-catalog.json',
      pattern: `"apiVersion": "${oldVer}"`,
      replacement: `"apiVersion": "${newVer}"`,
    },
    {
      file: 'apps/api/scripts/catalog-guard.mjs',
      pattern: /updatedAt:\s*'[^']+'/,
      replacement: `updatedAt: '${TODAY_UTC}'`,
    },

    // YAML files
    {
      file: 'smithery.yaml',
      pattern: `crossfin-mcp@${oldVer}`,
      replacement: `crossfin-mcp@${newVer}`,
    },
    {
      file: 'examples/gpt-actions-schema.yaml',
      pattern: `version: "${oldVer}"`,
      replacement: `version: "${newVer}"`,
    },

    // TypeScript source
    {
      file: 'apps/api/src/lib/fetchers.ts',
      pattern: `CrossFin-API/${oldVer}`,
      replacement: `CrossFin-API/${newVer}`,
    },
    {
      file: 'packages/sdk/src/types.ts',
      pattern: `v${oldVer}`,
      replacement: `v${newVer}`,
    },
    {
      file: 'packages/sdk/README.md',
      pattern: /version: '\d+\.\d+\.\d+'/,
      replacement: `version: '${newVer}'`,
    },

    // Markdown docs
    {
      file: 'README.md',
      pattern: `(v${oldVer})`,
      replacement: `(v${newVer})`,
    },
    {
      file: 'apps/docs/api.md',
      pattern: `(v${oldVer})`,
      replacement: `(v${newVer})`,
    },
  ]
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2]

  // Read current (canonical) version
  const apiPkg = await readJson(repoPath('apps/api/package.json'))
  let oldVer = apiPkg.version
  let newVer = oldVer

  if (arg) {
    if (!SEMVER_RE.test(arg)) {
      console.error(`[bump] Invalid version: "${arg}" (expected X.Y.Z)`)
      process.exit(1)
    }
    newVer = arg
  }

  if (oldVer === newVer && !arg) {
    console.log(`[bump] Current version is ${oldVer} — nothing to do (pass a version arg to change)`)
    process.exit(0)
  }

  console.log(`[bump] ${oldVer} → ${newVer}`)

  // 1. Update api/package.json first (the source of truth)
  if (oldVer !== newVer) {
    const apiPath = repoPath('apps/api/package.json')
    const raw = await readFile(apiPath, 'utf8')
    await writeFile(apiPath, raw.replace(`"version": "${oldVer}"`, `"version": "${newVer}"`), 'utf8')
    console.log(`  ✓ apps/api/package.json`)
  }

  // 2. Propagate to all targets
  const changed = []
  for (const t of targets(oldVer, newVer)) {
    const filePath = repoPath(t.file)
    const didChange = await replaceInFile(filePath, t.pattern, t.replacement)
    if (didChange) {
      changed.push(t.file)
      console.log(`  ✓ ${t.file}`)
    } else {
      console.log(`  · ${t.file} (no change)`)
    }
  }

  // 3. Sync package-lock.json files
  const lockDirs = ['apps/api', 'apps/web', 'apps/mcp-server', 'packages/sdk']
  for (const dir of lockDirs) {
    try {
      execSync('npm install --package-lock-only --ignore-scripts 2>/dev/null', {
        cwd: repoPath(dir),
        stdio: 'pipe',
      })
      console.log(`  ✓ ${dir}/package-lock.json (synced)`)
    } catch {
      console.log(`  ⚠ ${dir}/package-lock.json (sync skipped)`)
    }
  }

  console.log(`\n[bump] Done. ${changed.length + 1} files updated to ${newVer}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
