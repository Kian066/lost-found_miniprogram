// pages/mine/mine.js —— 个人中心
const store = require('../../utils/store')
const cloudapi = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    isAdmin: false,
    user: {},
    initial: '我',
    editing: false,
    form: { name: '', avatar: '', sid: '', college: '', contact: '' },
    stats: { publish: 0, inbox: 0, clue: 0, fav: 0, solved: 0 },
    menus: [
      { key: 'edit', icon: '✏️', name: '编辑资料', desc: '设置头像、昵称与默认联系方式' },
      { key: 'publish', icon: '📝', name: '我的发布', desc: '我登记的寻物 / 招领' },
      { key: 'claimSent', icon: '🙋', name: '我的认领申请', desc: '我提交的认领与进度' },
      { key: 'claimReceived', icon: '📨', name: '收到的认领申请', desc: '别人申请认领我的招领' },
      { key: 'inbox', icon: '📥', name: '收到的线索', desc: '别人给我的留言' },
      { key: 'clue', icon: '💬', name: '我提供的线索', desc: '我帮助过的信息' },
      { key: 'fav', icon: '⭐', name: '我的收藏', desc: '关注中的登记' }
    ]
  },

  onShow() {
    var user = store.getUser()
    var self = this
    this.setData({
      user: user,
      initial: String(user.name || '我').charAt(0),
      isAdmin: store.isAdmin(),
      form: {
        name: user.name || '',
        avatar: user.avatar || '',
        sid: user.sid || '',
        college: user.college || '',
        contact: user.contact || ''
      }
    })

    store.stats('mine').then(function (s) {
      self.setData({
        stats: {
          publish: (s && s.publish) || 0,
          inbox: (s && s.inbox) || 0,
          clue: (s && s.clue) || 0,
          solved: (s && s.solved) || 0,
          fav: store.getFavs().length
        }
      })
    })

    // 异步刷新一次档案：管理员角色可能在别处被授予，不能只信本地缓存
    store.login().then(function (u) {
      if (!u) return
      self.setData({ user: u, isAdmin: store.isAdmin() })
    })
  },

  goMenu(e) {
    var key = e.currentTarget.dataset.key
    if (key === 'edit') {
      this.toggleEdit()
      return
    }
    if (key === 'claimSent' || key === 'claimReceived') {
      var mode = key === 'claimReceived' ? 'received' : 'sent'
      wx.navigateTo({ url: '/pages/claim/list/list?mode=' + mode })
      return
    }
    if (key === 'admin') {
      wx.navigateTo({ url: '/pages/admin/admin' })
      return
    }
    wx.navigateTo({ url: '/pages/mylist/mylist?type=' + key })
  },

  toggleEdit() {
    // 收起时把表单还原成已保存的资料，避免残留未保存内容
    if (this.data.editing) this.onShow()
    this.setData({ editing: !this.data.editing })
  },

  /** 微信头像填写能力：拿到临时头像后转存云存储，避免重启失效 */
  onChooseAvatar(e) {
    var tmp = e.detail && e.detail.avatarUrl
    if (!tmp) return
    var self = this
    this.setData({ 'form.avatar': tmp })
    if (!cloudapi.isReady()) return

    wx.showLoading({ title: '上传头像', mask: true })
    cloudapi.uploadFile(tmp, 'avatars').then(function (fileID) {
      self.setData({ 'form.avatar': fileID })
      wx.hideLoading()
    }).catch(function () {
      wx.hideLoading()
      util.toast('头像上传失败，请重试')
    })
  },

  onFormInput(e) {
    var key = e.currentTarget.dataset.key
    var patch = {}
    patch['form.' + key] = e.detail.value
    this.setData(patch)
  },

  saveProfile() {
    var f = this.data.form
    var name = String(f.name || '').trim()
    if (!name) {
      util.toast('请填写昵称')
      return
    }

    var self = this
    wx.showLoading({ title: '保存中', mask: true })
    store.updateUser({
      name: name,
      avatar: String(f.avatar || ''),
      sid: String(f.sid || '').trim(),
      college: String(f.college || '').trim(),
      contact: String(f.contact || '').trim()
    }).then(function () {
      wx.hideLoading()
      self.setData({ editing: false })
      self.onShow()
      util.toast('资料已保存')
    }).catch(function () {
      wx.hideLoading()
      util.toast('保存失败，请稍后再试')
    })
  },

  resetData() {
    var that = this
    wx.showModal({
      title: '恢复演示数据',
      content: '将清空本地登记、线索与收藏，恢复到初始演示数据，确认继续？',
      success(res) {
        if (!res.confirm) return
        store.resetData()
        util.toast('已恢复演示数据')
        that.onShow()
      }
    })
  },

  about() {
    var mode = store.getMode() === 'cloud' ? '当前运行模式：云端（云函数）' : '当前运行模式：本地演示数据'
    wx.showModal({
      title: '关于「校园失物招领」',
      content: '基于 类目 / 特征 / 地点 / 时间 四维度的线索匹配算法，为校园失物与拾获信息自动牵线。' + mode + '。',
      showCancel: false
    })
  }
})
