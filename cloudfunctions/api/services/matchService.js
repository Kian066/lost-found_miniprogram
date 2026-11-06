// 匹配用例层
'use strict'

const match = require('../shared/match')
const perm = require('../shared/permissions')
const { ITEM_STATUS } = require('../shared/state')
const { notFound } = require('../shared/errors')

const CAND_LIMIT = 200
const MAX_LIMIT = 30

function briefOf(r, revealContact) {
  const it = r.item
  return {
    id: it.id,
    title: it.title,
    category: it.category,
    place: it.place,
    time: it.time,
    type: it.type,
    contact: revealContact ? (it.contact || '') : perm.maskContact(it.contact),
    score: r.score,
    level: r.level,
    reasons: r.reasons
  }
}

module.exports = function createMatchService({ itemRepo }) {
  return {
    /**
     * 服务端匹配，避免全库数据下发到客户端。
     * 传 baseId 时以该登记为基准；只传 keyword 时按关键词双向检索。
     */
    async search({ baseId, keyword, category, limit, openid }) {
      const kw = String(keyword || '').trim()
      const max = Math.min(Number(limit) > 0 ? Number(limit) : 20, MAX_LIMIT)

      let out = []

      if (baseId) {
        const base = await itemRepo.getById(baseId)
        if (!base) throw notFound('基准登记不存在')

        const target = base.type === 'lost' ? 'found' : 'lost'
        const cands = await itemRepo.listCandidates({ type: target, status: ITEM_STATUS.OPEN, limit: CAND_LIMIT })
        const dir = base.type === 'lost' ? '招领信息' : '寻物启事'
        const reveal = base.openid === openid

        out = match.matchList(base, cands, kw, 0).map(function (r) {
          return Object.assign(briefOf(r, reveal), { dir: dir })
        })
      } else if (kw) {
        const today = new Date()
        const pseudo = {
          title: kw,
          category: String(category || ''),
          place: '',
          time: today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate(),
          desc: kw,
          features: [],
          type: 'lost',
          id: ''
        }

        const collect = async function (baseType, dir) {
          const target = baseType === 'lost' ? 'found' : 'lost'
          const cands = await itemRepo.listCandidates({ type: target, status: ITEM_STATUS.OPEN, limit: CAND_LIMIT })
          match.matchList(Object.assign({}, pseudo, { type: baseType }), cands, kw, 20)
            .forEach(function (r) {
              const exist = out.filter(function (o) { return o.id === r.item.id })[0]
              if (exist) {
                if (r.score > exist.score) exist.score = r.score
                return
              }
              out.push(Object.assign(briefOf(r, false), { dir: dir }))
            })
        }

        await collect('lost', '招领信息')
        await collect('found', '寻物启事')
      } else {
        return { list: [], top: 0 }
      }

      out.sort(function (a, b) { return b.score - a.score })
      out = out.slice(0, max)

      return { list: out, top: out.length ? out[0].score : 0 }
    }
  }
}
