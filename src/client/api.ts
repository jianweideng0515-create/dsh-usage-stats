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
  lastRequestAt: string | null
  lastModel: string | null
  lastRequestCost: number | null
  lastRequestHitRate: number | null
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

export interface BalanceResponse {
  balance: number | null
  currency: string
  updatedAt: string | null
  error: string | null
  source: { baseUrl: string; path: string; apiKeyEnv: string; source: string } | null
}

/** 拉取区间汇总；sessionId 缺省取宿主“最近活跃会话”。 */
export async function fetchSummary(from: string, to: string, signal?: AbortSignal): Promise<SummaryResponse> {
  const url = `/api/dsh-usage-stats/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`summary HTTP ${response.status}`)
  return response.json() as Promise<SummaryResponse>
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
