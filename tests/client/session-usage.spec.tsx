import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle (window.__ModuleLoader__),
// not importable under vitest; stub the store factory the controller uses.
const { mockStores } = vi.hoisted(() => ({ mockStores: new Map<string, { get: () => unknown; set: (v: unknown) => void }>() }))
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => {
    const store = {
      get: () => init,
      set: (next: unknown) => { init = next },
      subscribe: () => () => {},
    }
    mockStores.set(`store-${mockStores.size}`, store)
    return store
  },
  SnapshotStore: {},
}))
import type { PerSession } from '../../src/client/api.ts'
import { SessionUsageButton, SessionUsageController } from '../../src/client/session-usage.tsx'
import type { SessionUsageStore } from '../../src/client/session-usage.tsx'

/** 会话切换测试用的 mock 响应（vi.hoisted 满足 vi.mock 工厂的 hoisting 约束）。 */
const { mockSessionResponses } = vi.hoisted(() => ({
  mockSessionResponses: new Map<string, PerSession>(),
}))

vi.mock('../../src/client/api.ts', () => ({
  fetchSessionUsage: vi.fn((sid: string) => Promise.resolve(mockSessionResponses.get(sid) ?? null)),
  fetchBalance: vi.fn(() => Promise.resolve({ balance: null, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null })),
  refreshBalance: vi.fn(() => Promise.resolve({ balance: null, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null })),
}))

/** 文件级清理：每个用例后卸载 DOM（vitest 未开 globals，无自动 cleanup）。 */
afterEach(() => cleanup())

const session: PerSession = {
  sessionId: 's1', workspace: null,
  turns: 5, requests: 12, cost: 0.35,
  uncachedInputTokens: 1000, cacheReadTokens: 9000, cacheWriteTokens: 0, outputTokens: 500,
  lastRequestAt: null, lastModel: 'deepseek-chat',
  lastRequestCost: 0.05, lastRequestHitRate: 0.4, lastRequestTokens: 1200,
  lastTurnTokens: 5000, lastTurnCost: 0.08,
  currentTurn: null,
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

  it('无记录会话按钮显示 - | - 且面板给出提示', () => {
    render(<SessionUsageButton
      t={t}
      state={baseState({ open: true, perSession: null })}
      onToggle={() => {}}
    />)
    // 按钮：Tokens 与 Cost 均用 - 占位（不显示 0）
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('0 | -')).toBeNull()
    // 面板：无记录提示（t 直接透传 key）
    expect(screen.getByText('session.noRecord')).toBeTruthy()
  })

  it('展开时渲染 8 项会话指标', () => {
    render(<SessionUsageButton
      t={t}
      state={baseState({
        open: true,
        perSession: session,
        balance: { balance: 12.34, currency: 'CNY', updatedAt: null, error: null, source: null, quota: null },
      })}
      onToggle={() => {}}
    />)
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    // 本次命中 40.00%（hitBadge）；本次费用 = 本轮消耗 0.0800（lastTurnCost，无进行中轮）
    expect(screen.getByText('40.00%')).toBeTruthy()
    expect(screen.getByText('0.0800')).toBeTruthy()
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
        balance: { balance: null, currency: 'CNY', updatedAt: null, error: 'provider does not expose an endpoint', source: null, quota: null },
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

describe('SessionUsageController 切换会话', () => {
  it('切换会话立即清空旧数据并重新拉取', async () => {
    mockSessionResponses.set('s-a', { ...session, sessionId: 's-a', turns: 1, lastTurnTokens: 100 })
    mockSessionResponses.set('s-b', { ...session, sessionId: 's-b', turns: 9, lastTurnTokens: 900 })
    const { fetchSessionUsage } = await import('../../src/client/api.ts')
    const fetchSessionUsageMock = fetchSessionUsage as unknown as ReturnType<typeof vi.fn>
    const controller = new SessionUsageController()
    controller.inject('s-a')
    controller.toggle() // 打开面板 → 拉取 s-a
    await new Promise((r) => setTimeout(r, 20))
    const face = controller.inject('s-b') // 切换会话
    await new Promise((r) => setTimeout(r, 20))
    const snapshot = face.hooks.sessionUsage.get()
    expect(snapshot.perSession?.sessionId).toBe('s-b')
    expect(snapshot.perSession?.turns).toBe(9)
    expect(fetchSessionUsageMock.mock.calls.some((c) => c[0] === 's-b')).toBe(true)
    fetchSessionUsageMock.mockClear()
  })

  it('面板未打开时绑定会话也会拉取一次（按钮不显示 0）', async () => {
    mockSessionResponses.set('s-c', { ...session, sessionId: 's-c', turns: 3, lastTurnTokens: 300 })
    const { fetchSessionUsage } = await import('../../src/client/api.ts')
    const fetchSessionUsageMock = fetchSessionUsage as unknown as ReturnType<typeof vi.fn>
    fetchSessionUsageMock.mockClear()
    const controller = new SessionUsageController()
    const face = controller.inject('s-c') // 不打开面板
    await new Promise((r) => setTimeout(r, 20))
    const snapshot = face.hooks.sessionUsage.get()
    expect(snapshot.open).toBe(false)
    expect(snapshot.perSession?.sessionId).toBe('s-c')
    expect(snapshot.perSession?.turns).toBe(3)
    expect(fetchSessionUsageMock.mock.calls.some((c) => c[0] === 's-c')).toBe(true)
    fetchSessionUsageMock.mockClear()
  })

  it('切回原会话时 rebind 重新拉取（框架 inject 缓存不调用时的兜底）', async () => {
    mockSessionResponses.set('s-a', { ...session, sessionId: 's-a', turns: 1, lastTurnTokens: 100 })
    mockSessionResponses.set('s-b', { ...session, sessionId: 's-b', turns: 9, lastTurnTokens: 900 })
    const { fetchSessionUsage } = await import('../../src/client/api.ts')
    const fetchSessionUsageMock = fetchSessionUsage as unknown as ReturnType<typeof vi.fn>
    fetchSessionUsageMock.mockClear()
    const controller = new SessionUsageController()
    const faceA = controller.inject('s-a') // 首次绑定 A
    await new Promise((r) => setTimeout(r, 20))
    controller.inject('s-b') // 切到 B（框架对新会话调用 inject）
    await new Promise((r) => setTimeout(r, 20))
    faceA.rebind('s-a') // 框架缓存命中不再调用 inject，组件层 rebind 切回 A
    await new Promise((r) => setTimeout(r, 20))
    const snapshot = faceA.hooks.sessionUsage.get()
    expect(snapshot.perSession?.sessionId).toBe('s-a')
    expect(snapshot.perSession?.turns).toBe(1)
    expect(fetchSessionUsageMock.mock.calls.some((c) => c[0] === 's-a')).toBe(true)
    fetchSessionUsageMock.mockClear()
  })
})

