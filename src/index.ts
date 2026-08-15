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

export const name = 'usage-stats'

// sessions 用于事件订阅；settings 经 installSettingsSection 内部的可选注入接入，
// 故此处仅声明 sessions（settings 是其可选能力，缺省时安装与测试都无需硬依赖）。
export const inject = ['sessions']

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
    // 卸载时落盘一次（含正常 dispose 的最终写盘）。
    const disposeEffect = ctx.effect(() => () => {
      saveNow(meter, store)
    }, 'usage-stats: final save')
    ;(ctx as unknown as Record<symbol, unknown>)[USAGE_STATS_METER_KEY] = meter

    disposeFiber = () => {
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
