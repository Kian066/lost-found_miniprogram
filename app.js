// app.js
const store = require('./utils/store')
const cloudapi = require('./utils/cloud')

// 是否启用云开发。未部署云函数前请保持 false
var USE_CLOUD = true

App({
  globalData: {
    user: null,
    mode: 'local'
  },

  onLaunch() {
    store.init()
    this.globalData.user = store.getUser()

    var self = this
    if (USE_CLOUD) {
      cloudapi.init().then(function (ok) {
        store.setMode(ok ? 'cloud' : 'local')
        self.globalData.mode = store.getMode()
        console.log('[store] mode =', self.globalData.mode)
        if (ok) return store.login()
      }).then(function (u) {
        if (!u) return
        self.globalData.user = u
        console.log('[store] user =', u.name)
      }).catch(function (e) {
        console.warn('[store] login failed:', e)
      })
    }
  }
})
