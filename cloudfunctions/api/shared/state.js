/* ------------------------------------------------------------------
 * 自动生成，请勿直接修改
 * 源文件：shared/state.js
 * 修改后执行：node scripts/sync-shared.js
 * ------------------------------------------------------------------ */
// 状态机（唯一来源：shared/state.js）
// 只放纯规则，不碰数据库、不碰 wx.*，前端与云函数共用。
//
// 设计要点：状态名称、迁移表、守卫全在这一个文件里。
// 任何地方判断状态，都从这里取，禁止再写字面量 'open' / 'closed'。
'use strict'

/** 信息状态 */
const ITEM_STATUS = {
  OPEN: 'open', // 寻找中 / 待认领
  PROCESSING: 'processing', // 已有人申请，交接中
  RESOLVED: 'resolved', // 已找回 / 已归还（成功终态）
  CLOSED: 'closed', // 主动关闭 / 被下架（可重开）
  ARCHIVED: 'archived' // 超期归档（系统）
}

/** 认领申请状态 */
const CLAIM_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED'
}

/**
 * 业务动作 → 状态迁移。
 * from 表示允许的起始状态，to 表示迁移目标，by 表示谁有权触发。
 *
 * 注意：创建认领申请**不改变**信息状态。招领在 OPEN 期间可以有多人同时申请，
 * 只有拾取者接受某一份申请后，信息才转 PROCESSING。
 */
const ITEM_ACTIONS = {
  CLAIM_ACCEPT: { from: [ITEM_STATUS.OPEN], to: ITEM_STATUS.PROCESSING, by: 'owner' },
  CLAIM_CANCEL: { from: [ITEM_STATUS.PROCESSING], to: ITEM_STATUS.OPEN, by: 'party' },
  CLAIM_COMPLETE: { from: [ITEM_STATUS.PROCESSING], to: ITEM_STATUS.RESOLVED, by: 'owner' },
  OWNER_CLOSE: { from: [ITEM_STATUS.OPEN], to: ITEM_STATUS.CLOSED, by: 'owner' },
  OWNER_REOPEN: { from: [ITEM_STATUS.CLOSED], to: ITEM_STATUS.OPEN, by: 'owner' },
  OWNER_RESOLVE: { from: [ITEM_STATUS.OPEN], to: ITEM_STATUS.RESOLVED, by: 'owner' },
  ADMIN_HIDE: { from: [ITEM_STATUS.OPEN, ITEM_STATUS.PROCESSING], to: ITEM_STATUS.CLOSED, by: 'admin' },
  ARCHIVE: { from: [ITEM_STATUS.OPEN], to: ITEM_STATUS.ARCHIVED, by: 'system' },
  // 管理端恢复可见：只改 visible，不改状态，因此不在此表
  ADMIN_RESTORE: { from: [], to: null, by: 'admin' }
}

/** 认领申请的动作 → 状态迁移 */
const CLAIM_ACTIONS = {
  ACCEPT: { from: [CLAIM_STATUS.PENDING], to: CLAIM_STATUS.ACCEPTED, by: 'owner' },
  REJECT: { from: [CLAIM_STATUS.PENDING], to: CLAIM_STATUS.REJECTED, by: 'owner' },
  CANCEL_APPLICANT: {
    from: [CLAIM_STATUS.PENDING, CLAIM_STATUS.ACCEPTED],
    to: CLAIM_STATUS.CANCELLED,
    by: 'applicant'
  },
  CANCEL_OWNER: { from: [CLAIM_STATUS.ACCEPTED], to: CLAIM_STATUS.CANCELLED, by: 'owner' },
  COMPLETE: { from: [CLAIM_STATUS.ACCEPTED], to: CLAIM_STATUS.COMPLETED, by: 'owner' }
}

/** 公开列表 / 详情可见的状态（外加 visible !== false） */
const PUBLIC_ITEM_STATUS = [ITEM_STATUS.OPEN, ITEM_STATUS.PROCESSING]

/** 终态：不再接受任何业务动作 */
const TERMINAL_ITEM_STATUS = [ITEM_STATUS.RESOLVED, ITEM_STATUS.ARCHIVED]

/** 是否为公开可见的信息（下架 visible=false 时一律不可见） */
function isPublicItem(item) {
  if (!item) return false
  if (item.visible === false) return false
  return PUBLIC_ITEM_STATUS.indexOf(item.status) > -1
}

/** 是否终态 */
function isTerminalItem(status) {
  return TERMINAL_ITEM_STATUS.indexOf(status) > -1
}

/**
 * 计算某个业务动作执行后信息应当处于的状态。
 * @param {string} action ITEM_ACTIONS 的键
 * @param {string} current 当前状态
 * @returns {{ok:boolean, to?:string, reason?:string}}
 */
function applyItemAction(action, current) {
  const rule = ITEM_ACTIONS[action]
  if (!rule) return { ok: false, reason: '未知的信息动作：' + action }
  if (!rule.to) return { ok: false, reason: '动作 ' + action + ' 不改变状态' }
  if (rule.from.indexOf(current) === -1) {
    return { ok: false, reason: '当前状态为「' + itemStatusText(current) + '」，不能执行该操作' }
  }
  return { ok: true, to: rule.to }
}

/**
 * 计算某个认领动作执行后申请应当处于的状态。
 * @param {string} action CLAIM_ACTIONS 的键
 * @param {string} current 当前申请状态
 */
function applyClaimAction(action, current) {
  const rule = CLAIM_ACTIONS[action]
  if (!rule) return { ok: false, reason: '未知的认领动作：' + action }
  if (rule.from.indexOf(current) === -1) {
    return { ok: false, reason: '当前申请状态为「' + claimStatusText(current) + '」，不能执行该操作' }
  }
  return { ok: true, to: rule.to }
}

/** 是否为活动申请（占用招领的申请） */
function isActiveClaim(status) {
  return status === CLAIM_STATUS.PENDING || status === CLAIM_STATUS.ACCEPTED
}

const ITEM_STATUS_TEXT = {
  open: '寻找中',
  processing: '交接中',
  resolved: '已找回',
  closed: '已关闭',
  archived: '已归档'
}

const CLAIM_STATUS_TEXT = {
  PENDING: '待处理',
  ACCEPTED: '已接受',
  REJECTED: '已拒绝',
  CANCELLED: '已取消',
  COMPLETED: '已完成'
}

function itemStatusText(status) {
  return ITEM_STATUS_TEXT[status] || status || '未知'
}

function claimStatusText(status) {
  return CLAIM_STATUS_TEXT[status] || status || '未知'
}

/** 状态对应的展示色调，前端直接用 */
function itemStatusTone(status) {
  if (status === ITEM_STATUS.RESOLVED) return 'success'
  if (status === ITEM_STATUS.PROCESSING) return 'warning'
  if (status === ITEM_STATUS.CLOSED || status === ITEM_STATUS.ARCHIVED) return 'muted'
  return 'primary'
}

module.exports = {
  ITEM_STATUS,
  CLAIM_STATUS,
  ITEM_ACTIONS,
  CLAIM_ACTIONS,
  PUBLIC_ITEM_STATUS,
  TERMINAL_ITEM_STATUS,
  isPublicItem,
  isTerminalItem,
  applyItemAction,
  applyClaimAction,
  isActiveClaim,
  itemStatusText,
  claimStatusText,
  itemStatusTone
}
