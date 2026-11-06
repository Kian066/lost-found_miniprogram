# AI 功能交接文档

> 给接下来负责 AI 部分的队友。读完这篇你应该能直接上手，不需要先翻全项目。

## 0. 一句话现状

**链路、降级、界面都做完了，但真模型一次都没跑过。** 现在点「AI 帮我填」走的是本地词典规则，返回 `degraded: true`。你的任务是把真模型接上并验证。

## 1. 已经能用的部分

| 已完成 | 说明 |
|---|---|
| 独立 `ai` 云函数 | 与业务主入口 `api` 分离，失败不会连累发布 |
| 接口契约 | 入参/出参/错误码固定，见 §4 |
| Provider 抽象 | `rule`（词典）与 `llm`（OpenAI 兼容）二选一，按环境变量切换 |
| 规则兜底 | 没配 key 也能出建议，发布页可直接演示 |
| 发布页卡片 | 展示建议、标注降级、只填补空字段 |
| 降级策略 | 模型失败返回 503，客户端提示后可继续手填 |
| 单测 | `scripts/test-ai-rule.js` 24 项，覆盖词典与边界 |

## 2. 你的任务清单（按优先级）

| # | 任务 | 说明 |
|---|---|---|
| 1 | **把 `ai` 函数超时改成 20 秒** | 云开发控制台 → 云函数 → ai → 配置。默认 3 秒会把模型请求掐断，这是最容易漏的一步 |
| 2 | 配环境变量并跑通一次真模型 | `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` |
| 3 | 验证图片识别 | 选一张图 → 点「AI 帮我填」→ `imageCount` 应为 1，建议里应体现图片内容 |
| 4 | 补 `scripts/test-ai-llm.js` | 用 mock HTTP 测 `providers/llm.js` 的解析与容错，不要依赖真网络 |
| 5 | 建评测集 | 20 组「文本/图片 → 期望字段」，人工核对准确率 |
| 6 | 加限流与成本控制 | 至少限制单用户调用频率，避免刷爆额度 |
| 7 | 模型输出容错 | 当前是直接 `JSON.parse`，模型偶尔会带 markdown 代码块或多说一句话 |

## 3. 代码地图

```
cloudfunctions/ai/
├── index.js              入口：参数校验、provider 选择、图片转链接、错误映射
├── dict.js               类别/地点/颜色/品牌/特征词，规则匹配用
└── providers/
    ├── rule.js           词典匹配（无网络，毫秒级）
    └── llm.js            OpenAI 兼容协议，Node 原生 https，无第三方依赖
```

客户端：

```
utils/cloud.js            callFn('ai', data) —— 通用云函数调用（call() 是走 api 的）
utils/store.js            aiExtract({ text, fileIds, category, place })
pages/publish/publish.js  runAi / applyAi / closeAi
pages/publish/publish.wxml 顶部「AI 辅助填写」卡片
```

## 4. 接口契约

### 入参

```js
{
  text?: string,        // 已填写的描述，≤500 字
  fileIds?: string[],   // 云存储 fileID（cloud:// 开头），≤3 个
  category?: string,    // 用户已选类别，仅作参考
  place?: string        // 用户已选地点，仅作参考
}
```

### 成功

```js
{
  ok: true,
  data: {
    suggestions: {
      title: string,        // ≤20 字
      category: string,     // 必须落在 dict.CATEGORIES 内
      place: string,        // 必须落在 dict.PLACES 内
      color: string,
      brand: string,
      features: string[],   // ≤6 个短词
      desc: string          // ≤200 字
    },
    source: 'rule' | 'llm',
    model: string,          // llm 时是模型名
    degraded: boolean,      // true = 没用上模型
    note: string,           // 'RULE_FALLBACK' 或空
    imageCount: number
  }
}
```

### 失败

```js
{ ok: false, msg: string, code: number }
```

| code | 含义 |
|---|---|
| 400 | 既没文字也没图片，或文字超过 500 字 |
| 503 | 模型不可用（超时 / 报错 / 输出不是 JSON） |

**硬约束**：`category` / `place` 必须能从 `dict.js` 的白名单里找到，编造的值会被 `normalizeSuggestions` 丢弃。新增类别前先同步 `utils/store.js` 的 `CATEGORIES`。

## 5. 接入真模型（三步）

### ① 配环境变量

云开发控制台 → 云函数 → `ai` → 配置 → 环境变量：

| 变量 | 示例 |
|---|---|
| `AI_API_KEY` | `sk-xxxx` |
| `AI_BASE_URL` | `https://api.openai.com/v1` 或厂商兼容地址 |
| `AI_MODEL` | 文字：任意；**图片：必须多模态**（qwen-vl-max / glm-4v / doubao-vision 等） |

### ② 把超时改成 20 秒

同上位置，「超时时间」改为 `20`。

### ③ 验证

进发布页写一段描述 → 点「AI 帮我填」，返回的 `source` 应为 `llm`、`degraded` 应为 `false`。

## 6. 怎么调试

**单独调用云函数**（不用点界面）：开发者工具控制台粘贴

```js
wx.cloud.callFunction({
  name: 'ai',
  data: { text: '在图书馆丢了一个黑色钱包，里面有校园卡' }
}).then(r => console.log(r.result))
```

**看日志**：云开发控制台 → 云函数 → ai → 日志。`index.js` 在 provider 失败时会打 `[ai] provider 调用失败:`。

**跑规则单测**（不需要云环境）：

```bash
node scripts/test-ai-rule.js
```

**判断是不是旧包**：改了客户端代码后必须 `cli close` → `open` → `auto` 重新编译，`cli open` 对已打开的项目是空操作。详见 `docs/architecture.md` §13.9。

## 7. 评测建议

准备一个 `tests/ai-samples.json`（仓库里还没有，你来建）：

```json
[
  { "text": "在图书馆三楼丢了一个黑色皮质钱包，里面有校园卡",
    "expect": { "category": "证件卡包", "place": "图书馆", "color": "黑色" } }
]
```

然后写 `scripts/eval-ai.js`：逐条调用 provider，统计每个字段的命中率。

建议指标：`category` 命中率 ≥ 80%、`place` ≥ 70%、`features` 至少命中一个 ≥ 70%。达不到先调 prompt，再考虑换模型。

## 8. 已知坑

| 坑 | 说明 |
|---|---|
| **超时 3 秒** | 平台默认值，不改成 20 秒模型请求必被掐断 |
| **模型返回不是纯 JSON** | 常见于在 ```` ```json ```` 代码块里返回。建议先剥代码块再解析，解析失败把原文记日志 |
| **图片用不了** | 大概率是选了纯文本模型；或不支持 `image_url` 字段 |
| **imageCount 为 0** | `fileIds` 必须是 `cloud://` 开头的云存储 ID；客户端本地临时路径传过来会被过滤 |
| **类别对不上** | 模型输出「卡类」「证件」这类词会被丢弃，需要在 prompt 里明确列出可选值 |
| **成本** | 最多 3 张图 + 500 字已做限制，但没有按用户限流，注意额度 |
| **隐私** | 只发物品描述和图片；**绝对不要**把 `contact`、认领的 `proofText` 发给模型 |

## 9. 验收标准

- [ ] 配好 key 后，`source === 'llm'`、`degraded === false`
- [ ] 图片识别返回 `imageCount === 1`，建议里体现图片内容
- [ ] 模型超时/报错时返回 503，发布页提示但不阻塞发布
- [ ] `node scripts/test-ai-llm.js` 通过（mock 网络）
- [ ] 评测集上 `category` 命中率 ≥ 80%
- [ ] `ai` 函数超时已改为 20 秒

## 10. 不要做的事

- ❌ **不要**把 API Key 写进代码或提交到仓库，只能放云函数环境变量
- ❌ **不要**把 AI 逻辑塞进 `cloudfunctions/api`——它只有 3 秒超时，且模型挂掉会连累整个业务入口
- ❌ **不要**直接改 `cloudfunctions/api/shared/` 下的文件，那些是 `scripts/sync-shared.js` 生成的副本
- ❌ **不要**让 AI 结果自动提交表单，必须由用户点「应用到表单」
- ❌ **不要**在失败时静默降级到规则——用户会困惑「为什么这次结果差这么多」，明确返回 503 更好

## 11. 相关文档

- 架构与分层：[architecture.md](architecture.md)
- AI 设计细节：[architecture.md §14](architecture.md)
- 易错点清单：[architecture.md §13](architecture.md)
