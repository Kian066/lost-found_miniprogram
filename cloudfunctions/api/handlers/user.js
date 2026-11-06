// 用户相关接口
'use strict'

module.exports = {
  /** 静默登录 / 读档案 / 改档案（event.mode === 'update' 时写） */
  async login(ctx, event) {
    return ctx.services.user.login({
      openid: ctx.openid,
      mode: event.mode === 'update' ? 'update' : 'get',
      patch: event.patch
    })
  },

  /** 「我的」聚合数据 */
  async mine(ctx) {
    return ctx.services.user.mine({ openid: ctx.openid })
  }
}
