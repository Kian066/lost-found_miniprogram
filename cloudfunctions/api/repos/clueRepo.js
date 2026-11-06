// 线索表的数据访问
'use strict'

const { COLLECTIONS } = require('../shared/constants')

module.exports = function createClueRepo(db) {
  const _ = db.command
  const col = () => db.collection(COLLECTIONS.CLUES)

  return {
    async add(doc) {
      const r = await col().add({ data: doc })
      return r._id
    },

    /** 线索数原子自增，避免并发覆盖 */
    async incItemClueCount(itemId) {
      await db.collection(COLLECTIONS.ITEMS).doc(itemId).update({
        data: { clueCount: _.inc(1), updatedAt: Date.now() }
      })
    },

    async countByItem(itemId) {
      const r = await col().where({ itemId: itemId }).count()
      return r.total
    },

    async listByItem(itemId, limit) {
      const r = await col()
        .where({ itemId: itemId })
        .orderBy('createdAt', 'desc')
        .limit(limit || 50)
        .get()
      return r.data || []
    },

    async removeByItem(itemId) {
      try {
        await col().where({ itemId: itemId }).remove()
      } catch (e) {
        // 线索清理失败不阻断主流程
      }
    },

    /** 我提交过的线索 */
    async listByOpenid(openid, limit) {
      const r = await col().where({ openid: openid }).orderBy('createdAt', 'desc').limit(limit || 100).get()
      return r.data || []
    },

    /** 别人在我发布的登记下留的线索 */
    async listForOwner(itemIds, ownerOpenid, limit) {
      if (!itemIds || !itemIds.length) return []
      const r = await col()
        .where({ itemId: _.in(itemIds), openid: _.neq(ownerOpenid) })
        .orderBy('createdAt', 'desc')
        .limit(limit || 100)
        .get()
      return r.data || []
    },

    /** 批量刷新某用户历史线索的展示名 */
    async syncAuthor(openid, name) {
      const BATCH = 100
      const MAX_ROUNDS = 20
      try {
        for (let i = 0; i < MAX_ROUNDS; i++) {
          const r = await col()
            .where({ openid: openid, author: _.neq(name) })
            .field({ _id: true })
            .limit(BATCH)
            .get()
          const ids = (r.data || []).map(function (d) { return d._id })
          if (!ids.length) return
          await col().where({ _id: _.in(ids) }).update({ data: { author: name } })
          if (ids.length < BATCH) return
        }
      } catch (e) {
        // 忽略
      }
    }
  }
}
