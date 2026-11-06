// 云函数共享常量（唯一来源：shared/constants.js）
// 各云函数通过 ./shared/constants 引用，副本由 scripts/sync-shared.js 生成
'use strict'

const { ITEM_STATUS } = require('./state')

// 数据库集合名
const COLLECTIONS = {
  ITEMS: 'items',
  CLUES: 'clues',
  USERS: 'users',
  CLAIMS: 'claims',
  REPORTS: 'reports'
}

// 业务上限（前后端都按这个校验）
const LIMITS = {
  IMAGES: 6,
  FEATURES: 6,
  CAND_LIMIT: 200,
  PAGE_SIZE: 8,
  TITLE_MAX: 50,
  DESC_MIN: 5,
  DESC_MAX: 1000,
  PROOF_MIN: 10,
  PROOF_MAX: 1000,
  CLUE_MIN: 5,
  REASON_MAX: 500,
  MESSAGE_MAX: 1000
}

module.exports = {
  COLLECTIONS,
  LIMITS,
  // 兼容旧引用：STATUS 现由 shared/state.js 的 ITEM_STATUS 提供。
  // 新代码请直接用 require('./shared/state') 的 ITEM_STATUS / CLAIM_STATUS。
  STATUS: ITEM_STATUS
}
