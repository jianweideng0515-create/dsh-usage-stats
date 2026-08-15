import type { BalanceEndpoint, BalanceSettings, DetectResult } from './provider-detect.ts'

/** 单个配额窗口的用量与重置时间。 */
export interface QuotaWindow {
  percent: number
  resetsAt: string | null
}

/** OpenCode 订阅配额（/v1/usage）：滚动 / 每周 / 每月三个窗口。 */
export interface UsageQuota {
  rolling: QuotaWindow | null
  weekly: QuotaWindow | null
  monthly: QuotaWindow | null
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
  /** 费用计价货币（插件设置 currency；CNY 显示 ¥，USD 显示 $）。 */
  costCurrency: string
}

/** 余额客户端的运行时依赖（测试可注入）。 */
export interface BalanceClientDeps {
  fetchFn: typeof fetch
  getEnv: (name: string) => string | undefined
  /** 费用计价货币（插件设置 currency 透传；缺省 CNY）。 */
  getCostCurrency?: () => string
}

const FAIL = (error: string, source: BalanceEndpoint | null, costCurrency = 'CNY'): BalanceSnapshot => ({
  balance: null,
  currency: 'CNY',
  updatedAt: null,
  error,
  source,
  quota: null,
  costCurrency,
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
 * { status, percent, resetsAt } } }）。三个窗口全部提取；窗口缺失或格式
 * 不符时为 null。整体格式不符（无任何窗口）返回 null。
 */
export function parseOpenCodeUsage(body: unknown): UsageQuota | null {
  if (typeof body !== 'object' || body === null) return null
  const usage = (body as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return null
  const record = usage as Record<string, unknown>
  const quota: UsageQuota = { rolling: null, weekly: null, monthly: null }
  let found = false
  for (const window of ['rolling', 'weekly', 'monthly'] as const) {
    const entry = record[window]
    if (typeof entry !== 'object' || entry === null) continue
    const percent = (entry as { percent?: unknown }).percent
    const numeric = typeof percent === 'number' ? percent : typeof percent === 'string' ? Number(percent) : NaN
    if (!Number.isFinite(numeric)) continue
    const resetsAt = typeof (entry as { resetsAt?: unknown }).resetsAt === 'string'
      ? (entry as { resetsAt: string }).resetsAt : null
    quota[window] = { percent: numeric, resetsAt }
    found = true
  }
  return found ? quota : null
}

export class BalanceClient {
  private settings: BalanceSettings = { mode: 'off' }
  private detect: () => Record<string, DetectResult> = () => ({})
  private last: Record<string, BalanceSnapshot> = {}

  constructor(private readonly deps: BalanceClientDeps) {}

  setSettings(settings: BalanceSettings): void { this.settings = settings }
  setDetect(fn: () => Record<string, DetectResult>): void { this.detect = fn }
  /** 最近一次各 provider 快照（provider id → 快照；未检测到的 provider 不在表内）。 */
  snapshot(): Record<string, BalanceSnapshot> { return this.last }
  /** 费用计价货币（设置 currency 实时读取）。 */
  private costCurrency(): string { return this.deps.getCostCurrency?.() ?? 'CNY' }

  /** 并行刷新全部检测到的 provider 快照；单个 provider 失败不影响其他。 */
  async refresh(): Promise<Record<string, BalanceSnapshot>> {
    const detected = this.detect()
    const next: Record<string, BalanceSnapshot> = { ...this.last }
    await Promise.all(Object.entries(detected).map(async ([provider, result]) => {
      next[provider] = result.ok
        ? await this.fetchEndpoint(result.endpoint)
        : FAIL(result.reason, null, this.costCurrency())
    }))
    this.last = next
    return this.last
  }

  /** 拉取并解析单个端点的快照（key 缺失、网络错误、格式不符均落 FAIL）。 */
  private async fetchEndpoint(endpoint: BalanceEndpoint): Promise<BalanceSnapshot> {
    const key = this.deps.getEnv(endpoint.apiKeyEnv)
    if (key === undefined || key === '') {
      return FAIL('missing API key', endpoint, this.costCurrency())
    }
    let response: Response
    try {
      response = await this.deps.fetchFn(endpoint.baseUrl + endpoint.path, {
        headers: {
          authorization: `Bearer ${key}`,
          // opencode.ai 的 Cloudflare 对非浏览器 UA 有数秒的延迟惩罚（实测
          // Node fetch 直连约 13.7s 才返回），浏览器 UA 可避免该惩罚。
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        // 余额接口挂起会卡住快照更新（无超时的话 fetch 可能长时间 pending），
        // 25 秒超时：覆盖 Cloudflare 对非浏览器 UA 的延迟惩罚（约 14s），
        // 超时后按网络错误处理，下一轮定时刷新再试。
        signal: AbortSignal.timeout(25_000),
      })
    } catch (error) {
      return FAIL(`network error: ${String(error)}`, endpoint, this.costCurrency())
    }
    if (!response.ok) {
      return FAIL(`HTTP ${response.status}`, endpoint, this.costCurrency())
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return FAIL('unexpected response', endpoint, this.costCurrency())
    }
    // 端点按路径区分：/usage 为 OpenCode 配额，/user/balance 为 DeepSeek 金额。
    if (endpoint.path.includes('/usage')) {
      const quota = parseOpenCodeUsage(body)
      if (quota === null) {
        return FAIL('unexpected response', endpoint, this.costCurrency())
      }
      return {
        balance: null,
        currency: '',
        updatedAt: new Date().toISOString(),
        error: null,
        source: endpoint,
        quota,
        costCurrency: this.costCurrency(),
      }
    }
    const parsed = parseBalanceResponse(body)
    if (parsed === null) {
      return FAIL('unexpected response', endpoint, this.costCurrency())
    }
    return {
      balance: parsed.balance,
      currency: parsed.currency,
      updatedAt: new Date().toISOString(),
      error: null,
      source: endpoint,
      quota: null,
      costCurrency: this.costCurrency(),
    }
  }

  /** 立即刷新一次并定时刷新；返回定时器 disposer。 */
  start(intervalMs: number): () => void {
    void this.refresh()
    const timer = setInterval(() => { void this.refresh() }, intervalMs)
    return () => clearInterval(timer)
  }
}
