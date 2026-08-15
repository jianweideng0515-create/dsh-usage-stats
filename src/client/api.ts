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

/** 拉取区间汇总（不带 sessionId：纯区间总量，perSession 恒 null）。 */
export async function fetchSummary(from: string, to: string, signal?: AbortSignal): Promise<SummaryResponse> {
  const url = `/api/dsh-usage-stats/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`summary HTTP ${response.status}`)
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

export async function fetchBalance(signal?: AbortSignal): Promise<BalanceResponse> {
  const response = await fetch('/api/dsh-usage-stats/balance', { signal })
  if (!response.ok) throw new Error(`balance HTTP ${response.status}`)
  return response.json() as Promise<BalanceResponse>
}

export async function refreshBalance(): Promise<BalanceResponse> {
  const response = await fetch('/api/dsh-usage-stats/balance/refresh', { method: 'POST' })
  if (!response.ok) throw new Error(`refresh HTTP ${response.status}`)
  return response.json() as Promise<BalanceResponse>
}
