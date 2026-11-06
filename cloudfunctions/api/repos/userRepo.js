// 用户表的数据访问
'use strict'

const { COLLECTIONS } = require('../shared/constants')

module.exports = function createUserRepo(db) {
  const col = () => db.collection(COLLECTIONS.USERS)

  return {
    async getById(openid) {
      try {
        const r = await col().doc(openid).get()
        return r.data || null
      } catch (e) {
        return null
      }
    },

    /** 首次登录 / 首次发布时补齐档案；已存在则不动 */
    async ensureProfile({ openid, nickName }) {
      const exist = await this.getById(openid)
      if (exist) return exist
      const now = Date.now()
      const doc = {
        _id: openid,
        openid: openid,
        nickName: nickName || ('同学' + String(openid).slice(-4)),
        credit: 90,
        createdAt: now,
        updatedAt: now
      }
      try {
        await col().add({ data: doc })
        return doc
      } catch (e) {
        // 并发下可能已被另一个请求写入
        return this.getById(openid)
      }
    },

    async getRole(openid) {
      const u = await this.getById(openid)
      return (u && u.role) || 'USER'
    },

    async update(openid, patch) {
      await col().doc(openid).update({ data: patch })
    },

    async setRole(openid, role) {
      await col().doc(openid).update({ data: { role: role, updatedAt: Date.now() } })
    },

    async listByRole(role, limit) {
      const r = await col().where({ role: role }).limit(limit || 20).get()
      return r.data || []
    }
  }
}
