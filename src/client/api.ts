/** 与宿主 /summary 响应对应的 JSON 形状（浏览器端独立声明，不依赖宿主包）。 */
export interface SummaryTokens {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  total: number
}

export interface SeriesPoint {
  bucket: string
  requests: number
  tokens: number
  cost: number
  hitRate: number
  /** 桶内按模型拆分的 token 用量（tokens 降序，供堆叠柱状图与 tooltip）。 */
  byModel: Array<{ model: string; tokens: number }>
}

export interface ModelSummary {
  model: string
  requests: number
  tokens: number
  cost: number
}

export interface PerSession {
  sessionId: string
  workspace: string | null
  turns: number
  requests: number
  cost: number
  /** 会话级 token 分项（会话页用量展示）。 */
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  lastRequestAt: string | null
  lastModel: string | null
  lastRequestCost: number | null
  lastRequestHitRate: number | null
  /** 最近一次有 usage 的请求的 token 合计。 */
  lastRequestTokens: number | null
  /** 最近一轮对话（一次发送信息触发的完整 turn）的消耗合计。 */
  lastTurnTokens: number | null
  lastTurnCost: number | null
  /** 当前进行中一轮的实时消耗；无进行中轮为 null。 */
  currentTurn: { tokens: number; cost: number } | null
}

export interface SummaryResponse {
  from: string
  to: string
  requests: number
  turns: number
  tokens: SummaryTokens
  cost: number
  activeDays: number
  avgCacheHitRate: number
  topModel: string | null
  uncountedRequests: number
  byModel: ModelSummary[]
  series: SeriesPoint[]
  perSession: PerSession | null
  /** 日费用阈值提醒（配置 alertDailyCost 后出现；未配置为 undefined）。 */
  dailyAlert?: { threshold: number; todayCost: number } | null
}

export interface QuotaWindow {
  percent: number
  resetsAt: string | null
}

export interface UsageQuota {
  rolling: QuotaWindow | null
  weekly: QuotaWindow | null
  monthly: QuotaWindow | null
}

export interface BalanceResponse {
  balance: number | null
  currency: string
  updatedAt: string | null
  error: string | null
  source: { baseUrl: string; path: string; apiKeyEnv: string; source: string } | null
  /** OpenCode 等订阅制配额；金额型（DeepSeek）为 null。 */
  quota: UsageQuota | null
  /** 费用计价货币（插件设置 currency；CNY 显示 ¥，USD 显示 $）。 */
  costCurrency: string
}

/** 每个范围最近一次的 ETag（条件请求：无变化时服务端返回 304）。 */
const summaryEtags = new Map<string, string>()

/** 拉取区间汇总（不带 sessionId）；304（相对上次未变化）返回 null，调用方保留现有数据。 */
export async function fetchSummary(from: string, to: string, signal?: AbortSignal): Promise<SummaryResponse | null> {
  const key = `${from}|${to}`
  const headers: Record<string, string> = {}
  const known = summaryEtags.get(key)
  if (known !== undefined) headers['if-none-match'] = known
  const url = `/api/dsh-usage-stats/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const response = await fetch(url, { signal, headers })
  if (response.status === 304) return null
  if (!response.ok) throw new Error(`summary HTTP ${response.status}`)
  const etag = response.headers.get('etag')
  if (etag !== null && etag !== '') summaryEtags.set(key, etag)
  return response.json() as Promise<SummaryResponse>
}

/** 拉取指定会话的用量明细（会话页用量面板用；区间字段无意义，取今日兜底）。 */
export async function fetchSessionUsage(sessionId: string, signal?: AbortSignal): Promise<PerSession | null> {
  const url = `/api/dsh-usage-stats/summary?sessionId=${encodeURIComponent(sessionId)}`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`session usage HTTP ${response.status}`)
  const body = await response.json() as SummaryResponse
  return body.perSession
}

/** 多 provider 余额/配额快照表（key 为 provider id，如 opencode-go / deepseek）。 */
export type BalanceMap = Record<string, BalanceResponse>

/** 拉取全部 provider 的余额/配额快照（host 定时刷新，此处只读）。 */
export async function fetchBalance(signal?: AbortSignal): Promise<BalanceMap> {
  const response = await fetch('/api/dsh-usage-stats/balance', { signal })
  if (!response.ok) throw new Error(`balance HTTP ${response.status}`)
  const body = await response.json() as { providers: BalanceMap }
  return body.providers
}

/** 手动触发一次全量余额/配额刷新并返回新快照表。 */
export async function refreshBalance(): Promise<BalanceMap> {
  const response = await fetch('/api/dsh-usage-stats/balance/refresh', { method: 'POST' })
  if (!response.ok) throw new Error(`refresh HTTP ${response.status}`)
  const body = await response.json() as { providers: BalanceMap }
  return body.providers
}

/** 最贵会话排行行（按费用降序）。 */
export interface TopSessionRow {
  sessionId: string
  workspace: string | null
  turns: number
  requests: number
  cost: number
  lastRequestAt: string | null
}

/** 拉取最贵会话排行（按费用降序，默认 Top 10）。 */
export async function fetchTopSessions(limit = 10, signal?: AbortSignal): Promise<TopSessionRow[]> {
  const response = await fetch(`/api/dsh-usage-stats/top-sessions?limit=${limit}`, { signal })
  if (!response.ok) throw new Error(`top-sessions HTTP ${response.status}`)
  return response.json() as Promise<TopSessionRow[]>
}
