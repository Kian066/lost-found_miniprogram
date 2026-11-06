/* ------------------------------------------------------------------
 * 自动生成，请勿直接修改
 * 源文件：shared/match.js
 * 修改后执行：node scripts/sync-shared.js
 * ------------------------------------------------------------------ */
// 云函数共享的匹配算法（唯一来源：shared/match.js）
// 前端 utils/match.js 是另一份独立实现（多了 bestScore，服务本地演示模式），
// 调整评分规则时两边都要同步检查；云端只认这一份。
'use strict'

const { STATUS } = require('./constants')

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^一-龥a-z0-9]/g, '')
}

function grams(s) {
  var t = norm(s)
  var set = {}
  for (var i = 0; i < t.length; i++) {
    set[t[i]] = 1
    if (i + 1 < t.length) set[t.slice(i, i + 2)] = 1
  }
  return set
}

function similarity(a, b) {
  var A = grams(a)
  var B = grams(b)
  var ka = 0
  var kb = 0
  var k
  for (k in A) { if (Object.prototype.hasOwnProperty.call(A, k)) ka++ }
  for (k in B) { if (Object.prototype.hasOwnProperty.call(B, k)) kb++ }
  if (!ka || !kb) return 0
  var hitA = 0
  var hitB = 0
  for (k in A) { if (A[k] && B[k]) hitA++ }
  for (k in B) { if (B[k] && A[k]) hitB++ }
  return (hitA / ka + hitB / kb) / 2
}

function commonFeatures(a, b) {
  var out = []
  ;(a || []).forEach(function (x) {
    ;(b || []).forEach(function (y) {
      if (x === y) { out.push(x); return }
      if (norm(x) && norm(y) && (norm(x).indexOf(norm(y)) > -1 || norm(y).indexOf(norm(x)) > -1)) {
        if (out.indexOf(x) === -1) out.push(x)
      }
    })
  })
  return out
}

function dayDiff(a, b) {
  if (!a || !b) return 999
  var t1 = new Date(String(a).replace(/-/g, '/')).getTime()
  var t2 = new Date(String(b).replace(/-/g, '/')).getTime()
  if (isNaN(t1) || isNaN(t2)) return 999
  return Math.abs(Math.floor((t1 - t2) / 86400000))
}

function itemText(item) {
  return [item.title, item.desc, (item.features || []).join(''), item.place, item.category].join(' ')
}

function score(base, cand, keyword) {
  var s = 0
  var reasons = []

  if (base.category === cand.category) {
    s += 30
    reasons.push('同类目 · ' + base.category)
  }

  var titleSim = similarity(base.title, cand.title)
  var descSim = similarity(
    (base.desc || '') + (base.features || []).join(''),
    (cand.desc || '') + (cand.features || []).join('')
  )
  var textSim = Math.max(titleSim, titleSim * 0.6 + descSim * 0.4)
  s += Math.round(textSim * 30)
  if (textSim >= 0.2) reasons.push('特征吻合度 ' + Math.round(textSim * 100) + '%')

  var placeSim = similarity(base.place, cand.place)
  s += Math.round(placeSim * 20)
  if (placeSim >= 0.2) reasons.push('地点接近 · ' + cand.place)

  var d = dayDiff(base.time, cand.time)
  if (d <= 1) { s += 15; reasons.push('时间仅相差 ' + d + ' 天') }
  else if (d <= 3) { s += 12; reasons.push('时间相差 ' + d + ' 天') }
  else if (d <= 7) { s += 8; reasons.push('时间相差 ' + d + ' 天') }
  else if (d <= 15) { s += 3 }

  var cf = commonFeatures(base.features, cand.features)
  if (cf.length) {
    s += Math.min(10, cf.length * 5)
    reasons.push('特征一致：' + cf.slice(0, 2).join('、'))
  }

  if (keyword) {
    var kwSim = similarity(keyword, itemText(cand))
    if (kwSim > 0) {
      s += Math.round(Math.min(1, kwSim * 2) * 10)
      reasons.push('命中关键词「' + keyword + '」')
    }
  }

  if (cand.clueCount) {
    s += Math.min(5, cand.clueCount * 2)
    reasons.push('已有 ' + cand.clueCount + ' 条线索佐证')
  }

  s = Math.round(s)
  if (s > 99) s = 99
  if (s < 12) s = 12

  var level = 'low'
  if (s >= 70) level = 'high'
  else if (s >= 45) level = 'mid'

  return { score: s, reasons: reasons.slice(0, 4), level: level }
}

function matchList(base, candidates, keyword, minScore) {
  if (!base) return []
  var targetType = base.type === 'lost' ? 'found' : 'lost'
  var out = []
  candidates.forEach(function (c) {
    if (c.type !== targetType) return
    if (c.status && c.status !== STATUS.OPEN) return
    if (base.id && c.id === base.id) return
    var r = score(base, c, keyword)
    if (r.score < (minScore || 0)) return
    out.push({ item: c, score: r.score, reasons: r.reasons, level: r.level })
  })
  out.sort(function (a, b) { return b.score - a.score })
  return out
}

function clueScore(item, clueText) {
  var s = Math.round(similarity(clueText, itemText(item)) * 100)
  return s > 99 ? 99 : s
}

module.exports = { similarity, score, matchList, clueScore }
