// 认领申请的事务工作单元
//
// 为什么单独一层：创建 / 接受 / 完成归还都要同时改 claims 与 items，
// 必须在一个事务里完成，否则会出现「申请已接受但招领还是 open」这类中间态。
// 事务句柄只在 repo 层出现，service 拿到的是语义化的 store。
'use strict'

const { COLLECTIONS } = require('../shared/constants')
const { CLAIM_STATUS } = require('../shared/state')

module.exports = function createClaimUow(db) {
  const _ = db.command

  return {
    /**
     * 在一个事务里执行业务回调。回调抛错会自动回滚。
     * @param {(store: Object) => Promise<any>} fn
     */
    run(fn) {
      return db.runTransaction(async function (tx) {
        const items = tx.collection(COLLECTIONS.ITEMS)
        const claims = tx.collection(COLLECTIONS.CLAIMS)

        const store = {
          async getItem(id) {
            try {
              const r = await items.doc(id).get()
              return r.data ? Object.assign({}, r.data, { id: r.data._id }) : null
            } catch (e) {
              return null
            }
          },

          async getClaim(id) {
            try {
              const r = await claims.doc(id).get()
              return r.data ? Object.assign({}, r.data, { id: r.data._id }) : null
            } catch (e) {
              return null
            }
          },

          /** 同一人对同一登记的活动申请 */
          async findActiveClaim(postId, openid) {
            const r = await claims
              .where({
                postId: postId,
                applicantOpenid: openid,
                status: _.in([CLAIM_STATUS.PENDING, CLAIM_STATUS.ACCEPTED])
              })
              .limit(1)
              .get()
            return (r.data || [])[0] || null
          },

          /** 该登记是否已有被接受的申请 */
          async findAcceptedClaim(postId) {
            const r = await claims
              .where({ postId: postId, status: CLAIM_STATUS.ACCEPTED })
              .limit(1)
              .get()
            return (r.data || [])[0] || null
          },

          async addClaim(doc) {
            const r = await claims.add({ data: doc })
            return r._id
          },

          async updateClaim(id, patch) {
            await claims.doc(id).update({ data: patch })
          },

          async updateItem(id, patch) {
            await items.doc(id).update({ data: patch })
          },

          /** 完成归还时，把其余待处理申请置为已拒绝 */
          async rejectOtherPending(postId, exceptClaimId, reason) {
            const r = await claims
              .where({ postId: postId, status: CLAIM_STATUS.PENDING })
              .limit(100)
              .get()
            const list = (r.data || []).filter(function (c) { return c._id !== exceptClaimId })
            for (const c of list) {
              await claims.doc(c._id).update({
                data: {
                  status: CLAIM_STATUS.REJECTED,
                  reason: reason || '物品已归还',
                  updatedAt: Date.now()
                }
              })
            }
            return list.length
          }
        }

        return fn(store)
      })
    }
  }
}
