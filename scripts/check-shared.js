#!/usr/bin/env node
/**
 * 校验各云函数里的 shared/ 副本是否与 shared/ 源文件一致。
 *
 * 用途：防止「改了共享代码但忘了同步」导致部署出去的是旧逻辑。
 * 退出码：0 = 一致，1 = 有漂移（会列出具体文件）。
 *
 * 用法：node scripts/check-shared.js
 *       也可挂到 git pre-commit 钩子里（见 README 的「云函数共享代码」一节）。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SHARED_DIR = path.join(ROOT, 'shared')
const FUNCTIONS_DIR = path.join(ROOT, 'cloudfunctions')

const GENERATED_HEADER = [
  '/* ------------------------------------------------------------------',
  ' * 自动生成，请勿直接修改',
  ' * 源文件：shared/__NAME__',
  ' * 修改后执行：node scripts/sync-shared.js',
  ' * ------------------------------------------------------------------ */',
  ''
].join('\n')

const problems = []

function listSharedFiles() {
  if (!fs.existsSync(SHARED_DIR)) return []
  return fs
    .readdirSync(SHARED_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
}

function expectedContent(name) {
  const src = fs.readFileSync(path.join(SHARED_DIR, name), 'utf8')
  return GENERATED_HEADER.replace('__NAME__', name) + src
}

function listFunctions() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return []
  return fs
    .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'shared')
    .filter((d) => fs.existsSync(path.join(FUNCTIONS_DIR, d.name, 'index.js')))
    .map((d) => d.name)
    .sort()
}

function usesShared(fnName) {
  const dir = path.join(FUNCTIONS_DIR, fnName)
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'shared' || entry.name === 'node_modules') continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) { if (walk(full)) return true; continue }
      if (!entry.name.endsWith('.js')) continue
      if (/require\(\s*['"]\.\/shared\//.test(fs.readFileSync(full, 'utf8'))) return true
    }
    return false
  }
  return walk(dir)
}

function main() {
  const files = listSharedFiles()
  const fns = listFunctions()

  for (const fn of fns) {
    const target = path.join(FUNCTIONS_DIR, fn, 'shared')
    const referenced = usesShared(fn)
    const exists = fs.existsSync(target)

    if (!referenced) {
      if (exists) problems.push(`${fn}: 未引用 ./shared/ 但仍存在 shared/ 目录（多余）`)
      continue
    }
    if (!exists) {
      problems.push(`${fn}: 引用了 ./shared/ 但缺少 shared/ 目录（未同步）`)
      continue
    }
    const present = fs.readdirSync(target).filter((f) => f.endsWith('.js')).sort()
    for (const f of files) {
      if (!present.includes(f)) { problems.push(`${fn}/shared/${f}: 缺失`); continue }
      const actual = fs.readFileSync(path.join(target, f), 'utf8')
      if (actual !== expectedContent(f)) problems.push(`${fn}/shared/${f}: 内容过期（与 shared/${f} 不一致）`)
    }
    for (const f of present) {
      if (!files.includes(f)) problems.push(`${fn}/shared/${f}: 源文件已不存在（残留）`)
    }
  }

  if (problems.length) {
    console.error('× 共享代码副本不同步：\n')
    problems.forEach((p) => console.error('  - ' + p))
    console.error('\n执行 node scripts/sync-shared.js 后重试。')
    process.exit(1)
  }

  const using = fns.filter(usesShared)
  console.log(`√ 共享代码一致（${files.length} 个源文件，${using.length} 个云函数引用：${using.join(', ') || '无'}）`)
}

main()
