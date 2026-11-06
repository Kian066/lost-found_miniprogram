// ai 云函数：把「文字 / 图片」提取成发布表单建议
//
// 契约
//   入参 { text?: string, fileIds?: string[], category?: string, place?: string }
//   成功 { ok:true, data:{ suggestions, source, model, degraded, note, imageCount } }
//   失败 { ok:false, msg, code }  —— 400 参数不合法 / 503 模型不可用
//
// 降级策略
//   未配置 AI_API_KEY → 用规则 provider（degraded:true, note:RULE_FALLBACK），
//     保证没有 key 时功能依然可用；
//   模型调用失败/超时 → 返回 503，客户端提示「AI 暂不可用，请手填」，
//     绝不阻塞发布。
'use strict'
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { ruleProvider } = require('./providers/rule')
const { createLlmProvider } = require('./providers/llm')

const TEXT_MAX = 500
const IMAGE_MAX = 3

/**
 * 生产配置必须由云函数环境变量提供，不能把 API Key / Base URL / Model 硬编码进仓库。
 * 这样既避免泄露密钥，也避免开发者误用过期默认值。
 * 仅当 AI_API_KEY + AI_BASE_URL + AI_MODEL 全都存在时，才调用外部模型；
 * 否则统一走规则兜底，保证「AI 帮我填」功能可用但不假装连到模型。
 */
const DEFAULT_CONFIG = {
  AI_BASE_URL: '',
  AI_API_KEY: '',
  AI_MODEL: ''
}

function ok(data) { return { ok: true, data: data } }
function fail(msg, code) { return { ok: false, msg: msg, code: code } }

/** 选择 provider：仅当环境变量齐全时调用外部模型，否则统一走规则兜底 */
function pickProvider() {
  const key = String((process.env.AI_API_KEY || DEFAULT_CONFIG.AI_API_KEY) || '').trim()
  const base = String((process.env.AI_BASE_URL || DEFAULT_CONFIG.AI_BASE_URL) || '').trim()
  const model = String((process.env.AI_MODEL || DEFAULT_CONFIG.AI_MODEL) || '').trim()

  console.log('[ai] provider check', {
    hasKey: !!key,
    hasBase: !!base,
    hasModel: !!model,
    base: base ? base.replace(/(^.*?)(\/api\/v3)?$/, '$1/api/v3') : '',
    model: model || '(empty)'
  })

  if (key && base && model) {
    return { provider: createLlmProvider({ key: key, base: base, model: model }), degraded: false, note: '' }
  }

  console.warn('[ai] 模型配置未就绪，使用规则兜底。请在云函数环境变量中配置 AI_API_KEY / AI_BASE_URL / AI_MODEL。')
  return { provider: ruleProvider, degraded: true, note: 'RULE_FALLBACK' }
}

/** fileID → https 临时链接（云函数有管理员权限，不受存储 ACL 影响） */
async function toImageUrls(fileIds) {
  if (!fileIds.length) return []
  try {
    const r = await cloud.getTempFileURL({ fileList: fileIds })
    return (r.fileList || []).map(function (f) { return f.tempFileURL }).filter(Boolean)
  } catch (e) {
    console.warn('[ai] 图片转链接失败:', e && e.message)
    return []
  }
}

exports.main = async (event) => {
  const text = String((event && event.text) || '').trim()
  const fileIds = (Array.isArray(event && event.fileIds) ? event.fileIds : [])
    .filter(function (f) { return typeof f === 'string' && f.indexOf('cloud://') === 0 })
    .slice(0, IMAGE_MAX)

  if (!text && !fileIds.length) return fail('请先输入物品描述或选择图片', 400)
  if (text.length > TEXT_MAX) return fail('描述最多 ' + TEXT_MAX + ' 个字', 400)

  const imageUrls = await toImageUrls(fileIds)
  const picked = pickProvider()

  try {
    const out = await picked.provider.extract({
      text: text,
      imageUrls: imageUrls,
      category: String((event && event.category) || ''),
      place: String((event && event.place) || '')
    })

    return ok({
      suggestions: out.suggestions,
      source: out.source || picked.provider.name,
      model: out.model || '',
      degraded: picked.degraded,
      note: picked.note,
      imageCount: imageUrls.length
    })
  } catch (e) {
    console.error('[ai] provider 调用失败:', {
      message: e && e.message,
      stack: e && e.stack,
      base: process.env.AI_BASE_URL || DEFAULT_CONFIG.AI_BASE_URL,
      model: process.env.AI_MODEL || DEFAULT_CONFIG.AI_MODEL,
      hasKey: !!(process.env.AI_API_KEY || DEFAULT_CONFIG.AI_API_KEY)
    })
    return fail('AI 暂时不可用，请手动填写', 503)
  }
}
