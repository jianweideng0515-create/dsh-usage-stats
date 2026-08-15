import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PerSession } from '../../src/client/api.ts'
import { SessionUsageButton } from '../../src/client/session-usage.tsx'
import type { SessionUsageStore } from '../../src/client/session-usage.tsx'

/** 文件级清理：每个用例后卸载 DOM（vitest 未开 globals，无自动 cleanup）。 */
afterEach(() => cleanup())

const session: PerSession = {
  sessionId: 's1', workspace: null,
  turns: 5, requests: 12, cost: 0.35,
  uncachedInputTokens: 1000, cacheReadTokens: 9000, cacheWriteTokens: 0, outputTokens: 500,
  lastRequestAt: null, lastModel: 'deepseek-chat',
  lastRequestCost: 0.05, lastRequestHitRate: 0.4, lastRequestTokens: 1200,
}

function baseState(overrides: Partial<SessionUsageStore> = {}): SessionUsageStore {
  return {
    open: false,
    perSession: null,
    balance: null,
    loading: false,
    error: null,
    ...overrides,
  }
}

describe('SessionUsageButton', () => {
  const t = (key: string) => key

  it('收起时只显示「用量」按钮', () => {
    render(<SessionUsageButton t={t} state={baseState()} onToggle={() => {}} />)
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('展开时渲染 8 项会话指标', () => {
    render(<SessionUsageButton
      t={t}
      state={baseState({
        open: true,
        perSession: session,
        balance: { balance: 12.34, currency: 'CNY', updatedAt: null, error: null, source: null },
      })}
      onToggle={() => {}}
    />)
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    // 状态徽标
    expect(screen.getByText('session.statusOk')).toBeTruthy()
    // 本次命中 40.00%（hitBadge）；本次费用 0.0500（strongText）
    expect(screen.getByText('40.00%')).toBeTruthy()
    expect(screen.getByText('0.0500')).toBeTruthy()
    // 完成轮次：metaValText "5 次"
    expect(screen.getByText('5 次')).toBeTruthy()
    // 会话总费用 0.3500（hero statNumber；按钮上同值出现两次）
    expect(screen.getAllByText('0.3500').length).toBeGreaterThanOrEqual(2)
    // 平均命中率 = 9000/10000 = 90.00%（metaValEmerald）
    expect(screen.getByText('90.00%')).toBeTruthy()
    // Tokens 合计 10500 → hero "10.5" + 单位 "K"
    expect(screen.getByText('10.5')).toBeTruthy()
    expect(screen.getByText('K')).toBeTruthy()
    // 余额
    expect(screen.getByText(/12\.34 CNY/)).toBeTruthy()
  })

  it('余额不可用时显示原因', () => {
    render(<SessionUsageButton
      t={t}
      state={baseState({
        open: true,
        perSession: session,
        balance: { balance: null, currency: 'CNY', updatedAt: null, error: 'provider does not expose an endpoint', source: null },
      })}
      onToggle={() => {}}
    />)
    expect(screen.getByText(/provider does not expose an endpoint/)).toBeTruthy()
  })

  it('点击按钮触发切换回调', () => {
    const onToggle = vi.fn()
    render(<SessionUsageButton t={t} state={baseState()} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
