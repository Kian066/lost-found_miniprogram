// 举报用例层
'use strict'

const { LIMITS } = require('../shared/constants')
const { badRequest, forbidden, notFound, unauthorized } = require('../shared/errors')

const REASON_MIN = 5

module.exports = function createReportService({ reportRepo, itemRepo, auditRepo }) {
  return {
    /**
     * 提交举报：登录用户、非本人登记、同一登记只能举报一次。
     * 处理举报是管理端的事（P4），这里只负责收。
     */
    async create({ postId, openid, reason }) {
      if (!openid) throw unauthorized()
      if (!postId) throw badRequest('缺少 postId')

      const text = String(reason || '').trim()
      if (text.length < REASON_MIN) throw badRequest('请至少写 ' + REASON_MIN + ' 个字说明举报原因')
      if (text.length > LIMITS.REASON_MAX) throw badRequest('举报原因最多 ' + LIMITS.REASON_MAX + ' 个字')

      const item = await itemRepo.getById(postId)
      if (!item) throw notFound('该登记不存在')
      if (item.openid === openid) throw forbidden('不能举报自己发布的登记')

      const exist = await reportRepo.findByUser(postId, openid)
      if (exist) return { id: exist._id || exist.id, duplicated: true }

      const audit = await auditRepo.checkText(text, openid)
      if (!audit.pass) throw badRequest(audit.msg || '内容不合规')

      const id = await reportRepo.add({
        postId: postId,
        reporterOpenid: openid,
        reason: text,
        status: 'PENDING',
        result: '',
        createdAt: Date.now()
      })

      return { id: id, duplicated: false }
    }
  }
}
