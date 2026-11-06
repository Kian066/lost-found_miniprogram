// utils/match.js —— 线索 / 失物 匹配算法
const util = require('./util')

/** 只保留中文、字母、数字 */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^一-龥a-z0-9]/g, '')
}

/** 生成 1~2 字（字符）集合，用于中文文本的粗粒度相似度 */
function grams(s) {
  var t = norm(s)
  var set = {}
  for (var i = 0; i < t.length; i++) {
    set[t[i]] = 1
    if (i + 1 < t.length) set[t.slice(i, i + 2)] = 1
  }
  return set
}

/** 两段文本的相似度 0~1（双向覆盖率平均） */
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

/** 两个特征数组的交集 */
function commonFeatures(a, b) {
  var out = []
  var list = a || []
  var other = b || []
  list.forEach(function (x) {
    other.forEach(function (y) {
      if (x === y) { out.push(x); return }
      if (norm(x) && norm(y) && (norm(x).indexOf(norm(y)) > -1 || norm(y).indexOf(norm(x)) > -1)) {
        if (out.indexOf(x) === -1) out.push(x)
      }
    })
  })
  return out
}

function itemText(item) {
  return [item.title, item.desc, (item.features || []).join(''), item.place, item.category].join(' ')
}

/**
 * 计算 base 与 cand 的匹配度
 * @param {Object} base 基准登记（或手填的检索条件）
 * @param {Object} cand 候选登记
 * @param {String} keyword 额外关键词（可空）
 * @returns {{score:Number, reasons:Array, level:String}}
 */
function score(base, cand, keyword) {
  var s = 0
  var reasons = []

  // 1. 类目一致 30
  if (base.category === cand.category) {
    s += 30
    reasons.push('同类目 · ' + base.category)
  }

  // 2. 标题 / 描述特征吻合 30
  var titleSim = similarity(base.title, cand.title)
  var descSim = similarity(
    (base.desc || '') + (base.features || []).join(''),
    (cand.desc || '') + (cand.features || []).join('')
  )
  var textSim = Math.max(titleSim, titleSim * 0.6 + descSim * 0.4)
  s += Math.round(textSim * 30)
  if (textSim >= 0.2) reasons.push('特征吻合度 ' + Math.round(textSim * 100) + '%')

  // 3. 地点接近 20
  var placeSim = similarity(base.place, cand.place)
  s += Math.round(placeSim * 20)
  if (placeSim >= 0.2) reasons.push('地点接近 · ' + cand.place)

  // 4. 时间接近 15
  var d = util.dayDiff(base.time, cand.time)
  if (d <= 1) { s += 15; reasons.push('时间仅相差 ' + d + ' 天') }
  else if (d <= 3) { s += 12; reasons.push('时间相差 ' + d + ' 天') }
  else if (d <= 7) { s += 8; reasons.push('时间相差 ' + d + ' 天') }
  else if (d <= 15) { s += 3 }

  // 5. 特征标签直接重合 10
  var cf = commonFeatures(base.features, cand.features)
  if (cf.length) {
    s += Math.min(10, cf.length * 5)
    reasons.push('特征一致：' + cf.slice(0, 2).join('、'))
  }

  // 6. 关键词命中 10
  if (keyword) {
    var kwSim = similarity(keyword, itemText(cand))
    if (kwSim > 0) {
      s += Math.round(Math.min(1, kwSim * 2) * 10)
      reasons.push('命中关键词「' + keyword + '」')
    }
  }

  // 7. 线索佐证：候选物品已有线索时小幅加分
  if (cand.clues && cand.clues.length) {
    s += Math.min(5, cand.clues.length * 2)
    reasons.push('已有 ' + cand.clues.length + ' 条线索佐证')
  }

  s = Math.round(s)
  if (s > 99) s = 99
  if (s < 12) s = 12

  var level = 'low'
  if (s >= 70) level = 'high'
  else if (s >= 45) level = 'mid'

  return { score: s, reasons: reasons.slice(0, 4), level: level }
}

/**
 * 在候选列表中为 base 找到互补类型的匹配结果
 * @param {Object} base 基准（type: lost -> 找 found；type: found -> 找 lost）
 * @param {Array} candidates 候选列表
 * @param {String} keyword 关键词
 * @param {Number} minScore 最低展示分
 */
function matchList(base, candidates, keyword, minScore) {
  if (!base) return []
  var targetType = base.type === 'lost' ? 'found' : 'lost'
  var out = []
  candidates.forEach(function (c) {
    if (c.type !== targetType) return
    if (c.status === 'closed') return
    if (base.id && c.id === base.id) return
    var r = score(base, c, keyword)
    if (r.score < (minScore || 0)) return
    out.push({ item: c, score: r.score, reasons: r.reasons, level: r.level })
  })
  out.sort(function (a, b) { return b.score - a.score })
  return out
}

/** 某条登记在全库中的最高匹配分（用于广场列表角标） */
function bestScore(item, all) {
  var res = matchList(item, all, '', 0)
  return res.length ? res[0].score : 0
}

/** 线索与登记的相关度（用于线索排序） */
function clueScore(item, clueText) {
  var sim = similarity(clueText, itemText(item))
  var s = Math.round(sim * 100)
  if (s > 99) s = 99
  return s
}

module.exports = {
  similarity: similarity,
  score: score,
  matchList: matchList,
  bestScore: bestScore,
  clueScore: clueScore
}
