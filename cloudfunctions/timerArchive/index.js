// 云函数：定时归档 —— 超过 N 天仍未解决的登记自动关闭
'use strict'
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const ITEMS = 'items'

const DEFAULT_DAYS = 30

exports.main = async (event) => {
  const days = Number(event && event.days) > 0 ? Number(event.days) : DEFAULT_DAYS
  const deadline = Date.now() - days * 86400000

  const res = await db.collection(ITEMS)
    .where({ status: 'open', createdAt: _.lt(deadline) })
    .limit(500)
    .get()

  let done = 0
  for (const d of res.data) {
    try {
      await db.collection(ITEMS).doc(d._id).update({
        data: { status: 'archived', archivedAt: Date.now() }
      })
      done++
    } catch (e) {
      // 单条失败继续
    }
  }

  return { ok: true, data: { scanned: res.data.length, archived: done, days: days } }
}
