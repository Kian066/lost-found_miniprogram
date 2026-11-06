// pages/admin/admin.js —— 管理后台（仅 role=ADMIN 可用）
const store = require('../../utils/store')
const util = require('../../utils/util')
const state = require('../../shared/state')

var REPORT_TEXT = {
  PENDING: '待处理',
  HANDLED: '已处理',
  IGNORED: '已忽略'
}

Page({
  data: {
    isAdmin: false,
    tab: 'items',
    items: [],
    reports: [],
    total: 0,
    page: 1,
    size: 20,
    onlyHidden: false,
    loading: false,
    booting: false
  },

  onShow() {
    var self = this
    // 角色以云端为准：本地缓存可能是授予管理员之前的
    store.login().then(function () {
      var admin = store.isAdmin()
      self.setData({ isAdmin: admin })
      if (admin) self.load()
    }).catch(function () {
      self.setData({ isAdmin: store.isAdmin() })
    })
  },

  switchTab(e) {
    var tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab: tab })
    this.load()
  },

  toggleHidden() {
    this.setData({ onlyHidden: !this.data.onlyHidden, page: 1 })
    this.load()
  },

  load() {
    if (!store.isAdmin()) return
    var self = this
    this.setData({ loading: true })

    if (this.data.tab === 'items') {
      store.adminItems({
        page: this.data.page,
        size: this.data.size,
        onlyHidden: this.data.onlyHidden
      }).then(function (d) {
        self.setData({
          items: (d.list || []).map(function (x) {
            return Object.assign({}, x, { statusText: state.itemStatusText(x.status) })
          }),
          total: d.total || 0,
          loading: false
        })
      }).catch(function (e) {
        self.setData({ loading: false })
        util.toast((e && e.message) || '加载失败')
      })
      return
    }

    store.adminReports('').then(function (d) {
      self.setData({
        reports: (d.list || []).map(function (r) {
          return Object.assign({}, r, { statusText: REPORT_TEXT[r.status] || r.status })
        }),
        loading: false
      })
    }).catch(function (e) {
      self.setData({ loading: false })
      util.toast((e && e.message) || '加载失败')
    })
  },

  hideItem(e) {
    var id = e.currentTarget.dataset.id
    var self = this
    wx.showModal({
      title: '下架信息',
      content: '下架后该信息不再公开展示，进行中的认领会一并取消。确认吗？',
      success: function (res) {
        if (!res.confirm) return
        store.adminSetVisible(id, false).then(function () {
          util.toast('已下架')
          self.load()
        }).catch(function (err) {
          util.toast((err && err.message) || '操作失败')
        })
      }
    })
  },

  restoreItem(e) {
    var id = e.currentTarget.dataset.id
    var self = this
    store.adminSetVisible(id, true).then(function () {
      util.toast('已恢复展示')
      self.load()
    }).catch(function (err) {
      util.toast((err && err.message) || '操作失败')
    })
  },

  handleReport(e) {
    var id = e.currentTarget.dataset.id
    var op = e.currentTarget.dataset.op
    var self = this
    wx.showModal({
      title: op === 'ignore' ? '忽略举报' : '处理举报',
      editable: true,
      placeholderText: '处理说明（选填）',
      success: function (res) {
        if (!res.confirm) return
        store.adminHandleReport(id, op, res.content || '').then(function () {
          util.toast(op === 'ignore' ? '已忽略' : '已处理')
          self.load()
        }).catch(function (err) {
          util.toast((err && err.message) || '操作失败')
        })
      }
    })
  },

  /** 引导：系统没有管理员时，把自己设为管理员 */
  bootstrap() {
    var self = this
    if (this.data.booting) return
    this.setData({ booting: true })
    store.adminBootstrap('P4_BOOTSTRAP').then(function () {
      return store.login()
    }).then(function () {
      self.setData({ booting: false })
      util.toast('已成为管理员')
      self.onShow()
    }).catch(function (e) {
      self.setData({ booting: false })
      util.toast((e && e.message) || '开通失败')
    })
  },

  goDetail(e) {
    var id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  }
})
