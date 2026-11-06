// 认领用例层
//
// 状态约定（与 shared/state.js 一致）：
//   创建申请：不动信息状态，招领仍为 open，允许多人同时申请
//   接受申请：招领 open → processing
//   取消交接：招领 processing → open
//   确认归还：招领 processing → resolved，其余待处理申请自动拒绝
'use strict'

const { LIMITS } = require('../shared/constants')
const {
  CLAIM_STATUS,
  ITEM_STATUS,
  applyClaimAction,
  applyItemAction
} = require('../shared/state')
const perm = require('../shared/permissions')
const { badRequest, forbidden, notFound, conflict, unauthorized } = require('../shared/errors')

const ACTION_MAP = {
  accept: 'ACCEPT',
  reject: 'REJECT',
  cancel: 'CANCEL',
  complete: 'COMPLETE'
}

function nextVersion(item) {
  return (item && item.version ? item.version : 1) + 1
}

module.exports = function createClaimService({ claimRepo, claimUow, itemRepo, userRepo, auditRepo }) {
  return {
    /**
     * 申请认领：只能对他人、可见、进行中的「招领」发起。
     */
    async create({ itemId, openid, proofText, contact }) {
      if (!openid) throw unauthorized()
      if (!itemId) throw badRequest('缺少 itemId')

      const proof = String(proofText || '').trim()
      if (proof.length < LIMITS.PROOF_MIN) {
        throw badRequest('请至少写 ' + LIMITS.PROOF_MIN + ' 个字的物品特征，方便对方核实')
      }
      if (proof.length > LIMITS.PROOF_MAX) throw badRequest('说明最多 ' + LIMITS.PROOF_MAX + ' 个字')

      const handoverContact = String(contact || '').trim()
      if (!handoverContact) throw badRequest('请填写交接联系方式')

      // 私密说明同样要过内容安全
      const audit = await auditRepo.checkText(proof, openid)
      if (!audit.pass) throw badRequest(audit.msg || '内容不合规')

      const user = await userRepo.getById(openid)
      const applicantName = (user && user.nickName) || ('同学' + String(openid).slice(-4))

      return claimUow.run(async function (tx) {
        const item = await tx.getItem(itemId)
        if (!item) throw notFound('该登记不存在')

        // 幂等：已有活动申请则直接返回原记录
        const existing = await tx.findActiveClaim(itemId, openid)
        if (existing) {
          return { id: existing._id || existing.id, status: existing.status, duplicated: true }
        }

        const relation = perm.relationOf({ item: item, openid: openid })
        if (!perm.canClaim(relation, item)) {
          if (relation === perm.RELATION.OWNER) throw forbidden('不能认领自己发布的信息')
          if (item.type !== 'found') throw forbidden('只有招领信息可以申请认领')
          throw forbidden('该信息当前不接受认领')
        }

        const now = Date.now()
        const id = await tx.addClaim({
          postId: itemId,
          applicantOpenid: openid,
          applicantName: applicantName,
          proofText: proof,
          applicantContact: handoverContact,
          finderContact: '',
          status: CLAIM_STATUS.PENDING,
          reason: '',
          createdAt: now,
          updatedAt: now
        })

        return { id: id, status: CLAIM_STATUS.PENDING, duplicated: false }
      })
    },

    /**
     * 处理申请：接受 / 拒绝 / 取消 / 确认归还。
     */
    async act({ claimId, openid, action, finderContact, reason }) {
      if (!openid) throw unauthorized()
      if (!claimId) throw badRequest('缺少 claimId')

      const actionName = ACTION_MAP[String(action || '')]
      if (!actionName) throw badRequest('未知操作：' + action)

      return claimUow.run(async function (tx) {
        const claim = await tx.getClaim(claimId)
        if (!claim) throw notFound('该申请不存在')

        const item = await tx.getItem(claim.postId)
        if (!item) throw notFound('关联的信息不存在')

        // 用「针对这条申请」的关系判定：申请进入终态后，本人仍然要能被认出来，
        // 否则重复取消会返回 403「无权」，而正确语义是 409「状态不允许」。
        const relation = perm.relationForClaim({ item: item, openid: openid, claim: claim })
        const now = Date.now()

        if (actionName === 'ACCEPT') {
          if (!perm.canDecideClaim(relation, claim)) {
            throw forbidden('只有发布者可以处理待处理的申请')
          }
          const accepted = await tx.findAcceptedClaim(item.id)
          if (accepted) throw conflict('该招领已有被接受的申请')

          const t = applyItemAction('CLAIM_ACCEPT', item.status)
          if (!t.ok) throw conflict(t.reason)

          await tx.updateClaim(claim.id, {
            status: CLAIM_STATUS.ACCEPTED,
            finderContact: String(finderContact || '').trim(),
            updatedAt: now
          })
          await tx.updateItem(item.id, {
            status: t.to,
            acceptedClaimId: claim.id,
            version: nextVersion(item),
            updatedAt: now
          })
          return { id: claim.id, status: CLAIM_STATUS.ACCEPTED, itemStatus: t.to }
        }

        if (actionName === 'REJECT') {
          if (!perm.canDecideClaim(relation, claim)) {
            throw forbidden('只有发布者可以拒绝待处理的申请')
          }
          const t = applyClaimAction('REJECT', claim.status)
          if (!t.ok) throw conflict(t.reason)
          await tx.updateClaim(claim.id, {
            status: t.to,
            reason: String(reason || '').slice(0, LIMITS.REASON_MAX),
            updatedAt: now
          })
          return { id: claim.id, status: t.to }
        }

        if (actionName === 'CANCEL') {
          let who
          if (relation === perm.RELATION.OWNER) who = 'CANCEL_OWNER'
          else if (
            relation === perm.RELATION.APPLICANT_PENDING ||
            relation === perm.RELATION.APPLICANT_ACCEPTED
          ) who = 'CANCEL_APPLICANT'
          else throw forbidden('无权取消该申请')

          const t = applyClaimAction(who, claim.status)
          if (!t.ok) throw conflict(t.reason)

          // 先记住原状态：updateClaim 之后不能再依赖本地对象的字段
          const wasAccepted = claim.status === CLAIM_STATUS.ACCEPTED

          await tx.updateClaim(claim.id, { status: t.to, updatedAt: now })

          // 取消的是已接受的申请 → 招领回到 open，可继续被他人申请
          if (wasAccepted) {
            const it = applyItemAction('CLAIM_CANCEL', item.status)
            if (it.ok) {
              await tx.updateItem(item.id, {
                status: it.to,
                acceptedClaimId: '',
                version: nextVersion(item),
                updatedAt: now
              })
            }
          }
          return { id: claim.id, status: t.to }
        }

        // COMPLETE
        if (!perm.canCompleteClaim(relation, claim)) {
          throw forbidden('只有发布者可以确认归还')
        }
        const t = applyClaimAction('COMPLETE', claim.status)
        if (!t.ok) throw conflict(t.reason)
        const it = applyItemAction('CLAIM_COMPLETE', item.status)
        if (!it.ok) throw conflict(it.reason)

        await tx.updateClaim(claim.id, { status: t.to, updatedAt: now })
        await tx.updateItem(item.id, {
          status: it.to,
          resolvedAt: now,
          acceptedClaimId: '',
          version: nextVersion(item),
          updatedAt: now
        })
        const rejected = await tx.rejectOtherPending(item.id, claim.id, '物品已归还')

        return { id: claim.id, status: t.to, itemStatus: it.to, othersRejected: rejected }
      })
    },

    /**
     * 申请列表
     * @param {Object} p
     * @param {'sent'|'received'} p.mode
     */
    async list({ openid, mode }) {
      if (!openid) throw unauthorized()

      if (mode === 'received') {
        const myItems = await itemRepo.listByOwner(openid, 100)
        const titleMap = {}
        myItems.forEach(function (d) { titleMap[d.id] = d.title })
        const claims = await claimRepo.listByPosts(myItems.map(function (d) { return d.id }), 100)
        return {
          mode: 'received',
          list: claims.map(function (c) {
            return Object.assign({}, c, { itemTitle: titleMap[c.postId] || '（登记已删除）' })
          })
        }
      }

      const claims = await claimRepo.listByApplicant(openid, 100)
      const titleMap = {}
      const ids = []
      claims.forEach(function (c) { if (ids.indexOf(c.postId) === -1) ids.push(c.postId) })
      for (const pid of ids) {
        const it = await itemRepo.getById(pid)
        titleMap[pid] = it ? it.title : '（登记已删除）'
      }
      return {
        mode: 'sent',
        list: claims.map(function (c) {
          return Object.assign({}, c, { itemTitle: titleMap[c.postId] || '' })
        })
      }
    },

    /**
     * 申请详情：只有发布者或申请人本人可看，私密说明仅这两方可见。
     */
    async detail({ claimId, openid }) {
      if (!openid) throw unauthorized()

      const claim = await claimRepo.getById(claimId)
      if (!claim) throw notFound('该申请不存在')

      const item = await itemRepo.getById(claim.postId)
      // 申请详情用「针对这条申请」的关系判定：已取消 / 已完成的申请，本人仍能查看
      const relation = perm.relationForClaim({ item: item, openid: openid, claim: claim })

      const isOwner = relation === perm.RELATION.OWNER
      const isApplicant =
        relation === perm.RELATION.APPLICANT_PENDING || relation === perm.RELATION.APPLICANT_ACCEPTED
      if (!isOwner && !isApplicant) throw forbidden('无权查看该申请')

      return {
        claim: {
          id: claim.id,
          postId: claim.postId,
          status: claim.status,
          reason: claim.reason || '',
          proofText: perm.canViewProof(relation) ? claim.proofText : '',
          applicantContact: perm.canViewContact(relation) && isOwner ? claim.applicantContact || '' : '',
          finderContact: claim.finderContact || '',
          createdAt: claim.createdAt,
          updatedAt: claim.updatedAt
        },
        item: item
          ? {
              id: item.id,
              title: item.title,
              type: item.type,
              status: item.status,
              place: item.place,
              time: item.time
            }
          : null,
        relation: relation,
        canDecide: perm.canDecideClaim(relation, claim),
        canComplete: perm.canCompleteClaim(relation, claim),
        canCancel: perm.canCancelClaim(relation, claim)
      }
    }
  }
}
