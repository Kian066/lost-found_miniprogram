#!/usr/bin/env node
/**
 * AI 规则兜底 provider 单测（无网络、无云环境）。
 * 没有模型 key 时，发布页的「AI 帮我填」走的就是这套逻辑。
 *
 * 用法：node scripts/test-ai-rule.js
 */
'use strict'

const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const { ruleProvider, _internal } = require(path.join(ROOT, 'cloudfunctions/ai/providers/rule.js'))
const DICT = require(path.join(ROOT, 'cloudfunctions/ai/dict.js'))

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; return }
  fail++
  console.error('  × ' + name + (detail ? '   [' + detail + ']' : ''))
}

;(async () => {
  console.log('AI · 规则兜底')

  // 类别识别
  ok('「校园卡」→ 证件卡包', _internal.detectCategory('在图书馆丢了校园卡') === '证件卡包', _internal.detectCategory('在图书馆丢了校园卡'))
  ok('「蓝牙耳机」→ 电子设备', _internal.detectCategory('蓝牙耳机落在食堂了') === '电子设备')
  ok('「课本」→ 书籍文具', _internal.detectCategory('一本高等数学课本') === '书籍文具')
  ok('「钥匙」→ 钥匙饰品', _internal.detectCategory('一串钥匙掉了') === '钥匙饰品')
  ok('无关文本不误判', _internal.detectCategory('今天天气不错') === '')

  // 地点识别
  ok('「一教」→ 第一教学楼', _internal.detectPlace('在一教丢的') === '第一教学楼', _internal.detectPlace('在一教丢的'))
  ok('「食堂」→ 食堂', _internal.detectPlace('在食堂三楼') === '食堂')
  ok('「图书馆」→ 图书馆', _internal.detectPlace('图书馆三楼靠窗') === '图书馆')
  ok('无地点返回空', _internal.detectPlace('不知道在哪') === '')

  // 标题
  const t1 = _internal.guessTitle('我在图书馆丢了一个黑色的钱包，里面有校园卡')
  ok('标题非空且不超过 20 字', !!t1 && t1.length <= 20, t1)

  // 完整提取
  const r = await ruleProvider.extract({
    text: '今天在图书馆三楼丢了一个黑色的皮质钱包，里面有校园卡，表面有划痕',
    imageUrls: []
  })
  ok('返回 source=rule', r.source === 'rule')
  ok('类别命中证件卡包', r.suggestions.category === '证件卡包', r.suggestions.category)
  ok('地点命中图书馆', r.suggestions.place === '图书馆', r.suggestions.place)
  ok('颜色命中黑色', r.suggestions.color === '黑色', r.suggestions.color)
  ok('特征包含划痕', r.suggestions.features.indexOf('划痕') > -1, JSON.stringify(r.suggestions.features))
  ok('特征不超过 6 个', r.suggestions.features.length <= 6, 'n=' + r.suggestions.features.length)
  ok('描述被保留', r.suggestions.desc.indexOf('钱包') > -1)

  // 品牌
  const b = await ruleProvider.extract({ text: '丢了一个 iPhone 13，蓝色' })
  ok('品牌命中 iphone', /iphone/i.test(b.suggestions.brand), b.suggestions.brand)

  // 已选类别/地点作为兜底
  const c = await ruleProvider.extract({ text: '不知道是什么', category: '生活用品', place: '食堂' })
  ok('无匹配时沿用已选类别', c.suggestions.category === '生活用品', c.suggestions.category)
  ok('无匹配时沿用已选地点', c.suggestions.place === '食堂', c.suggestions.place)

  // 空文本
  const e = await ruleProvider.extract({ text: '' })
  ok('空文本不报错', !!e.suggestions)
  ok('空文本建议为空', !e.suggestions.title && e.suggestions.features.length === 0)

  // 词典一致性：类别必须落在小程序端的类别表里
  const CATS = ['证件卡包', '电子设备', '书籍文具', '衣物箱包', '钥匙饰品', '生活用品', '其他']
  ok('词典类别与前端一致', JSON.stringify(DICT.CATEGORIES) === JSON.stringify(CATS), JSON.stringify(DICT.CATEGORIES))
  ok('所有规则的类别名都在表内', DICT.CATEGORY_RULES.every((r2) => CATS.indexOf(r2.name) > -1))

  console.log('')
  console.log(`通过 ${pass} 项，失败 ${fail} 项`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
