import type { BalanceEndpoint, BalanceSettings, DetectResult } from './provider-detect.ts'

/** OpenCode 订阅配额快照（/v1/usage 的三个窗口之一；优先展示月度）。 */
export interface UsageQuota {
  /** 已用百分比 0-100。 */
  percent: number
  /** 配额窗口。 */
  window: 'rolling' | 'weekly' | 'monthly'
  /** 重置时间（ISO）；接口未提供时为 null。 */
  resetsAt: string | null
}

/** 一次余额快照（路由响应形状）。金额与配额二选一：有 quota 时为订阅制。 */
export interface BalanceSnapshot {
  balance: number | null
  currency: string
  updatedAt: string | null
  error: string | null
  source: BalanceEndpoint | null
  /** OpenCode 等订阅制的配额百分比；金额型（DeepSeek）为 null。 */
  quota: UsageQuota | null
}

/** 余额客户端的运行时依赖（测试可注入）。 */
export interface BalanceClientDeps {
  fetchFn: typeof fetch
  getEnv: (name: string) => string | undefined
}

const FAIL = (error: string, source: BalanceEndpoint | null): BalanceSnapshot => ({
  balance: null,
  currency: 'CNY',
  updatedAt: null,
  error,
  source,
  quota: null,
})

/** 解析 DeepSeek 兼容余额响应；格式不符返回 null。 */
export function parseBalanceResponse(body: unknown): { balance: number; currency: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const infos = (body as { balance_infos?: unknown }).balance_infos
  if (!Array.isArray(infos)) return null
  const info = infos.find((i) => typeof i === 'object' && i !== null && (i as { currency?: unknown }).currency === 'CNY')
    ?? infos[0]
  if (typeof info !== 'object' || info === null) return null
  const total = (info as { total_balance?: unknown }).total_balance
  const balance = typeof total === 'string' ? Number(total) : typeof total === 'number' ? total : NaN
  if (!Number.isFinite(balance)) return null
  const currency = typeof (info as { currency?: unknown }).currency === 'string'
    ? (info as { currency: string }).currency : 'CNY'
  return { balance, currency }
}

/**
 * 解析 OpenCode 订阅配额响应（GET /v1/usage → { usage: { rolling/weekly/monthly:
 * { status, percent, resetsAt } } }）。优先月度窗口，其次周/滚动。
 * 格式不符返回 null。
 */
export function parseOpenCodeUsage(body: unknown): UsageQuota | null {
  if (typeof body !== 'object' || body === null) return null
  const usage = (body as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return null
  const record = usage as Record<string, unknown>
  for (const window of ['monthly', 'weekly', 'rolling'] as const) {
    const entry = record[window]
    if (typeof entry !== 'object' || entry === null) continue
    const percent = (entry as { percent?: unknown }).percent
    const numeric = typeof percent === 'number' ? percent : typeof percent === 'string' ? Number(percent) : NaN
    if (!Number.isFinite(numeric)) continue
    const resetsAt = typeof (entry as { resetsAt?: unknown }).resetsAt === 'string'
      ? (entry as { resetsAt: string }).resetsAt : null
    return { percent: numeric, window, resetsAt }
  }
  return null
}

export class BalanceClient {
  private settings: BalanceSettings = { mode: 'off' }
  private detect: () => DetectResult = () => ({ ok: false, reason: 'disabled' })
  private last: BalanceSnapshot = { balance: null, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null }

  constructor(private readonly deps: BalanceClientDeps) {}

  setSettings(settings: BalanceSettings): void { this.settings = settings }
  setDetect(fn: () => DetectResult): void { this.detect = fn }
  snapshot(): BalanceSnapshot { return this.last }

  async refresh(): Promise<BalanceSnapshot> {
    const result = this.detect()
    if (!result.ok) {
      this.last = FAIL(result.reason, null)
      return this.last
    }
    const endpoint = result.endpoint
    const key = this.deps.getEnv(endpoint.apiKeyEnv)
    if (key === undefined || key === '') {
      this.last = FAIL('missing API key', endpoint)
      return this.last
    }
    let response: Response
    try {
      response = await this.deps.fetchFn(endpoint.baseUrl + endpoint.path, {
        headers: { authorization: `Bearer ${key}` },
        // 余额接口挂起会卡住快照更新（无超时的话 fetch 可能长时间 pending），
        // 10 秒超时后按网络错误处理，下一轮定时刷新再试。
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      this.last = FAIL(`network error: ${String(error)}`, endpoint)
      return this.last
    }
    if (!response.ok) {
      this.last = FAIL(`HTTP ${response.status}`, endpoint)
      return this.last
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      this.last = FAIL('unexpected response', endpoint)
      return this.last
    }
    // 端点按路径区分：/usage 为 OpenCode 配额，/user/balance 为 DeepSeek 金额。
    if (endpoint.path.includes('/usage')) {
      const quota = parseOpenCodeUsage(body)
      if (quota === null) {
        this.last = FAIL('unexpected response', endpoint)
        return this.last
      }
      this.last = {
        balance: null,
        currency: '',
        updatedAt: new Date().toISOString(),
        error: null,
        source: endpoint,
        quota,
      }
      return this.last
    }
    const parsed = parseBalanceResponse(body)
    if (parsed === null) {
      this.last = FAIL('unexpected response', endpoint)
      return this.last
    }
    this.last = {
      balance: parsed.balance,
      currency: parsed.currency,
      updatedAt: new Date().toISOString(),
      error: null,
      source: endpoint,
      quota: null,
    }
    return this.last
  }

  /** 立即刷新一次并定时刷新；返回定时器 disposer。 */
  start(intervalMs: number): () => void {
    void this.refresh()
    const timer = setInterval(() => { void this.refresh() }, intervalMs)
    return () => clearInterval(timer)
  }
}
