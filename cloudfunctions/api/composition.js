// 唯一的装配点：把 db / cloud 变成 repos，把 repos 注入 services。
// 全项目只有这里知道「谁实现什么」，上层一律拿参数，不 require 实现。
'use strict'

const createItemRepo = require('./repos/itemRepo')
const createClueRepo = require('./repos/clueRepo')
const createClaimRepo = require('./repos/claimRepo')
const createClaimUow = require('./repos/claimUow')
const createReportRepo = require('./repos/reportRepo')
const createStatRepo = require('./repos/statRepo')
const createUserRepo = require('./repos/userRepo')
const createFileRepo = require('./repos/fileRepo')
const createAuditRepo = require('./repos/auditRepo')
const createNotifyRepo = require('./repos/notifyRepo')

const createItemService = require('./services/itemService')
const createClueService = require('./services/clueService')
const createClaimService = require('./services/claimService')
const createReportService = require('./services/reportService')
const createMatchService = require('./services/matchService')
const createUserService = require('./services/userService')
const createAdminService = require('./services/adminService')
const createStatService = require('./services/statService')

/**
 * @param {Object} deps
 * @param {Object} deps.db 云数据库实例
 * @param {Object} deps.cloud wx-server-sdk 实例（云存储 / 云调用）
 * @returns {Object} services —— 注入给 handlers 的 ctx.services
 */
module.exports = function buildServices({ db, cloud }) {
  const itemRepo = createItemRepo(db)
  const clueRepo = createClueRepo(db)
  const claimRepo = createClaimRepo(db)
  const claimUow = createClaimUow(db)
  const reportRepo = createReportRepo(db)
  const statRepo = createStatRepo(db)
  const userRepo = createUserRepo(db)
  const fileRepo = createFileRepo(cloud)
  const auditRepo = createAuditRepo(cloud)
  const notifyRepo = createNotifyRepo(cloud)

  return {
    item: createItemService({ itemRepo, clueRepo, claimRepo, fileRepo, auditRepo, userRepo }),
    clue: createClueService({ itemRepo, clueRepo, auditRepo, notifyRepo }),
    claim: createClaimService({ claimRepo, claimUow, itemRepo, userRepo, auditRepo }),
    report: createReportService({ reportRepo, itemRepo, auditRepo }),
    match: createMatchService({ itemRepo }),
    user: createUserService({ userRepo, itemRepo, clueRepo }),
    admin: createAdminService({ userRepo, itemRepo, reportRepo, claimRepo }),
    stat: createStatService({ statRepo })
  }
}
