#!/usr/bin/env node
/**
 * 架构约束检查：把「分层」从口号变成可执行的规则。
 *
 * 规则（依赖只能单向）：
 *   shared/     领域层，禁止 import 环境能力（wx-server-sdk / wx.*），只能依赖自己
 *   services/   用例层，只能依赖 shared 与 services
 *   handlers/   接口层，只能依赖 shared / services / handlers
 *   repos/      基础设施层，可以依赖 shared 与 repos，可以 require wx-server-sdk
 *   index/router/composition  装配层，可以依赖本函数内任何东西
 *
 * 另外检查：
 *   - 函数之间不许互相 require（跨部署单元耦合）
 *   - 不许出现循环依赖
 *
 * 用法：node scripts/check-architecture.js
 * 退出码：0 通过，1 有违规
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SHARED_DIR = path.join(ROOT, 'shared')
const FUNCTIONS_DIR = path.join(ROOT, 'cloudfunctions')

/** 允许的依赖方向：目标层 ∈ ALLOW[来源层] */
const ALLOW = {
  shared: ['shared'],
  services: ['shared', 'services'],
  handlers: ['shared', 'services', 'handlers'],
  repos: ['shared', 'repos'],
  entry: ['shared', 'services', 'handlers', 'repos', 'entry', 'generated']
}

const problems = []

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

/** 判断文件属于哪一层，不属于受管辖范围则返回 null */
function layerOf(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  if (rel.startsWith('shared/')) return 'shared'
  const m = rel.match(/^cloudfunctions\/([^/]+)\/(handlers|services|repos)\//)
  if (m) return m[2]
  if (rel.match(/^cloudfunctions\/[^/]+\/(index|router|composition)\.js$/)) return 'entry'
  if (rel.match(/^cloudfunctions\/[^/]+\/[^/]+\.js$/)) return 'entry' // 单文件函数
  if (rel.match(/^cloudfunctions\/[^/]+\/shared\//)) return 'generated'
  return null
}

function functionOf(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const m = rel.match(/^cloudfunctions\/([^/]+)\//)
  return m ? m[1] : null
}

function requires(file) {
  const src = fs.readFileSync(file, 'utf8')
  const out = []
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  let m
  while ((m = re.exec(src))) out.push(m[1])
  return out
}

/** 把相对模块名解析成实际文件路径（补 .js / /index.js） */
function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, base + '.js', path.join(base, 'index.js')]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

const files = []
walk(SHARED_DIR, files)
if (fs.existsSync(FUNCTIONS_DIR)) {
  for (const d of fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === 'shared') continue
    walk(path.join(FUNCTIONS_DIR, d.name), files)
  }
}

const graph = new Map()

for (const file of files) {
  const layer = layerOf(file)
  if (!layer || layer === 'generated') continue
  const fromFn = functionOf(file)
  const deps = requires(file)

  for (const spec of deps) {
    const target = resolveModule(file, spec)

    // 外部包 / 平台能力
    if (!target) {
      if (layer === 'shared' && spec === 'wx-server-sdk') {
        problems.push(`${rel(file)}: 领域层禁止依赖 wx-server-sdk`)
      }
      if (spec.startsWith('wx-server-sdk') && (layer === 'services' || layer === 'handlers')) {
        problems.push(`${rel(file)}: ${layer} 层禁止直接依赖 wx-server-sdk（应由 repos 层或注入提供）`)
      }
      continue
    }

    // 云函数里 require 的 ./shared/ 是 shared/ 的生成副本，语义上等同领域层
    const rawLayer = layerOf(target)
    const targetLayer = rawLayer === 'generated' ? 'shared' : rawLayer || 'generated'

    // 跨函数依赖
    const targetFn = functionOf(target)
    if (fromFn && targetFn && fromFn !== targetFn) {
      problems.push(`${rel(file)}: 不允许跨云函数依赖 ${targetFn}/（${spec}）`)
      continue
    }

    if (ALLOW[layer] && ALLOW[layer].indexOf(targetLayer) === -1) {
      problems.push(`${rel(file)}: ${layer} 层不允许依赖 ${targetLayer} 层（${spec}）`)
      continue
    }

    if (!graph.has(file)) graph.set(file, new Set())
    graph.get(file).add(target)
  }

  // 领域层禁止直接碰全局 wx
  if (layer === 'shared' && /(^|[^.\w])wx\.[a-zA-Z]/.test(fs.readFileSync(file, 'utf8'))) {
    problems.push(`${rel(file)}: 领域层禁止调用 wx.* 全局对象`)
  }
}

/** 循环依赖检测 */
const WHITE = 0
const GRAY = 1
const BLACK = 2
const color = new Map()

function dfs(node, stack) {
  color.set(node, GRAY)
  stack.push(node)
  const next = graph.get(node) || new Set()
  for (const dep of next) {
    const c = color.get(dep) || WHITE
    if (c === GRAY) {
      const idx = stack.indexOf(dep)
      const cycle = stack.slice(idx).concat(dep).map(rel).join(' → ')
      problems.push(`循环依赖：${cycle}`)
    } else if (c === WHITE) {
      dfs(dep, stack)
    }
  }
  stack.pop()
  color.set(node, BLACK)
}

for (const node of graph.keys()) {
  if ((color.get(node) || WHITE) === WHITE) dfs(node, [])
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

if (problems.length) {
  console.error('× 架构约束被破坏：\n')
  problems.forEach((p) => console.error('  - ' + p))
  console.error('\n依赖方向：shared ← services ← handlers；repos 只依赖 shared。详见脚本头部注释。')
  process.exit(1)
}

console.log(`√ 架构检查通过（扫描 ${files.length} 个文件）`)
