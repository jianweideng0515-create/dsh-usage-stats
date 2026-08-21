import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createEmptyBucket, localDateKey } from '../src/meter.ts'
import type { UsageStatsMeter } from '../src/meter.ts'
import { USAGE_STATS_METER_KEY } from '../src/index.ts'
import { makeRoutes } from '../src/routes.ts'
import type { BalanceClient } from '../src/balance.ts'

const NOW = Date.UTC(2026, 7, 20, 6, 0, 0) // 2026-08-20 本地

/** 构造最小可用 meter 替身：一天有量、一天为零。 */
function fakeMeter() {
  const date = localDateKey(NOW - 86_400_000)
  const bucket = { ...createEmptyBucket(), requests: 2, uncachedInputTokens: 70, cacheReadTokens: 30 }
  return {
    state: () => ({
      totals: { ...createEmptyBucket(), requests: 2 },
      byDay: { [date]: { bucket, byModel: { 'deepseek-chat': bucket } } },
      sessions: {
        s1: { sessionId: 's1', workspace: null, turns: 1, requests: 2, cost: 0.05, uncachedInputTokens: 70, cacheReadTokens: 30, cacheWriteTokens: 0, outputTokens: 0, lastRequestAt: null, lastModel: null, lastRequestCost: null, lastRequestHitRate: null, lastRequestTokens: null, lastTurnTokens: null, lastTurnCost: null },
      },
    }),
    currentTurnUsage: () => null,
  } as unknown as UsageStatsMeter
}

function fakeBalance() {
  const snapshot = {
    opencode: { balance: null, currency: '', updatedAt: '2026-08-20T00:00:00Z', error: null, source: null, quota: null, costCurrency: 'CNY' },
    deepseek: { balance: 12.34, currency: 'CNY', updatedAt: '2026-08-20T00:00:00Z', error: null, source: null, quota: null, costCurrency: 'CNY' },
  }
  return {
    snapshot: () => snapshot,
    refresh: async () => snapshot,
  } as unknown as BalanceClient
}

function makeCtx(meter: UsageStatsMeter): Context {
  return { [USAGE_STATS_METER_KEY]: meter } as unknown as Context
}

function mockReq(url: string, method = 'GET', remote = '127.0.0.1', extraHeaders: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress: remote }, headers: { host: '127.0.0.1:3080', ...extraHeaders }, url, method } as unknown as IncomingMessage
}

function mockRes() {
  const state = { status: 0, body: '', headers: {} as Record<string, unknown> }
  const res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      state.status = status
      if (headers !== undefined) Object.assign(state.headers, headers)
    },
    end: (body?: string) => { state.body = body ?? '' },
  }
  return { res: res as unknown as ServerResponse, state }
}

function setup() {
  const ctx = makeCtx(fakeMeter())
  const balance = fakeBalance()
  return makeRoutes(ctx, balance)
}

describe('routes handlers', () => {
  it('summary 缺省今日：补零序列 + perSession 为 null', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary'), res)
    expect(state.status).toBe(200)
    const body = JSON.parse(state.body)
    expect(body.from).toBe(body.to)
    expect(body.series).toHaveLength(1)
    expect(body.perSession).toBeNull()
  })

  it('summary 带 sessionId：返回会话明细与当前轮', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary?sessionId=s1'), res)
    expect(state.status).toBe(200)
    const body = JSON.parse(state.body)
    expect(body.perSession).not.toBeNull()
    expect(body.perSession.sessionId).toBe('s1')
    expect(body.perSession.currentTurn).toBeNull()
  })

  it('summary 非法日期返回 400', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary?from=bad&to=2026-08-20'), res)
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body).error).toContain('invalid')
  })

  it('非 loopback 请求被围栏拒绝（403）', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary', 'GET', '192.168.1.2'), res)
    expect(state.status).toBe(403)
  })

  it('错误方法返回 405', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary', 'POST'), res)
    expect(state.status).toBe(405)
  })

  it('balance GET 返回 providers 快照表', async () => {
    const routes = setup()
    const balanceRoute = routes.find((r) => r.path === '/api/dsh-usage-stats/balance')
    if (balanceRoute === undefined || balanceRoute.kind !== 'exact') throw new Error('balance route missing')
    const { res, state } = mockRes()
    await balanceRoute.handler(mockReq('/api/dsh-usage-stats/balance'), res)
    expect(state.status).toBe(200)
    const body = JSON.parse(state.body)
    expect(body.providers.deepseek.balance).toBe(12.34)
    expect(body.providers.opencode.quota).toBeNull()
  })

  it('balance/refresh POST 返回刷新后的快照表', async () => {
    const routes = setup()
    const refresh = routes.find((r) => r.path === '/api/dsh-usage-stats/balance/refresh')
    if (refresh === undefined || refresh.kind !== 'exact') throw new Error('refresh route missing')
    const { res, state } = mockRes()
    await refresh.handler(mockReq('/api/dsh-usage-stats/balance/refresh', 'POST'), res)
    expect(state.status).toBe(200)
    const body = JSON.parse(state.body)
    expect(body.providers.deepseek.balance).toBe(12.34)
  })

  it('sessions prefix 路由按 id 返回会话记录', async () => {
    const routes = setup()
    const sessions = routes.find((r) => r.path === '/api/dsh-usage-stats/sessions')
    if (sessions === undefined || sessions.kind !== 'prefix') throw new Error('sessions route missing')
    const { res, state } = mockRes()
    await sessions.handler(mockReq('/api/dsh-usage-stats/sessions/s1'), res)
    expect(state.status).toBe(200)
    expect(JSON.parse(state.body).session.sessionId).toBe('s1')
  })

  it('summary 条件请求：ETag 未变化返回 304', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const first = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary'), first.res)
    expect(first.state.status).toBe(200)
    const etag = first.state.headers.etag
    expect(typeof etag).toBe('string')
    // 带 If-None-Match 再请求 → 304 空体
    const second = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary', 'GET', '127.0.0.1', { 'if-none-match': String(etag) }), second.res)
    expect(second.state.status).toBe(304)
    expect(second.state.body).toBe('')
  })

  it('top-sessions 按费用降序返回会话行', async () => {
    const routes = setup()
    const top = routes.find((r) => r.path === '/api/dsh-usage-stats/top-sessions')
    if (top === undefined || top.kind !== 'exact') throw new Error('top-sessions route missing')
    const { res, state } = mockRes()
    await top.handler(mockReq('/api/dsh-usage-stats/top-sessions'), res)
    expect(state.status).toBe(200)
    const rows = JSON.parse(state.body)
    expect(rows).toHaveLength(1)
    expect(rows[0].sessionId).toBe('s1')
    expect(rows[0].cost).toBe(0.05)
  })

  it('export 返回 CSV 明细（BOM + 表头 + 数据行）', async () => {
    const routes = setup()
    const exp = routes.find((r) => r.path === '/api/dsh-usage-stats/export')
    if (exp === undefined || exp.kind !== 'exact') throw new Error('export route missing')
    const date = localDateKey(NOW - 86_400_000)
    const { res, state } = mockRes()
    await exp.handler(mockReq(`/api/dsh-usage-stats/export?from=${date}&to=${date}`), res)
    expect(state.status).toBe(200)
    expect(state.headers['content-type']).toContain('text/csv')
    expect(state.headers['content-disposition']).toContain('attachment')
    const csv = state.body as string
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('date,model,requests')
    expect(csv).toContain(`${date},"deepseek-chat",2,70,30,0,0`)
  })

  it('dailyAlert：配置阈值后 summary 附带今日费用与阈值', async () => {
    const ctx = makeCtx(fakeMeter())
    const balance = fakeBalance()
    const routes = makeRoutes(ctx, balance, () => 5)
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary?from=2026-08-19&to=2026-08-20'), res)
    const body = JSON.parse(state.body)
    expect(body.dailyAlert.threshold).toBe(5)
    expect(typeof body.dailyAlert.todayCost).toBe('number')
  })

  it('dailyAlert：未配置阈值时不出现在响应中', async () => {
    const routes = setup()
    const summary = routes.find((r) => r.path === '/api/dsh-usage-stats/summary')
    if (summary === undefined || summary.kind !== 'exact') throw new Error('summary route missing')
    const { res, state } = mockRes()
    await summary.handler(mockReq('/api/dsh-usage-stats/summary'), res)
    expect(JSON.parse(state.body).dailyAlert).toBeUndefined()
  })
})
