// utils/store.js —— 数据层
// 双模式：local（本地 Storage，开箱即用）/ cloud（云函数，需在 app.js 中切换）
// 对外接口统一返回 Promise，云调用失败自动降级到本地
const util = require('./util')
const cloudapi = require('./cloud')

var ITEMS_KEY = 'clf_items_v1'
var FAV_KEY = 'clf_favs_v1'
var USER_KEY = 'clf_user_v1'

var CATEGORIES = ['证件卡包', '电子设备', '书籍文具', '衣物箱包', '钥匙饰品', '生活用品', '其他']
var PLACES = ['图书馆', '第一教学楼', '第二教学楼', '第三教学楼', '实验楼', '大学生活动中心', '食堂', '体育馆', '操场', '宿舍区', '校门口', '快递站', '超市']
var CAT_EMOJI = {
  '证件卡包': '💳',
  '电子设备': '📱',
  '书籍文具': '📚',
  '衣物箱包': '🎒',
  '钥匙饰品': '🔑',
  '生活用品': '🍵',
  '其他': '📦'
}

var DEFAULT_USER = {
  id: 'u_me',
  name: '李同学',
  sid: '2023210372',
  college: '计算机学院',
  credit: 96
}

// ---------------- 种子数据 ----------------
function seed() {
  var raw = [
    {
      type: 'lost', title: '校园一卡通（蓝色卡面）', category: '证件卡包', place: '图书馆三楼自习区',
      time: util.daysAgo(1), desc: '10月16号下午在图书馆三楼自习区丢失，卡面是蓝色的，卡套上贴了柯基贴纸，里面有 80 多块饭钱。',
      features: ['蓝色卡面', '柯基贴纸', '姓名李思远', '饭卡余额80'], contact: '微信 lsy_3721',
      author: '李同学', mine: true,
      clues: [
        { content: '在三楼靠窗的座位夹缝里看到过一张蓝色卡片，像是卡片掉进桌缝了', contact: '微信 zzz_0912' },
        { content: '图书馆服务台好像收了一张一卡通，可以去问问前台老师', contact: '' }
      ]
    },
    {
      type: 'found', title: '黑色皮质男士钱包', category: '证件卡包', place: '第二教学楼 B205',
      time: util.daysAgo(1), desc: '昨天晚上在二教 B205 第四排抽屉里捡到的，里面有身份证和两张银行卡，没有现金。已交到楼下失物招领箱旁边的值班台。',
      features: ['黑色', '皮质', '内有身份证', '两张银行卡'], contact: '微信 wang_7788',
      author: '王同学', mine: false, clues: []
    },
    {
      type: 'lost', title: 'iPhone 13 深空灰色', category: '电子设备', place: '体育馆篮球场',
      time: util.daysAgo(3), desc: '周三晚上打球时放在场边不见了，深空灰色，套着透明壳，屏幕右上角有一道裂痕，锁屏是我家猫的照片。',
      features: ['深空灰', '透明壳', '屏幕裂痕', '猫锁屏'], contact: '13812345678',
      author: '张同学', mine: false,
      clues: [{ content: '体育馆器材室的失物篮里好像有一台深空灰的手机', contact: '微信 gym_boy' }]
    },
    {
      type: 'found', title: '银色金属 U 盘 32G', category: '电子设备', place: '实验楼 407',
      time: util.daysAgo(5), desc: '在实验楼 407 电脑旁的插座边捡到，银色金属外壳，上面贴着一张蓝色标签纸写着“数据结构”。',
      features: ['银色', '金属', '蓝色标签', '写着数据结构'], contact: '微信 lab_xu',
      author: '徐同学', mine: false, clues: []
    },
    {
      type: 'lost', title: '《高等数学（第七版）》教材', category: '书籍文具', place: '第一教学楼 A101',
      time: util.daysAgo(0), desc: '今天上午高数课后忘在 A101 第三排，书皮是透明塑料包着的，扉页写了名字和班级，里面夹着几张草稿纸，急用！',
      features: ['透明书皮', '扉页有名字', '夹着草稿纸'], contact: '微信 li_math2023',
      author: '李同学', mine: true, clues: []
    },
    {
      type: 'found', title: '蓝色保温杯', category: '生活用品', place: '操场看台',
      time: util.daysAgo(2), desc: '在操场看台第二排捡到一个蓝色保温杯，杯盖有一点磕碰痕迹，杯子底部贴了宿舍号标签。',
      features: ['蓝色', '杯盖磕碰', '底部有宿舍号'], contact: '微信 sport_lin',
      author: '林同学', mine: false, clues: []
    },
    {
      type: 'lost', title: '灰色连帽卫衣', category: '衣物箱包', place: '宿舍区洗衣房',
      time: util.daysAgo(6), desc: '上周送去洗衣房洗，取的时候少了一件灰色连帽卫衣，M 码，帽子抽绳是白色的，左袖口有一小块墨渍。',
      features: ['灰色', 'M码', '白色抽绳', '袖口墨渍'], contact: '微信 hui_0301',
      author: '陈同学', mine: false, clues: []
    },
    {
      type: 'found', title: '一串钥匙（带小熊挂件）', category: '钥匙饰品', place: '食堂二楼',
      time: util.daysAgo(4), desc: '在食堂二楼靠窗的位置捡到一串钥匙，共 3 把，挂着一个棕色小熊挂件，其中一把是宿舍门钥匙。',
      features: ['3把钥匙', '小熊挂件', '棕色', '宿舍钥匙'], contact: '微信 canteen_zhao',
      author: '赵同学', mine: false, clues: []
    },
    {
      type: 'lost', title: '黑色双肩电脑包', category: '衣物箱包', place: '图书馆一楼大厅',
      time: util.daysAgo(8), desc: '黑色双肩包，前面有一个白色小 logo，里面装着一台笔记本电脑和一本《算法导论》，包侧袋有一把折叠伞。',
      features: ['黑色', '白色logo', '内有电脑', '侧袋折叠伞'], contact: '微信 kevin_l',
      author: '刘同学', mine: false, clues: []
    },
    {
      type: 'found', title: '学生证一张', category: '证件卡包', place: '校门口快递站',
      time: util.daysAgo(7), desc: '在快递站取件台捡到一张学生证，姓名陈某，学院是外国语学院，照片那面有折痕。已放在快递站前台。',
      features: ['学生证', '外国语学院', '有折痕'], contact: '微信 express_sun',
      author: '孙同学', mine: false, clues: []
    }
  ]

  return raw.map(function (r, i) {
    var authorId = r.mine ? DEFAULT_USER.id : 'u_' + (i + 10)
    var clues = (r.clues || []).map(function (c) {
      return {
        id: util.genId('clue'),
        content: c.content,
        contact: c.contact || '',
        author: ['热心同学', '匿名同学', '路过的研究生'][i % 3],
        authorId: 'u_other_' + i,
        createdAt: Date.now() - (i + 1) * 3600000 * 5
      }
    })
    return {
      id: util.genId('item'),
      type: r.type,
      title: r.title,
      category: r.category,
      place: r.place,
      time: r.time,
      desc: r.desc,
      features: r.features,
      contact: r.contact,
      images: [],
      author: r.author,
      authorId: authorId,
      status: 'open',
      clues: clues,
      createdAt: Date.now() - i * 3600000 * 7
    }
  })
}

// ---------------- 本地读写 ----------------
function read(key, def) {
  try {
    var v = wx.getStorageSync(key)
    if (v === '' || v === undefined || v === null) return def
    return v
  } catch (e) {
    return def
  }
}

function write(key, val) {
  try {
    wx.setStorageSync(key, val)
  } catch (e) {
    // ignore
  }
}

function init() {
  if (!read(USER_KEY, null)) write(USER_KEY, DEFAULT_USER)
  if (!read(FAV_KEY, null)) write(FAV_KEY, [])
  if (!read(ITEMS_KEY, null)) write(ITEMS_KEY, seed())
}

// ---------------- 运行模式 ----------------
var MODE = 'local'

function setMode(m) {
  MODE = m === 'cloud' ? 'cloud' : 'local'
}

function getMode() {
  return MODE
}

function usingCloud() {
  return MODE === 'cloud' && cloudapi.isReady()
}

// ---------------- 本地实现（私有） ----------------
function localItems() {
  var list = read(ITEMS_KEY, [])
  return Array.isArray(list) ? list : []
}

function localSave(list) {
  write(ITEMS_KEY, list)
}

function localList(opt) {
  opt = opt || {}
  var all = localItems()
  var kw = String(opt.keyword || '').trim()
  var filtered = all.filter(function (i) {
    if (!opt.mine && i.status !== 'open') return false
    if (opt.mine && i.authorId !== getUser().id) return false
    if (opt.type && i.type !== opt.type) return false
    if (opt.category && opt.category !== '全部' && i.category !== opt.category) return false
    if (kw) {
      var text = [i.title, i.desc, (i.features || []).join(''), i.place, i.category, i.author].join(' ')
      if (text.toLowerCase().indexOf(kw.toLowerCase()) === -1) return false
    }
    return true
  })
  filtered.sort(function (a, b) {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    return b.createdAt - a.createdAt
  })
  var size = opt.size || 8
  var page = opt.page || 1
  var list = filtered.slice(0, page * size)
  return { list: list, total: filtered.length, hasMore: list.length < filtered.length }
}

function localAdd(data) {
  var user = getUser()
  var item = {
    id: util.genId('item'),
    type: data.type || 'lost',
    title: data.title || '',
    category: data.category || '其他',
    place: data.place || '',
    time: data.time || util.fmtDate(new Date()),
    desc: data.desc || '',
    features: data.features || [],
    contact: data.contact || '',
    images: data.images || [],
    author: user.name,
    authorId: user.id,
    status: 'open',
    clues: [],
    createdAt: Date.now()
  }
  var list = localItems()
  list.unshift(item)
  localSave(list)
  return item
}

function localUpdate(id, patch) {
  var list = localItems()
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) list[i][k] = patch[k]
      }
      localSave(list)
      return list[i]
    }
  }
  return null
}

function localRemove(id) {
  localSave(localItems().filter(function (i) { return i.id !== id }))
  return true
}

function localAddClue(itemId, content, contact) {
  var list = localItems()
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === itemId) {
      var clue = {
        id: util.genId('clue'),
        content: content,
        contact: contact || '',
        author: getUser().name,
        authorId: getUser().id,
        createdAt: Date.now()
      }
      list[i].clues = list[i].clues || []
      list[i].clues.unshift(clue)
      localSave(list)
      return clue
    }
  }
  return null
}

function localMyItems() {
  var uid = getUser().id
  return localItems().filter(function (i) { return i.authorId === uid })
}

/**
 * 本地全量数据，仅用于本地模式下的匹配角标计算。
 * 云模式下返回空数组（角标由服务端负责），避免把全库下发到客户端。
 */
function getItems() {
  return MODE === 'cloud' ? [] : localItems()
}

function localStats(scope) {
  var all = localItems()
  if (scope === 'mine') {
    var mine = localMyItems()
    var inbox = 0
    var uid = getUser().id
    mine.forEach(function (i) {
      (i.clues || []).forEach(function (c) { if (c.authorId !== uid) inbox++ })
    })
    return {
      publish: mine.length,
      inbox: inbox,
      clue: localMyClues().length,
      solved: mine.filter(function (i) { return i.status === 'closed' }).length
    }
  }
  var s = { lost: 0, found: 0, solved: 0, clue: 0 }
  all.forEach(function (i) {
    if (i.status === 'open') {
      if (i.type === 'lost') s.lost++
      else s.found++
    }
    if (i.status === 'closed') s.solved++
    s.clue += (i.clues || []).length
  })
  return s
}

function localInbox() {
  var uid = getUser().id
  var out = []
  localMyItems().forEach(function (item) {
    (item.clues || []).forEach(function (c) {
      if (c.authorId === uid) return
      out.push({
        id: c.id,
        content: c.content,
        contact: c.contact,
        author: c.author,
        createdAt: c.createdAt,
        itemId: item.id,
        itemTitle: item.title
      })
    })
  })
  out.sort(function (a, b) { return b.createdAt - a.createdAt })
  return out
}

function localMyClues() {
  var uid = getUser().id
  var out = []
  localItems().forEach(function (item) {
    (item.clues || []).forEach(function (c) {
      if (c.authorId !== uid) return
      out.push({
        id: c.id,
        content: c.content,
        contact: c.contact,
        author: c.author,
        createdAt: c.createdAt,
        itemId: item.id,
        itemTitle: item.title
      })
    })
  })
  out.sort(function (a, b) { return b.createdAt - a.createdAt })
  return out
}

// ---------------- 对外接口（统一 Promise） ----------------

/** 用户信息：始终取本地档案，同步返回 */
function getUser() {
  return read(USER_KEY, DEFAULT_USER)
}

function isMine(item) {
  return !!item && item.authorId === getUser().id
}

/**
 * 静默登录：无需用户操作，由云端通过 openid 建立 / 拉取用户档案
 * 云模式下成功后会把档案写入本地 Storage，之后 getUser() 即可同步读取
 * @returns {Promise<Object>} 用户档案
 */
function login() {
  if (!usingCloud()) return Promise.resolve(getUser())
  return cloudapi.call('userLogin', { mode: 'get' }).then(function (d) {
    var u = {
      id: d.openid || getUser().id,
      openid: d.openid || '',
      name: d.name || getUser().name,
      avatar: d.avatar || '',
      sid: d.sid || '',
      college: d.college || '',
      contact: d.contact || '',
      credit: d.credit || 90,
      role: d.role || 'USER'
    }
    write(USER_KEY, u)
    return u
  }).catch(function () {
    // 登录失败不阻塞使用，退回本地档案
    return getUser()
  })
}

/**
 * 更新用户资料：本地立即生效，云模式下同步到云端
 * @param {Object} patch 支持 name / avatar / sid / college / contact
 */
function updateUser(patch) {
  var u = Object.assign({}, getUser(), patch || {})
  write(USER_KEY, u)
  if (usingCloud()) {
    return cloudapi.call('userLogin', {
      mode: 'update',
      patch: {
        nickName: u.name,
        avatarUrl: u.avatar,
        sid: u.sid,
        college: u.college,
        contact: u.contact
      }
    }).then(function () {
      return u
    }).catch(function () {
      return u
    })
  }
  return Promise.resolve(u)
}

/** 广场列表 / 我的发布 */
function listItems(opt) {
  if (usingCloud()) {
    return cloudapi.call('itemList', opt || {}).then(function (d) {
      return { list: d.list || [], total: d.total || 0, hasMore: !!d.hasMore }
    }).catch(function () {
      return localList(opt)
    })
  }
  return Promise.resolve(localList(opt))
}

/** 详情：返回 { item, isMine, contactRevealed, clues, matches } */
function detail(id) {
  if (usingCloud()) {
    return cloudapi.call('itemDetail', { id: id }).then(function (d) {
      var item = d.item || {}
      item.clues = d.clues || []
      return {
        item: item,
        isMine: !!d.isMine,
        contactRevealed: !!d.contactRevealed,
        matches: d.matches || []
      }
    }).catch(function () {
      return localDetail(id)
    })
  }
  return Promise.resolve(localDetail(id))
}

function localDetail(id) {
  var match = require('./match')
  var all = localItems()
  var item = null
  all.forEach(function (i) { if (i.id === id) item = i })
  if (!item) return null
  return {
    item: item,
    isMine: isMine(item),
    contactRevealed: true,
    matches: match.matchList(item, all, '', 15).slice(0, 3).map(function (r) {
      return {
        id: r.item.id,
        title: r.item.title,
        category: r.item.category,
        place: r.item.place,
        time: r.item.time,
        score: r.score,
        level: r.level,
        reasons: r.reasons
      }
    })
  }
}

function addItem(data) {
  if (usingCloud()) {
    return cloudapi.call('itemCreate', {
      clientToken: String(data.clientToken || ''),
      type: data.type,
      title: data.title,
      category: data.category,
      place: data.place,
      time: data.time,
      desc: data.desc,
      features: data.features,
      images: data.images,
      contact: data.contact,
      author: getUser().name
    }).then(function (d) {
      return {
        id: d.id,
        type: data.type,
        title: data.title,
        category: data.category,
        place: data.place,
        time: data.time,
        desc: data.desc,
        features: data.features || [],
        images: data.images || [],
        contact: data.contact,
        author: getUser().name,
        authorId: getUser().id,
        status: 'open',
        clues: [],
        createdAt: d.createdAt || Date.now()
      }
    })
  }
  return Promise.resolve(localAdd(data))
}

function updateItem(id, patch, expectedVersion) {
  if (usingCloud()) {
    var payload = { id: id, patch: patch }
    if (expectedVersion !== undefined) payload.expectedVersion = expectedVersion
    return cloudapi.call('itemUpdate', payload)
  }
  return Promise.resolve(localUpdate(id, patch))
}

function removeItem(id) {
  if (usingCloud()) {
    return cloudapi.call('itemRemove', { id: id })
  }
  return Promise.resolve(localRemove(id))
}

function addClue(itemId, content, contact) {
  if (usingCloud()) {
    return cloudapi.call('clueCreate', {
      itemId: itemId,
      content: content,
      contact: contact,
      author: getUser().name
    })
  }
  return Promise.resolve(localAddClue(itemId, content, contact))
}

/** 我的发布 */
function myItems() {
  if (usingCloud()) {
    return cloudapi.call('userData', {}).then(function (d) {
      return d.publish || []
    }).catch(function () {
      return localMyItems()
    })
  }
  return Promise.resolve(localMyItems())
}

/** 我收到的线索 + 我提供的线索 + 我的统计（一次拿全） */
function myData() {
  if (usingCloud()) {
    return cloudapi.call('userData', {}).catch(function () {
      return {
        publish: localMyItems(),
        inbox: localInbox(),
        clues: localMyClues(),
        stats: localStats('mine')
      }
    })
  }
  return Promise.resolve({
    publish: localMyItems(),
    inbox: localInbox(),
    clues: localMyClues(),
    stats: localStats('mine')
  })
}

/** scope: 'global' 全站概览 | 'mine' 个人统计 */
function stats(scope) {
  if (usingCloud()) {
    if (scope === 'mine') {
      return cloudapi.call('userData', {}).then(function (d) { return d.stats || {} }).catch(function () {
        return localStats('mine')
      })
    }
    return cloudapi.call('statOverview', {}).then(function (d) { return d || {} }).catch(function () {
      return localStats('global')
    })
  }
  return Promise.resolve(localStats(scope))
}

// ---------------- 收藏（本地偏好，始终走 Storage） ----------------
function getFavs() {
  return read(FAV_KEY, [])
}

function isFav(id) {
  return getFavs().indexOf(id) > -1
}

function toggleFav(id) {
  var list = getFavs()
  var idx = list.indexOf(id)
  if (idx > -1) {
    list.splice(idx, 1)
    write(FAV_KEY, list)
    return false
  }
  list.push(id)
  write(FAV_KEY, list)
  return true
}

function favItems() {
  var favs = getFavs()
  if (!favs.length) return Promise.resolve([])
  if (usingCloud()) {
    return cloudapi.call('itemList', { size: 20, page: 1 }).then(function (d) {
      return (d.list || []).filter(function (i) { return favs.indexOf(i.id) > -1 })
    }).catch(function () {
      return localItems().filter(function (i) { return favs.indexOf(i.id) > -1 })
    })
  }
  return Promise.resolve(localItems().filter(function (i) { return favs.indexOf(i.id) > -1 }))
}

/** 恢复演示数据（仅本地模式） */
function resetData() {
  write(ITEMS_KEY, seed())
  write(FAV_KEY, [])
  return true
}

// ---- 认领（仅云模式；本地演示模式不提供认领流程） ----

function createClaim(itemId, proofText, contact) {
  if (usingCloud()) return cloudapi.call('claimCreate', { itemId: itemId, proofText: proofText, contact: contact })
  return Promise.reject(new Error('本地演示模式不支持认领'))
}

function actClaim(claimId, op, extra) {
  if (usingCloud()) return cloudapi.call('claimAction', Object.assign({ claimId: claimId, op: op }, extra || {}))
  return Promise.reject(new Error('本地演示模式不支持认领'))
}

function listClaims(mode) {
  if (usingCloud()) return cloudapi.call('claimList', { mode: mode })
  return Promise.resolve({ mode: mode, list: [] })
}

function claimDetail(claimId) {
  if (usingCloud()) return cloudapi.call('claimDetail', { claimId: claimId })
  return Promise.reject(new Error('本地演示模式不支持认领'))
}

function reportItem(postId, reason) {
  if (usingCloud()) return cloudapi.call('reportCreate', { postId: postId, reason: reason })
  return Promise.reject(new Error('本地演示模式不支持举报'))
}

/**
 * AI 辅助填写：调用独立的 ai 云函数。
 * 没有配置模型 key 时云端会退化为规则提取（degraded=true），功能仍可用。
 * @param {Object} p
 * @param {string} [p.text] 已填写的描述
 * @param {string[]} [p.fileIds] 云存储图片 fileID
 * @param {string} [p.category]
 * @param {string} [p.place]
 */
function aiExtract(p) {
  if (!usingCloud()) return Promise.reject(new Error('本地演示模式不支持 AI 辅助'))
  return cloudapi.callFn('ai', {
    text: (p && p.text) || '',
    fileIds: (p && p.fileIds) || [],
    category: (p && p.category) || '',
    place: (p && p.place) || ''
  })
}

/** 是否管理员（由云端 userLogin 返回的 role 决定，前端只用来控制入口显隐） */
function isAdmin() {
  return (getUser().role || 'USER') === 'ADMIN'
}

// ---- 管理端 ----

function adminBootstrap(confirm) {
  if (usingCloud()) return cloudapi.call('adminBootstrap', { confirm: confirm })
  return Promise.reject(new Error('本地演示模式不支持管理端'))
}

function adminItems(opt) {
  if (usingCloud()) return cloudapi.call('adminItems', opt || {})
  return Promise.reject(new Error('本地演示模式不支持管理端'))
}

function adminSetVisible(id, visible) {
  if (usingCloud()) return cloudapi.call('adminSetVisible', { id: id, visible: !!visible })
  return Promise.reject(new Error('本地演示模式不支持管理端'))
}

function adminReports(status) {
  if (usingCloud()) return cloudapi.call('adminReports', { status: status || '' })
  return Promise.reject(new Error('本地演示模式不支持管理端'))
}

function adminHandleReport(id, op, result) {
  if (usingCloud()) return cloudapi.call('adminHandleReport', { id: id, op: op, result: result || '' })
  return Promise.reject(new Error('本地演示模式不支持管理端'))
}

module.exports = {
  CATEGORIES: CATEGORIES,
  PLACES: PLACES,
  CAT_EMOJI: CAT_EMOJI,
  setMode: setMode,
  getMode: getMode,
  usingCloud: usingCloud,
  init: init,
  getUser: getUser,
  login: login,
  updateUser: updateUser,
  isMine: isMine,
  getItems: getItems,
  listItems: listItems,
  detail: detail,
  addItem: addItem,
  updateItem: updateItem,
  removeItem: removeItem,
  addClue: addClue,
  createClaim: createClaim,
  actClaim: actClaim,
  listClaims: listClaims,
  claimDetail: claimDetail,
  reportItem: reportItem,
  aiExtract: aiExtract,
  isAdmin: isAdmin,
  adminBootstrap: adminBootstrap,
  adminItems: adminItems,
  adminSetVisible: adminSetVisible,
  adminReports: adminReports,
  adminHandleReport: adminHandleReport,
  myItems: myItems,
  myData: myData,
  stats: stats,
  getFavs: getFavs,
  isFav: isFav,
  toggleFav: toggleFav,
  favItems: favItems,
  resetData: resetData
}
