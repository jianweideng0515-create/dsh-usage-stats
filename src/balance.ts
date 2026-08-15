import type { BalanceEndpoint, BalanceSettings, DetectResult } from './provider-detect.ts'

/** 一次余额快照（路由响应形状）。 */
export interface BalanceSnapshot {
  balance: number | null
  currency: string
  updatedAt: string | null
  error: string | null
  source: BalanceEndpoint | null
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

export class BalanceClient {
  private settings: BalanceSettings = { mode: 'off' }
  private detect: () => DetectResult = () => ({ ok: false, reason: 'disabled' })
  private last: BalanceSnapshot = { balance: null, currency: 'CNY', updatedAt: null, error: null, source: null }

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
