// pages/claim/list/list.js —— 我发出的 / 我收到的认领申请
const store = require('../../../utils/store')
const util = require('../../../utils/util')
const state = require('../../../shared/state')

var TONE = {
  PENDING: 'warn',
  ACCEPTED: 'ok',
  COMPLETED: 'ok',
  REJECTED: 'muted',
  CANCELLED: 'muted'
}

Page({
  data: {
    mode: 'sent',
    list: [],
    loading: true,
    empty: false
  },

  onLoad(options) {
    var mode = (options && options.mode) === 'received' ? 'received' : 'sent'
    this.setData({ mode: mode })
    wx.setNavigationBarTitle({ title: mode === 'received' ? '收到的申请' : '我的申请' })
  },

  onShow() { this.load() },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  switchMode(e) {
    var mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    this.setData({ mode: mode, loading: true })
    wx.setNavigationBarTitle({ title: mode === 'received' ? '收到的申请' : '我的申请' })
    this.load()
  },

  load() {
    var self = this
    var mode = this.data.mode
    store.listClaims(mode).then(function (d) {
      var list = (d.list || []).map(function (c) {
        return {
          id: c.id,
          postId: c.postId,
          itemTitle: c.itemTitle || '（登记已删除）',
          status: c.status,
          statusText: state.claimStatusText(c.status),
          tone: TONE[c.status] || 'muted',
          who: mode === 'received' ? (c.applicantName || '同学') : '我',
          timeText: util.relTime(c.createdAt),
          reason: c.reason || ''
        }
      })
      self.setData({ list: list, loading: false, empty: list.length === 0 })
    }).catch(function () {
      self.setData({ list: [], loading: false, empty: true })
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/claim/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goItem(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.postid })
  }
})
