// 线索的用例层
'use strict'

const { LIMITS } = require('../shared/constants')
const perm = require('../shared/permissions')
const { badRequest, forbidden, notFound, unauthorized } = require('../shared/errors')

module.exports = function createClueService({ itemRepo, clueRepo, auditRepo, notifyRepo }) {
  return {
    /**
     * 提交线索。
     * 规则（旧版本缺失、本次补上）：只能给「他人 + 进行中 + 寻物启事」提供线索。
     */
    async create({ itemId, openid, content, contact, author }) {
      if (!openid) throw unauthorized()
      if (!itemId) throw badRequest('缺少 itemId')

      const text = String(content || '').trim()
      if (text.length < LIMITS.CLUE_MIN) {
        throw badRequest('线索至少写 ' + LIMITS.CLUE_MIN + ' 个字，方便核实')
      }
      if (text.length > LIMITS.MESSAGE_MAX) {
        throw badRequest('线索最多 ' + LIMITS.MESSAGE_MAX + ' 个字')
      }

      const item = await itemRepo.getById(itemId)
      if (!item) throw notFound('该登记不存在')

      const relation = perm.relationOf({ item, openid })
      if (!perm.canSubmitClue(relation, item)) {
        if (relation === 'OWNER') throw forbidden('不能给自己的登记提供线索')
        if (item.type !== 'lost') throw forbidden('只能给寻物启事提供线索')
        throw forbidden('该登记当前不接受线索')
      }

      const audit = await auditRepo.checkText(text, openid)
      if (!audit.pass) throw badRequest(audit.msg || '内容不合规')

      const createdAt = Date.now()
      const id = await clueRepo.add({
        itemId: itemId,
        openid: openid,
        content: text,
        contact: String(contact || '').trim(),
        author: String(author || '热心同学').slice(0, 30),
        createdAt: createdAt
      })

      await clueRepo.incItemClueCount(itemId)

      // 通知失败不影响线索提交
      await notifyRepo.sendClueNotice({
        toOpenid: item.openid,
        fromOpenid: openid,
        item: item,
        content: text
      })

      return { id: id, createdAt: createdAt }
    }
  }
}
