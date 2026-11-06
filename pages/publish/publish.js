// pages/publish/publish.js —— 发布寻物 / 招领
const store = require('../../utils/store')
const util = require('../../utils/util')
const cloudapi = require('../../utils/cloud')

// 一次表单会话的唯一标识：发布成功后重新生成
// 用于让服务端做幂等，重复提交 / 超时重试不会写出两条
function newToken() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

Page({
  data: {
    types: [
      { key: 'lost', name: '我丢了东西', hint: '发布寻物启事，等待好心人提供线索' },
      { key: 'found', name: '我捡到东西', hint: '发布失物招领，帮它找到主人' }
    ],
    typeIndex: 0,
    cats: [],
    catIndex: 0,
    places: [],
    placeIndex: 0,
    title: '',
    placeDetail: '',
    time: '',
    today: '',
    contact: '',
    desc: '',
    featInput: '',
    features: [],
    images: [],
    quickFeats: ['黑色', '白色', '蓝色', '有挂件', '有名字', '透明壳', '有划痕', '小号'],
    submitting: false,
    aiLoading: false,
    aiResult: null
  },

  onLoad() {
    this.setData({
      submitting: false,
      token: newToken(),
      cats: store.CATEGORIES,
      places: store.PLACES,
      today: util.fmtDate(new Date()),
      time: util.fmtDate(new Date()),
      // 资料里存过联系方式就自动带入，省得每条重填
      contact: store.getUser().contact || ''
    })
  },

  onType(e) {
    this.setData({ typeIndex: Number(e.currentTarget.dataset.index) })  },

  onInput(e) {
    var key = e.currentTarget.dataset.key
    var patch = {}
    patch[key] = e.detail.value
    this.setData(patch)
  },

  onCat(e) {
    this.setData({ catIndex: Number(e.detail.value) })
  },

  onPlace(e) {
    this.setData({ placeIndex: Number(e.detail.value) })
  },

  onTime(e) {
    this.setData({ time: e.detail.value })
  },

  onFeatInput(e) {
    this.setData({ featInput: e.detail.value })
  },

  addFeat() {
    var v = String(this.data.featInput || '').trim()
    if (!v) return
    if (this.data.features.indexOf(v) > -1) {
      util.toast('该特征已添加')
      return
    }
    if (this.data.features.length >= 6) {
      util.toast('最多添加 6 个特征')
      return
    }
    this.setData({
      features: this.data.features.concat([v]),
      featInput: ''
    })
  },

  addQuickFeat(e) {
    var v = e.currentTarget.dataset.value
    if (this.data.features.indexOf(v) > -1) return
    this.setData({ features: this.data.features.concat([v]) })
  },

  delFeat(e) {
    var v = e.currentTarget.dataset.value
    this.setData({
      features: this.data.features.filter(function (f) { return f !== v })
    })
  },

  chooseImage() {
    var that = this
    var left = 6 - this.data.images.length
    if (left <= 0) {
      util.toast('最多上传 6 张图片')
      return
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success(res) {
        var files = res.tempFiles.map(function (f) { return f.tempFilePath })
        that.setData({ images: that.data.images.concat(files) })
      }
    })
  },

  previewImage(e) {
    var url = e.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: this.data.images })
  },

  delImage(e) {
    var url = e.currentTarget.dataset.url
    this.setData({
      images: this.data.images.filter(function (u) { return u !== url })
    })
  },

  /**
   * 提交前把本地临时图片上传到云存储，返回可落库的地址数组
   * - 本地模式（未连云）不上传，保持原有演示体验
   * - 已是 cloud fileID 的直接复用，重试提交不会重复上传
   * - 单张失败不中断，最后统一询问用户是否继续发布
   * @returns {Promise<string[]|null>} null 表示用户在失败提示里选择了取消
   */
  prepareImages() {
    var images = this.data.images || []
    if (!store.usingCloud()) return Promise.resolve(images)

    var pending = images.filter(function (u) { return !cloudapi.isFileID(u) })
    if (!pending.length) return Promise.resolve(images)

    var done = 0
    var failed = 0
    var tasks = images.map(function (u) {
      if (cloudapi.isFileID(u)) return Promise.resolve(u)
      return cloudapi.uploadFile(u, 'items').then(function (fid) {
        done++
        return fid
      }).catch(function () {
        done++
        failed++
        return ''
      }).then(function (v) {
        // 并发上传，用完成数做进度提示
        wx.showLoading({ title: '上传图片 ' + done + '/' + pending.length, mask: true })
        return v
      })
    })

    return Promise.all(tasks).then(function (list) {
      var urls = list.filter(function (u) { return !!u })
      if (!failed) return urls

      wx.hideLoading()
      return new Promise(function (resolve) {
        wx.showModal({
          title: '有图片没上传成功',
          content: failed + ' 张图片上传失败，继续发布会缺少这些图片。',
          confirmText: '继续发布',
          cancelText: '取消',
          success: function (res) { resolve(res.confirm ? urls : null) },
          fail: function () { resolve(urls) }
        })
      })
    })
  },

  // ---- AI 辅助填写 ----
  aiText() {
    var parts = []
    if (this.data.title) parts.push(this.data.title)
    if (this.data.desc) parts.push(this.data.desc)
    if (this.data.features.length) parts.push(this.data.features.join(' '))
    return parts.join('，')
  },

  runAi() {
    var self = this
    if (this.data.aiLoading) return

    var text = this.aiText()
    var rawImages = this.data.images || []
    var cloudIds = rawImages.filter(function (u) { return cloudapi.isFileID(u) })

    // 真正发起识别；extraIds 为本次最新上传得到的 cloud fileID
    var doExtract = function (extraIds) {
      var fileIds = extraIds.length ? cloudIds.concat(extraIds) : cloudIds.slice(0, 3)
      if (!text && !fileIds.length) {
        util.toast('先写点描述或选一张图，AI 才有依据')
        return
      }
      self.setData({ aiLoading: true })
      store.aiExtract({
        text: text,
        fileIds: fileIds,
        category: self.data.cats[self.data.catIndex],
        place: self.data.places[self.data.placeIndex]
      }).then(function (d) {
        var s = d.suggestions || {}
        s.featuresText = (s.features || []).join('、')
        self.setData({
          aiLoading: false,
          aiResult: {
            suggestions: s,
            degraded: !!d.degraded,
            source: d.source || '',
            note: d.note || ''
          }
        })
      }).catch(function (e) {
        // AI 失败绝不阻塞发布，只提示一次
        self.setData({ aiLoading: false })
        util.toast((e && e.message) || 'AI 暂时不可用，请手动填写')
      })
    }

    // 有本地临时图片：先上传成 cloud fileID，AI 才能识别到图片。
    // 上传成功后把 fileID 写回 images，提交时 prepareImages 会直接复用，不重复上传。
    var pending = rawImages.filter(function (u) { return !cloudapi.isFileID(u) })
    if (pending.length && store.usingCloud()) {
      wx.showLoading({ title: '上传图片中', mask: true })
      var tasks = pending.map(function (u) {
        return cloudapi.uploadFile(u, 'items').catch(function () { return '' })
      })
      Promise.all(tasks).then(function (list) {
        wx.hideLoading()
        var extra = list.filter(Boolean)
        if (extra.length) {
          var k = 0
          var merged = rawImages.map(function (u) {
            if (!cloudapi.isFileID(u)) { var id = list[k]; k++; return id || u }
            return u
          })
          self.setData({ images: merged })
        }
        doExtract(extra)
      }).catch(function () {
        wx.hideLoading()
        doExtract([])
      })
    } else {
      doExtract([])
    }
  },

  closeAi() {
    this.setData({ aiResult: null })
  },

  applyAi() {
    var r = this.data.aiResult
    if (!r) return
    var s = r.suggestions || {}
    var patch = {}

    // 只填补空字段，不覆盖用户已经写好的内容
    if (s.title && !this.data.title) patch.title = s.title
    if (s.desc && !String(this.data.desc || '').trim()) patch.desc = s.desc

    var ci = this.data.cats.indexOf(s.category)
    if (ci > -1) patch.catIndex = ci
    var pi = this.data.places.indexOf(s.place)
    if (pi > -1) patch.placeIndex = pi

    if (s.features && s.features.length) {
      var merged = this.data.features.slice()
      s.features.forEach(function (f) {
        if (merged.indexOf(f) === -1 && merged.length < 6) merged.push(f)
      })
      patch.features = merged
    }

    patch.aiResult = null
    this.setData(patch)
    util.toast('已填入建议，可继续修改')
  },

  submit() {
    var type = this.data.types[this.data.typeIndex].key
    var title = String(this.data.title || '').trim()
    var place = this.data.places[this.data.placeIndex]
    if (this.data.placeDetail) place = place + ' ' + this.data.placeDetail
    var contact = String(this.data.contact || '').trim()

    if (!title) { util.toast('请填写物品名称'); return }
    if (!this.data.time) { util.toast('请选择时间'); return }
    if (!contact) { util.toast('请填写联系方式，方便对方联系你'); return }
    if (String(this.data.desc || '').trim().length < 5) {
      util.toast('请至少用 5 个字描述一下物品特征');
      return
    }

    // 提交锁：图片上传 + 内容安全审核期间必须挡住重复点击
    if (this.data.submitting) return
    this.setData({ submitting: true })

    var that = this
    var token = this.data.token || newToken()
    this.setData({ token: token })

    // 有待上传的图片时先给出准确文案，避免用户以为卡在“发布中”
    var uploading = store.usingCloud() && this.data.images.some(function (u) {
      return !cloudapi.isFileID(u)
    })
    wx.showLoading({ title: uploading ? '上传图片中' : '发布中', mask: true })

    this.prepareImages().then(function (images) {
      // null 表示用户在“部分图片上传失败”弹窗里选择了取消
      if (!images) return null
      wx.showLoading({ title: '发布中', mask: true })
      return store.addItem({
        clientToken: token,
        type: type,
        title: title,
        category: that.data.cats[that.data.catIndex],
        place: place,
        time: that.data.time,
        desc: String(that.data.desc || '').trim(),
        features: that.data.features,
        contact: contact,
        images: images
      })
    }).then(function (item) {
      if (!item) {
        wx.hideLoading()
        that.setData({ submitting: false })
        return
      }
      wx.hideLoading()
      // 换 token，让下一条登记是新记录
      that.setData({ submitting: false, token: newToken() })
      // 先 hideLoading 再 showToast，部分机型需要间隔，否则 toast 会被吞掉
      setTimeout(function () {
        wx.showToast({ title: '发布成功', icon: 'success' })
      }, 100)
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/detail/detail?id=' + item.id })
        that.resetForm()
      }, 900)
    }).catch(function (err) {
      wx.hideLoading()
      that.setData({ submitting: false })
      var msg = (err && err.message) || ''
      // 超时不代表没写成功，别让用户盲目再点一次
      if (msg.indexOf('超时') > -1 || msg.indexOf('timeout') > -1) {
        msg = '网络超时，请到「我的发布」确认是否已发布'
      }
      util.toast(msg || '发布失败，请稍后再试')
    })
  },

  resetForm() {
    this.setData({
      title: '',
      placeDetail: '',
      contact: store.getUser().contact || '',
      desc: '',
      featInput: '',
      features: [],
      images: [],
      time: this.data.today
    })
  }
})
