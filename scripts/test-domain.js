#!/usr/bin/env node
/**
 * 领域层单元测试：状态机 + 权限矩阵。
 * 纯函数，不依赖云环境，`node scripts/test-domain.js` 直接跑。
 *
 * 用法：node scripts/test-domain.js
 * 退出码：0 全部通过，1 有失败
 */
'use strict'

const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const state = require(path.join(ROOT, 'shared', 'state.js'))
const perm = require(path.join(ROOT, 'shared', 'permissions.js'))

let pass = 0
let fail = 0

function ok(name, cond) {
  if (cond) { pass++; return }
  fail++
  console.error('  × ' + name)
}

function eq(name, actual, expected) {
  ok(name + `  (期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)})`, actual === expected)
}

const S = state.ITEM_STATUS
const C = state.CLAIM_STATUS
const R = perm.RELATION

// ---------------- 状态机：信息 ----------------
console.log('状态机 · 信息')

eq('open 接受申请 → processing', state.applyItemAction('CLAIM_ACCEPT', S.OPEN).to, S.PROCESSING)
eq('resolved 不可再接受申请', state.applyItemAction('CLAIM_ACCEPT', S.RESOLVED).ok, false)
eq('processing 不可重复接受申请', state.applyItemAction('CLAIM_ACCEPT', S.PROCESSING).ok, false)
eq('processing 不可直接关闭（须先取消认领）', state.applyItemAction('OWNER_CLOSE', S.PROCESSING).ok, false)
eq('open 可关闭', state.applyItemAction('OWNER_CLOSE', S.OPEN).to, S.CLOSED)
eq('closed 可重开', state.applyItemAction('OWNER_REOPEN', S.CLOSED).to, S.OPEN)
eq('resolved 不可重开', state.applyItemAction('OWNER_REOPEN', S.RESOLVED).ok, false)
eq('processing 可完成归还', state.applyItemAction('CLAIM_COMPLETE', S.PROCESSING).to, S.RESOLVED)
eq('open 可标记找回', state.applyItemAction('OWNER_RESOLVE', S.OPEN).to, S.RESOLVED)
eq('管理员可下架 open', state.applyItemAction('ADMIN_HIDE', S.OPEN).to, S.CLOSED)
eq('管理员可下架 processing', state.applyItemAction('ADMIN_HIDE', S.PROCESSING).to, S.CLOSED)
eq('resolved 是终态', state.isTerminalItem(S.RESOLVED), true)
eq('closed 不是终态（可重开）', state.isTerminalItem(S.CLOSED), false)

console.log('状态机 · 可见性')

eq('open 公开可见', state.isPublicItem({ status: S.OPEN }), true)
eq('processing 公开可见', state.isPublicItem({ status: S.PROCESSING }), true)
eq('resolved 不在公开列表', state.isPublicItem({ status: S.RESOLVED }), false)
eq('下架后即使 open 也不可见', state.isPublicItem({ status: S.OPEN, visible: false }), false)

// ---------------- 状态机：认领 ----------------
console.log('状态机 · 认领')

eq('PENDING 可接受', state.applyClaimAction('ACCEPT', C.PENDING).to, C.ACCEPTED)
eq('PENDING 不可完成', state.applyClaimAction('COMPLETE', C.PENDING).ok, false)
eq('ACCEPTED 可完成', state.applyClaimAction('COMPLETE', C.ACCEPTED).to, C.COMPLETED)
eq('COMPLETED 是终态', state.applyClaimAction('ACCEPT', C.COMPLETED).ok, false)
eq('PENDING 计入活动申请', state.isActiveClaim(C.PENDING), true)
eq('REJECTED 不计入', state.isActiveClaim(C.REJECTED), false)

// ---------------- 权限：联系方式（本次收紧的核心） ----------------
console.log('权限 · 联系方式与证明')

eq('本人可见完整联系方式', perm.canViewContact(R.OWNER), true)
eq('申请被接受后可见', perm.canViewContact(R.APPLICANT_ACCEPTED), true)
eq('仅提交过线索的普通用户不可见', perm.canViewContact(R.USER), false)
eq('待处理申请人不可见', perm.canViewContact(R.APPLICANT_PENDING), false)
eq('管理员也不可见（明确限制）', perm.canViewContact(R.ADMIN), false)
eq('访客不可见', perm.canViewContact(R.GUEST), false)
eq('管理员不可见 proof', perm.canViewProof(R.ADMIN), false)
eq('认领双方可见 proof', perm.canViewProof(R.APPLICANT_ACCEPTED) && perm.canViewProof(R.OWNER), true)
eq('待处理申请人可见自己的 proof', perm.canViewProof(R.APPLICANT_PENDING), true)
eq('无关用户不可见 proof', perm.canViewProof(R.USER), false)

eq('脱敏保留前3后3', perm.maskContact('13812345678'), '138****678')
eq('短号码不脱敏', perm.maskContact('12345'), '12345')
eq('普通用户拿到的是脱敏值', perm.contactFor(R.USER, '13812345678'), '138****678')

// ---------------- 权限：信息动作 ----------------
console.log('权限 · 信息动作')

const foundOpen = { type: 'found', status: S.OPEN, visible: true, openid: 'A' }
const lostOpen = { type: 'lost', status: S.OPEN, visible: true, openid: 'A' }

eq('他人可申请招领', perm.canClaim(R.USER, foundOpen), true)
eq('本人不可申请自己的招领', perm.canClaim(R.OWNER, foundOpen), false)
eq('寻物不可被认领', perm.canClaim(R.USER, lostOpen), false)
eq('已处理的招领不可再申请', perm.canClaim(R.USER, Object.assign({}, foundOpen, { status: S.PROCESSING })), false)
eq('下架的招领不可申请', perm.canClaim(R.USER, Object.assign({}, foundOpen, { visible: false })), false)

eq('他人可给寻物提线索', perm.canSubmitClue(R.USER, lostOpen), true)
eq('本人不可给自己的寻物提线索', perm.canSubmitClue(R.OWNER, lostOpen), false)
eq('招领不可提线索', perm.canSubmitClue(R.USER, foundOpen), false)
eq('已关闭的寻物不可提线索', perm.canSubmitClue(R.USER, Object.assign({}, lostOpen, { status: S.CLOSED })), false)

eq('本人可编辑 open 的信息', perm.canEditItem(R.OWNER, foundOpen), true)
eq('交接中不可编辑', perm.canEditItem(R.OWNER, Object.assign({}, foundOpen, { status: S.PROCESSING })), false)
eq('他人不可编辑', perm.canEditItem(R.USER, foundOpen), false)
eq('招领有活动申请时禁止编辑', perm.canEditItem(R.OWNER, foundOpen, true), false)
eq('寻物有线索时仍可编辑', perm.canEditItem(R.OWNER, lostOpen, true), true)

eq('本人可重开 closed', perm.canReopenItem(R.OWNER, { status: S.CLOSED }), true)
eq('本人不可重开 resolved', perm.canReopenItem(R.OWNER, { status: S.RESOLVED }), false)

eq('他人可举报', perm.canReport(R.USER), true)
eq('本人不可举报自己', perm.canReport(R.OWNER), false)

// ---------------- 权限：关系判定 ----------------
console.log('权限 · 关系判定')

const itemA = { openid: 'A', status: S.OPEN, type: 'found', visible: true }

eq('未登录 → GUEST', perm.relationOf({ item: itemA, openid: '' }), R.GUEST)
eq('发布者 → OWNER', perm.relationOf({ item: itemA, openid: 'A' }), R.OWNER)
eq('无关用户 → USER', perm.relationOf({ item: itemA, openid: 'B' }), R.USER)
eq('管理员优先 → ADMIN', perm.relationOf({ item: itemA, openid: 'B', role: 'ADMIN' }), R.ADMIN)
eq(
  '有待处理申请 → APPLICANT_PENDING',
  perm.relationOf({ item: itemA, openid: 'B', activeClaim: { applicantOpenid: 'B', status: C.PENDING } }),
  R.APPLICANT_PENDING
)
eq(
  '申请已接受 → APPLICANT_ACCEPTED',
  perm.relationOf({ item: itemA, openid: 'B', activeClaim: { applicantOpenid: 'B', status: C.ACCEPTED } }),
  R.APPLICANT_ACCEPTED
)
eq(
  '别人的申请不影响我的关系',
  perm.relationOf({ item: itemA, openid: 'B', activeClaim: { applicantOpenid: 'C', status: C.PENDING } }),
  R.USER
)

// 申请详情专用的关系判定：终态申请本人仍可查看
eq(
  '已取消的申请，本人仍视为申请人',
  perm.relationForClaim({ item: itemA, openid: 'B', claim: { applicantOpenid: 'B', status: C.CANCELLED } }),
  R.APPLICANT_PENDING
)
eq(
  '已完成的申请，本人视为已接受方',
  perm.relationForClaim({ item: itemA, openid: 'B', claim: { applicantOpenid: 'B', status: C.COMPLETED } }),
  R.APPLICANT_ACCEPTED
)
eq(
  '发布者查看申请为 OWNER',
  perm.relationForClaim({ item: itemA, openid: 'A', claim: { applicantOpenid: 'B', status: C.PENDING } }),
  R.OWNER
)
eq(
  '无关用户查看申请为 USER',
  perm.relationForClaim({ item: itemA, openid: 'C', claim: { applicantOpenid: 'B', status: C.PENDING } }),
  R.USER
)

// ---------------- 汇总 ----------------
console.log('')
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
process.exit(fail === 0 ? 0 : 1)
