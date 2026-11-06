// pages/claim/detail/detail.js —— 认领申请详情与处理
const store = require('../../../utils/store')
const util = require('../../../utils/util')
const state = require('../../../shared/state')

Page({
  data: {
    id: '',
    claim: null,
    item: null,
    relation: '',
    statusText: '',
    canDecide: false,
    canComplete: false,
    canCancel: false,
    finderContact: '',
    reason: '',
    busy: false,
    loading: true
  },

  onLoad(options) {
    this.setData({ id: (options && options.id) || '' })
  },

  onShow() {
    if (this.data.id) this.load()
  },

  load() {
    var self = this
    store.claimDetail(this.data.id).then(function (d) {
      self.setData({
        claim: Object.assign({}, d.claim, { timeText: util.relTime(d.claim.createdAt) }),
        item: d.item,
        relation: d.relation,
        statusText: state.claimStatusText(d.claim.status),
        canDecide: !!d.canDecide,
        canComplete: !!d.canComplete,
        canCancel: !!d.canCancel,
        loading: false
      })
    }).catch(function (e) {
      self.setData({ loading: false })
      util.toast((e && e.message) || '加载失败')
    })
  },

  onFinder(e) { this.setData({ finderContact: e.detail.value }) },
  onReason(e) { this.setData({ reason: e.detail.value }) },

  run(op, extra, okText, confirmText) {
    var self = this
    if (this.data.busy) return

    var go = function () {
      self.setData({ busy: true })
      wx.showLoading({ title: '处理中', mask: true })
      store.actClaim(self.data.id, op, extra).then(function () {
        wx.hideLoading()
        self.setData({ busy: false })
        util.toast(okText)
        self.load()
      }).catch(function (e) {
        wx.hideLoading()
        self.setData({ busy: false })
        util.toast((e && e.message) || '操作失败')
        // 冲突时刷新，避免界面停留在过期状态
        self.load()
      })
    }

    if (!confirmText) { go(); return }
    wx.showModal({
      title: '确认',
      content: confirmText,
      success: function (res) { if (res.confirm) go() }
    })
  },

  accept() {
    if (!String(this.data.finderContact || '').trim()) {
      util.toast('请先填写交接联系方式')
      return
    }
    this.run('accept', { finderContact: this.data.finderContact }, '已接受申请', '接受后请尽快与对方交接，确认吗？')
  },

  reject() {
    this.run('reject', { reason: this.data.reason }, '已拒绝', '确定拒绝这条认领申请吗？')
  },

  cancel() {
    this.run('cancel', {}, '已取消', '取消后招领会重新开放，确定吗？')
  },

  complete() {
    this.run('complete', {}, '已完成归还', '确认物品已经交还给对方了吗？完成后其他申请会被自动拒绝。')
  },

  goItem() {
    if (this.data.item) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + this.data.item.id })
    }
  }
})
