// pages/match/match.js —— 线索智能匹配
const store = require('../../utils/store')
const match = require('../../utils/match')
const cloudapi = require('../../utils/cloud')
const util = require('../../utils/util')

/** 把云函数返回的精简结果补上展示所需的字段 */
function decorate(r) {
  return {
    id: r.id,
    title: r.title,
    place: r.place,
    time: r.time,
    typeText: r.type === 'lost' ? '寻物' : '招领',
    emoji: store.CAT_EMOJI[r.category] || '📦',
    contact: r.contact || '',
    score: r.score,
    level: r.level,
    reasons: r.reasons || [],
    dir: r.dir || ''
  }
}

Page({
  data: {
    bases: [],
    baseId: '',
    keyword: '',
    cats: [],
    catIndex: 0,
    results: [],
    top: 0,
    tip: ''
  },

  onLoad() {
    this.setData({
      cats: ['不限'].concat(store.CATEGORIES),
      tip: '选择一条我的登记，或直接输入关键词，系统会按「类目 + 特征 + 地点 + 时间」四维度打分。'
    })
  },

  onShow() {
    var self = this
    store.myItems().then(function (mine) {
      var bases = mine.filter(function (i) { return i.status === 'open' }).map(function (i) {
        return {
          id: i.id,
          title: i.title,
          type: i.type,
          typeText: i.type === 'lost' ? '寻物' : '招领',
          emoji: store.CAT_EMOJI[i.category] || '📦',
          clueCount: (i.clues || []).length
        }
      })
      var keepId = self.data.baseId
      var still = false
      bases.forEach(function (b) { if (b.id === keepId) still = true })
      self.setData({ bases: bases, baseId: still ? keepId : (bases.length ? bases[0].id : '') })
      self.compute()
    })
  },

  onPickBase(e) {
    var id = e.currentTarget.dataset.id
    this.setData({ baseId: this.data.baseId === id ? '' : id })
    this.compute()
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  onCat(e) {
    this.setData({ catIndex: Number(e.detail.value) })
    this.compute()
  },

  run() {
    this.compute()
  },

  compute() {
    var self = this
    var kw = String(this.data.keyword || '').trim()
    var cat = this.data.catIndex === 0 ? '' : this.data.cats[this.data.catIndex]

    // 云端模式：匹配在服务端完成，避免全库下发
    if (store.usingCloud()) {
      cloudapi.call('matchQuery', {
        baseId: this.data.baseId,
        keyword: kw,
        category: cat,
        limit: 20
      }).then(function (d) {
        var list = (d.list || []).map(decorate)
        self.setData({ results: list, top: d.top || (list.length ? list[0].score : 0) })
        if (!list.length) util.toast('暂无匹配结果，换个关键词试试')
      }).catch(function () {
        self.localCompute()
      })
      return
    }

    this.localCompute()
  },

  /** 本地模式：在客户端全量计算 */
  localCompute() {
    var kw = String(this.data.keyword || '').trim()
    var items = store.getItems().filter(function (i) { return i.status === 'open' })
    var out = []

    if (this.data.baseId) {
      var base = null
      items.forEach(function (i) { if (i.id === this.data.baseId) base = i }, this)
      if (!base) {
        this.setData({ results: [], top: 0 })
        return
      }
      var dir = base.type === 'lost' ? '招领信息' : '寻物启事'
      match.matchList(base, items, kw, 0).forEach(function (r) {
        out.push({
          id: r.item.id,
          title: r.item.title,
          place: r.item.place,
          time: r.item.time,
          typeText: r.item.type === 'lost' ? '寻物' : '招领',
          emoji: store.CAT_EMOJI[r.item.category] || '📦',
          contact: r.item.contact,
          score: r.score,
          level: r.level,
          reasons: r.reasons,
          dir: dir
        })
      })
    } else if (kw) {
      var today = util.fmtDate(new Date())
      var cat = this.data.catIndex === 0 ? '' : this.data.cats[this.data.catIndex]
      var collect = function (type, dir) {
        var b = { id: '', type: type, title: kw, category: cat, place: '', time: today, desc: kw, features: [] }
        match.matchList(b, items, kw, 20).forEach(function (r) {
          var exist = null
          out.forEach(function (o) { if (o.id === r.item.id) exist = o })
          if (exist) {
            if (r.score > exist.score) exist.score = r.score
            return
          }
          out.push({
            id: r.item.id,
            title: r.item.title,
            place: r.item.place,
            time: r.item.time,
            typeText: r.item.type === 'lost' ? '寻物' : '招领',
            emoji: store.CAT_EMOJI[r.item.category] || '📦',
            contact: r.item.contact,
            score: r.score,
            level: r.level,
            reasons: r.reasons,
            dir: dir
          })
        })
      }
      collect('lost', '招领信息')
      collect('found', '寻物启事')
    } else {
      this.setData({ results: [], top: 0 })
      return
    }

    out.sort(function (a, b) { return b.score - a.score })
    out = out.slice(0, 20)
    this.setData({ results: out, top: out.length ? out[0].score : 0 })
    if (!out.length) util.toast('暂无匹配结果，换个关键词试试')
  },

  copyContact(e) {
    var c = e.currentTarget.dataset.contact
    if (!c) {
      util.toast('对方未留联系方式')
      return
    }
    wx.setClipboardData({
      data: c,
      success() { util.toast('联系方式已复制') }
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  }
})
