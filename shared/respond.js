// 云函数统一返回格式（唯一来源：shared/respond.js）
// 约定：成功 { ok: true, data? }，失败 { ok: false, msg, code? }
'use strict'

/**
 * 成功返回。不传 data 时不带 data 字段，兼容既有调用方对 res.data 的判断。
 * @param {*} data
 */
function ok(data) {
  if (data === undefined) return { ok: true }
  return { ok: true, data: data }
}

/**
 * 失败返回。
 * @param {string} msg 面向用户的中文提示
 * @param {number|string} [code] 业务错误码，如 403 越权、409 状态冲突
 */
function fail(msg, code) {
  const r = { ok: false, msg: msg || '操作失败' }
  if (code !== undefined && code !== null) r.code = code
  return r
}

/** 便捷判断：查询结果里是否取到了记录 */
function hasRecord(res) {
  return !!(res && res.data)
}

module.exports = { ok, fail, hasRecord }
