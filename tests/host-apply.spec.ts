import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Fiber } from '@deepseek-ai/cordis'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import { apply, inject, USAGE_STATS_METER_KEY } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { UsageStatsMeter } from '../src/meter.ts'
import { UsageStatsStore } from '../src/store.ts'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-stats-host-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** 从插件纤程 ctx 上读取宿主端挂载的 meter。 */
function meterOf(fiberCtx: Context): UsageStatsMeter {
  const m = (fiberCtx as unknown as Record<symbol, unknown>)[USAGE_STATS_METER_KEY]
  if (!(m instanceof UsageStatsMeter)) throw new Error('expect meter mounted on ctx')
  return m
}

async function startPlugin(config: Partial<Config>): Promise<{ ctx: Context; fiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  // 插件 inject 声明 webServer/agentDefaultModel/llm；单测不启动真实服务，
  // 提供最小伪服务以通过依赖解析与 cordis 的注入检查。
  const fakeWebServer = {
    register: (_route: WebRoute): (() => void) => () => undefined,
  }
  const fakeAgentDefaultModel = {
    currentSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }),
  }
  const fakeLlm = {
    listConfigurableProviders: () => [],
  }
  ctx.provide('webServer' as never, fakeWebServer as never)
  ctx.provide('agentDefaultModel' as never, fakeAgentDefaultModel as never)
  ctx.provide('llm' as never, fakeLlm as never)
  const fiber = await ctx.plugin({ inject, apply }, config)
  return { ctx, fiber }
}

function appendRequest(session: Session): void {
  session.append('request/header', { header: { config: { provider: 'p', model: 'deepseek-chat' } }, reason: 'initial' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } } })
  session.append('step/end', { turn: 1, step: 1 })
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('usage-stats host apply', () => {
  it('默认启用：事件累计 + flush 后落盘', async () => {
    const dir = tempDir()
    const filePath = join(dir, 'stats.json')
    const { ctx, fiber } = await startPlugin({ filePath })
    const session = ctx.sessions.create()
    appendRequest(session)
    await ctx.sessions.flush(session)
    // flush 节流 5s 内首次触发立即写盘；等待写盘完成
    await sleep(50)
    const meter = meterOf(fiber.ctx)
    expect(meter.state().totals.requests).toBe(1)
    expect(meter.state().totals.uncachedInputTokens).toBe(100)
    const store = new UsageStatsStore(filePath)
    const loaded = store.load()
    expect(loaded?.totals.requests).toBe(1)
    expect(loaded?.totals.uncachedInputTokens).toBe(100)
    await fiber.dispose()
  })

  it('enabled: false 不累计且不挂 meter', async () => {
    const dir = tempDir()
    const filePath = join(dir, 'stats.json')
    const { ctx, fiber } = await startPlugin({ enabled: false, filePath })
    const session = ctx.sessions.create()
    appendRequest(session)
    await sleep(20)
    const mounted = (fiber.ctx as unknown as Record<symbol, unknown>)[USAGE_STATS_METER_KEY]
    expect(mounted).toBeUndefined()
    await fiber.dispose()
  })

  it('dispose 时最终写盘（未 flush）', async () => {
    const dir = tempDir()
    const filePath = join(dir, 'stats.json')
    const { ctx, fiber } = await startPlugin({ filePath })
    const session = ctx.sessions.create()
    appendRequest(session)
    // 不 flush，直接 dispose 插件纤程：ctx.effect 注册的最终写盘应落盘
    await fiber.dispose()
    await sleep(50)
    const meter = meterOf(fiber.ctx)
    expect(meter.state().totals.requests).toBe(1)
    const store = new UsageStatsStore(filePath)
    const loaded = store.load()
    expect(existsSync(filePath)).toBe(true)
    expect(loaded?.totals.requests).toBe(1)
  })
})
