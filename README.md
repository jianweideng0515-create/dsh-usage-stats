# @abcdefu_cja/dsh-usage-stats

DSH Web 的 API 用量统计插件：精确统计 token、请求、完成轮次、活跃天数、缓存命中率、费用估算，并同时拉取 OpenCode 订阅配额与 DeepSeek 官方余额。以独立插件形态挂载（不属于 dsh-web-ui 家族），在设置页左侧导航提供专属「用量统计」Tab。

与启发式估算不同，本插件的 token 计数是**精确**的：直接来自每个请求的 provider `usage` 报告（`inputTokens`/`outputTokens` 与 `cacheReadTokens`/`cacheWriteTokens`），并采用 DSH 自身的 `(turn, step)` 替换语义，最终消息会替换其先前的用量块而不是重复累计。

## 功能

- **用量概览 Tab**
  - 常驻 KPI 区：Token 总量（含费用）、请求数、完成轮次、活跃天数、平均缓存命中率、提供商动态卡（OpenCode 周配额 / DeepSeek 余额）
  - Token 四分色拆分条（输入 / 缓存读 / 缓存写 / 输出）
  - **堆叠柱状趋势图**：按模型分段着色，Y 轴中文单位刻度（万/亿），悬停柱子显示当日明细 tooltip（总用量 / 费用 / 分模型 Top5+其他 / 缓存命中率）
  - 模型明细表（请求数 / token / 费用）
- **模型与缓存 Tab**：模型占比 Donut 图 + 缓存效率诊断（命中率、节省 token、节省比例）
- **余额与配额 Tab**：OpenCode 订阅配额三窗口进度条（滚动 / 每周 / 每月 + 重置倒计时）；DeepSeek 官方余额（金额 / 预计可用天数 / 充值链接跳转官方充值页 / 手动刷新）
- **会话用量面板**：会话页按钮展开当前会话用量（累计 / 最近请求 / 进行中轮次实时消耗）
- 7 / 14 / 30 / 90 天与自定义范围切换；展开时 30s 轮询

## 架构

- **宿主端**：订阅 `session/event`（全局、所有会话），把每次请求折入 `UsageStatsMeter`（token / 请求 / 轮次 / 费用 / 最近请求元数据）。按日（本地时区 `YYYY-MM-DD`）与分模型桶聚合，落盘到 `~/.dsh/dsh-usage-stats.json`（30s 防抖写盘 + flush/dispose 即时写，原子 `tmp + rename`，损坏文件转 `.bak` 重建）。只读路由 `/api/dsh-usage-stats/*` 带 loopback 围栏。余额客户端**并行**拉取全部已检测 provider 的快照（OpenCode `/v1/usage` 配额 + DeepSeek `/user/balance` 金额），各自失败互不影响。
- **浏览器端**：注册设置页左侧导航独立 Tab（官方 `settings.section` 槽，id `usage-stats`；不属于任何家族分组）。也注册会话页用量按钮（`conversation.session.header.utilities` 槽）。

## 安装

独立插件，与 dsh-web-ui 家族及其聚合包无关。

**方式一：npm（发布后）**

```sh
npm i @abcdefu_cja/dsh-usage-stats
dsh plugin --profile web add @abcdefu_cja/dsh-usage-stats
```

**方式二：本地 link（开发）**

```sh
dsh plugin --profile web add link:/path/to/dsh-usage-stats
```

安装后重启 `dsh web`。也可写入个人 DSH 覆盖层 `~/.dsh/config.yaml`（保存即热加载）：

```yaml
- insert:
    - id: usage-stats
      name: '@abcdefu_cja/dsh-usage-stats'
      config:
        enabled: true
        currency: CNY
        balance:
          mode: auto
          refreshMs: 600000
```

所有配置项均可选（默认值见下表）。

## 配置

| Key | 类型 | 默认 | 含义 |
|---|---|---|---|
| `enabled` | `boolean` | `true` | 总开关；关闭后停止事件订阅、落盘与计量 |
| `prices` | `Record<string, ModelPrice>` | 内置 DeepSeek 价目表 | 每百万 token 单价，按模型键（`input` / `cacheRead` / `cacheWrite` / `output`）；用户项覆盖内置表 |
| `defaultPrice` | `ModelPrice` | 无 | 未在 `prices` 中的模型的兜底单价；缺省时未知模型按 0 计价 |
| `currency` | `string` | `CNY` | 费用与余额的显示货币（CNY 显示 ¥，USD 显示 $） |
| `balance.mode` | `'auto' \| 'manual' \| 'off'` | `auto` | `auto` 自动检测全部已知 provider（OpenCode 配额 + DeepSeek 余额）；`manual` 使用固定 `baseUrl`；`off` 关闭余额拉取 |
| `balance.baseUrl` | `string` | 无 | 余额端点基址（`manual` 模式必填） |
| `balance.path` | `string` | `/user/balance` | 追加到 `baseUrl` 的余额路径 |
| `balance.apiKeyEnv` | `string` | `DEEPSEEK_API_KEY` | 存放 provider API key 的环境变量名（优先进程环境变量，其次 `~/.dsh/.credentials.yaml`） |
| `balance.refreshMs` | `number` | `600000` | 余额刷新间隔（毫秒，最小 1000） |

`ModelPrice` 为 `{ input, cacheRead, cacheWrite, output }`，非负数。内置 DeepSeek 价目：`deepseek-chat` `{ input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 }`；`deepseek-reasoner` `{ input: 4, cacheRead: 1, cacheWrite: 4, output: 16 }`（每百万 token，CNY）。

## 余额自动检测

`auto` 模式同时检测以下 provider（内置端点表，profile 无 baseURL 也可推断）：

| provider | 端点 | 展示 |
|---|---|---|
| OpenCode Go（`opencode-go`） | `GET https://opencode.ai/zen/go/v1/usage`，key 环境变量 `OPENCODE_GO_API_KEY` | 订阅配额三窗口（滚动 / 每周 / 每月） |
| DeepSeek（`deepseek`） | `GET https://api.deepseek.com/user/balance`，key 环境变量 `DEEPSEEK_API_KEY` | 金额余额 + 预计可用天数 |

## 导出形态

函数/命名空间插件：`inject` / `Config` / `apply`，无默认导出。宿主端还导出 `USAGE_STATS_METER_KEY`（宿主挂到上下文、路由与余额任务读取的 symbol）与 `USAGE_STATS_SETTINGS_NAMESPACE`。计量、计价、存储、查询与 provider 检测模块均为纯函数并有单元测试。

## 模型体验

### 提示词与工具面

无。插件不注入任何提示片段、不注册任何工具：只消费持久化的 `session/event` 流并暴露只读 HTTP 路由；浏览器卡片经官方 `settings.section` 槽渲染。

### Token 影响

每请求零额外 token。

### KV 缓存影响

无系统提示词贡献，无缓存稳定性影响。

## 已知限制与后续工作

- **费用是估算**：按内置或用户价目表 × provider 上报用量计算，非账单方发票；请以实际账单为准。
- **余额取决于 provider 端点**：DeepSeek 官方余额接口要求有效官方 key（OpenCode 的 key 不被接受）；OpenCode 配额接口可能受 Cloudflare 对非浏览器 UA 的延迟惩罚（已用浏览器 UA + 25s 超时缓解）。
- **历史自启用时起算**：日聚合只记录插件启用后观察到的事件，之前的使用不回填。
- **留存**：`byDay` 保留最近 730 天，`sessions` 保留最近 500 个；更早数据在保存时裁剪。

## 许可

BSD-3-Clause，见 [LICENSE](./LICENSE)。
