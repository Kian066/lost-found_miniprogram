# 架构说明

> 本文描述**当前实际生效**的结构（P0 重构后）。历史方案见项目外部的 `campus-lost-found/` 目录，与本文无关。

## 1. 一张图

```
小程序页面（pages/*）
      │
      ▼
utils/store.js          数据层门面：本地模式 / 云模式自动切换
      │
      ▼
utils/cloud.js          cloud.callFunction 封装：name → action，错误码透传
      │
      ▼  wx.cloud.callFunction
┌───────────────────────────────────────────────┐
│ cloudfunctions/api        （唯一业务入口）      │
│                                               │
│  index.js     取 openid / 装配 ctx / 统一收错  │
│      ↓                                        │
│  router.js    action → handler                │
│      ↓                                        │
│  handlers/    入参整理，不写业务                │
│      ↓                                        │
│  services/    业务规则：状态机、权限、校验       │
│      ↓                                        │
│  repos/       数据访问：拼 where、读写集合       │
│      ↓                                        │
│  云数据库 / 云存储 / 云调用                     │
└───────────────────────────────────────────────┘
      │  依赖
      ▼
shared/   领域层（纯函数，前后端共用）
```

## 2. 目录职责

| 路径 | 职责 | 允许依赖 |
|---|---|---|
| `shared/` | 领域规则：状态机、权限、校验、评分、错误码、常量 | 只依赖自己 |
| `scripts/` | 质量门禁：共享同步、架构检查、领域单测 | 无 |
| `cloudfunctions/api/index.js` | 入口：取身份、装配依赖、统一捕获异常 | 本函数全部 |
| `cloudfunctions/api/router.js` | `action → handler` 映射，唯一注册点 | handlers |
| `cloudfunctions/api/composition.js` | 唯一装配点：db/cloud → repos → services | repos、services |
| `cloudfunctions/api/handlers/` | 接口层：整理入参、调 service、组装返回 | services、shared |
| `cloudfunctions/api/services/` | 用例层：业务规则编排，**不直接碰 db** | shared、注入的 repo |
| `cloudfunctions/api/repos/` | 数据访问：SQL/where 拼接、集合读写 | shared |
| `cloudfunctions/api/shared/` | `shared/` 的生成副本（勿改） | — |
| `utils/` | 小程序端工具：`store` 数据门面、`cloud` 调用封装、`match` 本地评分 | 小程序 API |

## 3. 分层规则（由脚本强制）

```
shared  ←  services  ←  handlers
   ↑
 repos （只依赖 shared）
```

| 层 | 可以依赖 | 禁止 |
|---|---|---|
| `shared` | 自己 | `wx-server-sdk`、`wx.*`、任何 IO |
| `services` | `shared`、注入的 repo | 直接 `require` repos；`wx-server-sdk` |
| `handlers` | `shared`、`services` | `repos` |
| `repos` | `shared` | `services`、`handlers` |
| 入口三件套 | 本函数内全部 | 跨云函数依赖 |

检查命令：

```bash
node scripts/check-architecture.js
```

违规会连文件名一起打印，退出码 1。**新增代码前先跑一遍**。

## 4. 一次调用的链路（以 `itemList` 为例）

```
pages/home/home.js
  → store.getItems()
  → cloudapi.call('itemList', {...})
  → wx.cloud.callFunction({ name: 'api', data: {..., action: 'itemList'} })

api/index.js
  → 从 getWXContext() 取 OPENID
  → buildServices({ db, cloud })          // composition.js 装配
  → routes['itemList'](ctx, event)

handlers/item.list
  → 整理参数，调 ctx.services.item.list(...)

services/itemService.list
  → 校验 size / keyword 长度
  → 决定 publicOnly 还是 ownerOpenid
  → itemRepo.search(query)

repos/itemRepo.search
  → 拼 where（状态、类型、类别、关键词正则）
  → 字段白名单投影（剔除 openid / clientToken）
  → count + get 并行

返回 { total, page, size, hasMore, list }
```

## 5. 领域层

### 5.1 信息状态

```
open ──claimAccept──→ processing ──claimComplete──→ resolved
 │                        │
 │                        └──claimCancel──→ open
 ├──ownerClose──→ closed ──ownerReopen──→ open
 ├──ownerResolve──→ resolved
 └──archive(30d)──→ archived
```

> **申请认领本身不改变信息状态**。招领在 `open` 期间可以有多人同时申请，
> 只有拾取者接受某一份后，信息才转 `processing`。

| 状态 | 含义 | 可重开 |
|---|---|---|
| `open` | 寻找中 / 待认领 | — |
| `processing` | 已有人申请，交接中 | 取消后回 `open` |
| `resolved` | 已找回 / 已归还 | ❌ |
| `closed` | 主动关闭 / 被下架 | ✅ |
| `archived` | 超期归档 | ❌ |

**规则出处只有一处**：`shared/state.js` 的 `ITEM_ACTIONS`。业务代码里禁止再写 `status === 'open'` 这类字面量。

### 5.2 认领状态

```
PENDING ──accept──→ ACCEPTED ──complete──→ COMPLETED
   │                    └──────cancel────→ CANCELLED
   ├──reject──→ REJECTED
   └──cancel──→ CANCELLED
```

### 5.3 权限矩阵

| 角色 | 完整联系方式 | proof | 编辑 | 申请认领 | 接受/拒绝 | 提交线索 | 举报 |
|---|---|---|---|---|---|---|---|
| 访客 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 他人 | ❌ | ❌ | ❌ | ✅(FOUND) | ❌ | ✅(LOST) | ✅ |
| 本人 | ✅ | ✅ | ✅(open) | ❌ | ✅ | ❌ | ❌ |
| 申请人(待处理) | ❌ | ❌ | ❌ | ❌ | ❌ | — | ✅ |
| 申请人(已接受) | ✅ | ✅ | ❌ | ❌ | ❌ | — | ✅ |
| 管理员 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

规则出处：`shared/permissions.js`。前端用它决定按钮显隐，云端用它做最终拒绝——**同一份代码**，不会出现「按钮能点、后端 403」。

## 6. 部署单元

| 云函数 | 作用 | 说明 |
|---|---|---|
| `api` | 全部业务读写 | 16 个 action |
| `ai` | AI 辅助填写 | provider 可替换；**超时需手动改为 20 秒** |
| `timerArchive` | 定时归档 | 需触发器，必须独立 |

仓库与云端都只有这三个。早期 9 个「一动作一函数」的实现已全部删除（源码在 git 历史里，需要时 `git checkout 7b9f117^ -- cloudfunctions/<name>` 可找回）。

**叶函数约束（实测结论）**：云函数互相调用时 `getWXContext().OPENID` 为空，`SOURCE` 会追加 `scf`。因此若拆分 `ai` / `notify` 等叶函数：

```js
const source = cloud.getWXContext().SOURCE || ''
if (source.split(',').indexOf('scf') === -1) return fail('禁止直接调用', 403)
// 身份必须由调用方显式传入，并且自己再校验资源归属
```

## 7. 数据模型

| 集合 | 关键字段 |
|---|---|
| `items` | `openid, type, title, category, place, time, desc, features[], images[], contact, author, status, visible, version, clueCount, clientToken, createdAt, updatedAt` |
| `clues` | `itemId, openid, content, contact, author, createdAt` |
| `users` | `_id(=openid), openid, nickName, avatarUrl, sid, college, contact, role, credit` |
| `claims` | 已建空集合，P1 使用 |
| `reports` | 已建空集合，P4 使用 |

建议索引：`items(status,visible,type,createdAt)`、`items(openid,createdAt)`、`clues(itemId,createdAt)`、`clues(openid,createdAt)`。

### 配图地址怎么变成 HTTPS

落库的是云存储 `fileID`（`cloud://...`），详情接口返回前由云函数批量换成带签名的临时链接：

```js
// repos/fileRepo.js → services/itemService.detail
const urlMap = await fileRepo.toTempUrls(item.images)
images = item.images.map(f => urlMap[f] || f)
```

**必须在服务端做**：云函数调用 `getTempFileURL` 具有管理员权限，不受云存储「仅创建者可读写」这类 ACL 限制；客户端自己调则会报 `STORAGE_EXCEED_AUTHORITY`，别人的配图永远看不到。这样也省掉了修改存储权限的费用。

## 8. 接口契约

### 8.1 action 一览

| 域 | action |
|---|---|
| 信息 | `itemCreate` `itemList` `itemDetail` `itemUpdate` `itemRemove` |
| 线索 | `clueCreate` |
| 认领 | `claimCreate` `claimAction` `claimList` `claimDetail` |
| 举报 | `reportCreate` |
| 管理 | `adminBootstrap` `adminItems` `adminSetVisible` `adminReports` `adminHandleReport` |
| 匹配 | `matchQuery` |
| 用户 | `userLogin` `userData` |
| 统计 | `statOverview` |

`claimAction` 的动词放在 `op` 字段：`accept` / `reject` / `cancel` / `complete`。

### 8.2 返回信封

```js
{ ok: true, data: any }
{ ok: false, msg: string, code: number }
```

### 8.3 错误码

| code | 含义 |
|---|---|
| 400 | 参数不合法 |
| 401 | 未登录 |
| 403 | 无权限 |
| 404 | 不存在 |
| 409 | 状态冲突 / 版本冲突 |
| 429 | 操作过于频繁 |
| 500 | 服务异常 |

### 8.4 路由键约束

**`action` 是保留字段**，只用于路由，不能当子动词用：

```js
// ✗ 会被路由层吃掉
data: { action: 'itemUpdate', patch: {...}, action: 'delete' }
// ✓ 拆成独立 action
data: { action: 'itemRemove', id }
// ✓ 需要子模式时换个字段名
data: { action: 'userLogin', mode: 'update' }
```

## 9. 共享代码机制

云函数**按目录独立打包**，`require('../shared/xx')` 在云端找不到文件，所以共享代码是「单一源 + 物理复制」：

```bash
node scripts/sync-shared.js    # 把 shared/ 复制到引用过 ./shared/ 的云函数
node scripts/check-shared.js   # 校验副本是否过期（退出码 0/1）
```

只有出现 `require('./shared/...')` 的函数才会生成 `shared/` 目录，其余不受影响。副本文件头带「自动生成，请勿直接修改」标记。

## 10. 质量门禁

| 脚本 | 作用 |
|---|---|
| `node scripts/test-domain.js` | 领域层单测（65 项：状态机 + 权限矩阵） |
| `node scripts/test-claim-service.js` | 认领业务规则（24 项，假 repo） |
| `node scripts/test-admin-service.js` | 管理端规则（25 项，假 repo） |
| `node scripts/test-ai-rule.js` | AI 规则兜底（24 项，纯函数） |
| `node scripts/check-architecture.js` | 分层依赖检查 |
| `node scripts/check-shared.js` | 共享副本一致性 |
| `node scripts/sync-shared.js` | 同步共享副本 |

建议装成 git 钩子：

```bash
printf '#!/bin/sh\nnode scripts/check-shared.js && node scripts/check-architecture.js\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## 11. 已知限制 / 待办

| 项 | 说明 |
|---|---|
| **AI 未接入真模型** | `providers/llm.js` 只写了代码，从未真实调用；图片识别、超时、评测集、限流均未验证。见 [AI 交接文档](handover-ai.md) |
| `ai` 函数超时 | 仍是默认 3 秒，接模型前必须改为 20 秒，否则请求会被平台掐断 |
| 云存储权限 | **已绕过**：`getTempFileURL` 改在云函数里执行（管理员权限），无需修改存储 ACL |
| 前后端评分算法 | `utils/match.js`（前端，服务本地演示）与 `shared/match.js`（云端）仍是两份，改算法要两边同步 |
| 本地模式 | 认领 / 举报 / 管理端 / AI 只做云端；本地模式只能浏览演示数据 |

## 12. 实施阶段（P0–P5）

补齐旧版设计中的缺失功能，按依赖关系分六期。**每期结束小程序都能正常演示**，不允许出现「改到一半不能用」。

| 阶段 | 目标 | 主要交付物 | 状态 |
|---|---|---|---|
| **P0** 骨架 | 收敛部署单元、建立分层与领域层、迁移存量数据 | `cloudfunctions/api`（四层）、`shared/`（6 模块）、`check-architecture.js`、`test-domain.js`、`closed → resolved` 迁移 | ✅ 完成 |
| **P1** 认领后端 | 认领申请的状态机与事务 | `claims` 集合、`claimCreate/claimAction/claimList/claimDetail`、`claimUow` 事务层、`test-claim-service.js` | ✅ 完成 |
| **P2** 认领页面 | 让认领流程可演示 | `pages/claim/{apply,list,detail}`、详情页按钮分流、mine 页入口 | ✅ 完成 |
| **P3** 规则修正 | 把「有接口没规则」的地方补齐 | 线索限制 ✅、删除时清理云文件 ✅、编辑 `expectedVersion` 乐观锁 ✅、举报提交 ✅ | ✅ 完成 |
| **P4** 管理端 | 下架、举报处理、全量列表 | `admin` 权限（`users.role`）、`adminItems` / `adminSetVisible` / `adminReports` / `adminHandleReport`、隐藏页 `pages/admin` | ✅ 完成 |
| **P5** AI 辅助 | 发布页「AI 帮我填」 | 独立 `ai` 云函数、规则兜底 provider、模型适配层、发布页建议卡片 | ⚠️ **部分完成**：链路与降级可用，真模型未接入验证 |

### 各期要点

**P0 · 骨架**

把 10 个「一动作一云函数」收敛成单个 `api`，客户端只改 `cloud.js` 一处。目的是让共享代码、跨表事务、统一鉴权有地方落脚。

- 依赖关系：无前置，但要先跑通事务与上下文探针
- 关键结论：云函数互调**不透传 openid**，`SOURCE` 会追加 `scf`；事务内 `where()` 可用

**P1 · 认领后端**

- 状态约定：**申请不改信息状态**，多人可同时申请；接受才转 `processing`
- 事务边界：`claimUow` 同时改 `claims` 与 `items`
- 并发约束：同一人同一登记只保留一个活动申请；同一登记最多一个 `ACCEPTED`

**P2 · 认领页面**

- 按钮可见性由 `shared/permissions.js` 的规则驱动，前端只负责渲染
- 私密说明：发布者与申请人都能看到，管理员不可见

**P3 · 规则修正**

- 线索限制：只能给「他人 + 进行中 + 寻物启事」提交
- 文件清理：删除登记时同步删云存储配图
- 乐观锁：`itemUpdate` 接受 `expectedVersion`，不一致返回 409；不传时保持向后兼容
- 举报：`reportCreate`，登录用户、非本人、同一登记只能报一次；处理归 P4

**P4 · 管理端**

- 形态：小程序内隐藏页 `pages/admin`，入口只在「我的」页对 `role=ADMIN` 显示
- 权限：`adminService` 每个方法先 `requireAdmin`；前端隐藏只是体验，真正的拒绝在服务端
- 引导：`adminBootstrap` 仅在**系统内还没有任何管理员**时可用，一次性把当前账号设为管理员；之后永久失效，避免成为后门
- 下架：`visible=false`；进行中的信息转 `closed`；已接受的认领一并取消（避免交接悬空）
- 恢复：只恢复可见性，**不复活已关闭的状态**
- 举报处理：只改举报状态（`HANDLED` / `IGNORED`），不自动下架——下架是独立动作

**P5 · AI 辅助（部分完成）**

已完成：

- 独立 `ai` 云函数：模型调用可能超时，不能和 3 秒的业务入口混在一起
- Provider 可替换：`providers/rule.js`（词典匹配，永远可用）与 `providers/llm.js`（OpenAI 兼容）
- 选了哪个由环境变量决定：配了 `AI_API_KEY` + `AI_BASE_URL` 走模型，否则走规则
- 规则兜底让功能在**没有 key 时也能演示**，返回 `degraded:true, note:RULE_FALLBACK`
- 模型失败 → 503，客户端提示「AI 暂不可用，请手动填写」，**绝不阻塞发布**
- 建议只填补空字段，不覆盖用户已写的内容

**未完成（接 AI 的队友收尾）：**

- `providers/llm.js` **从未真实调用过**，只有代码和契约
- 图片识别路径未验证（目前只验证了 fileID → https 的转换）
- `ai` 函数超时未改成 20 秒
- 没有评测集 / 准确率基线 / 调用限流 / 成本控制
- 模型输出是直接 `JSON.parse`，没有容错与重试

具体交接见 [handover-ai.md](handover-ai.md)。

### 依赖与顺序

```
P0 ──→ P1 ──→ P2
       │
       └──→ P3（可与 P2 并行）
                │
                ├──→ P4
                └──→ P5
```

P0→P1→P2 是强依赖链；P3 只依赖 P1 的领域模型；P4、P5 相互独立，可最后做。

### 质量门禁（每期都要过）

```bash
node scripts/check-architecture.js    # 分层依赖
node scripts/check-shared.js          # 共享副本一致性
node scripts/test-domain.js           # 状态机 + 权限
node scripts/test-claim-service.js    # 认领业务规则
node scripts/test-admin-service.js    # 管理端规则
```

再加一轮 automator 集成验证：改动的 action 用真实云函数跑通，改动页面截图确认。

## 13. 易错点与约定

以下每一条都是**实际踩过坑**之后总结的，不是理论推演。改相关代码前先扫一眼。

### 13.1 `action` 是保留字段，不能当子动词

路由键就是 `event.action`。如果调用方在 payload 里再传一个 `action`，合并时会把它覆盖掉，路由直接失配。

```js
// ✗ 删除动词会被路由层吃掉，表现为「点了没反应」
{ action: 'itemUpdate', id, action: 'delete' }

// ✓ 拆成独立 action
{ action: 'itemRemove', id }

// ✓ 需要子模式时换个字段名
{ action: 'userLogin', mode: 'update' }
{ action: 'claimAction', claimId, op: 'accept' }
```

项目里已经因此踩过两次（`itemUpdate` 的 delete、`userLogin` 的 update）。**新增带子动作的接口，一律另起字段名。**

### 13.2 `relationOf` 与 `relationForClaim` 是两回事

| 函数 | 语义 | 用在哪 |
|---|---|---|
| `relationOf` | 以「是否有**活动**申请」判断 | 信息详情、按钮显隐 |
| `relationForClaim` | 以「是不是**这条**申请的人」判断 | 申请详情、申请动作 |

混用的后果很隐蔽：

- 用 `relationOf` 做申请详情 → 申请人看不到自己**已取消 / 已完成**的申请，页面空白（403）
- 用 `relationOf` 做申请动作 → 重复取消返回 403「无权」，正确语义是 409「状态不允许」

**凡是「针对某一条申请」的判定，都用 `relationForClaim`。** 同一个坑踩过两次才收敛，别再犯第三次。

### 13.3 更新之后不要再读本地对象的字段

`tx.updateClaim(id, patch)` 之后，回调里的 `claim` 变量可能仍是旧值（真实数据库返回副本），也可能是新值（假对象被就地修改）。依赖它等于依赖实现细节。

```js
// ✗ 若 update 就地改了对象，这里的判断永远为 false
await tx.updateClaim(id, { status: 'CANCELLED' })
if (claim.status === 'ACCEPTED') { /* 回滚信息状态 */ }

// ✓ 先记住原状态
const wasAccepted = claim.status === 'ACCEPTED'
await tx.updateClaim(id, { status: 'CANCELLED' })
if (wasAccepted) { /* ... */ }
```

写假 repo 时也要返回**副本**，否则测试会掩盖这类问题。

### 13.4 云函数互调拿不到 openid

实测：A 调 B 时，B 的 `getWXContext().OPENID` 是**空字符串**，`SOURCE` 会追加 `scf`。

```js
const source = cloud.getWXContext().SOURCE || ''
if (source.split(',').indexOf('scf') === -1) return fail('禁止直接调用', 403)
// 身份由调用方显式传入，且自己再校验一次资源归属
```

### 13.5 云存储 fileID 必须在服务端签名

客户端直接 `getTempFileURL` 会受存储 ACL 限制（`STORAGE_EXCEED_AUTHORITY`），别人的配图永远出不来。云函数有管理员权限，必须在服务端换成 HTTPS 链接再下发。

### 13.6 状态字面量禁止散落

判断状态一律从 `shared/state.js` 取，不许写 `status === 'open'`。当初状态拆分（`closed → resolved`）时要改 20 处，就是因为字面量散落各处。

### 13.7 事务不跨云函数

`claimUow` 的事务只在 `api` 内部成立。任何「改状态」的逻辑都不能下沉到叶函数——两次独立调用之间挂掉就是中间态。

### 13.8 分层方向不能反

`handlers` 不许 require `repos`，`services` 不许 require `repos` 或 `wx-server-sdk`。依赖由 `composition.js` 注入，这样 service 才能用假 repo 做单测。`scripts/check-architecture.js` 会拦。

### 13.9 改完客户端代码必须「关闭再打开」才重新编译

`cli open --project` 对**已经打开**的项目不会重新编译，跑的还是旧包。表现为：改了页面逻辑却毫无变化，甚至怀疑是业务 bug。

```bash
cli close --project <path>
cli open  --project <path>
cli auto  --project <path> --auto-port 9420   # 关闭后自动化端口也会失效，要重开
```

判断依据：给页面加一个只在错误分支写入的字段，如果它**根本不出现**，说明跑的是旧包，而不是逻辑没走到。

### 13.10 客户端 cloud 调用会静默降级到本地数据

`store.js` 里几乎所有云端调用都写了 `.catch(() => localXxx())`，失败时**不报错、直接返回本地种子数据**。表现是页面看起来正常，但 id 是 `item_xxx` 这种本地格式、数据是旧的。

排查时先看列表 id 的格式，再看 `app.globalData.mode`。为便于定位，`cloud.js` 现在会在未初始化、返回为空、调用失败时打 `console.warn`。

### 13.11 页面的 require 层级容易算错

`pages/claim/apply/apply.js` 在第三层，用 `../../../`；`pages/admin/admin.js` 在第二层，只能用 `../../`。

层级多写了一层，`require` 会在模块加载阶段抛错，**整个页面注册失败**：表现为页面空白、`page.data()` 返回空对象、控制台只有一条 `页面【xxx]错误` 且错误对象是 `{}`，很难看出是路径问题。

判断方法：先把它换成能跑的最简 `Page({data:{ok:1}})`，如果页面就正常了，问题一定出在被注入的模块或路径上。

### 13.12 不要用 PowerShell 文本命令改源码文件

`Get-Content -Raw` + `Set-Content` 在这台机器上会按 GBK 解码 UTF-8，把中文注释和字符串写坏，甚至吃掉换行导致后面的代码被注释掉。曾因此把 `admin.js` 写坏、排查了很久。

改源码一律用编辑工具，不要用 shell 文本管道。


## 14. AI 辅助填写

### 14.1 部署单元

`cloudfunctions/ai` 是独立云函数，不与 `api` 合并：

| 原因 | 说明 |
|---|---|
| 超时不同 | 模型调用可能需要 10~20 秒，`api` 只有 3 秒 |
| 失败隔离 | 模型挂掉不能连累发布、认领等主流程 |
| 配置隔离 | key 只在这个函数的环境变量里 |

> **部署后务必把 `ai` 函数的超时改成 20 秒**（云开发控制台 → 云函数 → ai → 配置）。
> 默认 3 秒时，走模型的请求会被平台直接掐断。

### 14.2 接口契约

```
入参
  text?      string   已填写的描述，≤500 字
  fileIds?   string[] 云存储 fileID，≤3 个
  category?  string   用户已选类别（仅作参考/兜底）
  place?     string   用户已选地点

成功
  { ok:true, data:{
      suggestions: { title, category, place, color, brand, features[], desc },
      source: 'rule' | 'llm',
      model: string,
      degraded: boolean,     // true = 没用上模型
      note: string,          // 'RULE_FALLBACK' 或空
      imageCount: number
  }}

失败
  { ok:false, msg, code }
    400 参数不合法（既无文字也无图片，或文字超长）
    503 模型不可用（超时 / 报错 / 输出不是 JSON）
```

约束：`suggestions.category` 一定落在 `utils/store.js` 的类别表内，`place` 同理；无法确定的字段返回空串或空数组，不编造。

### 14.3 Provider 选择与降级

```
配置了 AI_API_KEY + AI_BASE_URL？
  ├─ 是 → providers/llm.js（OpenAI 兼容协议）
  └─ 否 → providers/rule.js（词典匹配，永远可用）
```

- **规则兜底**：用 `dict.js` 里的类别词、地点别名、颜色、品牌、特征词做匹配，响应毫秒级。没有 key 时功能照样能演示，只是返回 `degraded:true`。
- **模型失败**：不降级到规则、直接返回 503。理由是一次点击只发一次请求，静默换实现会让用户困惑「为什么这次结果差这么多」。
- 客户端拿到的 `degraded` 用于展示「未配置模型，已用规则匹配」。

### 14.4 模型适配层

`providers/llm.js` 用 Node 原生 `https`，不引第三方 SDK，走 OpenAI 兼容的 `/chat/completions`：

| 环境变量 | 作用 |
|---|---|
| `AI_API_KEY` | 密钥 |
| `AI_BASE_URL` | 接口根地址，如 `https://api.xxx.com/v1` |
| `AI_MODEL` | 模型名 |

图片以 `image_url` 形式传入，**必须选多模态模型**（如通义千问 VL、智谱 GLM-4V、豆包视觉版）；纯文本模型会忽略图片。

模型输出会经过 `normalizeSuggestions` 二次校验：类别/地点不在白名单里直接丢弃，长度截断，特征去空并限 6 个。

### 14.5 客户端

- 入口：发布页顶部「✨ AI 帮我填」卡片
- 展示：逐字段列出建议，标出 `degraded` 状态
- 应用：**只填补空字段**，不覆盖用户已写的内容；特征做去重合并，上限 6 个
- 失败：`util.toast` 提示，表单不受影响，可以继续手填

### 14.6 怎么接入真模型

1. 在云开发控制台给 `ai` 函数加环境变量：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`
2. 把 `ai` 函数超时改成 20 秒
3. 重新进入发布页点「AI 帮我填」，返回的 `source` 会变成 `llm`、`degraded` 变成 `false`

不需要改任何代码。
