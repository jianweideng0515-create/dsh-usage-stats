import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** 四类 token 分项（与 provider usage 对应）。 */
export interface TokenBuckets {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** 一个聚合桶：token 分项 + 请求/轮次/费用 + 最近请求信息。 */
export interface ModelBucket extends TokenBuckets {
  requests: number
  turns: number
  cost: number
  lastRequestAt?: string
  lastRequestCost?: number
  lastRequestHitRate?: number
  lastModel?: string
}

/** 单日聚合：当日总桶 + 当日分模型桶（区间模型统计由此聚合）。 */
export interface DayBucket {
  bucket: ModelBucket
  byModel: Record<string, ModelBucket>
}

/** 单会话记录（供"当前会话轮次/费用"等展示）。 */
export interface SessionRecord {
  sessionId: string
  workspace: string | null
  createdAt: string
  turns: number
  requests: number
  cost: number
  /** 会话级 token 分项（会话页用量：Tokens 用量与平均命中率由此计算）。 */
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  lastRequestAt: string | null
  lastModel: string | null
  lastRequestCost: number | null
  lastRequestHitRate: number | null
  /** 最近一次有 usage 的请求的 token 合计（最近单次消耗展示）。 */
  lastRequestTokens: number | null
}

/** 完整聚合状态（持久化形状）。 */
export interface UsageStatsState {
  totals: ModelBucket
  byDay: Record<string, DayBucket>
  sessions: Record<string, SessionRecord>
}

/** 单会话折叠态（不进持久化）。 */
export interface SessionFold {
  currentModel: string | null
  pending: PendingUsage | null
}

/** 当前 step 已记账的用量（替换语义的基准）。 */
export interface PendingUsage {
  turn: number
  step: number
  buckets: TokenBuckets
  cost: number
  hitRate: number
}

export const UNKNOWN_MODEL = '__unknown__'

/** 缓存命中率口径：cacheRead / (uncached + cacheRead + cacheWrite)；无输入为 0。 */
export function hitRateOf(buckets: TokenBuckets): number {
  const input = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  return input <= 0 ? 0 : buckets.cacheReadTokens / input
}

/** 本地时区 YYYY-MM-DD（按当日 12 时取键，避免 DST 边界抖动）。 */
export function localDateKey(timeMs: number): string {
  const d = new Date(timeMs)
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  const y = noon.getFullYear()
  const m = String(noon.getMonth() + 1).padStart(2, '0')
  const day = String(noon.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function createEmptyBucket(): ModelBucket {
  return {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    requests: 0,
    turns: 0,
    cost: 0,
  }
}

export interface MeterOptions {
  /** 时钟注入（测试用）；默认 Date.now。 */
  now?: () => number
  /** 费用计算（Task 2 接入 pricing）；缺省返回 0。 */
  getPrice?: (model: string, buckets: TokenBuckets) => number
}

function addInto(target: ModelBucket, delta: Partial<ModelBucket>): void {
  for (const key of ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'requests', 'turns', 'cost'] as const) {
    target[key] += delta[key] ?? 0
  }
  if (delta.lastRequestAt !== undefined) target.lastRequestAt = delta.lastRequestAt
  if (delta.lastRequestCost !== undefined) target.lastRequestCost = delta.lastRequestCost
  if (delta.lastRequestHitRate !== undefined) target.lastRequestHitRate = delta.lastRequestHitRate
  if (delta.lastModel !== undefined) target.lastModel = delta.lastModel
}

export class UsageStatsMeter {
  private readonly data: UsageStatsState
  private readonly folds = new Map<string, SessionFold>()
  private getPrice: (model: string, buckets: TokenBuckets) => number

  constructor(opts: MeterOptions = {}) {
    this.data = { totals: createEmptyBucket(), byDay: {}, sessions: {} }
    this.getPrice = opts.getPrice ?? (() => 0)
  }

  /** 深拷贝快照（路由/持久化读取用）。 */
  state(): UsageStatsState {
    return JSON.parse(JSON.stringify(this.data)) as UsageStatsState
  }

  applyEvent(sessionId: string, workspace: string | null, event: SessionEvent): void {
    const fold = this.foldOf(sessionId, workspace)
    const date = localDateKey(event.time)
    switch (event.type) {
      case 'turn/end': {
        if (event.data.reason.kind !== 'completed') break
        addInto(this.data.totals, { turns: 1 })
        addInto(this.day(date).bucket, { turns: 1 })
        this.sessionOf(sessionId).turns += 1
        break
      }
      case 'step/start': {
        const model = fold.currentModel ?? UNKNOWN_MODEL
        addInto(this.data.totals, { requests: 1 })
        const day = this.day(date)
        addInto(day.bucket, { requests: 1 })
        addInto(this.modelBucket(day, model), { requests: 1 })
        this.sessionOf(sessionId).requests += 1
        fold.pending = null
        break
      }
      case 'request/header': {
        fold.currentModel = event.data.header.config.model
        break
      }
      case 'assistant/chunk': {
        if (event.data.chunk.type === 'usage') this.settle(sessionId, fold, date, event.data.turn, event.data.step, event.data.chunk.usage, event.time)
        break
      }
      case 'assistant/message': {
        if (event.data.usage !== undefined) this.settle(sessionId, fold, date, event.data.turn, event.data.step, event.data.usage, event.time)
        break
      }
      case 'step/end': {
        fold.pending = null
        break
      }
      default:
        break
    }
  }

  /** 替换语义记账：同 (turn,step) 时减旧加新，否则直接累加。 */
  private settle(sessionId: string, fold: SessionFold, date: string, turn: number, step: number, usage: TokenUsage, time: number): void {
    const buckets: TokenBuckets = {
      uncachedInputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      outputTokens: usage.outputTokens,
    }
    const model = fold.currentModel ?? UNKNOWN_MODEL
    const rawCost = this.getPrice(model, buckets)
    // 双保险：价格计算异常（如默认价空对象）可能返回 NaN，NaN 会污染累计
    // 状态并随 JSON 序列化为 null——任何非有限费用一律按 0 记账。
    const cost = Number.isFinite(rawCost) ? rawCost : 0
    const rate = hitRateOf(buckets)
    const prev = fold.pending
    if (prev !== null && prev.turn === turn && prev.step === step) {
      const delta: Partial<ModelBucket> = {
        uncachedInputTokens: buckets.uncachedInputTokens - prev.buckets.uncachedInputTokens,
        cacheReadTokens: buckets.cacheReadTokens - prev.buckets.cacheReadTokens,
        cacheWriteTokens: buckets.cacheWriteTokens - prev.buckets.cacheWriteTokens,
        outputTokens: buckets.outputTokens - prev.buckets.outputTokens,
        cost: cost - prev.cost,
      }
      addInto(this.data.totals, delta)
      const day = this.day(date)
      addInto(day.bucket, delta)
      addInto(this.modelBucket(day, model), delta)
    } else {
      const delta: Partial<ModelBucket> = { ...buckets, cost }
      addInto(this.data.totals, delta)
      const day = this.day(date)
      addInto(day.bucket, delta)
      addInto(this.modelBucket(day, model), delta)
    }
    const last: Partial<ModelBucket> = {
      lastRequestAt: new Date(time).toISOString(),
      lastRequestCost: cost,
      lastRequestHitRate: rate,
      lastModel: model,
    }
    addInto(this.data.totals, last)
    const day = this.day(date)
    addInto(day.bucket, last)
    addInto(this.modelBucket(day, model), last)
    const session = this.sessionOf(sessionId)
    session.lastRequestAt = new Date(time).toISOString()
    session.lastModel = model
    session.lastRequestCost = cost
    session.lastRequestHitRate = rate
    session.lastRequestTokens = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
    // 会话累计与全局聚合同一替换语义：同 (turn,step) 的二次上报按差值调整。
    session.cost += cost - (prev?.cost ?? 0)
    session.uncachedInputTokens += buckets.uncachedInputTokens - (prev?.buckets.uncachedInputTokens ?? 0)
    session.cacheReadTokens += buckets.cacheReadTokens - (prev?.buckets.cacheReadTokens ?? 0)
    session.cacheWriteTokens += buckets.cacheWriteTokens - (prev?.buckets.cacheWriteTokens ?? 0)
    session.outputTokens += buckets.outputTokens - (prev?.buckets.outputTokens ?? 0)
    fold.pending = { turn, step, buckets, cost, hitRate: rate }
  }

  /** 用持久化状态重建（清空会话折叠态；旧版本数据补齐会话 token 分项）。 */
  restore(state: UsageStatsState): void {
    this.data.totals = { ...createEmptyBucket(), ...state.totals }
    this.data.byDay = state.byDay
    this.data.sessions = state.sessions
    for (const record of Object.values(this.data.sessions)) {
      record.uncachedInputTokens ??= 0
      record.cacheReadTokens ??= 0
      record.cacheWriteTokens ??= 0
      record.outputTokens ??= 0
      record.lastRequestTokens ??= null
    }
    this.folds.clear()
  }

  /** 替换费用计算器（配置热更新用）。 */
  setPriceResolver(fn: (model: string, buckets: TokenBuckets) => number): void {
    this.getPrice = fn
  }

  private day(date: string): DayBucket {
    let day = this.data.byDay[date]
    if (day === undefined) {
      day = { bucket: createEmptyBucket(), byModel: {} }
      this.data.byDay[date] = day
    }
    return day
  }

  private modelBucket(day: DayBucket, model: string): ModelBucket {
    let bucket = day.byModel[model]
    if (bucket === undefined) {
      bucket = createEmptyBucket()
      day.byModel[model] = bucket
    }
    return bucket
  }

  private sessionOf(sessionId: string): SessionRecord {
    let session = this.data.sessions[sessionId]
    if (session === undefined) {
      session = {
        sessionId,
        workspace: null,
        createdAt: new Date().toISOString(),
        turns: 0,
        requests: 0,
        cost: 0,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        lastRequestAt: null,
        lastModel: null,
        lastRequestCost: null,
        lastRequestHitRate: null,
        lastRequestTokens: null,
      }
      this.data.sessions[sessionId] = session
    }
    return session
  }

  private foldOf(sessionId: string, workspace: string | null): SessionFold {
    let fold = this.folds.get(sessionId)
    if (fold === undefined) {
      fold = { currentModel: null, pending: null }
      this.folds.set(sessionId, fold)
    }
    const session = this.sessionOf(sessionId)
    if (session.workspace === null && workspace !== null) session.workspace = workspace
    return fold
  }
}
