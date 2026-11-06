#!/usr/bin/env node
/**
 * 认领用例层单测：用内存假 repo 直接跑 claimService，覆盖
 * 「接受 / 拒绝 / 取消 / 确认归还」这些需要两个身份才能触发的分支。
 *
 * 之所以能这么做：services 通过参数接收依赖，不 require 具体实现，
 * 所以可以塞入假仓库，完全脱离云环境。
 *
 * 用法：node scripts/test-claim-service.js
 */
'use strict'

const path = require('path')
const ROOT = path.resolve(__dirname, '..')

const createClaimService = require(path.join(ROOT, 'cloudfunctions/api/services/claimService.js'))

const CLAIM_STATUS = { PENDING: 'PENDING', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED' }

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; return }
  fail++
  console.error('  × ' + name + (detail ? '   [' + detail + ']' : ''))
}

/** 构造一套内存数据 + 服务实例 */
function setup() {
  const state = {
    items: new Map(),
    claims: new Map(),
    seq: 0
  }

  const store = {
    // 与真实 repo 一致：返回副本，避免测试假象掩盖「更新后就地修改」的 bug
    async getItem(id) {
      const it = state.items.get(id)
      return it ? Object.assign({}, it) : null
    },
    async getClaim(id) {
      const c = state.claims.get(id)
      return c ? Object.assign({}, c) : null
    },
    async findActiveClaim(postId, openid) {
      for (const c of state.claims.values()) {
        if (c.postId === postId && c.applicantOpenid === openid &&
          (c.status === CLAIM_STATUS.PENDING || c.status === CLAIM_STATUS.ACCEPTED)) return c
      }
      return null
    },
    async findAcceptedClaim(postId) {
      for (const c of state.claims.values()) {
        if (c.postId === postId && c.status === CLAIM_STATUS.ACCEPTED) return c
      }
      return null
    },
    async addClaim(doc) {
      const id = 'c' + (++state.seq)
      state.claims.set(id, Object.assign({ id: id, _id: id }, doc))
      return id
    },
    async updateClaim(id, patch) { Object.assign(state.claims.get(id), patch) },
    async updateItem(id, patch) { Object.assign(state.items.get(id), patch) },
    async rejectOtherPending(postId, exceptId, reason) {
      let n = 0
      for (const c of state.claims.values()) {
        if (c.postId === postId && c.status === CLAIM_STATUS.PENDING && c.id !== exceptId) {
          Object.assign(c, { status: CLAIM_STATUS.REJECTED, reason: reason })
          n++
        }
      }
      return n
    }
  }

  const service = createClaimService({
    claimRepo: {
      async getById(id) { return state.claims.get(id) || null },
      async listByApplicant() { return [] },
      async listByPosts() { return [] },
      async listByPost() { return [] },
      async countActiveByPost(postId) {
        let n = 0
        for (const c of state.claims.values()) {
          if (c.postId === postId && (c.status === CLAIM_STATUS.PENDING || c.status === CLAIM_STATUS.ACCEPTED)) n++
        }
        return n
      }
    },
    claimUow: { run: (fn) => fn(store) },
    itemRepo: {
      async getById(id) { return state.items.get(id) || null },
      async listByOwner() { return [] }
    },
    userRepo: { async getById() { return { nickName: '同学甲' } } },
    auditRepo: { async checkText() { return { pass: true } } }
  })

  return { service, state }
}

/** 造一条招领 + 一条待处理申请 */
function seedFOUND(state, ownerOpenid) {
  state.items.set('i1', {
    id: 'i1', _id: 'i1', type: 'found', title: '黑色钱包', status: 'open',
    visible: true, version: 1, openid: ownerOpenid, contact: '13800000000'
  })
}

async function seedClaim(state, applicantOpenid, proof) {
  const s = setupFrom(state)
  return s.create({
    itemId: 'i1',
    openid: applicantOpenid,
    proofText: proof || '钱包是黑色皮质，里面有校园卡',
    contact: '13900000000'
  })
}

// seedClaim 需要重新拿到 service 绑定同一份 state，这里用一个闭包技巧
let currentService = null
function setupFrom() { return currentService }

async function scenario(name, fn) {
  const { service, state } = setup()
  currentService = service
  seedFOUND(state, 'OWNER')
  try {
    await fn({ service, state })
    console.log('√ ' + name)
  } catch (e) {
    console.log('× ' + name + '   抛出异常: ' + e.message)
    fail++
  }
}

;(async () => {
  console.log('认领 · 服务层')

  await scenario('接受申请：申请变 ACCEPTED，招领转 processing', async ({ service, state }) => {
    const created = await seedClaim(state, 'APPLICANT')
    const r = await service.act({ claimId: created.id, openid: 'OWNER', action: 'accept', finderContact: '13700000000' })
    const claim = state.claims.get(created.id)
    const item = state.items.get('i1')
    ok('申请状态 ACCEPTED', claim.status === CLAIM_STATUS.ACCEPTED, claim.status)
    ok('招领状态 processing', item.status === 'processing', item.status)
    ok('记录被接受的申请 id', item.acceptedClaimId === created.id, item.acceptedClaimId)
    ok('version 递增', item.version === 2, String(item.version))
    ok('写入交接联系方式', claim.finderContact === '13700000000', claim.finderContact)
    ok('返回 itemStatus', r.itemStatus === 'processing', r.itemStatus)
  })

  await scenario('非发布者不能接受', async ({ service, state }) => {
    const created = await seedClaim(state, 'APPLICANT')
    try {
      await service.act({ claimId: created.id, openid: 'APPLICANT', action: 'accept' })
      ok('应当拒绝', false)
    } catch (e) {
      ok('非发布者接受 → 403', e.code === 403, 'code=' + e.code)
    }
  })

  await scenario('已有被接受的申请时，接受第二份 → 409', async ({ service, state }) => {
    const c1 = await seedClaim(state, 'APPLICANT_A', '第一个人的证明，描述物品特征')
    const c2 = await service.create({ itemId: 'i1', openid: 'APPLICANT_B', proofText: '第二个人的证明，也描述特征', contact: '139' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'accept' })
    try {
      await service.act({ claimId: c2.id, openid: 'OWNER', action: 'accept' })
      ok('应当冲突', false)
    } catch (e) {
      ok('第二份接受 → 409', e.code === 409, 'code=' + e.code)
    }
  })

  await scenario('多个申请人可同时排队（申请不改信息状态）', async ({ service, state }) => {
    await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    await service.create({ itemId: 'i1', openid: 'APPLICANT_B', proofText: '乙的证明，描述物品特征', contact: '139' })
    ok('招领仍为 open', state.items.get('i1').status === 'open', state.items.get('i1').status)
    let n = 0
    for (const c of state.claims.values()) if (c.status === CLAIM_STATUS.PENDING) n++
    ok('两份申请都是 PENDING', n === 2, 'n=' + n)
  })

  await scenario('确认归还：申请 COMPLETED，招领 resolved，其余申请被拒', async ({ service, state }) => {
    const c1 = await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    const c2 = await service.create({ itemId: 'i1', openid: 'APPLICANT_B', proofText: '乙的证明，描述物品特征', contact: '139' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'accept' })
    const r = await service.act({ claimId: c1.id, openid: 'OWNER', action: 'complete' })
    ok('申请 COMPLETED', state.claims.get(c1.id).status === CLAIM_STATUS.COMPLETED)
    ok('招领 resolved', state.items.get('i1').status === 'resolved', state.items.get('i1').status)
    ok('另一份被拒', state.claims.get(c2.id).status === CLAIM_STATUS.REJECTED, state.claims.get(c2.id).status)
    ok('拒绝原因为已归还', state.claims.get(c2.id).reason === '物品已归还', state.claims.get(c2.id).reason)
    ok('返回 rejected 数量', r.othersRejected === 1, String(r.othersRejected))
  })

  await scenario('非发布者不能确认归还', async ({ service, state }) => {
    const c1 = await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'accept' })
    try {
      await service.act({ claimId: c1.id, openid: 'APPLICANT_A', action: 'complete' })
      ok('应当拒绝', false)
    } catch (e) {
      ok('申请人确认归还 → 403', e.code === 403, 'code=' + e.code)
    }
  })

  await scenario('发布者取消交接：招领回到 open', async ({ service, state }) => {
    const c1 = await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'accept' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'cancel' })
    ok('申请 CANCELLED', state.claims.get(c1.id).status === CLAIM_STATUS.CANCELLED)
    ok('招领回到 open', state.items.get('i1').status === 'open', state.items.get('i1').status)
    ok('清空 acceptedClaimId', state.items.get('i1').acceptedClaimId === '', JSON.stringify(state.items.get('i1').acceptedClaimId))
  })

  await scenario('无关用户不能取消', async ({ service, state }) => {
    const c1 = await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    try {
      await service.act({ claimId: c1.id, openid: 'STRANGER', action: 'cancel' })
      ok('应当拒绝', false)
    } catch (e) {
      ok('无关用户取消 → 403', e.code === 403, 'code=' + e.code)
    }
  })

  await scenario('拒绝申请：招领保持 open', async ({ service, state }) => {
    const c1 = await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'reject', reason: '描述不符' })
    ok('申请 REJECTED', state.claims.get(c1.id).status === CLAIM_STATUS.REJECTED)
    ok('记录拒绝原因', state.claims.get(c1.id).reason === '描述不符')
    ok('招领仍为 open', state.items.get('i1').status === 'open', state.items.get('i1').status)
  })

  await scenario('终态申请不可再操作', async ({ service, state }) => {
    const c1 = await service.create({ itemId: 'i1', openid: 'APPLICANT_A', proofText: '甲的证明，描述物品特征', contact: '139' })
    await service.act({ claimId: c1.id, openid: 'OWNER', action: 'reject' })
    try {
      await service.act({ claimId: c1.id, openid: 'OWNER', action: 'accept' })
      ok('应当拒绝', false)
    } catch (e) {
      ok('已拒绝的申请不能再接受 → 409/403', e.code === 409 || e.code === 403, 'code=' + e.code)
    }
  })

  console.log('')
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
