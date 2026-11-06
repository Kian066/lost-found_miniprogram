// 信息的用例层：业务规则在这里，不碰数据库 API。
// 依赖通过参数注入（itemRepo / clueRepo / fileRepo），因此可以脱离云环境单测。
'use strict'

const { LIMITS } = require('../shared/constants')
const { ITEM_STATUS, applyItemAction } = require('../shared/state')
const match = require('../shared/match')
const perm = require('../shared/permissions')
const { badRequest, forbidden, notFound, conflict, unauthorized } = require('../shared/errors')

const MAX_SIZE = 20
const KEYWORD_MAX = 50
const MIGRATE_BATCH = 100
const MIGRATE_MAX_ROUNDS = 50

/** 允许客户端直接改的字段（status 单独走状态机，不在此列） */
const EDITABLE_FIELDS = ['title', 'desc', 'features', 'contact', 'place', 'time', 'category', 'images']

/**
 * 旧客户端的 status 语义 → 业务动作。
 * 旧版「标记已解决」写 closed，现在对应 OWNER_RESOLVE（open → resolved）；
 * 旧版「重新开启」写 open，对应 OWNER_REOPEN（closed → open）。
 */
const LEGACY_STATUS_ACTION = {
  closed: 'OWNER_RESOLVE',
  resolved: 'OWNER_RESOLVE',
  open: 'OWNER_REOPEN'
}

module.exports = function createItemService({ itemRepo, clueRepo, claimRepo, fileRepo, auditRepo, userRepo }) {
  return {
    /**
     * 发布登记：校验 → 幂等查重 → 内容审核 → 落库（显式写入 visible / version / status）
     */
    async create(input) {
      if (!input.openid) throw unauthorized()

      const title = String(input.title || '').trim()
      const desc = String(input.desc || '').trim()
      const contact = String(input.contact || '').trim()
      const time = String(input.time || '').trim()

      if (!title) throw badRequest('请填写物品名称')
      if (title.length > LIMITS.TITLE_MAX) throw badRequest('物品名称最多 ' + LIMITS.TITLE_MAX + ' 个字')
      if (desc.length < LIMITS.DESC_MIN) throw badRequest('请至少用 ' + LIMITS.DESC_MIN + ' 个字描述物品特征')
      if (desc.length > LIMITS.DESC_MAX) throw badRequest('描述最多 ' + LIMITS.DESC_MAX + ' 个字')
      if (!contact) throw badRequest('请填写联系方式')
      if (!time) throw badRequest('请选择时间')

      const features = Array.isArray(input.features) ? input.features.slice(0, LIMITS.FEATURES) : []
      const images = Array.isArray(input.images) ? input.images.slice(0, LIMITS.IMAGES) : []
      const token = String(input.clientToken || '').trim()

      // 幂等：同一 clientToken + 同一标题只写一条
      if (token) {
        const dup = await itemRepo.findByClientToken(input.openid, token, title)
        if (dup) {
          return { id: dup._id, createdAt: dup.createdAt, duplicated: true }
        }
      }

      const audit = await auditRepo.checkText([title, desc, features.join('')].join(' '), input.openid)
      if (!audit.pass) throw badRequest(audit.msg || '内容不合规')

      const now = Date.now()
      const doc = {
        openid: input.openid,
        clientToken: token,
        type: input.type === 'found' ? 'found' : 'lost',
        title: title,
        category: String(input.category || '其他'),
        place: String(input.place || ''),
        time: time,
        desc: desc,
        features: features,
        images: images,
        contact: contact,
        author: String(input.author || '同学').slice(0, 30),
        status: ITEM_STATUS.OPEN,
        visible: true,
        version: 1,
        clueCount: 0,
        createdAt: now,
        updatedAt: now
      }

      const id = await itemRepo.add(doc)
      await userRepo.ensureProfile({ openid: input.openid, nickName: doc.author })

      return { id: id, createdAt: now }
    },

    /**
     * 广场 / 我的发布 列表
     */
    async list({ page, size, type, category, keyword, openid, mine }) {
      const p = Number(page) > 0 ? Math.floor(Number(page)) : 1
      const s = Math.min(Number(size) > 0 ? Math.floor(Number(size)) : LIMITS.PAGE_SIZE, MAX_SIZE)
      const kw = String(keyword || '').trim()
      if (kw.length > KEYWORD_MAX) throw badRequest('关键词最多 ' + KEYWORD_MAX + ' 个字')

      const query = { type, category, keyword: kw, skip: (p - 1) * s, limit: s }

      if (mine) {
        if (!openid) throw unauthorized()
        query.ownerOpenid = openid
        // 只有自己的发布才下发联系方式
        query.withContact = true
      } else {
        query.publicOnly = true
        query.withContact = false
      }

      const { total, list } = await itemRepo.search(query)

      return { total, page: p, size: s, hasMore: p * s < total, list }
    },

    /**
     * 详情：受控下发联系方式 + 线索列表 + Top3 推荐
     */
    async detail({ id, openid }) {
      if (!id) throw badRequest('缺少 id')

      const item = await itemRepo.getById(id)
      if (!item) throw notFound('该登记不存在或已删除')

      const relation = perm.relationOf({ item: item, openid: openid })
      if (!perm.canViewItem(relation, item)) throw forbidden('该登记当前不可查看')

      const isMine = relation === perm.RELATION.OWNER
      const clueList = await clueRepo.listByItem(id, 50)

      const clues = clueList.map(function (c) {
        return {
          id: c._id,
          content: c.content,
          author: c.author,
          createdAt: c.createdAt,
          score: match.clueScore(item, c.content),
          // 线索提交者的联系方式只给登记发布者看
          contact: isMine ? (c.contact || '') : ''
        }
      })
      clues.sort(function (a, b) { return b.score - a.score })

      // Top3 推荐
      let matches = []
      try {
        const target = item.type === 'lost' ? 'found' : 'lost'
        const cands = await itemRepo.listCandidates({ type: target, status: ITEM_STATUS.OPEN, limit: 100 })
        matches = match.matchList(item, cands, '', 15).slice(0, 3).map(function (r) {
          return {
            id: r.item.id,
            title: r.item.title,
            category: r.item.category,
            place: r.item.place,
            time: r.item.time,
            score: r.score,
            level: r.level,
            reasons: r.reasons
          }
        })
      } catch (e) {
        matches = []
      }

      // 云存储 fileID → HTTPS 临时链接。在云函数里做，不受存储 ACL 限制，
      // 客户端拿到的就是可直接渲染的地址，无需再调 getTempFileURL。
      const urlMap = await fileRepo.toTempUrls(item.images || [])
      const images = (item.images || []).map(function (f) {
        return urlMap[f] || f
      })

      return {
        item: {
          id: item.id,
          type: item.type,
          title: item.title,
          category: item.category,
          place: item.place,
          time: item.time,
          desc: item.desc,
          features: item.features || [],
          images: images,
          author: item.author,
          status: item.status,
          clueCount: item.clueCount || 0,
          createdAt: item.createdAt,
          contact: perm.contactFor(relation, item.contact)
        },
        isMine: isMine,
        contactRevealed: perm.canViewContact(relation),
        clues: clues,
        matches: matches
      }
    },

    /**
     * 修改登记：状态变更走状态机；字段编辑只允许在 open 状态。
     */
    async update({ id, openid, patch, expectedVersion }) {
      if (!openid) throw unauthorized()
      if (!id) throw badRequest('缺少 id')

      const item = await itemRepo.getById(id)
      if (!item) throw notFound('该登记不存在')
      if (item.openid !== openid) throw forbidden('无权操作他人的登记')

      // 乐观锁：客户端带上读取时的 version，不一致说明期间被改过
      if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
        const current = Number(item.version || 1)
        if (Number(expectedVersion) !== current) {
          throw conflict('内容已被修改，请刷新后重试')
        }
      }

      const input = patch || {}
      const next = {}

      if (input.status !== undefined) {
        const action = LEGACY_STATUS_ACTION[input.status]
        if (!action) throw badRequest('不支持的状态变更：' + input.status)
        const r = applyItemAction(action, item.status)
        if (!r.ok) throw conflict(r.reason)
        next.status = r.to
        if (r.to === ITEM_STATUS.RESOLVED) next.resolvedAt = Date.now()
      }

      const fieldKeys = Object.keys(input).filter(function (k) {
        return k !== 'status' && EDITABLE_FIELDS.indexOf(k) > -1 && input[k] !== undefined
      })
      if (fieldKeys.length) {
        // 招领一旦有人申请，就不允许再改内容（避免申请方看到的与实物不符）
        let hasActiveClaim = false
        if (item.type === 'found' && claimRepo) {
          hasActiveClaim = (await claimRepo.countActiveByPost(id)) > 0
        }
        if (!perm.canEditItem(perm.RELATION.OWNER, item, hasActiveClaim)) {
          throw conflict(
            hasActiveClaim
              ? '该招领已有待处理的认领申请，暂不能编辑'
              : '当前状态为「' + item.status + '」，不允许编辑'
          )
        }
        fieldKeys.forEach(function (k) { next[k] = input[k] })
      }

      if (!Object.keys(next).length) throw badRequest('没有需要更新的字段')

      next.updatedAt = Date.now()
      next.version = (item.version || 1) + 1

      await itemRepo.updateById(id, next)
      return { id: id, patch: next }
    },

    /**
     * 删除登记：动手中不允许删除；同时清理线索与云存储图片。
     */
    async remove({ id, openid }) {
      if (!openid) throw unauthorized()
      if (!id) throw badRequest('缺少 id')

      const item = await itemRepo.getById(id)
      if (!item) throw notFound('该登记不存在')
      if (item.openid !== openid) throw forbidden('无权操作他人的登记')
      if (item.status === ITEM_STATUS.PROCESSING) {
        throw conflict('交接中不能删除，请先取消认领')
      }

      await itemRepo.removeById(id)
      await clueRepo.removeByItem(id)

      // 清理云存储里的配图，避免孤儿文件累积
      const cleaned = await fileRepo.removeFiles(item.images)
      return { deleted: true, filesRemoved: cleaned.removed }
    },

    /**
     * 存量数据迁移：把旧的 closed（实为「已找回」）换成 resolved，
     * 并补齐 visible / version 字段。幂等，可重复执行。
     * 注意：对外接口已从 router 摘除，如需再跑，临时注册一次为 migrate 即可。
     */
    async migrateLegacy({ apply }) {
      const stats = {
        closedToResolved: await itemRepo.countByStatus(ITEM_STATUS.CLOSED),
        missingVisible: await itemRepo.countMissingField('visible'),
        missingVersion: await itemRepo.countMissingField('version')
      }

      if (!apply) return { applied: false, stats }

      let moved = 0
      for (let round = 0; round < MIGRATE_MAX_ROUNDS; round++) {
        const ids = await itemRepo.listIdsByStatus(ITEM_STATUS.CLOSED, MIGRATE_BATCH)
        if (!ids.length) break
        for (const id of ids) {
          await itemRepo.updateById(id, {
            status: ITEM_STATUS.RESOLVED,
            resolvedAt: Date.now()
          })
          moved++
        }
        if (ids.length < MIGRATE_BATCH) break
      }

      let filled = 0
      for (let round = 0; round < MIGRATE_MAX_ROUNDS; round++) {
        const ids = await itemRepo.listIdsMissingField('visible', MIGRATE_BATCH)
        if (!ids.length) break
        for (const id of ids) {
          await itemRepo.updateById(id, { visible: true, version: 1 })
          filled++
        }
        if (ids.length < MIGRATE_BATCH) break
      }

      const remaining = {
        closed: await itemRepo.countByStatus(ITEM_STATUS.CLOSED),
        missingVisible: await itemRepo.countMissingField('visible')
      }

      return { applied: true, moved, filled, remaining }
    }
  }
}
