import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { USAGE_STATS_METER_KEY, USAGE_STATS_DEBUG_KEY } from './index.ts'
import { parseRange, summarizeRange } from './query.ts'
import type { UsageStatsMeter } from './meter.ts'
import type { BalanceClient } from './balance.ts'

/** Loopback literal check plus browser same-origin markers (mirrors the pairing routes' fence). */
export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** 一条 JSON 响应。 */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** 从当前纤程 ctx 上读取宿主挂载的 meter（Task 4 在 apply 内挂载）。 */
function meterOf(ctx: Context): UsageStatsMeter {
  return (ctx as unknown as Record<symbol, UsageStatsMeter>)[USAGE_STATS_METER_KEY]
}

/** 最近活跃会话兜底：lastRequestAt 非 null 且最新的一条。 */
function latestActiveSession(meter: UsageStatsMeter) {
  return Object.values(meter.state().sessions)
    .filter((session) => session.lastRequestAt !== null)
    .sort((a, b) => (a.lastRequestAt! < b.lastRequestAt! ? 1 : -1))[0] ?? null
}

/** 构造 usage-stats 全部只读路由（loopback 围栏，全部先过 isLoopbackRequest）。 */
export function makeRoutes(ctx: Context, balance: BalanceClient): WebRoute[] {
  const summary: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/summary',
    handler: (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed' }); return }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parsed = parseRange(
        url.searchParams.get('from') ?? undefined,
        url.searchParams.get('to') ?? undefined,
        Date.now(),
      )
      if (!parsed.ok) { writeJson(res, 400, { error: parsed.error }); return }
      const meter = meterOf(ctx)
      const summary = summarizeRange(meter.state(), parsed.query)
      const sessionId = url.searchParams.get('sessionId')
      let perSession = null
      if (sessionId !== null) {
        perSession = meter.state().sessions[sessionId] ?? null
      } else {
        perSession = latestActiveSession(meter)
      }
      writeJson(res, 200, { ...summary, perSession })
    },
  }

  // prefix 语义：匹配 path 本身以及 path/<anything>；handler 从 req.url 末段取 id。
  const session: WebRoute = {
    kind: 'prefix',
    path: '/api/dsh-usage-stats/sessions',
    handler: (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed' }); return }
      const id = (req.url ?? '').split('?')[0].split('/').pop() ?? ''
      const record = meterOf(ctx).state().sessions[id] ?? null
      writeJson(res, 200, { session: record })
    },
  }

  // GET /balance：返回最近一次余额快照（定时器维护）。
  const balanceRoute: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/balance',
    handler: (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed' }); return }
      const debugFn = (ctx as unknown as Record<symbol, unknown>)[USAGE_STATS_DEBUG_KEY]
      const debug = typeof debugFn === 'function' ? debugFn() : null
      writeJson(res, 200, { ...balance.snapshot(), debug })
    },
  }

  // POST /balance/refresh：立即重新拉取一次余额。
  const refreshBalance: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/balance/refresh',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'POST') { writeJson(res, 405, { error: 'method not allowed' }); return }
      const debugFn = (ctx as unknown as Record<symbol, unknown>)[USAGE_STATS_DEBUG_KEY]
      const debug = typeof debugFn === 'function' ? debugFn() : null
      writeJson(res, 200, { ...(await balance.refresh()), debug })
    },
  }

  return [summary, session, balanceRoute, refreshBalance]
}
