// 认领申请的数据访问（非事务读）
'use strict'

const { COLLECTIONS } = require('../shared/constants')

module.exports = function createClaimRepo(db) {
  const _ = db.command
  const col = () => db.collection(COLLECTIONS.CLAIMS)

  return {
    async getById(id) {
      try {
        const r = await col().doc(id).get()
        return r.data ? Object.assign({}, r.data, { id: r.data._id }) : null
      } catch (e) {
        return null
      }
    },

    /** 我发出的申请 */
    async listByApplicant(openid, limit) {
      const r = await col()
        .where({ applicantOpenid: openid })
        .orderBy('createdAt', 'desc')
        .limit(limit || 50)
        .get()
      return (r.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
    },

    /** 我发布的登记收到的申请 */
    async listByPosts(postIds, limit) {
      if (!postIds || !postIds.length) return []
      const r = await col()
        .where({ postId: _.in(postIds) })
        .orderBy('createdAt', 'desc')
        .limit(limit || 100)
        .get()
      return (r.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
    },

    /** 某条登记的全部申请（发布者视角） */
    async listByPost(postId, limit) {
      const r = await col()
        .where({ postId: postId })
        .orderBy('createdAt', 'desc')
        .limit(limit || 50)
        .get()
      return (r.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
    },

    /** 是否存在活动申请（发布者禁止编辑招领用） */
    async countActiveByPost(postId) {
      const r = await col()
        .where({ postId: postId, status: _.in(['PENDING', 'ACCEPTED']) })
        .count()
      return r.total
    },

    /** 管理端下架时：把该登记下所有活动申请置为已取消 */
    async cancelActiveByPost(postId, reason) {
      const r = await col()
        .where({ postId: postId, status: _.in(['PENDING', 'ACCEPTED']) })
        .limit(100)
        .get()
      const list = r.data || []
      for (const c of list) {
        await col().doc(c._id).update({
          data: { status: 'CANCELLED', reason: reason || '信息已被下架', updatedAt: Date.now() }
        })
      }
      return list.length
    }
  }
}
