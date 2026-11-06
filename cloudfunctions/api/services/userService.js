// 用户用例层：登录档案 + 「我的」聚合数据
'use strict'

const perm = require('../shared/permissions')
const { ITEM_STATUS } = require('../shared/state')
const { badRequest, unauthorized } = require('../shared/errors')

// 允许客户端更新的白名单字段与长度上限
const UP_FIELDS = ['nickName', 'avatarUrl', 'sid', 'college', 'contact']
const MAX_LEN = { nickName: 32, avatarUrl: 500, sid: 32, college: 32, contact: 64 }

function defaultName(openid) {
  return '同学' + String(openid || '0000').slice(-4)
}

function profileOf(rec, openid) {
  return {
    openid: rec.openid || openid,
    name: rec.nickName || defaultName(openid),
    avatar: rec.avatarUrl || '',
    sid: rec.sid || '',
    college: rec.college || '',
    contact: rec.contact || '',
    credit: rec.credit || 90,
    role: rec.role || 'USER'
  }
}

module.exports = function createUserService({ userRepo, itemRepo, clueRepo }) {
  return {
    /**
     * 静默登录 / 读取档案 / 更新档案。
     * @param {Object} p
     * @param {string} p.openid
     * @param {string} [p.mode] 'update' 时才写
     * @param {Object} [p.patch]
     */
    async login({ openid, mode, patch }) {
      if (!openid) throw unauthorized()

      let rec = await userRepo.getById(openid)
      if (!rec) {
        rec = await userRepo.ensureProfile({ openid: openid, nickName: defaultName(openid) })
        rec = rec || { openid: openid, nickName: defaultName(openid) }
      }

      if (mode === 'update') {
        const p = patch || {}
        const next = {}
        UP_FIELDS.forEach(function (k) {
          if (typeof p[k] !== 'string') return
          next[k] = String(p[k]).slice(0, MAX_LEN[k] || 100)
        })

        if (Object.keys(next).length) {
          const oldName = rec.nickName
          next.updatedAt = Date.now()
          await userRepo.update(openid, next)
          Object.assign(rec, next)

          // 昵称变化时刷新历史登记 / 线索的展示名
          if (next.nickName && next.nickName !== oldName) {
            await itemRepo.syncAuthor(openid, next.nickName)
            await clueRepo.syncAuthor(openid, next.nickName)
          }
        }
      }

      return profileOf(rec, openid)
    },

    /**
     * 「我的」聚合：我的发布 / 收到的线索 / 我提供的线索 + 计数
     */
    async mine({ openid }) {
      if (!openid) throw unauthorized()

      const publish = await itemRepo.listByOwner(openid, 100)
      const myIds = publish.map(function (d) { return d.id })

      const [clueMine, inboxRaw] = await Promise.all([
        clueRepo.listByOpenid(openid, 100),
        clueRepo.listForOwner(myIds, openid, 100)
      ])

      // 线索补上所属登记标题
      const needIds = []
      clueMine.forEach(function (c) {
        if (needIds.indexOf(c.itemId) === -1) needIds.push(c.itemId)
      })
      const titleMap = {}
      for (const iid of needIds) {
        const it = await itemRepo.getById(iid)
        titleMap[iid] = it ? it.title : '（登记已删除）'
      }

      const inbox = inboxRaw.map(function (c) {
        return {
          id: c._id,
          itemId: c.itemId,
          content: c.content,
          contact: c.contact || '',
          author: c.author,
          createdAt: c.createdAt,
          itemTitle: titleMap[c.itemId] || ''
        }
      })

      // 收到的线索来自「我发布的登记」，标题直接从 publish 里取
      const ownTitle = {}
      publish.forEach(function (d) { ownTitle[d.id] = d.title })
      inbox.forEach(function (c) { c.itemTitle = c.itemTitle || ownTitle[c.itemId] || '' })

      const clues = clueMine.map(function (c) {
        return {
          id: c._id,
          itemId: c.itemId,
          itemTitle: titleMap[c.itemId] || '',
          content: c.content,
          contact: c.contact || '',
          author: c.author,
          createdAt: c.createdAt
        }
      })

      const solved = publish.filter(function (d) { return d.status === ITEM_STATUS.RESOLVED }).length

      return {
        publish: publish,
        inbox: inbox,
        clues: clues,
        stats: {
          publish: publish.length,
          inbox: inbox.length,
          clue: clues.length,
          solved: solved
        }
      }
    }
  }
}
