// api 云函数入口
// 职责只有一个：取身份、装配依赖、交给 router、统一收错误。
// 这里不允许出现任何业务判断（业务在 services，数据在 repos）。
'use strict'
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const routes = require('./router')
const buildServices = require('./composition')
const { ok, fail } = require('./shared/respond')
const { toBizError } = require('./shared/errors')

exports.main = async (event) => {
  const action = String((event && event.action) || '')
  const handler = routes[action]
  if (!handler) return fail('未知的 action：' + (action || '(空)'), 400)

  const wxContext = cloud.getWXContext() || {}
  const ctx = {
    openid: wxContext.OPENID || '',
    source: wxContext.SOURCE || '',
    services: buildServices({ db, cloud })
  }

  try {
    const data = await handler(ctx, event || {})
    return ok(data)
  } catch (e) {
    const err = toBizError(e)
    if (err.code === 500) console.error('[api] ' + action + ' 执行失败:', e)
    return fail(err.message, err.code)
  }
}
