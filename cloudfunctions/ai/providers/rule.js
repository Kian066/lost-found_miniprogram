// 规则兜底 Provider：没有模型 key 时也能给出建议。
// 只做基于词典的匹配，不涉及网络，响应极快。
'use strict'

const DICT = require('../dict')

function lower(s) {
  return String(s || '').toLowerCase()
}

function detectCategory(text) {
  const t = lower(text)
  let best = ''
  let bestHits = 0
  DICT.CATEGORY_RULES.forEach(function (rule) {
    let hits = 0
    rule.words.forEach(function (w) {
      if (t.indexOf(lower(w)) > -1) hits++
    })
    if (hits > bestHits) { bestHits = hits; best = rule.name }
  })
  return bestHits > 0 ? best : ''
}

function detectPlace(text) {
  const t = lower(text)
  let best = ''
  let bestLen = 0
  Object.keys(DICT.PLACE_ALIAS).forEach(function (place) {
    DICT.PLACE_ALIAS[place].forEach(function (alias) {
      if (t.indexOf(lower(alias)) > -1 && alias.length > bestLen) {
        bestLen = alias.length
        best = place
      }
    })
  })
  return best
}

function pickAll(text, list) {
  const t = lower(text)
  const out = []
  list.forEach(function (w) {
    if (t.indexOf(lower(w)) > -1 && out.indexOf(w) === -1) out.push(w)
  })
  return out
}

function guessTitle(text) {
  const t = String(text || '').trim()
  if (!t) return ''
  // 去掉常见的时间/地点前缀，取第一段短句
  const cleaned = t
    .replace(/^(我(今天|昨天|刚才)?(在)?)/, '')
    .replace(/^[^，。,.!?！？]{0,10}(丢了|捡到|捡到了|丢了(一个|一只)|找到了)/, '')
  const head = cleaned.split(/[，。,.!?！？\s]/).filter(Boolean)[0] || t
  return head.slice(0, 20)
}

const ruleProvider = {
  name: 'rule',

  async extract({ text, category, place }) {
    const colors = pickAll(text, DICT.COLORS)
    const brands = pickAll(text, DICT.BRANDS)
    const featWords = pickAll(text, DICT.FEATURE_WORDS)

    const features = []
    colors.forEach(function (c) { if (features.indexOf(c) === -1) features.push(c) })
    featWords.forEach(function (f) { if (features.indexOf(f) === -1) features.push(f) })

    return {
      source: 'rule',
      model: '',
      suggestions: {
        title: guessTitle(text),
        category: detectCategory(text) || category || '',
        place: detectPlace(text) || place || '',
        color: colors[0] || '',
        brand: brands[0] || '',
        features: features.slice(0, 6),
        desc: String(text || '').trim().slice(0, 200)
      }
    }
  }
}

module.exports = { ruleProvider, _internal: { detectCategory, detectPlace, guessTitle } }
