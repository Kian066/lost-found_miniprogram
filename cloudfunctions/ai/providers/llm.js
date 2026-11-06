// 大模型 Provider（OpenAI 兼容协议，无第三方依赖）
//
// 需要的环境变量（配在 ai 云函数上）：
//   AI_API_KEY   密钥
//   AI_BASE_URL  接口根地址，例如 https://api.xxx.com/v1
//   AI_MODEL     模型名，例如 gpt-4o-mini / qwen-vl-max
//
// 注意：图片识别必须使用多模态模型；纯文本模型会忽略图片。
'use strict'

const https = require('https')
const { URL } = require('url')
const DICT = require('../dict')

const TIMEOUT_MS = 15000

function postJson(urlStr, headers, body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const u = new URL(urlStr)
    const data = JSON.stringify(body)
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }, headers)
    }, function (res) {
      let buf = ''
      res.on('data', function (c) { buf += c })
      res.on('end', function () {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode + ' ' + buf.slice(0, 200)))
          return
        }
        try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('响应不是 JSON')) }
      })
    })
    req.setTimeout(timeoutMs || TIMEOUT_MS, function () { req.destroy(new Error('请求超时')) })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function buildMessages(text, imageUrls, category, place) {
  const system = [
    '你是校园失物招领的填写助手。根据用户提供的描述（可能附带物品照片）提取表单字段。',
    '只输出 JSON，不要任何解释。字段：',
    'title 物品名称(≤20字)；category 必须是以下之一：' + DICT.CATEGORIES.join('、'),
    'place 必须是以下之一：' + DICT.PLACES.join('、'),
    'color 颜色；brand 品牌；features 特征数组(≤6个短词)；desc 整理后的描述(≤200字)。',
    '无法确定的字段一律给空字符串或空数组，不要编造。'
  ].join('\n')

  const userContent = []
  if (text) userContent.push({ type: 'text', text: text })
  imageUrls.forEach(function (u) {
    userContent.push({ type: 'image_url', image_url: { url: u } })
  })
  if (!userContent.length) userContent.push({ type: 'text', text: '（无描述，请仅根据图片判断）' })

  if (category || place) {
    userContent.push({ type: 'text', text: '参考：用户已选类别=' + (category || '未选') + '，地点=' + (place || '未选') })
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userContent }
  ]
}

function normalizeSuggestions(raw) {
  const s = raw || {}
  const pick = function (v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : '' }
  const category = DICT.CATEGORIES.indexOf(pick(s.category, 20)) > -1 ? pick(s.category, 20) : ''
  const place = DICT.PLACES.indexOf(pick(s.place, 20)) > -1 ? pick(s.place, 20) : ''
  const features = Array.isArray(s.features)
    ? s.features.filter(function (x) { return typeof x === 'string' && x.trim() }).slice(0, 6).map(function (x) { return x.trim().slice(0, 12) })
    : []
  return {
    title: pick(s.title, 20),
    category: category,
    place: place,
    color: pick(s.color, 12),
    brand: pick(s.brand, 20),
    features: features,
    desc: pick(s.desc, 200)
  }
}

function createLlmProvider({ key, base, model }) {
  return {
    name: 'llm',

    async extract({ text, imageUrls, category, place }) {
      const url = String(base).replace(/\/+$/, '') + '/chat/completions'
      const res = await postJson(url, { Authorization: 'Bearer ' + key }, {
        model: model || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: buildMessages(text, imageUrls || [], category, place)
      })

      const content = res && res.choices && res.choices[0] && res.choices[0].message
        ? res.choices[0].message.content
        : ''
      if (!content) throw new Error('模型返回为空')

      const parsed = extractJson(content)
      if (!parsed) throw new Error('模型输出不是 JSON')

      return {
        source: 'llm',
        model: (res && res.model) || model || '',
        suggestions: normalizeSuggestions(parsed)
      }
    }
  }
}

/**
 * 容错解析模型输出：剥 markdown 代码块 → 整体 parse → 提取首个 {…} 平衡段。
 * 解决豆包 thinking 模型偶尔在输出里混入思维链 / 代码块导致的解析失败。
 * @returns {Object|null} 解析失败返回 null
 */
function extractJson(content) {
  if (!content) return null
  let s = String(content).trim()
  const block = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)
  if (block) s = block[1].trim()

  try { return JSON.parse(s) } catch (e) { /* 继续尝试提取 */ }

  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '"' && !esc) inStr = false
      esc = c === '\\' && !esc
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    if (depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)) } catch (e) { return null }
    }
  }
  return null
}

module.exports = { createLlmProvider, _internal: { normalizeSuggestions, buildMessages, extractJson } }
