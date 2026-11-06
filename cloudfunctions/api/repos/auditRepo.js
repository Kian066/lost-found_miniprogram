// 内容安全审核（云调用）
'use strict'

module.exports = function createAuditRepo(cloud) {
  return {
    /**
     * 文本安全检测。接口不可用时放行（保证可用性），命中违规返回 false。
     * @param {string} text
     * @param {string} openid
     * @returns {Promise<{pass:boolean, msg?:string, ignored?:boolean}>}
     */
    async checkText(text, openid) {
      if (!text) return { pass: true }
      try {
        await cloud.openapi.security.msgSecCheck({
          content: String(text).slice(0, 2500),
          scene: 2,
          version: 2,
          openid: openid
        })
        return { pass: true }
      } catch (e) {
        const code = e && (e.errCode || e.errcode)
        if (code === 87014) return { pass: false, msg: '内容包含违规信息' }
        return { pass: true, ignored: true }
      }
    }
  }
}
