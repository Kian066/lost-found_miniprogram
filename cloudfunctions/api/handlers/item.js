// 信息相关接口：只做入参整理与旧客户端形状适配，业务交给 service。
'use strict'

module.exports = {
  async create(ctx, event) {
    return ctx.services.item.create({
      openid: ctx.openid,
      clientToken: event.clientToken,
      type: event.type,
      title: event.title,
      category: event.category,
      place: event.place,
      time: event.time,
      desc: event.desc,
      features: event.features,
      images: event.images,
      contact: event.contact,
      author: event.author
    })
  },

  async list(ctx, event) {    return ctx.services.item.list({
      page: event.page,
      size: event.size,
      type: event.type,
      category: event.category,
      keyword: event.keyword,
      openid: ctx.openid,
      mine: !!event.mine
    })
  },

  /**
   * 修改登记。注意：删除是独立的 itemRemove，不要在这里用 action 字段区分，
   * 因为顶层 action 已经被路由占用了。
   */
  async update(ctx, event) {
    return ctx.services.item.update({
      id: event.id,
      openid: ctx.openid,
      patch: event.patch,
      expectedVersion: event.expectedVersion
    })
  },

  async remove(ctx, event) {
    return ctx.services.item.remove({ id: event.id, openid: ctx.openid })
  },

  async detail(ctx, event) {
    return ctx.services.item.detail({ id: event.id, openid: ctx.openid })
  }
}
