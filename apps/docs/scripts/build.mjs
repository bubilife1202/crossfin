import { mkdirSync, rmSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const srcDir = resolve(root, 'src')
const distDir = resolve(root, 'dist')

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })
cpSync(srcDir, distDir, { recursive: true })

console.log('Built docs to dist/')
