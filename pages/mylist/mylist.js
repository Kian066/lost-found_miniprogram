// pages/mylist/mylist.js —— 我的发布 / 线索 / 收藏
const store = require('../../utils/store')
const match = require('../../utils/match')
const util = require('../../utils/util')

var TITLES = {
  publish: '我的发布',
  inbox: '收到的线索',
  clue: '我提供的线索',
  fav: '我的收藏'
}

Page({
  data: {
    type: 'publish',
    title: '',
    items: [],
    clues: []
  },

  onLoad(options) {
    var type = (options && options.type) || 'publish'
    this.setData({ type: type, title: TITLES[type] || '列表' })
    wx.setNavigationBarTitle({ title: TITLES[type] || '列表' })
  },

  onShow() {
    this.build()
  },

  onPullDownRefresh() {
    this.build()
    wx.stopPullDownRefresh()
  },

  build() {
    var self = this
    var type = this.data.type

    if (type === 'publish') {
      store.myItems().then(function (list) { self.setItems(list) })
    } else if (type === 'fav') {
      store.favItems().then(function (list) { self.setItems(list) })
    } else {
      store.myData().then(function (d) {
        self.setClues(type === 'inbox' ? (d.inbox || []) : (d.clues || []))
      })
    }
  },

  setItems(list) {
    var all = store.getItems()
    this.setData({
      items: (list || []).map(function (i) {
        var copy = JSON.parse(JSON.stringify(i))
        copy._best = all.length ? match.bestScore(i, all) : 0
        return copy
      }),
      clues: []
    })
  },

  setClues(list) {
    var all = store.getItems()
    this.setData({
      clues: (list || []).map(function (c) {
        var item = null
        all.forEach(function (i) { if (i.id === c.itemId) item = i })
        return {
          id: c.id,
          content: c.content,
          author: c.author,
          contact: c.contact || '',
          timeText: util.relTime(c.createdAt),
          itemId: c.itemId,
          itemTitle: c.itemTitle || (item ? item.title : ''),
          score: item ? match.clueScore(item, c.content) : 0
        }
      }),
      items: []
    })
  },

  goDetail(e) {
    var id = e.detail && e.detail.id ? e.detail.id : e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  }
})
