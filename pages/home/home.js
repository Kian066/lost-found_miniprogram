// pages/home/home.js —— 失物招领广场
const store = require('../../utils/store')
const match = require('../../utils/match')

var SIZE = 8

Page({
  data: {
    cats: [],
    catIndex: 0,
    tabs: [
      { key: 'all', name: '全部' },
      { key: 'lost', name: '寻物启事' },
      { key: 'found', name: '失物招领' }
    ],
    tabIndex: 0,
    keyword: '',
    list: [],
    page: 1,
    hasMore: false,
    total: 0,
    stats: { lost: 0, found: 0, solved: 0, clue: 0 }
  },

  onLoad() {
    this.page = 1
    this.setData({ cats: ['全部'].concat(store.CATEGORIES) })
  },

  onShow() {
    this.page = 1
    this.build()
  },

  onPullDownRefresh() {
    this.page = 1
    this.build()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (!this.data.hasMore) return
    this.page = this.page + 1
    this.build()
  },

  /** 拉取统计 + 列表 */
  build() {
    var self = this
    var kw = String(this.data.keyword || '').trim()
    var cat = this.data.cats[this.data.catIndex]
    var tabKey = this.data.tabs[this.data.tabIndex].key

    store.stats('global').then(function (s) {
      if (s) self.setData({ stats: s })
    })

    store.listItems({
      type: tabKey === 'all' ? '' : tabKey,
      category: cat,
      keyword: kw,
      page: self.page,
      size: SIZE
    }).then(function (res) {
      self.render(res)
    })
  },

  /** 渲染列表，并计算每条的匹配角标（云模式下由服务端负责，此处为 0） */
  render(res) {
    var all = store.getItems()
    var list = (res.list || []).map(function (i) {
      var copy = JSON.parse(JSON.stringify(i))
      copy._best = all.length ? match.bestScore(i, all) : 0
      return copy
    })
    this.setData({
      list: this.page > 1 ? this.data.list.concat(list) : list,
      total: res.total || list.length,
      hasMore: !!res.hasMore
    })
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value })
    this.page = 1
    this.build()
  },

  onClear() {
    this.setData({ keyword: '' })
    this.page = 1
    this.build()
  },

  onCat(e) {
    this.setData({ catIndex: Number(e.currentTarget.dataset.index) })
    this.page = 1
    this.build()
  },

  onTab(e) {
    this.setData({ tabIndex: Number(e.currentTarget.dataset.index) })
    this.page = 1
    this.build()
  },

  goDetail(e) {
    var id = e.detail.id
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goMatch() {
    wx.switchTab({ url: '/pages/match/match' })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  }
})
