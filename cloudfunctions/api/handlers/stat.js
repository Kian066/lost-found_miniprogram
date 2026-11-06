// 统计相关接口
'use strict'

module.exports = {
  async overview(ctx, event) {
    return ctx.services.stat.overview({
      openid: ctx.openid,
      mine: !!event.mine
    })
  }
}
