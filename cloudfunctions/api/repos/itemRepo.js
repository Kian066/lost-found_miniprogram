// 信息表的数据访问层：只负责把「语义查询」翻译成数据库操作。
// 不含业务判断，不抛业务错误，不认识权限。
'use strict'

const { COLLECTIONS } = require('../shared/constants')
const { PUBLIC_ITEM_STATUS } = require('../shared/state')

module.exports = function createItemRepo(db) {
  const _ = db.command
  const col = () => db.collection(COLLECTIONS.ITEMS)

  /** 把语义条件翻译成 where 子句 */
  function buildWhere(query) {
    const where = {}

    if (query.ownerOpenid) {
      // 我的发布：包含已关闭/已找回的
      where.openid = query.ownerOpenid
    } else if (query.publicOnly) {
      where.status = _.in(PUBLIC_ITEM_STATUS)
      where.visible = _.neq(false)
    }

    if (query.type === 'lost' || query.type === 'found') where.type = query.type
    if (query.category && query.category !== '全部') where.category = query.category

    if (query.keyword) {
      const re = db.RegExp({
        regexp: String(query.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options: 'i'
      })
      where.$or = [{ title: re }, { desc: re }, { place: re }, { category: re }]
    }

    return where
  }

  /**
   * 列表返回字段白名单。
   * 不下发 openid / clientToken（身份与幂等标记不出后端）；
   * contact 只在「我的发布」场景下发，避免广场把所有人的联系方式一次性泄漏。
   */
  function buildFields(withContact) {
    const fields = {
      type: true,
      title: true,
      category: true,
      place: true,
      time: true,
      desc: true,
      features: true,
      images: true,
      author: true,
      status: true,
      clueCount: true,
      createdAt: true,
      updatedAt: true,
      visible: true,
      version: true
    }
    if (withContact) fields.contact = true
    return fields
  }

  return {
    /** 按 id 取单条（不存在返回 null，不抛错） */
    async getById(id) {
      try {
        const r = await col().doc(id).get()
        return r.data ? Object.assign({}, r.data, { id: r.data._id }) : null
      } catch (e) {
        return null
      }
    },

    /** 分页搜索，返回 { total, list } */
    async search(query) {
      const where = buildWhere(query)
      const skip = query.skip || 0
      const limit = query.limit || 8

      const [countRes, listRes] = await Promise.all([
        col().where(where).count(),
        col()
          .where(where)
          .field(buildFields(!!query.withContact))
          .orderBy('createdAt', 'desc')
          .skip(skip)
          .limit(limit)
          .get()
      ])

      return {
        total: countRes.total,
        list: (listRes.data || []).map(function (d) {
          return Object.assign({}, d, { id: d._id })
        })
      }
    },

    // ---- 迁移专用 ----

    async countByStatus(status) {
      const r = await col().where({ status: status }).count()
      return r.total
    },

    async countMissingField(field) {
      const cond = {}
      cond[field] = _.exists(false)
      const r = await col().where(cond).count()
      return r.total
    },

    async listIdsByStatus(status, limit) {
      const r = await col()
        .where({ status: status })
        .field({ _id: true })
        .limit(limit || 100)
        .get()
      return (r.data || []).map(function (d) { return d._id })
    },

    async listIdsMissingField(field, limit) {
      const cond = {}
      cond[field] = _.exists(false)
      const r = await col()
        .where(cond)
        .field({ _id: true })
        .limit(limit || 100)
        .get()
      return (r.data || []).map(function (d) { return d._id })
    },

    /** 管理端：全量列表（含已关闭 / 已下架），不下发联系方式 */
    async listForAdmin({ skip, limit, onlyHidden }) {
      const where = onlyHidden ? { visible: false } : {}
      const fields = {
        type: true, title: true, category: true, place: true, time: true,
        author: true, status: true, visible: true, version: true,
        clueCount: true, createdAt: true, updatedAt: true
      }
      const [countRes, listRes] = await Promise.all([
        col().where(where).count(),
        col().where(where).field(fields).orderBy('createdAt', 'desc').skip(skip || 0).limit(limit || 20).get()
      ])
      return {
        total: countRes.total,
        list: (listRes.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
      }
    },

    async updateById(id, patch) {
      await col().doc(id).update({ data: patch })
    },

    async removeById(id) {
      await col().doc(id).remove()
    },

    /** 幂等查重：同一用户 + 同一 clientToken + 同一标题 */
    async findByClientToken(openid, token, title) {
      const r = await col()
        .where({ openid: openid, clientToken: token, title: title })
        .limit(1)
        .get()
        .catch(function () { return { data: [] } })
      return (r.data || [])[0] || null
    },

    async add(doc) {
      const r = await col().add({ data: doc })
      return r._id
    },

    /** 我的发布（含已关闭） */
    async listByOwner(openid, limit) {
      const r = await col().where({ openid: openid }).orderBy('createdAt', 'desc').limit(limit || 100).get()
      return (r.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
    },

    /** 匹配候选：指定类型 + 状态，按时间倒序 */
    async listCandidates({ type, status, limit }) {
      const r = await col()
        .where({ type: type, status: status })
        .orderBy('createdAt', 'desc')
        .limit(limit || 100)
        .get()
      return (r.data || []).map(function (d) { return Object.assign({}, d, { id: d._id }) })
    },

    /** 批量刷新某用户历史登记的展示名 */
    async syncAuthor(openid, name) {
      const BATCH = 100
      const MAX_ROUNDS = 20
      try {
        for (let i = 0; i < MAX_ROUNDS; i++) {
          const r = await col()
            .where({ openid: openid, author: _.neq(name) })
            .field({ _id: true })
            .limit(BATCH)
            .get()
          const ids = (r.data || []).map(function (d) { return d._id })
          if (!ids.length) return
          await col().where({ _id: _.in(ids) }).update({ data: { author: name } })
          if (ids.length < BATCH) return
        }
      } catch (e) {
        // 历史数据展示名同步失败不影响档案保存
      }
    }
  }
}
