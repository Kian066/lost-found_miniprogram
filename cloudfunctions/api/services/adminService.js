// 管理端用例层
//
// 权限判定：users.role === 'ADMIN'。
// 约束：管理员不能读取原始联系方式与私密证明，这里只操作状态与可见性。
'use strict'

const { badRequest, forbidden, notFound, unauthorized } = require('../shared/errors')
const { ITEM_STATUS, applyItemAction } = require('../shared/state')

const BOOTSTRAP_TOKEN = 'P4_BOOTSTRAP'

module.exports = function createAdminService({ userRepo, itemRepo, reportRepo, claimRepo }) {
  /** 取当前用户并要求管理员身份 */
  async function requireAdmin(openid) {
    if (!openid) throw unauthorized()
    const u = await userRepo.getById(openid)
    if (!u || u.role !== 'ADMIN') throw forbidden('需要管理员权限')
    return u
  }

  return {
    /**
     * 引导：系统里还没有任何管理员时，允许当前用户把自己设为管理员。
     * 一旦存在管理员，此接口永久失效，避免成为后门。
     */
    async bootstrap({ openid, confirm }) {
      if (!openid) throw unauthorized()
      if (confirm !== BOOTSTRAP_TOKEN) throw badRequest('缺少引导确认标记')

      const existing = await userRepo.listByRole('ADMIN', 1)
      if (existing.length) throw forbidden('系统已存在管理员，引导入口已关闭')

      await userRepo.ensureProfile({ openid: openid })
      await userRepo.setRole(openid, 'ADMIN')

      return { openid: openid, role: 'ADMIN' }
    },

    /** 全量信息（含已关闭 / 已归档 / 已下架） */
    async items({ openid, page, size, onlyHidden }) {
      await requireAdmin(openid)
      const p = Number(page) > 0 ? Math.floor(Number(page)) : 1
      const s = Math.min(Number(size) > 0 ? Math.floor(Number(size)) : 20, 50)
      const { total, list } = await itemRepo.listForAdmin({
        skip: (p - 1) * s,
        limit: s,
        onlyHidden: !!onlyHidden
      })
      return { total, page: p, size: s, list }
    },

    /**
     * 下架 / 恢复。
     * 下架时：可见性置 false；进行中的信息转 closed；已接受的认领一并取消。
     * 恢复时：只恢复可见性，不复活已经关闭的状态。
     */
    async setVisible({ openid, id, visible }) {
      await requireAdmin(openid)
      if (!id) throw badRequest('缺少 id')

      const item = await itemRepo.getById(id)
      if (!item) throw notFound('该登记不存在')

      const now = Date.now()

      if (visible) {
        await itemRepo.updateById(id, { visible: true, updatedAt: now })
        return { id: id, visible: true, status: item.status }
      }

      const patch = { visible: false, updatedAt: now }

      // 进行中的信息转 closed
      const t = applyItemAction('ADMIN_HIDE', item.status)
      if (t.ok) {
        patch.status = t.to
        patch.version = (item.version || 1) + 1
      }

      await itemRepo.updateById(id, patch)

      // 已接受的认领要一并取消，否则交接会悬空
      const cancelled = await claimRepo.cancelActiveByPost(id, '信息已被管理员下架')

      return {
        id: id,
        visible: false,
        status: patch.status || item.status,
        cancelledClaims: cancelled
      }
    },

    /** 举报列表 */
    async reports({ openid, status }) {
      await requireAdmin(openid)
      const list = await reportRepo.listByStatus(status || '', 100)
      const titleMap = {}
      const ids = []
      list.forEach(function (r) { if (ids.indexOf(r.postId) === -1) ids.push(r.postId) })
      for (const pid of ids) {
        const it = await itemRepo.getById(pid)
        titleMap[pid] = it ? it.title : '（登记已删除）'
      }
      return {
        list: list.map(function (r) {
          return Object.assign({}, r, { itemTitle: titleMap[r.postId] || '' })
        })
      }
    },

    /** 处理举报：只改举报状态，不自动下架（下架是另一个动作） */
    async handleReport({ openid, id, action, result }) {
      await requireAdmin(openid)
      if (!id) throw badRequest('缺少 id')

      const report = await reportRepo.getById(id)
      if (!report) throw notFound('该举报不存在')
      if (report.status !== 'PENDING') throw badRequest('该举报已处理')

      const next = action === 'ignore' ? 'IGNORED' : 'HANDLED'
      await reportRepo.updateById(id, {
        status: next,
        result: String(result || '').slice(0, 500),
        handledAt: Date.now()
      })

      return { id: id, status: next }
    }
  }
}
