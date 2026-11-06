// 统计的数据访问层
'use strict'

const { COLLECTIONS } = require('../shared/constants')
const { ITEM_STATUS } = require('../shared/state')

module.exports = function createStatRepo(db) {
  async function count(name, where) {
    try {
      const r = await db.collection(name).where(where).count()
      return r.total
    } catch (e) {
      return 0
    }
  }

  return {
    /**
     * 概览计数
     * @param {Object} p
     * @param {string} p.openid 当前用户
     * @param {boolean} p.mine 是否统计该用户自己的
     */
    async overview({ openid, mine }) {
      const scope = mine ? { openid: openid } : {}

      const [lost, found, resolved, closed, clue, publish] = await Promise.all([
        count(COLLECTIONS.ITEMS, Object.assign({ status: ITEM_STATUS.OPEN, type: 'lost' }, scope)),
        count(COLLECTIONS.ITEMS, Object.assign({ status: ITEM_STATUS.OPEN, type: 'found' }, scope)),
        count(COLLECTIONS.ITEMS, Object.assign({ status: ITEM_STATUS.RESOLVED }, scope)),
        count(COLLECTIONS.ITEMS, Object.assign({ status: ITEM_STATUS.CLOSED }, scope)),
        count(COLLECTIONS.CLUES, {}),
        count(COLLECTIONS.ITEMS, { openid: openid })
      ])

      return {
        lost,
        found,
        // solved 保持旧字段名，语义为「已找回 / 已归还」
        solved: resolved,
        resolved,
        closed,
        clue,
        publish
      }
    }
  }
}
