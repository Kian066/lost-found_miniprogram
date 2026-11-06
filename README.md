# 校园失物招领小程序

基于微信小程序云开发（Serverless）的校园失物招领 / 寻物启事平台，支持**登记发布、线索提交、智能匹配、联系撮合**。

> 架构、分层规则、状态机与接口契约见 **[架构说明](docs/architecture.md)**。改代码前建议先读一遍，尤其是「分层规则」和「接口契约」两节。
>
> 分阶段实施计划（P0–P5 完成度与依赖关系）见 **[架构说明 §12](docs/architecture.md#12-实施阶段p0p5)**。

## 已完成功能

| 模块 | 页面 | 说明 |
| --- | --- | --- |
| 广场 | `pages/home` | 全部 / 寻物 / 招领切换、类目筛选、关键词搜索、下拉刷新、触底分页（每页 8 条） |
| 发布 | `pages/publish` | 表单校验、类目 / 地点选择、时间选择、特征标签（≤6 个）、图片上传（≤6 张） |
| 线索匹配 | `pages/match` | 四维度打分（类目 / 特征 / 地点 / 时间），输出 Top 20 候选并支持复制联系方式 |
| 详情 | `pages/detail` | 图片预览、提交线索、收藏、复制联系方式、标记已解决 / 重新开启 / 删除、Top 3 推荐 |
| 申请认领 | `pages/claim/apply` | 私密特征说明 + 交接联系方式，仅双方可见 |
| 认领列表 | `pages/claim/list` | 我发出的 / 我收到的，带状态标签 |
| 认领详情 | `pages/claim/detail` | 核验说明、接受、拒绝、取消交接、确认归还 |
| 管理后台 | `pages/admin` | 信息管理（下架/恢复）、举报处理；仅 `role=ADMIN` 可见 |
| AI 辅助 | `pages/publish` | 「✨ AI 帮我填」：按描述/图片提取名称、类别、地点、特征；未配模型 key 时走词典规则兜底（**模型部分待接入验证**） |
| 我的发布 | `pages/mylist` | 四种视图：`我的发布` / `收到线索` / `我的线索` / `我的收藏` |
| 我的 | `pages/mine` | 个人统计、菜单入口、重置演示数据 |

## 目录结构

```
├── app.js                  # 入口，USE_CLOUD 开关在此
├── app.json                # 全局配置（含 tabBar）
├── pages/                  # 10 个页面（含认领 3 页、管理后台）
├── components/item-card/   # 物品卡片组件
├── utils/
│   ├── store.js            # 数据层：本地 / 云端双模式，自动降级
│   ├── cloud.js            # 云函数调用封装（统一走 api，另有 callFn 调 ai）
│   ├── match.js            # 前端匹配打分（本地演示模式用）
│   └── util.js             # 相对时间、脱敏等工具
├── shared/                 # 领域层：状态机 / 权限 / 错误码 / 评分（前后端共用）
├── scripts/                # 质量门禁：共享同步、架构检查、四套单测
├── docs/
│   ├── architecture.md     # 架构说明（分层 / 状态机 / 契约 / 实施阶段）
│   └── handover-ai.md      # AI 功能交接文档
└── cloudfunctions/
    ├── api/                # 业务主入口（index → router → handlers → services → repos）
    ├── ai/                 # AI 辅助填写（provider 可替换）
    └── timerArchive/       # 定时归档（触发器独占）
```

## 运行模式

由 `utils/store.js` 自动切换，当前项目默认跑**云模式**：

- **云模式（当前默认）**：数据来自云数据库，读写走云函数 `api`。`app.js` 的 `USE_CLOUD = true`。
- **本地模式（降级兜底）**：云环境不可用时自动退回，数据来自 `utils/store.js` 内置的 10 条种子数据，读写走 `wx.setStorageSync`。**认领、举报、管理端、AI 在本地模式不可用**，会明确提示「本地演示模式不支持」。

## 接入云开发（上云步骤）

### 1. 开通环境与填 ID

1. 微信开发者工具 → 工具栏「云开发」→ 开通，创建环境。
2. 把环境 ID 填入 `utils/cloud.js:6`：

   ```js
   var ENV_ID = 'campus-lf-xxxxxxxx'   // 改成你的环境 ID
   ```

3. 把 `app.js:6` 的开关打开：

   ```js
   var USE_CLOUD = true
   ```

### 2. 创建数据库集合

云开发控制台 → 数据库 → 新建 5 个集合：

| 集合 | 用途 | 主要字段 |
| --- | --- | --- |
| `items` | 失物 / 招领登记 | `openid, type(lost\|found), title, category, place, time, desc, features[], images[], contact, author, status, visible, version, acceptedClaimId, clueCount, createdAt, updatedAt` |
| `clues` | 线索留言 | `itemId, openid, content, contact, author, createdAt` |
| `users` | 用户档案 | `_id(=openid), openid, nickName, avatarUrl, sid, college, contact, role(USER\|ADMIN), credit` |
| `claims` | 认领申请 | `postId, applicantOpenid, applicantName, proofText, applicantContact, finderContact, status(PENDING\|ACCEPTED\|REJECTED\|CANCELLED\|COMPLETED), reason` |
| `reports` | 举报 | `postId, reporterOpenid, reason, status(PENDING\|HANDLED\|IGNORED), result, handledAt` |

**权限建议**：所有读写都经过云函数（云函数使用管理员权限），因此集合权限设为**「仅管理端可读写」**即可，客户端无法直接篡改数据。

**建议索引**（数据量上来后必加）：

- `items`：`status + visible + type + createdAt`（复合，主列表）、`openid + createdAt`、`activeClaimId`
- `clues`：`itemId + createdAt`、`openid`
- `claims`：`postId + status`、`applicantOpenid + createdAt`
- `reports`：`status + createdAt`、`postId`

### 3. 部署云函数

在开发者工具里，右键 `cloudfunctions/` 下每个目录 → **「上传并部署：云端安装依赖」**，共 3 个：

| 云函数 | 作用 | 注意事项 |
| --- | --- | --- |
| `api` | 全部业务读写（信息 / 线索 / 认领 / 举报 / 管理端 / 统计） | 主入口，`action` 路由 |
| `ai` | AI 辅助填写 | **超时需改为 20 秒**；可选配模型环境变量 |
| `timerArchive` | 定时器：每天 02:00 归档 30 天未解决的登记 | 需上传触发器配置 |

> `timerArchive` 依赖目录下的 `config.json`（已配好 `0 0 2 * * * *`）。上传部署后，在云开发控制台「云函数 → timerArchive → 触发管理」确认定时器已生效。

> `ai` 默认超时 3 秒，走模型时会被掐断。云开发控制台 → 云函数 → ai → 配置 → 超时时间改为 **20 秒**。

### 4.（可选）订阅消息

`api` 的 `clueCreate` 动作会在有人提交线索时通知发布者，需要：

1. 小程序后台 → 订阅消息 → 选用模板（3 个字段：物品名称 / 线索内容 / 时间）。
2. 把模板 ID 配到云函数 **`api`** 的环境变量 `CLUE_TEMPLATE_ID`。

未配置时会静默跳过，不影响主流程。

### 5.（可选）AI 模型

配了才走真模型，不配则用词典规则兜底：

| 环境变量 | 说明 |
| --- | --- |
| `AI_API_KEY` | 模型密钥 |
| `AI_BASE_URL` | OpenAI 兼容接口根地址，如 `https://api.xxx.com/v1` |
| `AI_MODEL` | 模型名，图片识别需多模态模型 |

详见 [AI 交接文档](docs/handover-ai.md)。

## 云函数一览

云端只有三个函数：`api`、`ai`、`timerArchive`。业务接口全部收敛在 `api` 里，通过 `action` 分发；接口清单与契约见 [架构说明 §8](docs/architecture.md)。

统一返回协议：`{ ok: boolean, data?: any, msg?: string, code?: number }`。

错误码：`400` 参数 / `401` 未登录 / `403` 无权 / `404` 不存在 / `409` 状态或版本冲突 / `429` 太频繁 / `503` 依赖不可用。

- **鉴权**：`OPENID` 由 `cloud.getWXContext()` 从微信侧获取，不接受客户端传入；所有写操作都会校验记录归属，越权返回 403。
- **管理员**：`users.role === 'ADMIN'`，`adminService` 每个方法先 `requireAdmin`；管理员也看不到原始联系方式与私密证明。
- **内容安全**：发布、线索、认领说明、举报原因都会调用 `security.msgSecCheck`，接口不可用时放行以保证可用性，`errCode 87014` 返回友好提示。
- **脱敏**：联系方式只对「本人」和「认领申请已被接受的人」完整下发，管理员同样打码。
- **昵称同步**：用户修改昵称后，`userLogin` 会把其历史 `items` / `clues` 上的 `author` 批量刷新；联系方式保持发布时快照，不做全局覆盖。
- **幂等**：发布带 `clientToken`，认领按「同一人同一登记只保留一个活动申请」，举报按「同一人同一条只能报一次」。
- **乐观锁**：`itemUpdate` 接受 `expectedVersion`，不一致返回 409。

## 云函数共享代码

微信云函数**每个目录独立打包上传**，`require('../shared/xx')` 在云端找不到文件。所以共享代码采用「单一源 + 物理复制」：

```
shared/                        ← 唯一源，只改这里
├── constants.js               集合名、状态、业务上限
├── respond.js                 ok() / fail() 统一返回
└── match.js                   匹配算法（云端唯一一份）
scripts/
├── sync-shared.js             复制到各云函数
└── check-shared.js            检查副本是否过期
```

云函数里这样引用（副本由脚本生成）：

```js
const { COLLECTIONS, STATUS } = require('./shared/constants')
const { ok, fail } = require('./shared/respond')
const match = require('./shared/match')
```

**改完共享代码必须同步，否则部署上去的是旧逻辑：**

```bash
node scripts/sync-shared.js     # 同步（幂等，可反复执行）
node scripts/check-shared.js    # 校验，退出码 0=一致 1=有漂移
```

规则：

- 只有代码里出现 `require('./shared/...')` 的云函数才会生成 `shared/` 目录，其余函数不受影响；
- 副本文件头带「自动生成，请勿直接修改」标记，**改副本会在下次同步时被覆盖**；
- `scripts/check-shared.js` 能同时抓两种漂移：改了源文件没同步、改了副本没改源文件。

可选：装成 git 钩子，提交前自动拦截。

```bash
printf '#!/bin/sh\nnode scripts/check-shared.js\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

## 已知待办 / 注意事项

- [x] **用户身份**：静默登录，`api` 的 `userLogin` 动作基于 openid 建立/读取档案，支持头像、昵称、学号、学院、默认联系方式，存于 `users` 集合。头像经云存储持久化；仅本地演示模式使用写死的 `DEFAULT_USER` 档案。
- [x] **发布图片**：`publish` 提交前把本地临时图片并发上传到云存储 `items/` 目录，落库的是 `fileID`；详情页用 `getTempFileURL` 转 HTTPS 临时链接后再渲染与预览。部分图片上传失败会弹窗询问，可继续发布。本地模式不上传，仍用临时路径。
- [x] **单一后端入口**：10 个业务云函数已合并为 `cloudfunctions/api`，客户端 `cloud.js` 统一以 `action` 路由，页面代码无需感知。
- [x] **联系方式泄漏**：列表接口不再下发 `openid` / `clientToken`，`contact` 仅「我的发布」场景返回。
- [x] **云存储权限**：`getTempFileURL` 已改在云函数内执行（管理员权限），绕过「仅创建者可读」的 ACL 限制，无需付费修改存储权限即可让所有人看到配图。
- [x] **旧云函数下线**：9 个旧函数（`itemCreate` / `itemList` / `itemDetail` / `itemUpdate` / `clueCreate` / `userData` / `userLogin` / `matchQuery` / `statOverview`）的仓库目录与云端实例均已删除，云端只保留 `api` / `ai` / `timerArchive`。
- [ ] **收藏功能**：云模式下通过拉取列表再前端过滤实现，数据量大后不稳定，建议单独建 `favorites` 集合。
- [x] **代码重复（云端）**：`matchQuery` 与 `itemDetail` 各自的 `match.js` 副本已合并为 `shared/match.js`，云端现在只有一份算法。
- [x] **编辑乐观锁**：`itemUpdate` 接受 `expectedVersion`，版本不一致返回 409；详情页改状态时会带上读取时的版本。
- [x] **举报**：`reportCreate` 已实现（登录用户、非本人、同一登记只能举报一次）；处理举报在管理端。
- [x] **管理端**：小程序内隐藏页 `pages/admin`，支持全量列表、下架/恢复、举报处理；权限由 `users.role=ADMIN` 判定，首次可通过「成为管理员」引导开通（系统已有管理员后自动失效）。
- [ ] **AI 辅助（未完全完成）**：链路、降级、UI 已就绪，但**真模型尚未接入验证**——没有 key，`providers/llm.js` 从未真实调用过；图片识别未验证；`ai` 函数超时未调成 20 秒；没有评测集与限流。交接见 [AI 交接文档](docs/handover-ai.md)。
- [ ] **代码重复（前后端）**：`utils/match.js`（前端，服务本地演示模式，多一个 `bestScore`）与 `shared/match.js`（云端）仍是两份独立实现，调整评分规则时两边都要改。
- [ ] `mylist` 页面暂无分页，数据量增长后需要补上。

## 本地开发

1. 用微信开发者工具导入项目根目录（`appid` 已在 `project.config.json` 中配置）。
2. 无需任何配置即可预览 —— 默认跑本地演示数据。
3. 「我的」页面底部有「恢复演示数据」，可随时重置本地数据。
