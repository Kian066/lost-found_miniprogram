// pages/claim/apply/apply.js —— 申请认领：提交私密证明 + 交接联系方式
const store = require('../../../utils/store')
const util = require('../../../utils/util')

Page({
  data: {
    id: '',
    item: null,
    emoji: '📦',
    proofText: '',
    contact: '',
    submitting: false,
    loading: true
  },

  onLoad(options) {
    var id = (options && options.id) || ''
    this.setData({ id: id, contact: store.getUser().contact || '' })
    if (!id) {
      util.toast('缺少参数')
      return
    }
    var self = this
    store.detail(id).then(function (d) {
      self.setData({
        item: d.item,
        emoji: store.CAT_EMOJI[d.item.category] || '📦',
        loading: false
      })
    }).catch(function () {
      self.setData({ loading: false })
      util.toast('加载失败')
    })
  },

  onProof(e) { this.setData({ proofText: e.detail.value }) },
  onContact(e) { this.setData({ contact: e.detail.value }) },

  submit() {
    var self = this
    var proof = String(this.data.proofText || '').trim()
    var contact = String(this.data.contact || '').trim()

    if (this.data.submitting) return
    if (proof.length < 10) { util.toast('请至少写 10 个字描述物品特征'); return }
    if (!contact) { util.toast('请填写交接联系方式'); return }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })

    store.createClaim(this.data.id, proof, contact).then(function (d) {
      wx.hideLoading()
      self.setData({ submitting: false })
      wx.showToast({ title: d.duplicated ? '你已提交过申请' : '申请已提交', icon: 'none' })
      setTimeout(function () {
        wx.redirectTo({ url: '/pages/claim/detail/detail?id=' + d.id })
      }, 900)
    }).catch(function (e) {
      wx.hideLoading()
      self.setData({ submitting: false })
      util.toast((e && e.message) || '提交失败')
    })
  }
})
