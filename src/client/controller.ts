/**
 * 统计卡片 controller：持有范围与数据状态，展开时 30s 轮询 summary/balance。
 * 设置页 section（UsageStatsSection）经 statsShared 订阅同一 store。
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { fetchBalance, fetchSummary, refreshBalance } from './api.ts'
import type { BalanceMap, SummaryResponse } from './api.ts'

/** 卡片投影快照（controller 注入给渲染层）。 */
export interface UsageStatsCardStore {
  summary: SummaryResponse | null
  balances: BalanceMap | null
  loading: boolean
  error: string | null
  rangeDays: number | 'custom'
  customFrom: string
  customTo: string
  /** 当前生效范围起止（自定义未填时为 null；导出按钮用）。 */
  rangeFrom: string | null
  rangeTo: string | null
  balanceRefreshing: boolean
  /** 卡片是否展开；收起时不渲染内容且暂停轮询。 */
  expanded: boolean
}

/** 插槽注册侧注入面：hooks 快照 + 动作。 */
export interface UsageStatsCardActions {
  onRangeDays: (days: number | 'custom') => void
  onCustomFrom: (value: string) => void
  onCustomTo: (value: string) => void
  onRefreshBalance: () => void
  /** 展开/收起卡片（收起时暂停轮询）。 */
  onToggleExpanded: () => void
}

export interface UsageStatsCardFace extends UsageStatsCardActions {
  hooks: {
    usageStatsCard: SnapshotStore<UsageStatsCardStore>
  }
}

/** 设置页 section 与插件卡共享的 controller face（apply 注入）。 */
export interface StatsShared {
  face: UsageStatsCardFace
  t: (key: string) => string
}

export let statsShared: StatsShared | null = null
export function setStatsShared(shared: StatsShared): void { statsShared = shared }

const REFRESH_INTERVAL_MS = 30_000

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 统计卡片 controller：持有范围与数据状态，展开时 30s 轮询 summary/balance。 */
export class UsageStatsCardController {
  private readonly store: SnapshotStore<UsageStatsCardStore>
  private rangeDays: number | 'custom' = 7
  private customFrom = ''
  private customTo = ''
  private summary: SummaryResponse | null = null
  private balances: BalanceMap | null = null
  private loading = false
  private error: string | null = null
  private balanceRefreshing = false
  private expanded = false
  private abort: AbortController | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.store = createSnapshotStore(this.projection())
    // 默认收起：不发起请求，展开后才开始轮询。
  }

  /** 计算当前范围起点；自定义且未填时返回 null。 */
  private currentFrom(): string | null {
    if (this.rangeDays === 'custom') return this.customFrom === '' ? null : this.customFrom
    const base = new Date()
    base.setDate(base.getDate() - (this.rangeDays - 1))
    return fmtDate(base)
  }

  /** 计算当前范围终点；自定义且未填时返回 null。 */
  private currentTo(): string | null {
    if (this.rangeDays === 'custom') return this.customTo === '' ? null : this.customTo
    return fmtDate(new Date())
  }

  private projection(): UsageStatsCardStore {
    return {
      summary: this.summary,
      balances: this.balances,
      loading: this.loading,
      error: this.error,
      rangeDays: this.rangeDays,
      customFrom: this.customFrom,
      customTo: this.customTo,
      rangeFrom: this.currentFrom(),
      rangeTo: this.currentTo(),
      balanceRefreshing: this.balanceRefreshing,
      expanded: this.expanded,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private startPolling(): void {
    if (this.timer !== null) return
    void this.pollSummary()
    void this.pollBalance()
    this.timer = setInterval(() => {
      void this.pollSummary()
      void this.pollBalance()
    }, REFRESH_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.abort?.abort()
  }

  /** 切换展开状态：展开即拉取并定时刷新，收起即停止轮询并中止在途请求。 */
  toggleExpanded(): void {
    this.expanded = !this.expanded
    if (this.expanded) this.startPolling()
    else this.stopPolling()
    this.publish()
  }

  private async pollSummary(): Promise<void> {
    const from = this.currentFrom()
    const to = this.currentTo()
    if (from === null || to === null) {
      this.loading = true
      this.publish()
      return
    }
    this.abort?.abort()
    const controller = new AbortController()
    this.abort = controller
    this.loading = true
    this.publish()
    try {
      // 304（未变化）返回 null：保留现有 summary，仅清掉加载态。
      const summary = await fetchSummary(from, to, controller.signal)
      if (controller.signal.aborted) return
      if (summary !== null) {
        this.summary = summary
        this.error = null
      }
    } catch (e) {
      if (controller.signal.aborted) return
      this.error = String((e as Error)?.message ?? e)
    } finally {
      if (!controller.signal.aborted) {
        this.loading = false
        this.publish()
      }
    }
  }

  private async pollBalance(): Promise<void> {
    try {
      this.balances = await fetchBalance()
    } catch (e) {
      const error = String((e as Error)?.message ?? e)
      // 拉取失败：为两个内置 provider 各落一条错误快照，保证 UI 可展示失败原因
      this.balances = {
        opencode: { balance: null, currency: '', updatedAt: null, error, source: null, quota: null, costCurrency: 'CNY' },
        deepseek: { balance: null, currency: 'CNY', updatedAt: null, error, source: null, quota: null, costCurrency: 'CNY' },
      }
    }
    this.publish()
  }

  /** 构建插槽注册侧注入面。 */
  inject(): UsageStatsCardFace {
    return {
      hooks: { usageStatsCard: this.store },
      onRangeDays: (days) => {
        this.rangeDays = days
        void this.pollSummary()
      },
      onCustomFrom: (value) => {
        this.customFrom = value
        if (this.rangeDays === 'custom') void this.pollSummary()
      },
      onCustomTo: (value) => {
        this.customTo = value
        if (this.rangeDays === 'custom') void this.pollSummary()
      },
      onRefreshBalance: () => {
        if (this.balanceRefreshing) return
        this.balanceRefreshing = true
        this.publish()
        void (async () => {
          try {
            this.balances = await refreshBalance()
          } catch (e) {
            const error = String((e as Error)?.message ?? e)
            this.balances = {
              opencode: { balance: null, currency: '', updatedAt: null, error, source: null, quota: null, costCurrency: 'CNY' },
              deepseek: { balance: null, currency: 'CNY', updatedAt: null, error, source: null, quota: null, costCurrency: 'CNY' },
            }
          }
          this.balanceRefreshing = false
          this.publish()
        })()
      },
      onToggleExpanded: () => this.toggleExpanded(),
    }
  }
}
