// 管理端接口
'use strict'

module.exports = {
  async bootstrap(ctx, event) {
    return ctx.services.admin.bootstrap({ openid: ctx.openid, confirm: event.confirm })
  },

  async items(ctx, event) {
    return ctx.services.admin.items({
      openid: ctx.openid,
      page: event.page,
      size: event.size,
      onlyHidden: !!event.onlyHidden
    })
  },

  async setVisible(ctx, event) {
    return ctx.services.admin.setVisible({
      openid: ctx.openid,
      id: event.id,
      visible: !!event.visible
    })
  },

  async reports(ctx, event) {
    return ctx.services.admin.reports({ openid: ctx.openid, status: event.status })
  },

  async handleReport(ctx, event) {
    return ctx.services.admin.handleReport({
      openid: ctx.openid,
      id: event.id,
      action: event.op,
      result: event.result
    })
  }
}
