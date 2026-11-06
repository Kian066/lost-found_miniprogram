/* ------------------------------------------------------------------
 * 自动生成，请勿直接修改
 * 源文件：shared/permissions.js
 * 修改后执行：node scripts/sync-shared.js
 * ------------------------------------------------------------------ */
// 权限规则（唯一来源：shared/permissions.js）
// 只放纯判断，不查库。云端用于「拒绝」，前端用于「该不该显示按钮」，
// 两边同一份代码，避免出现「按钮能点、后端 403」的割裂。
'use strict'

const { ITEM_STATUS, CLAIM_STATUS } = require('./state')

/** 访问者与某条信息的相对关系 */
const RELATION = {
  GUEST: 'GUEST', // 未登录
  USER: 'USER', // 登录了，但和这条信息无关
  OWNER: 'OWNER', // 发布者本人
  APPLICANT_PENDING: 'APPLICANT_PENDING', // 自己申请了，还没被接受
  APPLICANT_ACCEPTED: 'APPLICANT_ACCEPTED', // 自己申请被接受（或已完成）
  ADMIN: 'ADMIN' // 管理员
}

/**
 * 计算关系。
 * @param {Object} p
 * @param {Object} p.item 信息（含 openid）
 * @param {string} p.openid 访问者 openid
 * @param {Object} [p.activeClaim] 当前与该信息相关的活动申请（如有）
 * @param {string} [p.role] 访问者角色 USER / ADMIN
 */
function relationOf({ item, openid, activeClaim, role }) {
  if (role === 'ADMIN') return RELATION.ADMIN
  if (!openid) return RELATION.GUEST
  if (item && item.openid === openid) return RELATION.OWNER
  if (activeClaim && activeClaim.applicantOpenid === openid) {
    const st = activeClaim.status
    if (st === CLAIM_STATUS.ACCEPTED || st === CLAIM_STATUS.COMPLETED) {
      return RELATION.APPLICANT_ACCEPTED
    }
    if (st === CLAIM_STATUS.PENDING) return RELATION.APPLICANT_PENDING
  }
  return RELATION.USER
}

/**
 * 针对「某一份认领申请」的关系判定（申请详情页用）。
 * 与 relationOf 的区别：这里只要求「是这条申请的人」，不要求申请仍处于活动状态，
 * 否则申请人看不到自己已取消 / 已完成的申请。
 */
function relationForClaim({ item, openid, claim, role }) {
  if (role === 'ADMIN') return RELATION.ADMIN
  if (!openid) return RELATION.GUEST
  if (item && item.openid === openid) return RELATION.OWNER
  if (claim && claim.applicantOpenid === openid) {
    const st = claim.status
    if (st === CLAIM_STATUS.ACCEPTED || st === CLAIM_STATUS.COMPLETED) {
      return RELATION.APPLICANT_ACCEPTED
    }
    return RELATION.APPLICANT_PENDING
  }
  return RELATION.USER
}

// ---- 字段可见性 ----------------------------------------------------------

/**
 * 联系方式的完整可见范围。
 * 按既定决策收紧：只给本人和「申请已被接受」的人，管理员也脱敏。
 */
const CONTACT_VISIBLE_RELATIONS = [RELATION.OWNER, RELATION.APPLICANT_ACCEPTED]

/**
 * 私密证明的可见范围：发布者可看收到的申请，申请人可看自己提交的。
 * 注意 relation 是针对「某一份申请」算的，因此 APPLICANT_PENDING 只能看到
 * 自己那一份，不会看到别人的。管理员不可见。
 */
const PROOF_VISIBLE_RELATIONS = [
  RELATION.OWNER,
  RELATION.APPLICANT_PENDING,
  RELATION.APPLICANT_ACCEPTED
]

function canViewContact(relation) {
  return CONTACT_VISIBLE_RELATIONS.indexOf(relation) > -1
}

function canViewProof(relation) {
  return PROOF_VISIBLE_RELATIONS.indexOf(relation) > -1
}

/** 联系方式脱敏：保留前后各 3 位 */
function maskContact(str) {
  if (!str) return ''
  const s = String(str)
  if (s.length <= 6) return s
  return s.slice(0, 3) + '****' + s.slice(-3)
}

/** 按关系决定联系方式下发内容 */
function contactFor(relation, contact) {
  return canViewContact(relation) ? contact || '' : maskContact(contact)
}

// ---- 信息相关动作 --------------------------------------------------------

/**
 * 可否编辑信息：本人且处于 open；招领若已有活动申请则禁止编辑。
 * @param {string} relation
 * @param {Object} item
 * @param {boolean} [hasActiveClaim] 是否已有活动申请（PENDING / ACCEPTED）
 */
function canEditItem(relation, item, hasActiveClaim) {
  if (relation !== RELATION.OWNER || !item) return false
  if (item.status !== ITEM_STATUS.OPEN) return false
  if (item.type === 'found' && hasActiveClaim) return false
  return true
}

/** 可否申请认领：针对他人的、可见的、open 状态的 FOUND */
function canClaim(relation, item) {
  if (!item) return false
  return (
    relation === RELATION.USER &&
    item.type === 'found' &&
    item.status === ITEM_STATUS.OPEN &&
    item.visible !== false
  )
}

/** 可否提交线索：针对他人的、可见的、open 状态的 LOST */
function canSubmitClue(relation, item) {
  if (!item) return false
  return (
    relation === RELATION.USER &&
    item.type === 'lost' &&
    item.status === ITEM_STATUS.OPEN &&
    item.visible !== false
  )
}

/** 可否关闭 / 标记找回：本人且 open */
function canCloseItem(relation, item) {
  return relation === RELATION.OWNER && !!item && item.status === ITEM_STATUS.OPEN
}

function canResolveItem(relation, item) {
  return relation === RELATION.OWNER && !!item && item.status === ITEM_STATUS.OPEN
}

/** 可否重开：本人且 closed（resolved 不可复活） */
function canReopenItem(relation, item) {
  return relation === RELATION.OWNER && !!item && item.status === ITEM_STATUS.CLOSED
}

/** 可否举报：登录用户，且不是自己的信息 */
function canReport(relation) {
  return relation === RELATION.USER || relation === RELATION.APPLICANT_PENDING
}

/** 可否查看该信息详情（公开信息所有人可看，非公开只有本人/管理员） */
function canViewItem(relation, item) {
  if (!item) return false
  if (item.visible !== false) {
    if (item.status === ITEM_STATUS.OPEN || item.status === ITEM_STATUS.PROCESSING) return true
  }
  return relation === RELATION.OWNER || relation === RELATION.ADMIN
}

// ---- 认领相关动作 --------------------------------------------------------

/** 可否接受 / 拒绝申请：本人，且申请处于 PENDING */
function canDecideClaim(relation, claim) {
  return relation === RELATION.OWNER && !!claim && claim.status === CLAIM_STATUS.PENDING
}

/** 可否确认归还：本人，且申请已接受 */
function canCompleteClaim(relation, claim) {
  return relation === RELATION.OWNER && !!claim && claim.status === CLAIM_STATUS.ACCEPTED
}

/** 可否取消：申请人可取消自己的 PENDING/ACCEPTED；发布者可取消 ACCEPTED */
function canCancelClaim(relation, claim) {
  if (!claim) return false
  if (relation === RELATION.APPLICANT_PENDING) return claim.status === CLAIM_STATUS.PENDING
  if (relation === RELATION.APPLICANT_ACCEPTED) return claim.status === CLAIM_STATUS.ACCEPTED
  if (relation === RELATION.OWNER) return claim.status === CLAIM_STATUS.ACCEPTED
  return false
}

// ---- 管理动作 ------------------------------------------------------------

/** 管理员专属：下架 / 恢复 / 处理举报 */
function isAdmin(relation) {
  return relation === RELATION.ADMIN
}

module.exports = {
  RELATION,
  relationOf,
  relationForClaim,
  canViewContact,
  canViewProof,
  maskContact,
  contactFor,
  canEditItem,
  canClaim,
  canSubmitClue,
  canCloseItem,
  canResolveItem,
  canReopenItem,
  canReport,
  canViewItem,
  canDecideClaim,
  canCompleteClaim,
  canCancelClaim,
  isAdmin
}
