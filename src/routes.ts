import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { USAGE_STATS_METER_KEY } from './index.ts'
import { parseRange, summarizeRange } from './query.ts'
import { localDateKey } from './meter.ts'
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

/**
 * 构造 usage-stats 全部只读路由（loopback 围栏，全部先过 isLoopbackRequest）。
 * @param getAlertDailyCost - 日费用阈值（插件设置 alertDailyCost；未配置为 undefined），
 *   配置后 /summary 附带 dailyAlert（今日费用与阈值），前端据此渲染超限横幅。
 */
export function makeRoutes(ctx: Context, balance: BalanceClient, getAlertDailyCost?: () => number | undefined): WebRoute[] {
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
      // 会话维度仅在显式携带 sessionId 时附带（会话页用量组件用）；
      // 设置页只统计总量，不带 sessionId 时 perSession 恒为 null。
      const sessionId = url.searchParams.get('sessionId')
      let perSession = null
      if (sessionId !== null) {
        const record = meter.state().sessions[sessionId] ?? null
        // 当前轮的实时消耗（进行中的 turn；用户每发一次信息自动重置）
        const currentTurn = meter.currentTurnUsage(sessionId)
        perSession = record === null ? null : { ...record, currentTurn }
      }
      // 日费用阈值提醒：配置后附带今日费用与阈值（前端据此渲染超限横幅）。
      const threshold = getAlertDailyCost?.()
      const dailyAlert = typeof threshold === 'number' && threshold > 0
        ? { threshold, todayCost: meter.state().byDay[localDateKey(Date.now())]?.bucket.cost ?? 0 }
        : undefined
      // 条件请求：内容未变化返回 304（前端轮询 30s，省带宽与重渲染）。
      const payload = JSON.stringify({ ...summary, perSession, ...(dailyAlert === undefined ? {} : { dailyAlert }) })
      const etag = `"${createHash('sha1').update(payload).digest('hex')}"`
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag })
      res.end(payload)
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

  // GET /balance：返回最近一次各 provider 余额/配额快照（定时器维护）。
  const balanceRoute: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/balance',
    handler: (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed' }); return }
      writeJson(res, 200, { providers: balance.snapshot() })
    },
  }

  // POST /balance/refresh：立即重新拉取一次全部 provider 余额。
  const refreshBalance: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/balance/refresh',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'POST') { writeJson(res, 405, { error: 'method not allowed' }); return }
      writeJson(res, 200, { providers: await balance.refresh() })
    },
  }

  // GET /top-sessions：最贵会话排行（按费用降序，limit 缺省 10、上限 50）。
  const topSessions: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/top-sessions',
    handler: (req, res) => {
      if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden' }); return }
      if (req.method !== 'GET') { writeJson(res, 405, { error: 'method not allowed' }); return }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parsed = Number(url.searchParams.get('limit') ?? '10')
      const limit = Number.isFinite(parsed) ? Math.min(50, Math.max(1, Math.floor(parsed))) : 10
      const sessions = meterOf(ctx).state().sessions
      const rows = Object.values(sessions)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, limit)
        .map((s) => ({
          sessionId: s.sessionId,
          workspace: s.workspace,
          turns: s.turns,
          requests: s.requests,
          cost: s.cost,
          lastRequestAt: s.lastRequestAt,
        }))
      writeJson(res, 200, rows)
    },
  }

  // GET /export：当前范围的按日×分模型明细 CSV（附件下载；BOM 便于 Excel 识别 UTF-8）。
  const exportRoute: WebRoute = {
    kind: 'exact',
    path: '/api/dsh-usage-stats/export',
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
      const { byDay } = meterOf(ctx).state()
      const lines = ['date,model,requests,uncached_input_tokens,cache_read_tokens,cache_write_tokens,output_tokens,cost']
      for (const [date, day] of Object.entries(byDay)) {
        if (date < parsed.query.from || date > parsed.query.to) continue
        for (const [model, b] of Object.entries(day.byModel)) {
          lines.push([
            date,
            `"${model.replaceAll('"', '""')}"`,
            String(b.requests),
            String(b.uncachedInputTokens),
            String(b.cacheReadTokens),
            String(b.cacheWriteTokens),
            String(b.outputTokens),
            b.cost.toFixed(6),
          ].join(','))
        }
      }
      const csv = `\uFEFF${lines.join('\r\n')}\r\n`
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="usage-${parsed.query.from}-to-${parsed.query.to}.csv"`,
      })
      res.end(csv)
    },
  }

  return [summary, session, balanceRoute, refreshBalance, topSessions, exportRoute]
}
