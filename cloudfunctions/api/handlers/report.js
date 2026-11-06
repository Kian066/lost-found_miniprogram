// 举报相关接口
'use strict'

module.exports = {
  async create(ctx, event) {
    return ctx.services.report.create({
      postId: event.postId,
      openid: ctx.openid,
      reason: event.reason
    })
  }
}
