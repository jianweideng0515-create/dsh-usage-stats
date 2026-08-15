import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import type { BalanceMap, SummaryResponse } from '../../src/client/api.ts'
import { UsageStatsCard } from '../../src/client/UsageStatsCard.tsx'

const summary: SummaryResponse = {
  from: '2026-08-14', to: '2026-08-15',
  requests: 12, turns: 9,
  tokens: { uncachedInputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 100, outputTokens: 200, total: 1800 },
  cost: 0.35, activeDays: 2, avgCacheHitRate: 0.31, topModel: 'deepseek-chat',
  uncountedRequests: 1,
  byModel: [{ model: 'deepseek-chat', requests: 11, tokens: 1700, cost: 0.33 }],
  series: [{ bucket: '2026-08-14', requests: 5, tokens: 800, cost: 0.15, hitRate: 0.3, byModel: [] }],
  perSession: { sessionId: 's1', workspace: null, turns: 3, requests: 4, cost: 0.1, lastRequestAt: null, lastModel: 'deepseek-chat', lastRequestCost: 0.05, lastRequestHitRate: 0.4 },
}

/** 默认多 provider 快照：opencode 未接入（无配额）、deepseek 有金额余额。 */
const balances: BalanceMap = {
  opencode: { balance: null, currency: '', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' },
  deepseek: { balance: 12.34, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' },
}

/** 两个 provider 均无可展示数据的空快照。 */
const balancesEmpty: BalanceMap = {
  opencode: { balance: null, currency: '', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' },
  deepseek: { balance: null, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' },
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

/** 文件级清理：每个用例后卸载 DOM（vitest 未开 globals，无自动 cleanup）。 */
afterEach(() => cleanup())

describe('UsageStatsCard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('渲染总览指标与模型明细', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balances={balances}
      loading={false}
      error={null}
      {...baseProps}
    />)
    // 默认在「用量概览」Tab：KPI 请求数量 / 轮次卡 / 天数卡 / 模型明细
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    // 完成轮次卡：值 9 + 标题
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getAllByText('metric.turns').length).toBeGreaterThan(0)
    // 活跃天数卡：值 2
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThan(0)
    // 提供商动态卡默认 opencode（无配额数据 → 未接入占位）
    expect(screen.getAllByText('provider.notConnected').length).toBeGreaterThan(0)
  })

  it('命中率显示两位小数', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={{ ...summary, avgCacheHitRate: 0.9984 }}
      balances={balancesEmpty}
      loading={false}
      error={null}
      {...baseProps}
    />)
    // KPI 卡命中率 99.84%；会话摘要本次命中 40.00%（0.4 → 两位小数）
    expect(screen.getByText('99.84%')).toBeTruthy()
    expect(screen.getAllByText('40.00%').length).toBeGreaterThan(0)
  })

  it('余额与配额 Tab：切换提供商展示对应余额', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balances={balances}
      loading={false}
      error={null}
      {...baseProps}
    />)
    // 切到余额 Tab → 默认 opencode（无配额 → 不可用提示）
    fireEvent.click(screen.getByText('tab.quota'))
    expect(screen.getByText(/balance\.unavailable/)).toBeTruthy()
    // 切到 DeepSeek → 金额余额（KPI 动态卡 + 配额卡各一处）+ 预计可用天数
    fireEvent.click(screen.getByText('provider.deepseek'))
    expect(screen.getAllByText(/12\.34/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/balance\.estimate/)).toBeTruthy()
    // 切回 OpenCode → 配额视图（无配额数据 → 不可用提示）
    fireEvent.click(screen.getByText('provider.opencode'))
    expect(screen.getByText(/balance\.unavailable/)).toBeTruthy()
  })

  it('OpenCode 配额展示三窗口进度条卡', () => {
    const t = (key: string) => key
    const quota = {
      rolling: { percent: 1, resetsAt: null },
      weekly: { percent: 42, resetsAt: null },
      monthly: { percent: 21, resetsAt: null },
    }
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balances={{ opencode: { balance: null, currency: '', updatedAt: null, error: null, source: { baseUrl: 'x', path: '/usage', apiKeyEnv: 'K', source: 'auto:opencode-go' }, quota, costCurrency: 'CNY' }, deepseek: { balance: null, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' } }}
      loading={false}
      error={null}
      {...baseProps}
    />)
    fireEvent.click(screen.getByText('tab.quota'))
    // 三个窗口标签都在
    expect(screen.getByText('quota.rolling')).toBeTruthy()
    expect(screen.getByText('quota.weekly')).toBeTruthy()
    expect(screen.getByText('quota.monthly')).toBeTruthy()
    // 状态 chip：1% → 充沛；42% → 正常；21% → 充沛
    expect(screen.getAllByText('quota.abundant').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('quota.normal')).toBeTruthy()
    // 大数字百分号
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('余额不可用时显示原因', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balances={{ opencode: { balance: null, currency: 'CNY', updatedAt: null, error: 'provider does not expose an endpoint', source: null, quota: null, costCurrency: 'CNY' }, deepseek: { balance: null, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' } }}
      loading={false}
      error={null}
      {...baseProps}
    />)
    fireEvent.click(screen.getByText('tab.quota'))
    expect(screen.getByText(/provider does not expose an endpoint/)).toBeTruthy()
  })

  it('DeepSeek 负余额显示充值提示而非可用天数', () => {
    const t = (key: string) => key
    render(<UsageStatsCard
      t={t}
      summary={summary}
      balances={{ opencode: { balance: null, currency: '', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' }, deepseek: { balance: -0.07, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null, costCurrency: 'CNY' } }}
      loading={false}
      error={null}
      {...baseProps}
    />)
    fireEvent.click(screen.getByText('provider.deepseek'))
    fireEvent.click(screen.getByText('tab.quota'))
    // 负余额：显示充值提示，不出现"预计可支撑约 N 天"
    expect(screen.getByText('balance.negative')).toBeTruthy()
    expect(screen.queryByText(/balance\.estimate/)).toBeNull()
    expect(screen.getByText('-0.07')).toBeTruthy()
  })

  it('趋势图 hover 柱子显示按模型明细 tooltip', () => {
    const t = (key: string) => key
    const { container } = render(<UsageStatsCard
      t={t}
      summary={{
        ...summary,
        series: [
          { bucket: '2026-08-15', requests: 100, tokens: 30_000_000, cost: 0.2, hitRate: 0.95, byModel: [{ model: 'deepseek-chat', tokens: 20_000_000 }, { model: 'deepseek-r1', tokens: 10_000_000 }] },
          { bucket: '2026-08-16', requests: 200, tokens: 40_000_000, cost: 0.3, hitRate: 0.9, byModel: [{ model: 'deepseek-chat', tokens: 40_000_000 }] },
        ],
      }}
      balances={balances}
      loading={false}
      error={null}
      {...baseProps}
    />)
    // 悬停第一天柱子 → tooltip：日期 / 总用量（万）/ 分模型 / 命中率 / 费用
    const hitAreas = container.querySelectorAll('[data-trend-hit="true"]')
    expect(hitAreas.length).toBe(2)
    fireEvent.mouseEnter(hitAreas[0])
    expect(screen.getByText('2026-08-15')).toBeTruthy()
    expect(screen.getByText('3000.0万')).toBeTruthy()
    // 模型名在 tooltip 与模型明细表各出现一次
    expect(screen.getAllByText('deepseek-chat').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('deepseek-r1')).toBeTruthy()
    expect(screen.getByText('95.00%')).toBeTruthy()
    // 悬停第二天 → 单模型明细 + 命中率变化（4000.0万：总用量与 deepseek-chat 模型行同值）
    fireEvent.mouseEnter(hitAreas[1])
    expect(screen.getByText('2026-08-16')).toBeTruthy()
    expect(screen.getAllByText('4000.0万').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('90.00%')).toBeTruthy()
  })
})

