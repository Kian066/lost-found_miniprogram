#!/usr/bin/env node
/**
 * 管理端用例层单测：用内存假 repo 覆盖需要特殊数据才能触发的分支。
 * 重点：下架时的联动（转 closed、取消活动认领）、恢复不复活状态、
 * 权限拒绝、举报处理的状态机。
 *
 * 用法：node scripts/test-admin-service.js
 */
'use strict'

const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const createAdminService = require(path.join(ROOT, 'cloudfunctions/api/services/adminService.js'))

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; return }
  fail++
  console.error('  × ' + name + (detail ? '   [' + detail + ']' : ''))
}

function setup(opts) {
  const o = opts || {}
  const state = {
    items: new Map(),
    claims: new Map(),
    reports: new Map(),
    users: new Map()
  }

  state.users.set(o.openid || 'ADMIN', { openid: o.openid || 'ADMIN', nickName: '管理员', role: o.role || 'ADMIN' })

  const userRepo = {
    async getById(id) { return state.users.get(id) || null },
    async listByRole(role) {
      return Array.from(state.users.values()).filter((u) => u.role === role)
    },
    async ensureProfile({ openid }) {
      if (!state.users.has(openid)) state.users.set(openid, { openid: openid, nickName: '新同学' })
      return state.users.get(openid)
    },
    async setRole(id, role) {
      const u = state.users.get(id) || { openid: id }
      u.role = role
      state.users.set(id, u)
    }
  }

  const itemRepo = {
    async getById(id) {
      const it = state.items.get(id)
      return it ? Object.assign({}, it) : null
    },
    async updateById(id, patch) {
      const it = state.items.get(id)
      if (it) Object.assign(it, patch)
    },
    async listForAdmin({ skip, limit, onlyHidden }) {
      let list = Array.from(state.items.values())
      if (onlyHidden) list = list.filter((x) => x.visible === false)
      return { total: list.length, list: list.slice(skip || 0, (skip || 0) + (limit || 20)) }
    }
  }

  const claimRepo = {
    async cancelActiveByPost(postId, reason) {
      let n = 0
      for (const c of state.claims.values()) {
        if (c.postId === postId && (c.status === 'PENDING' || c.status === 'ACCEPTED')) {
          c.status = 'CANCELLED'
          c.reason = reason
          n++
        }
      }
      return n
    }
  }

  const reportRepo = {
    async listByStatus(status) {
      const all = Array.from(state.reports.values())
      return status ? all.filter((r) => r.status === status) : all
    },
    async getById(id) {
      const r = state.reports.get(id)
      return r ? Object.assign({}, r) : null
    },
    async updateById(id, patch) {
      const r = state.reports.get(id)
      if (r) Object.assign(r, patch)
    }
  }

  const service = createAdminService({ userRepo, itemRepo, reportRepo, claimRepo })
  return { service, state }
}

function seedItem(state, id, extra) {
  state.items.set(id, Object.assign({
    id: id, _id: id, type: 'found', title: '测试物品', status: 'open',
    visible: true, version: 1
  }, extra || {}))
}

;(async () => {
  console.log('管理端 · 服务层')

  // 权限
  {
    const { service } = setup({ role: 'USER' })
    try {
      await service.items({ openid: 'ADMIN' })
      ok('非管理员调用 items 应被拒绝', false)
    } catch (e) {
      ok('非管理员调用 items → 403', e.code === 403, 'code=' + e.code)
    }
  }

  // 下架 open 信息
  {
    const { service, state } = setup()
    seedItem(state, 'i1', { status: 'open', version: 3 })
    const r = await service.setVisible({ openid: 'ADMIN', id: 'i1', visible: false })
    const it = state.items.get('i1')
    ok('下架后 visible=false', it.visible === false)
    ok('open → closed', it.status === 'closed', it.status)
    ok('version 递增', it.version === 4, String(it.version))
    ok('返回值带状态', r.status === 'closed', r.status)
  }

  // 下架 processing 信息时取消活动认领
  {
    const { service, state } = setup()
    seedItem(state, 'i2', { status: 'processing' })
    state.claims.set('c1', { id: 'c1', postId: 'i2', status: 'ACCEPTED' })
    state.claims.set('c2', { id: 'c2', postId: 'i2', status: 'PENDING' })
    state.claims.set('c3', { id: 'c3', postId: 'i2', status: 'CANCELLED' })
    const r = await service.setVisible({ openid: 'ADMIN', id: 'i2', visible: false })
    ok('processing → closed', state.items.get('i2').status === 'closed')
    ok('取消了两条活动认领', r.cancelledClaims === 2, 'n=' + r.cancelledClaims)
    ok('已取消的认领不被重复处理', state.claims.get('c3').status === 'CANCELLED')
    ok('取消原因写入', state.claims.get('c1').reason === '信息已被管理员下架', state.claims.get('c1').reason)
  }

  // 下架 resolved 信息：状态不变
  {
    const { service, state } = setup()
    seedItem(state, 'i3', { status: 'resolved' })
    await service.setVisible({ openid: 'ADMIN', id: 'i3', visible: false })
    ok('已解决的信息下架不改状态', state.items.get('i3').status === 'resolved', state.items.get('i3').status)
    ok('但可见性被关闭', state.items.get('i3').visible === false)
  }

  // 恢复不复活状态
  {
    const { service, state } = setup()
    seedItem(state, 'i4', { status: 'closed', visible: false })
    await service.setVisible({ openid: 'ADMIN', id: 'i4', visible: true })
    ok('恢复后可见', state.items.get('i4').visible === true)
    ok('恢复后仍是 closed（不复活）', state.items.get('i4').status === 'closed', state.items.get('i4').status)
  }

  // 不存在 / 缺参数
  {
    const { service } = setup()
    try { await service.setVisible({ openid: 'ADMIN', id: '', visible: false }); ok('缺 id 应报错', false) }
    catch (e) { ok('缺 id → 400', e.code === 400, 'code=' + e.code) }
    try { await service.setVisible({ openid: 'ADMIN', id: 'nope', visible: false }); ok('不存在应报错', false) }
    catch (e) { ok('不存在 → 404', e.code === 404, 'code=' + e.code) }
  }

  // 举报处理
  {
    const { service, state } = setup()
    state.reports.set('r1', { id: 'r1', postId: 'i1', status: 'PENDING', reason: 'x' })
    const r = await service.handleReport({ openid: 'ADMIN', id: 'r1', action: 'handle', result: '已核实' })
    ok('处理举报 → HANDLED', r.status === 'HANDLED')
    ok('处理说明已写入', state.reports.get('r1').result === '已核实')
    try { await service.handleReport({ openid: 'ADMIN', id: 'r1', action: 'handle' }); ok('重复处理应报错', false) }
    catch (e) { ok('重复处理 → 400', e.code === 400, 'code=' + e.code) }
  }

  // 忽略举报
  {
    const { service, state } = setup()
    state.reports.set('r2', { id: 'r2', postId: 'i1', status: 'PENDING' })
    const r = await service.handleReport({ openid: 'ADMIN', id: 'r2', action: 'ignore' })
    ok('忽略举报 → IGNORED', r.status === 'IGNORED')
  }

  // 举报处理不改信息状态（下架是独立动作）
  {
    const { service, state } = setup()
    seedItem(state, 'i5', { status: 'open', visible: true })
    state.reports.set('r3', { id: 'r3', postId: 'i5', status: 'PENDING' })
    await service.handleReport({ openid: 'ADMIN', id: 'r3', action: 'handle' })
    ok('处理举报不影响信息可见性', state.items.get('i5').visible === true)
    ok('处理举报不改变信息状态', state.items.get('i5').status === 'open')
  }

  // 引导
  {
    const { service, state } = setup({ role: 'USER' })
    state.users.set('ADMIN', { openid: 'ADMIN', role: 'USER' })
    try { await service.bootstrap({ openid: 'ADMIN', confirm: 'WRONG' }); ok('引导标记错误应报错', false) }
    catch (e) { ok('引导标记错误 → 400', e.code === 400, 'code=' + e.code) }

    const r = await service.bootstrap({ openid: 'ADMIN', confirm: 'P4_BOOTSTRAP' })
    ok('无管理员时引导成功', r.role === 'ADMIN')
    ok('角色已落库', state.users.get('ADMIN').role === 'ADMIN')

    try { await service.bootstrap({ openid: 'ADMIN', confirm: 'P4_BOOTSTRAP' }); ok('二次引导应报错', false) }
    catch (e) { ok('已有管理员后引导 → 403', e.code === 403, 'code=' + e.code) }
  }

  console.log('')
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
