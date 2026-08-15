import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle (window.__ModuleLoader__),
// not importable under vitest; stub the one the card's controller uses.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => ({
    get: () => init,
    set: () => {},
    subscribe: () => () => {},
  }),
  SnapshotStore: {},
}))
import type { SummaryResponse } from '../../src/client/api.ts'
import { UsageStatsCard } from '../../src/client/UsageStatsCard.tsx'

const summary: SummaryResponse = {
  from: '2026-08-14', to: '2026-08-15',
  requests: 12, turns: 9,
  tokens: { uncachedInputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 100, outputTokens: 200, total: 1800 },
  cost: 0.35, activeDays: 2, avgCacheHitRate: 0.31, topModel: 'deepseek-chat',
  uncountedRequests: 1,
  byModel: [{ model: 'deepseek-chat', requests: 11, tokens: 1700, cost: 0.33 }],
  series: [{ bucket: '2026-08-14', requests: 5, tokens: 800, cost: 0.15 }],
  perSession: { sessionId: 's1', workspace: null, turns: 3, requests: 4, cost: 0.1, lastRequestAt: null, lastModel: 'deepseek-chat', lastRequestCost: 0.05, lastRequestHitRate: 0.4 },
}

const baseProps = {
  rangeDays: 7 as const,
  customFrom: '',
  customTo: '',
  onRangeDays: () => {},
  onCustomFrom: () => {},
  onCustomTo: () => {},
  onRefreshBalance: () => {},
  balanceRefreshing: false,
}

describe('UsageStatsCard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('渲染总览指标与模型明细', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balance={{ balance: 12.34, currency: 'CNY', updatedAt: null, error: null, source: null }}
      loading={false}
      error={null}
      {...baseProps}
    />)
    expect(screen.getByText('12')).toBeTruthy()          // 请求数量
    expect(screen.getByText('9')).toBeTruthy()            // 完成轮次
    expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThan(0) // 最常用模型 / 明细表
    expect(screen.getByText(/12\.34/)).toBeTruthy()      // 余额
  })

  it('余额不可用时显示原因', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balance={{ balance: null, currency: 'CNY', updatedAt: null, error: 'provider does not expose an endpoint', source: null }}
      loading={false}
      error={null}
      {...baseProps}
    />)
    expect(screen.getByText(/provider does not expose an endpoint/)).toBeTruthy()
  })
})
