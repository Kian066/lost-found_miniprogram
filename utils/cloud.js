// utils/cloud.js —— 云函数调用封装
// 未开通云开发 / 调用失败时由 store.js 自动降级到本地数据

// 云开发环境 ID
var ENV_ID = 'cloud1-d4gc1q6zp8c9f8cec'

var READY = false

function isSupported() {
  return typeof wx !== 'undefined' && !!wx.cloud && typeof wx.cloud.init === 'function'
}

/** 初始化云开发，返回是否可用 */
function init(envId) {
  return new Promise(function (resolve) {
    if (!isSupported()) {
      READY = false
      resolve(false)
      return
    }
    try {
      var opt = { traceUser: true }
      var env = envId || ENV_ID
      if (env) opt.env = env
      wx.cloud.init(opt)
      READY = true
      resolve(true)
    } catch (e) {
      READY = false
      resolve(false)
    }
  })
}

function isReady() {
  return READY
}

/**
 * 调用云函数
 * 所有业务接口都收敛到单个 api 云函数，原来的函数名降级为 action。
 * action 放在最后合并，保证路由键不会被调用方数据覆盖。
 * 统一约定：返回 { ok: true, data } 或 { ok: false, msg, code }
 * @returns {Promise<Object>} 成功时 resolve(data)
 */
/**
 * 调用任意云函数（内部用）
 * @param {string} fnName 云函数名
 * @param {Object} data 入参
 */
function callFn(fnName, data) {
  return new Promise(function (resolve, reject) {
    if (!READY) {
      console.warn('[cloud] 云环境未初始化，调用被跳过:', fnName)
      reject(new Error('云环境未初始化'))
      return
    }
    wx.cloud.callFunction({
      name: fnName,
      data: data || {},
      success: function (res) {
        var r = res && res.result
        if (!r) {
          console.warn('[cloud] 云函数返回为空:', fnName)
          reject(new Error('云函数返回为空：' + fnName))
          return
        }
        if (r.ok === false) {
          // 业务错误是正常流程（403/404/409），只记录，不当作异常刷屏
          var err = new Error(r.msg || '云函数调用失败')
          err.code = r.code || 0
          reject(err)
          return
        }
        resolve(r.data || {})
      },
      fail: function (err) {
        console.warn('[cloud] 调用失败:', fnName, (err && err.errMsg) || err)
        reject(new Error((err && err.errMsg) || '云函数调用失败'))
      }
    })
  })
}

/**
 * 调用业务主入口 api：函数名降级为 action
 * @param {string} name action 名
 * @param {Object} data 入参
 */
function call(name, data) {
  return callFn('api', Object.assign({}, data || {}, { action: name }))
}

/**
 * 上传本地临时文件到云存储，返回 fileID
 * 头像 / 发布图片都应走这里，避免持久化本地临时路径导致图片失效
 * @param {string} filePath wx.chooseMedia / chooseAvatar 返回的临时路径
 * @param {string} dir 云存储目录，如 'avatars' / 'items'
 * @returns {Promise<string>} fileID
 */
function uploadFile(filePath, dir) {
  return new Promise(function (resolve, reject) {
    if (!READY) {
      reject(new Error('云环境未初始化'))
      return
    }
    var path = String(filePath || '')
    var ext = ''
    var idx = path.lastIndexOf('.')
    if (idx > -1) ext = path.slice(idx, idx + 10)
    var name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + (ext || '.png')
    wx.cloud.uploadFile({
      cloudPath: (dir || 'images') + '/' + name,
      filePath: path,
      success: function (res) {
        resolve(res.fileID)
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '图片上传失败'))
      }
    })
  })
}

/** 是否为云存储文件 ID（cloud:// 开头） */
function isFileID(url) {
  return /^cloud:\/\//.test(String(url || ''))
}

/**
 * 把 images 里的 cloud fileID 批量换成可直接预览的 HTTPS 临时链接
 * 非 fileID（本地临时路径 / 已是 https）原样保留，顺序不变
 * 转换失败也原样返回，保证界面不因个别图片挂掉
 * @param {string[]} list
 * @returns {Promise<string[]>}
 */
function toDisplayUrls(list) {
  var arr = (list || []).map(function (u) { return String(u || '') })
  var ids = []
  arr.forEach(function (u) {
    if (isFileID(u) && ids.indexOf(u) === -1) ids.push(u)
  })
  if (!ids.length || !READY || !isSupported()) return Promise.resolve(arr)

  return new Promise(function (resolve) {
    wx.cloud.getTempFileURL({
      fileList: ids.slice(0, 50),
      success: function (res) {
        var map = {}
        var bad = []
        var fl = (res && res.fileList) || []
        fl.forEach(function (f) {
          if (f && f.fileID && f.tempFileURL) {
            map[f.fileID] = f.tempFileURL
          } else if (f && f.fileID) {
            // status != 0 通常是云存储权限或 fileID 不存在
            bad.push({ fileID: f.fileID, status: f.status, errmsg: f.errmsg })
          }
        })
        if (bad.length) {
          console.warn('[cloud] 以下文件没能拿到临时链接：', bad)
        }
        resolve(arr.map(function (u) { return map[u] || u }))
      },
      fail: function (err) {
        console.warn('[cloud] getTempFileURL 调用失败：', err)
        resolve(arr)
      }
    })
  })
}

module.exports = {
  init: init,
  isReady: isReady,
  isSupported: isSupported,
  call: call,
  callFn: callFn,
  uploadFile: uploadFile,
  isFileID: isFileID,
  toDisplayUrls: toDisplayUrls
}
