import { describe, expect, it } from 'vitest'
import { parseRange, summarizeRange } from '../src/query.ts'
import { createEmptyBucket, localDateKey, UNKNOWN_MODEL } from '../src/meter.ts'
import type { UsageStatsState } from '../src/meter.ts'

const NOW = Date.UTC(2026, 7, 20, 6, 0, 0) // 2026-08-20 本地

function dayState(daysAgo: number, patch: { requests?: number; tokens?: number; model?: string }): UsageStatsState {
  const date = localDateKey(NOW - daysAgo * 86_400_000)
  const model = patch.model ?? 'deepseek-chat'
  const bucket = { ...createEmptyBucket(), requests: patch.requests ?? 0, uncachedInputTokens: patch.tokens ?? 0 }
  const byModel = { [model]: { ...bucket } }
  return { totals: createEmptyBucket(), byDay: { [date]: { bucket, byModel } }, sessions: {} }
}

describe('parseRange', () => {
  it('缺省为今日', () => {
    const r = parseRange(undefined, undefined, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.query.from).toBe(r.query.to)
  })
  it('非法日期拒绝', () => {
    expect(parseRange('2026-13-01', undefined, NOW).ok).toBe(false)
    expect(parseRange('abc', undefined, NOW).ok).toBe(false)
  })
  it('from > to 拒绝', () => {
    expect(parseRange('2026-08-10', '2026-08-01', NOW).ok).toBe(false)
  })
  it('跨度 > 730 天拒绝', () => {
    expect(parseRange('2024-01-01', '2026-08-20', NOW).ok).toBe(false)
  })
  it('31 天内按天、以上按周', () => {
    const day = parseRange('2026-08-01', '2026-08-20', NOW)
    expect(day.ok && day.query.granularity).toBe('day')
    const week = parseRange('2026-07-01', '2026-08-20', NOW)
    expect(week.ok && week.query.granularity).toBe('week')
  })
})

describe('summarizeRange', () => {
  it('聚合区间指标', () => {
    const state = dayState(1, { requests: 3, tokens: 300 })
    const r = parseRange(localDateKey(NOW - 86_400_000), localDateKey(NOW - 86_400_000), NOW)
    if (!r.ok) throw new Error('range')
    const s = summarizeRange(state, r.query)
    expect(s.requests).toBe(3)
    expect(s.tokens.total).toBe(300)
    expect(s.activeDays).toBe(1)
    expect(s.topModel).toBe('deepseek-chat')
    expect(s.uncountedRequests).toBe(0)
  })
  it('未知模型计入 uncountedRequests', () => {
    const state = dayState(1, { requests: 2, tokens: 10, model: UNKNOWN_MODEL })
    const r = parseRange(localDateKey(NOW - 86_400_000), localDateKey(NOW - 86_400_000), NOW)
    if (!r.ok) throw new Error('range')
    const s = summarizeRange(state, r.query)
    expect(s.uncountedRequests).toBe(2)
    expect(s.topModel).toBe(UNKNOWN_MODEL)
  })
  it('平均命中率 = 区间 cacheRead / 全部输入', () => {
    const date = localDateKey(NOW - 86_400_000)
    const bucket = { ...createEmptyBucket(), requests: 1, uncachedInputTokens: 70, cacheReadTokens: 30 }
    const state: UsageStatsState = { totals: createEmptyBucket(), byDay: { [date]: { bucket, byModel: { m: bucket } } }, sessions: {} }
    const r = parseRange(date, date, NOW)
    if (!r.ok) throw new Error('range')
    const s = summarizeRange(state, r.query)
    expect(s.avgCacheHitRate).toBeCloseTo(0.3)
  })
})
