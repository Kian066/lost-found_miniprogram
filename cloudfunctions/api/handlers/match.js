// 匹配相关接口
'use strict'

module.exports = {
  async search(ctx, event) {
    return ctx.services.match.search({
      baseId: event.baseId,
      keyword: event.keyword,
      category: event.category,
      limit: event.limit,
      openid: ctx.openid
    })
  }
}
