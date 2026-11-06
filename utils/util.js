// utils/util.js —— 通用工具函数

function pad(n) {
  return Number(n) < 10 ? '0' + Number(n) : '' + Number(n)
}

/** Date -> 'YYYY-MM-DD' */
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** n 天前的日期字符串 */
function daysAgo(n) {
  var d = new Date()
  d.setDate(d.getDate() - n)
  return fmtDate(d)
}

/** 时间戳 -> 相对时间 */
function relTime(ts) {
  if (!ts) return ''
  var diff = Date.now() - Number(ts)
  if (diff < 0) diff = 0
  var min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + '分钟前'
  var hour = Math.floor(min / 60)
  if (hour < 24) return hour + '小时前'
  var day = Math.floor(hour / 24)
  if (day < 30) return day + '天前'
  var d = new Date(Number(ts))
  return fmtDate(d)
}

/** 两个日期字符串相差天数 */
function dayDiff(a, b) {
  if (!a || !b) return 999
  var t1 = new Date(String(a).replace(/-/g, '/')).getTime()
  var t2 = new Date(String(b).replace(/-/g, '/')).getTime()
  if (isNaN(t1) || isNaN(t2)) return 999
  return Math.abs(Math.floor((t1 - t2) / 86400000))
}

/** 联系方式脱敏：保留前后各 3 位 */
function mask(str) {
  if (!str) return ''
  var s = String(str)
  if (s.length <= 6) return s
  return s.slice(0, 3) + '****' + s.slice(-3)
}

function genId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 1600 })
}

module.exports = {
  pad: pad,
  fmtDate: fmtDate,
  daysAgo: daysAgo,
  relTime: relTime,
  dayDiff: dayDiff,
  mask: mask,
  genId: genId,
  toast: toast
}
