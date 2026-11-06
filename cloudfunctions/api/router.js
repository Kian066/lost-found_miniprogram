// action → handler 映射表。唯一注册点，新增接口只改这里。
'use strict'

const item = require('./handlers/item')
const clue = require('./handlers/clue')
const claim = require('./handlers/claim')
const report = require('./handlers/report')
const matchHandler = require('./handlers/match')
const user = require('./handlers/user')
const admin = require('./handlers/admin')
const stat = require('./handlers/stat')

module.exports = {
  // 信息
  itemCreate: item.create,
  itemList: item.list,
  itemDetail: item.detail,
  itemUpdate: item.update,
  itemRemove: item.remove,

  // 线索
  clueCreate: clue.create,

  // 认领
  claimCreate: claim.create,
  claimAction: claim.act,
  claimList: claim.list,
  claimDetail: claim.detail,

  // 举报
  reportCreate: report.create,

  // 匹配
  matchQuery: matchHandler.search,

  // 用户
  userLogin: user.login,
  userData: user.mine,

  // 管理端
  adminBootstrap: admin.bootstrap,
  adminItems: admin.items,
  adminSetVisible: admin.setVisible,
  adminReports: admin.reports,
  adminHandleReport: admin.handleReport,

  // 统计
  statOverview: stat.overview
}
