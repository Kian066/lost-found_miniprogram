#!/usr/bin/env node
/**
 * 把 shared/ 下的共享模块同步到各云函数目录。
 *
 * 背景：微信云函数每个目录独立打包上传，require('../shared/xx') 在云端会找不到文件，
 * 所以只能把共享代码物理复制进每个函数目录。这个脚本负责复制，check-shared.js 负责检查漂移。
 *
 * 规则：
 *   - 只给「代码里确实 require('./shared/...')」的云函数复制，其余函数不产生多余文件
 *   - 每个副本带自动生成标记，避免有人直接改副本
 *   - 幂等：重复执行结果一致
 *
 * 用法：node scripts/sync-shared.js
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

function listSharedFiles() {
  if (!fs.existsSync(SHARED_DIR)) return []
  return fs
    .readdirSync(SHARED_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
}

function readShared(name) {
  return fs.readFileSync(path.join(SHARED_DIR, name), 'utf8')
}

function generatedContent(name) {
  const header = GENERATED_HEADER.replace('__NAME__', name)
  return header + readShared(name)
}

/** 列出云函数目录（含 index.js 的子目录） */
function listFunctions() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return []
  return fs
    .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'shared')
    .filter((d) => fs.existsSync(path.join(FUNCTIONS_DIR, d.name, 'index.js')))
    .map((d) => d.name)
}

/** 该函数是否引用了 ./shared/（扫描函数目录下所有 .js，排除 shared 自身） */
function usesShared(fnName) {
  const dir = path.join(FUNCTIONS_DIR, fnName)
  const seen = new Set()
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'shared' || entry.name === 'node_modules') continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.js')) continue
      if (seen.has(full)) continue
      seen.add(full)
      const src = fs.readFileSync(full, 'utf8')
      if (/require\(\s*['"]\.\/shared\//.test(src)) return true
    }
    return false
  }
  return walk(dir)
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

function main() {
  const files = listSharedFiles()
  if (!files.length) {
    console.error('× shared/ 下没有可同步的 .js 文件')
    process.exit(1)
  }

  const fns = listFunctions()
  let synced = 0
  let cleaned = 0
  const skipped = []

  for (const fn of fns) {
    const target = path.join(FUNCTIONS_DIR, fn, 'shared')
    if (!usesShared(fn)) {
      if (fs.existsSync(target)) { rmrf(target); cleaned++ }
      skipped.push(fn)
      continue
    }
    rmrf(target)
    fs.mkdirSync(target, { recursive: true })
    for (const f of files) {
      fs.writeFileSync(path.join(target, f), generatedContent(f), 'utf8')
    }
    synced++
    console.log(`√ ${fn}/shared  (${files.join(', ')})`)
  }

  console.log('')
  console.log(`已同步 ${synced} 个云函数，清理 ${cleaned} 个多余副本`)
  if (skipped.length) console.log(`未引用共享模块（跳过）：${skipped.join(', ')}`)
}

main()
