// 举报表的数据访问
'use strict'

const { COLLECTIONS } = require('../shared/constants')

module.exports = function createReportRepo(db) {
  const _ = db.command
  const col = () => db.collection(COLLECTIONS.REPORTS)

  return {
    async add(doc) {
      const r = await col().add({ data: doc })
      return r._id
    },

    /** 同一人对同一条登记是否已举报过 */
    async findByUser(postId, openid) {
      const r = await col()
        .where({ postId: postId, reporterOpenid: openid })
        .limit(1)
        .get()
        .catch(function () { return { data: [] } })
      return (r.data || [])[0] || null
    },

    async countByPost(postId) {
      const r = await col().where({ postId: postId }).count()
      return r.total
    },

    async getById(id) {
      try {
        const r = await col().doc(id).get()
        return r.data ? Object.assign({}, r.data, { id: r.data._id }) : null
      } catch (e) {
        return null
      }
    },

    /** 管理端：按状态列出（P4 使用） */
    async listByStatus(status, limit) {
      const where = status ? { status: status } : {}
      const r = await col()
        .where(where)
        .orderBy('createdAt', 'desc')
        .limit(limit || 100)
        .get()
      return (r.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
    },

    async updateById(id, patch) {
      await col().doc(id).update({ data: patch })
    },

    async countByStatus(status) {
      const r = await col().where({ status: status }).count()
      return r.total
    }
  }
}
