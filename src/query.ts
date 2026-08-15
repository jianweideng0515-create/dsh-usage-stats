import { hitRateOf, localDateKey, UNKNOWN_MODEL } from './meter.ts'
import type { TokenBuckets, UsageStatsState } from './meter.ts'

/** 区间查询参数：起止日期键（YYYY-MM-DD）+ 聚合粒度。 */
export interface RangeQuery { from: string; to: string; granularity: 'day' | 'week' }

/** 趋势序列点：单日或自然周的聚合。 */
export interface SeriesPoint { bucket: string; requests: number; tokens: number; cost: number }

/** 分模型聚合行。 */
export interface ModelSummary { model: string; requests: number; tokens: number; cost: number }

/** 区间汇总（路由 /summary 的主体）。 */
export interface RangeSummary {
  from: string
  to: string
  requests: number
  turns: number
  tokens: TokenBuckets & { total: number }
  cost: number
  activeDays: number
  avgCacheHitRate: number
  topModel: string | null
  uncountedRequests: number
  byModel: ModelSummary[]
  series: SeriesPoint[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 730

/** 真实日期校验：格式 + 回读比对（拒绝 2026-02-30 之类越界值）。 */
function isValidDate(raw: string): boolean {
  if (!DATE_RE.test(raw)) return false
  const [y, m, d] = raw.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

/** 解析 from/to 查询参数；缺省为今日；非法/超界返回错误。 */
export function parseRange(
  fromRaw: string | undefined,
  toRaw: string | undefined,
  now: number,
): { ok: true; query: RangeQuery } | { ok: false; error: string } {
  const today = localDateKey(now)
  const from = fromRaw ?? today
  const to = toRaw ?? today
  if (!isValidDate(from)) return { ok: false, error: 'invalid from date' }
  if (!isValidDate(to)) return { ok: false, error: 'invalid to date' }
  if (from > to) return { ok: false, error: 'from must not be after to' }
  // 以午时（12:00）相减避免 DST 边界导致整除偏差；+1 含首尾两天。
  const spanDays = Math.round((Date.parse(to + 'T12:00:00') - Date.parse(from + 'T12:00:00')) / 86_400_000) + 1
  if (spanDays > MAX_RANGE_DAYS) return { ok: false, error: 'range too large (max 730 days)' }
  return { ok: true, query: { from, to, granularity: spanDays <= 31 ? 'day' : 'week' } }
}

/** 自然周键：该周周一（inclusive）的日期（YYYY-MM-DD）。 */
function weekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12)
  const day = (date.getDay() + 6) % 7 // 周一起始：周一 = 0
  date.setDate(date.getDate() - day)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const EMPTY_TOKENS = (): TokenBuckets & { total: number } => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  total: 0,
})

/** 对区间内 byDay 条目聚合：总量指标、分模型、趋势序列。 */
export function summarizeRange(state: UsageStatsState, query: RangeQuery): RangeSummary {
  const tokens = EMPTY_TOKENS()
  const byModel = new Map<string, { requests: number; tokens: number; cost: number }>()
  const series = new Map<string, SeriesPoint>()
  let requests = 0
  let turns = 0
  let cost = 0
  let uncountedRequests = 0
  let activeDays = 0
  let sumCacheRead = 0
  let sumInput = 0

  for (const [date, day] of Object.entries(state.byDay)) {
    if (date < query.from || date > query.to) continue
    const b = day.bucket
    requests += b.requests
    turns += b.turns
    cost += b.cost
    tokens.uncachedInputTokens += b.uncachedInputTokens
    tokens.cacheReadTokens += b.cacheReadTokens
    tokens.cacheWriteTokens += b.cacheWriteTokens
    tokens.outputTokens += b.outputTokens
    sumCacheRead += b.cacheReadTokens
    sumInput += b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens
    if (b.requests > 0) activeDays += 1
    for (const [model, mb] of Object.entries(day.byModel)) {
      const entry = byModel.get(model) ?? { requests: 0, tokens: 0, cost: 0 }
      entry.requests += mb.requests
      entry.tokens += mb.uncachedInputTokens + mb.cacheReadTokens + mb.cacheWriteTokens + mb.outputTokens
      entry.cost += mb.cost
      byModel.set(model, entry)
      if (model === UNKNOWN_MODEL) uncountedRequests += mb.requests
    }
    const bucketKey = query.granularity === 'day' ? date : weekKey(date)
    const point = series.get(bucketKey) ?? { bucket: bucketKey, requests: 0, tokens: 0, cost: 0 }
    point.requests += b.requests
    point.tokens += b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens + b.outputTokens
    point.cost += b.cost
    series.set(bucketKey, point)
  }
  tokens.total = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens

  const modelList = [...byModel.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.requests - a.requests)
  const topModel = modelList.length > 0 ? modelList[0].model : null

  return {
    from: query.from,
    to: query.to,
    requests,
    turns,
    tokens,
    cost,
    activeDays,
    avgCacheHitRate: sumInput <= 0 ? 0 : sumCacheRead / sumInput,
    topModel,
    uncountedRequests,
    byModel: modelList,
    series: [...series.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1)),
  }
}

// 保持口径函数对齐：路由层可复用同一命中率实现。
export { hitRateOf }
