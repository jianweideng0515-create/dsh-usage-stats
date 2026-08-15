import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { UsageStatsMeter } from './meter.ts'
import { priceBuckets, resolvePrices } from './pricing.ts'
import type { ModelPrice } from './pricing.ts'
import { UsageStatsStore } from './store.ts'
import { makeRoutes } from './routes.ts'
import { BalanceClient } from './balance.ts'
import type { BalanceSettings } from './provider-detect.ts'
import { detectBalanceEndpoint } from './provider-detect.ts'

export const name = 'usage-stats'

// sessions 用于事件订阅；webServer 用于注册 /api/dsh-usage-stats/* 只读路由；
// agentDefaultModel + llm 供余额端点自动推断（cordis 4 的 ctx 是 Proxy，
// 未 inject 的服务即使存在也会在读取时抛错）；settings 经 installSettingsSection
// 内部的可选注入接入，故不在此声明。
export const inject = ['sessions', 'webServer', 'agentDefaultModel', 'llm']

/** 宿主端在 ctx 上暴露 meter 的键（路由/余额任务读取）。 */
export const USAGE_STATS_METER_KEY = Symbol('usage-stats.meter')

export const USAGE_STATS_SETTINGS_NAMESPACE: SettingsNamespace = settingsNamespace('usage-stats')

export interface Config {
  /** 总开关；false 时停止订阅、写盘与 meter 挂载。 */
  enabled?: boolean
  /** 持久化文件路径；缺省 ~/.dsh/dsh-usage-stats.json（测试注入用）。 */
  filePath?: string
  /** 用户按模型覆盖的单价（每百万 token）。 */
  prices?: Record<string, ModelPrice>
  /** 未知模型兜底单价。 */
  defaultPrice?: ModelPrice
  /** 计价货币显示名，默认 CNY。 */
  currency?: string
  /** 余额拉取配置；缺省 auto 自动推断。 */
  balance?: BalanceSettings
}

const priceSchema = z.object({
  input: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
  output: z.number().min(0),
})

/** 运行时 schema（schemastery）。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  filePath: z.string(),
  prices: z.dict(priceSchema),
  defaultPrice: priceSchema,
  currency: z.string().default('CNY'),
  balance: z.object({
    mode: z.union([z.const('auto'), z.const('manual'), z.const('off')]).default('auto'),
    baseUrl: z.string(),
    path: z.string(),
    apiKeyEnv: z.string(),
    refreshMs: z.number().min(1000),
  }),
})

const SAVE_DEBOUNCE_MS = 30_000
const FLUSH_THROTTLE_MS = 5_000

export function apply(ctx: Context, config: Config = {}): void {
  // 权威配置源：settings 挂载时为 scope，否则为组合入口 config。
  let current: () => Config = () => config ?? {}
  // 当前挂载纤程（事件订阅 + 最终写盘 effect + ctx 键）；重建时整体卸载。
  let disposeFiber: (() => void) | undefined
  let meter: UsageStatsMeter
  let store: UsageStatsStore
  let installedAt: string | null = null

  // 防抖/节流计时器（跨 mount/unmount 复用，重建时清空避免陈旧写盘）。
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let lastFlushSave = 0

  const resolve = (): Required<Pick<Config, 'enabled' | 'filePath' | 'currency'>> & Config => {
    const value = current()
    return {
      enabled: value.enabled ?? true,
      filePath: value.filePath ?? join(homedir(), '.dsh', 'dsh-usage-stats.json'),
      currency: value.currency ?? 'CNY',
      ...value,
    }
  }

  // 余额客户端与定时器：apply 顶层创建一次，跨 mount 保持运行；热更新只改
  // settings/detect（mount 内调用），不重建定时器。整体 dispose 时经效应清理。
  // agentDefaultModel/llm 在 inject 中声明（cordis 硬依赖，web 组合总是存在）；
  // settings 经 ctx.inject 可选注入捕获（服务缺失不影响插件激活），供余额
  // 端点自动推断读取其他插件的命名空间。fetch 用全局 fetch，key 从环境变量读。
  let settingsService: { get(ns: unknown): unknown } | undefined
  ctx.inject(['settings'], (injectedCtx) => {
    settingsService = injectedCtx.settings as { get(ns: unknown): unknown }
    // settings 服务就绪后立即补一次余额刷新：start() 的首次 refresh 可能在
    // 本回调之前执行（inject 异步触发），当时 settingsService 尚未捕获，
    // 自动推断会因读不到命名空间而失败——这里补齐首次正确快照。
    void balance.refresh()
  })
  const balance = new BalanceClient({
    fetchFn: fetch,
    getEnv: (name) => process.env[name],
  })
  const syncBalance = (): void => {
    const value = resolve().balance ?? { mode: 'auto' }
    balance.setSettings(value)
    balance.setDetect(() => {
      const result = detectBalanceEndpoint(ctx, resolve().balance ?? { mode: 'auto' }, settingsService)
      if (!result.ok) {
        // 诊断：记录推断失败时的服务与命名空间状态（生产排查余额不可用原因）
        ctx.logger.warn(`usage-stats: balance detect failed: ${result.reason} (settings captured: ${settingsService !== undefined})`)
      }
      return result
    })
  }
  // 先同步检测配置再启动定时器：start() 会立即 refresh 一次，若检测闭包尚未
  // 设置，首次快照会停留在默认的 disabled 状态（要等下一轮定时刷新才纠正）。
  syncBalance()
  const stopBalance = balance.start(resolve().balance?.refreshMs ?? 600_000)
  ctx.effect(() => stopBalance, 'usage-stats: balance timer')

  const syncPrices = (target: UsageStatsMeter): void => {
    const value = resolve()
    const prices = resolvePrices(value.prices)
    target.setPriceResolver((model, buckets) => priceBuckets(model, buckets, prices, value.defaultPrice))
  }

  /** 立即写盘；任何异常仅告警，不抛出。 */
  const saveNow = (target: UsageStatsMeter, file: UsageStatsStore): void => {
    try {
      file.save(target.state(), installedAt)
    } catch (error) {
      ctx.logger.warn(`usage-stats: 写盘失败: ${String(error)}`)
    }
  }

  /** 防抖 30s 写盘。 */
  const scheduleSave = (target: UsageStatsMeter, file: UsageStatsStore): void => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      saveNow(target, file)
    }, SAVE_DEBOUNCE_MS)
  }

  const unmount = (): void => {
    if (disposeFiber !== undefined) {
      if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined }
      disposeFiber()
      disposeFiber = undefined
    }
  }

  const mount = (): void => {
    const value = resolve()
    store = new UsageStatsStore(value.filePath)
    installedAt = store.lastInstalledAt() ?? null
    const loaded = store.load()
    meter = new UsageStatsMeter()
    if (loaded !== null) {
      installedAt = store.lastInstalledAt() ?? installedAt
      meter.restore(loaded)
    }
    syncPrices(meter)
    syncBalance()
    lastFlushSave = 0

    // 订阅全局会话事件：实时累计并排期写盘。
    const onEvent = (session: Session, event: SessionEvent): void => {
      meter.applyEvent(session.id as unknown as string, session.header.cwd ?? null, event)
      scheduleSave(meter, store)
    }
    const onFlush = (): void => {
      const now = Date.now()
      if (now - lastFlushSave >= FLUSH_THROTTLE_MS) {
        lastFlushSave = now
        saveNow(meter, store)
      }
    }
    const offEvent = ctx.on('session/event', onEvent, { global: true })
    const offFlush = ctx.on('session/flush', onFlush, { global: true })
    // 路由 handler 运行时从 ctx 读当前 meter，故注册一次即可随重挂载取到最新状态。
    const routes = makeRoutes(ctx, balance)
    const routeDisposers = routes.map((route) => ctx.webServer.register(route))
    // 卸载时落盘一次（含正常 dispose 的最终写盘）。
    const disposeEffect = ctx.effect(() => () => {
      saveNow(meter, store)
    }, 'usage-stats: final save')
    ;(ctx as unknown as Record<symbol, unknown>)[USAGE_STATS_METER_KEY] = meter

    disposeFiber = () => {
      // 先注销路由，再注销事件，最后写盘。
      for (const dispose of routeDisposers) dispose()
      offEvent()
      offFlush()
      disposeEffect()
    }
  }

  const remount = (): void => {
    unmount()
    // 重建会导致 meter 折叠态丢失，可接受（任务要求热更新后能继续累计即可）。
    if (!resolve().enabled) return
    mount()
  }

  installSettingsSection(ctx, USAGE_STATS_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source; remount() },
    onChange: remount,
  })
  remount()
}
