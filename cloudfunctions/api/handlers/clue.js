// 线索相关接口
'use strict'

module.exports = {
  async create(ctx, event) {
    return ctx.services.clue.create({
      itemId: event.itemId,
      openid: ctx.openid,
      content: event.content,
      contact: event.contact,
      author: event.author
    })
  }
}
