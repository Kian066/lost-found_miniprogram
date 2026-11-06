// pages/detail/detail.js —— 登记详情 + 线索 + 智能匹配
const store = require('../../utils/store')
const match = require('../../utils/match')
const util = require('../../utils/util')
const cloudapi = require('../../utils/cloud')

Page({
  data: {
    id: '',
    item: null,
    emoji: '📦',
    typeText: '',
    isMine: false,
    contactRevealed: true,
    fav: false,
    matches: [],
    clues: [],
    clueText: '',
    clueContact: '',
    pubTime: ''
  },

  onLoad(options) {
    var id = options && options.id
    if (!id) {
      util.toast('数据不存在')
      return
    }
    this.setData({ id: id })
    this.load()
  },

  load() {
    var self = this
    store.detail(this.data.id).then(function (d) {
      if (!d || !d.item) {
        util.toast('该登记已删除')
        return
      }
      var item = d.item
      var clues = (item.clues || []).map(function (c) {
        return {
          id: c.id,
          content: c.content,
          contact: c.contact || '',
          author: c.author,
          timeText: util.relTime(c.createdAt),
          score: c.score === undefined ? match.clueScore(item, c.content) : c.score
        }
      })
      clues.sort(function (a, b) { return b.score - a.score })

      self.setData({
        item: item,
        emoji: store.CAT_EMOJI[item.category] || '📦',
        typeText: item.type === 'lost' ? '寻物启事' : '失物招领',
        isMine: !!d.isMine,
        contactRevealed: d.contactRevealed === undefined ? true : !!d.contactRevealed,
        // 认领相关按钮的可见性，规则与云端 shared/permissions.js 保持一致
        canClaim: !d.isMine && item.type === 'found' && item.status === 'open',
        canResolve: !!d.isMine && item.status === 'open',
        canReopen: !!d.isMine && item.status === 'closed',
        fav: store.isFav(item.id),
        matches: d.matches || [],
        clues: clues,
        pubTime: util.relTime(item.createdAt)
      })
      wx.setNavigationBarTitle({ title: item.type === 'lost' ? '寻物详情' : '招领详情' })

      // 云存储 fileID 换成 HTTPS 临时链接：image 组件与 previewImage 都能稳定使用
      // 非云地址会原样返回，本地模式无额外开销
      self.resolveImages(item.images || [])
    }).catch(function (err) {
      console.warn('[detail] 加载失败:', (err && err.message) || err)
      util.toast('加载失败')
    })
  },

  /**
   * 把当前登记的图片地址换成可直接渲染的 HTTPS 临时链接
   * 转换结果里仍残留 cloud fileID（getTempFileURL 偶发失败）时自动重试一次
   */
  resolveImages(images) {
    var self = this
    this._imgRetried = false
    cloudapi.toDisplayUrls(images).then(function (urls) {
      var pending = urls.some(function (u) { return cloudapi.isFileID(u) })
      if (!pending || self._imgRetried) {
        self.setData({ 'item.images': urls })
        return
      }
      // 弱网 / 云能力刚初始化时偶发失败，延迟后重试一次
      self._imgRetried = true
      setTimeout(function () {
        cloudapi.toDisplayUrls(images).then(function (again) {
          self.setData({ 'item.images': again })
        })
      }, 600)
    })
  },

  /** image 组件加载失败兜底：重试一次地址转换，仍失败则在控制台留下线索 */
  onImgError(e) {
    var idx = Number(e.currentTarget.dataset.index)
    var urls = this.data.item.images || []
    this._errCount = (this._errCount || 0) + 1
    console.warn('[detail] 第 ' + (idx + 1) + ' 张图片加载失败，src =', urls[idx])
    if (this._errCount <= 2) this.resolveImages(urls)
  },

  onClueInput(e) {
    this.setData({ clueText: e.detail.value })
  },

  onClueContact(e) {
    this.setData({ clueContact: e.detail.value })
  },

  submitClue() {
    var self = this
    var text = String(this.data.clueText || '').trim()
    if (text.length < 5) {
      util.toast('线索至少写 5 个字，方便核实')
      return
    }
    store.addClue(this.data.id, text, this.data.clueContact).then(function () {
      self.setData({ clueText: '', clueContact: '' })
      wx.showToast({ title: '线索已提交，感谢！', icon: 'success' })
      self.load()
    }).catch(function (err) {
      util.toast((err && err.message) || '提交失败，请稍后再试')
    })
  },

  onFav() {
    var fav = store.toggleFav(this.data.id)
    this.setData({ fav: fav })
    util.toast(fav ? '已收藏' : '已取消收藏')
  },

  copyContact() {
    var c = this.data.item.contact
    if (!c) return
    wx.setClipboardData({
      data: c,
      success() { util.toast('联系方式已复制') }
    })
  },

  onResolve() {
    var self = this
    wx.showModal({
      title: '标记为已解决',
      content: '确认物品已经找到了吗？标记后将从匹配池中移除。',
      success(res) {
        if (!res.confirm) return
        // 带上读取时的版本号，期间被他人改过会返回 409
        store.updateItem(self.data.id, { status: 'closed' }, self.data.item.version).then(function () {
          util.toast('已标记为解决')
          self.load()
        }).catch(function (err) {
          util.toast((err && err.message) || '操作失败')
          self.load()
        })
      }
    })
  },

  onReopen() {
    var self = this
    store.updateItem(this.data.id, { status: 'open' }, this.data.item.version).then(function () {
      util.toast('已重新开启')
      self.load()
    }).catch(function (err) {
      util.toast((err && err.message) || '操作失败')
      self.load()
    })
  },

  onReport() {
    var self = this
    wx.showModal({
      title: '举报这条信息',
      editable: true,
      placeholderText: '请说明举报原因（至少 5 个字）',
      success(res) {
        if (!res.confirm) return
        var reason = String(res.content || '').trim()
        if (reason.length < 5) {
          util.toast('请至少写 5 个字')
          return
        }
        store.reportItem(self.data.id, reason).then(function (d) {
          util.toast(d && d.duplicated ? '你已举报过这条信息' : '举报已提交，等待处理')
        }).catch(function (err) {
          util.toast((err && err.message) || '举报失败')
        })
      }
    })
  },

  goApplyClaim() {
    wx.navigateTo({ url: '/pages/claim/apply/apply?id=' + this.data.id })
  },

  goClaims() {
    wx.navigateTo({ url: '/pages/claim/list/list?mode=received' })
  },

  onDelete() {
    var self = this
    wx.showModal({
      title: '删除登记',
      content: '删除后不可恢复，确认删除吗？',
      success(res) {
        if (!res.confirm) return
        store.removeItem(self.data.id).then(function () {
          util.toast('已删除')
          setTimeout(function () { wx.navigateBack() }, 600)
        }).catch(function (err) {
          util.toast((err && err.message) || '删除失败')
        })
      }
    })
  },

  previewImage(e) {
    var url = e.currentTarget.dataset.url
    var urls = this.data.item.images || []
    // 兜底：若展示地址还没转换完（仍是 cloud fileID），预览前再转一次
    cloudapi.toDisplayUrls(urls).then(function (list) {
      wx.previewImage({
        current: list[urls.indexOf(url)] || url,
        urls: list
      })
    })
  },

  goMatch(e) {
    wx.redirectTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  }
})
