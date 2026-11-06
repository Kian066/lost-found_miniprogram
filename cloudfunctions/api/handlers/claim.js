// 认领相关接口
'use strict'

module.exports = {
  async create(ctx, event) {
    return ctx.services.claim.create({
      itemId: event.itemId,
      openid: ctx.openid,
      proofText: event.proofText,
      contact: event.contact
    })
  },

  /**
   * 处理申请。注意动词放在 op 字段：action 已被路由占用。
   * op: accept | reject | cancel | complete
   */
  async act(ctx, event) {
    return ctx.services.claim.act({
      claimId: event.claimId,
      openid: ctx.openid,
      action: event.op,
      finderContact: event.finderContact,
      reason: event.reason
    })
  },

  async list(ctx, event) {
    return ctx.services.claim.list({
      openid: ctx.openid,
      mode: event.mode === 'received' ? 'received' : 'sent'
    })
  },

  async detail(ctx, event) {
    return ctx.services.claim.detail({ claimId: event.claimId, openid: ctx.openid })
  }
}
