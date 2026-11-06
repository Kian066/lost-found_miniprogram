// 订阅消息推送
'use strict'

const TEMPLATE_ID = process.env.CLUE_TEMPLATE_ID || ''

function pad(n) { return Number(n) < 10 ? '0' + Number(n) : '' + Number(n) }

function fmtTime(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

module.exports = function createNotifyRepo(cloud) {
  return {
    /**
     * 有新线索时通知登记发布者。未配置模板 / 对方未订阅 / 自己给自己提线索时静默跳过。
     * 失败绝不抛错，不能阻断线索写入。
     * @returns {Promise<boolean>} 是否真正发出
     */
    async sendClueNotice({ toOpenid, fromOpenid, item, content }) {
      if (!TEMPLATE_ID || !toOpenid) return false
      if (toOpenid === fromOpenid) return false
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: toOpenid,
          templateId: TEMPLATE_ID,
          page: 'pages/detail/detail?id=' + item._id,
          data: {
            thing1: { value: String(item.title || '登记').slice(0, 20) },
            thing2: { value: String(content || '').slice(0, 20) },
            time3: { value: fmtTime(Date.now()) }
          },
          miniprogramState: 'developer'
        })
        return true
      } catch (e) {
        // 43101 = 用户未订阅该模板；其他错误同样忽略
        return false
      }
    }
  }
}
