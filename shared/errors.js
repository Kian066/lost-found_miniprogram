// 统一错误码（唯一来源：shared/errors.js）
// 云函数抛出 BizError，入口层统一转成 { ok:false, msg, code }
'use strict'

const ERROR_CODE = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY: 429,
  INTERNAL: 500
}

class BizError extends Error {
  constructor(code, msg) {
    super(msg || '操作失败')
    this.name = 'BizError'
    this.code = code
  }
}

const badRequest = (msg) => new BizError(ERROR_CODE.BAD_REQUEST, msg || '参数不合法')
const unauthorized = (msg) => new BizError(ERROR_CODE.UNAUTHORIZED, msg || '请先登录')
const forbidden = (msg) => new BizError(ERROR_CODE.FORBIDDEN, msg || '没有权限执行该操作')
const notFound = (msg) => new BizError(ERROR_CODE.NOT_FOUND, msg || '内容不存在')
const conflict = (msg) => new BizError(ERROR_CODE.CONFLICT, msg || '当前状态不允许该操作')
const tooMany = (msg) => new BizError(ERROR_CODE.TOO_MANY, msg || '操作太频繁，请稍后再试')

/** 把任意异常收敛成错误码，避免把内部堆栈暴露给前端 */
function toBizError(e) {
  if (e instanceof BizError) return e
  const err = new BizError(ERROR_CODE.INTERNAL, '服务暂时不可用')
  err.raw = e
  return err
}

module.exports = {
  ERROR_CODE,
  BizError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooMany,
  toBizError
}
