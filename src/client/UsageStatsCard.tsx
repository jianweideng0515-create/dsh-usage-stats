import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { fetchBalance, fetchSummary, refreshBalance } from './api.ts'
import type { BalanceResponse, SummaryResponse } from './api.ts'
import styles from './card.module.css'

/** 统计卡片主体所需的 props（受控组件，数据由 controller 轮询提供）。 */
export interface UsageStatsCardProps {
  /** 文案读取器。 */
  t: (key: string) => string
  /** 区间汇总；null 表示尚未拿到数据。 */
  summary: SummaryResponse | null
  /** 余额快照；null 表示仍在加载。 */
  balance: BalanceResponse | null
  /** 请求进行中。 */
  loading: boolean
  /** 最近一次请求错误。 */
  error: string | null
  /** 当前范围；'custom' 表示自定义起止。 */
  rangeDays: number | 'custom'
  /** 自定义开始日期（YYYY-MM-DD）。 */
  customFrom: string
  /** 自定义结束日期（YYYY-MM-DD）。 */
  customTo: string
  /** 切换固定范围（7/14/30/90）或自定义。 */
  onRangeDays: (days: number | 'custom') => void
  /** 编辑自定义开始日期。 */
  onCustomFrom: (value: string) => void
  /** 编辑自定义结束日期。 */
  onCustomTo: (value: string) => void
  /** 手动刷新余额。 */
  onRefreshBalance: () => void
  /** 余额刷新进行中。 */
  balanceRefreshing: boolean
}

const RANGES: Array<{ key: 'last7' | 'last14' | 'last30' | 'last90'; days: number }> = [
  { key: 'last7', days: 7 },
  { key: 'last14', days: 14 },
  { key: 'last30', days: 30 },
  { key: 'last90', days: 90 },
]

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(2) + 'M'
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K'
  return String(tokens)
}

function formatCost(cost: number): string {
  return cost.toFixed(4)
}

function formatRate(rate: number): string {
  return Math.round(rate * 100) + '%'
}

/** 统计卡片主体：总览 + 今日/会话摘要 + 趋势 + 模型明细 + 余额。 */
export function UsageStatsCard(props: UsageStatsCardProps): ReactElement {
  const { t, summary, balance, loading, error } = props
  const maxSeries = useMemo(() => {
    if (summary === null || summary.series.length === 0) return 0
    return Math.max(...summary.series.map((p) => p.tokens))
  }, [summary])

  return (
    <div className={styles.card}>
      <div className={styles.rangeRow}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={props.rangeDays === r.days ? styles.rangeActive : styles.range}
            onClick={() => props.onRangeDays(r.days)}
          >
            {t('range.' + r.key)}
          </button>
        ))}
        <button
          type="button"
          className={props.rangeDays === 'custom' ? styles.rangeActive : styles.range}
          onClick={() => props.onRangeDays('custom')}
        >
          {t('range.custom')}
        </button>
      </div>
      {props.rangeDays === 'custom' ? (
        <div className={styles.customRow}>
          <label>
            {t('range.from')}
            <input type="date" value={props.customFrom} onChange={(e) => props.onCustomFrom(e.target.value)} />
          </label>
          <label>
            {t('range.to')}
            <input type="date" value={props.customTo} onChange={(e) => props.onCustomTo(e.target.value)} />
          </label>
        </div>
      ) : null}
      {loading && summary === null ? <p className={styles.status}>{t('loading')}</p> : null}
      {error !== null ? <p className={styles.status}>{t('error')}: {error}</p> : null}
      {summary !== null ? (
        <>
          <dl className={styles.metrics}>
            <div><dt>{t('metric.tokens')}</dt><dd title={t('metric.tokensHint')}>{formatTokens(summary.tokens.total)}</dd></div>
            <div><dt>{t('metric.requests')}</dt><dd>{summary.requests}</dd></div>
            <div><dt>{t('metric.turns')}</dt><dd>{summary.turns}</dd></div>
            <div><dt>{t('metric.activeDays')}</dt><dd>{summary.activeDays}</dd></div>
            <div><dt>{t('metric.avgHitRate')}</dt><dd>{formatRate(summary.avgCacheHitRate)}</dd></div>
            <div><dt>{t('metric.topModel')}</dt><dd>{summary.topModel ?? '-'}</dd></div>
            <div><dt>{t('metric.cost')}</dt><dd>{formatCost(summary.cost)}</dd></div>
            <div><dt>{t('metric.uncounted')}</dt><dd>{summary.uncountedRequests}</dd></div>
          </dl>
          <div className={styles.tokenSplit}>
            <span>{t('tokens.input')} {formatTokens(summary.tokens.uncachedInputTokens)}</span>
            <span>{t('tokens.cacheRead')} {formatTokens(summary.tokens.cacheReadTokens)}</span>
            <span>{t('tokens.cacheWrite')} {formatTokens(summary.tokens.cacheWriteTokens)}</span>
            <span>{t('tokens.output')} {formatTokens(summary.tokens.outputTokens)}</span>
          </div>
          {summary.perSession !== null ? (
            <dl className={styles.metrics}>
              <div><dt>{t('metric.lastHit')}</dt><dd>{summary.perSession.lastRequestHitRate === null ? '-' : formatRate(summary.perSession.lastRequestHitRate)}</dd></div>
              <div><dt>{t('metric.lastCost')}</dt><dd>{summary.perSession.lastRequestCost === null ? '-' : formatCost(summary.perSession.lastRequestCost)}</dd></div>
              <div><dt>{t('metric.sessionTurns')}</dt><dd>{summary.perSession.turns}</dd></div>
              <div><dt>{t('metric.sessionCost')}</dt><dd>{formatCost(summary.perSession.cost)}</dd></div>
            </dl>
          ) : null}
          <h4 className={styles.heading}>{t('trend.title')}</h4>
          <div className={styles.bars}>
            {summary.series.map((p) => (
              <div key={p.bucket} className={styles.barCol} title={`${p.bucket}: ${p.requests} req, ${formatTokens(p.tokens)} tok`}>
                <div className={styles.bar} style={{ height: maxSeries > 0 ? `${Math.max(4, (p.tokens / maxSeries) * 100)}%` : '4%' }} />
              </div>
            ))}
          </div>
          <h4 className={styles.heading}>{t('model.table')}</h4>
          <table className={styles.table}>
            <thead><tr><th>{t('metric.topModel')}</th><th>{t('metric.requests')}</th><th>{t('metric.tokens')}</th><th>{t('metric.cost')}</th></tr></thead>
            <tbody>
              {summary.byModel.map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td><td>{m.requests}</td><td>{formatTokens(m.tokens)}</td><td>{formatCost(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      <div className={styles.balance}>
        <h4 className={styles.heading}>{t('balance.title')}</h4>
        {balance === null ? <p className={styles.status}>{t('loading')}</p> : balance.balance === null ? (
          <p className={styles.status}>{t('balance.unavailable')}{balance.error !== null ? `: ${balance.error}` : ''}</p>
        ) : (
          <p>
            {t('balance.amount')}: {balance.balance} {balance.currency}
            {balance.updatedAt !== null ? ` (${t('balance.updated')}: ${new Date(balance.updatedAt).toLocaleString()})` : ''}
            {balance.source !== null ? ` (${t('balance.source')}: ${balance.source.source})` : ''}
          </p>
        )}
        <button type="button" className={styles.refresh} disabled={props.balanceRefreshing} onClick={props.onRefreshBalance}>
          {props.balanceRefreshing ? t('balance.refreshing') : t('balance.refresh')}
        </button>
      </div>
    </div>
  )
}

/** 卡片投影快照（controller 注入给渲染层）。 */
export interface UsageStatsCardStore {
  summary: SummaryResponse | null
  balance: BalanceResponse | null
  loading: boolean
  error: string | null
  rangeDays: number | 'custom'
  customFrom: string
  customTo: string
  balanceRefreshing: boolean
}

/** controller 暴露的动作。 */
export interface UsageStatsCardActions {
  onRangeDays: (days: number | 'custom') => void
  onCustomFrom: (value: string) => void
  onCustomTo: (value: string) => void
  onRefreshBalance: () => void
}

/** 插槽注册侧注入面：hooks 快照 + 动作。 */
export interface UsageStatsCardFace extends UsageStatsCardActions {
  hooks: {
    usageStatsCard: SnapshotStore<UsageStatsCardStore>
  }
}

const REFRESH_INTERVAL_MS = 30_000

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 统计卡片 controller：持有范围与数据状态，30s 轮询 summary/balance。 */
export class UsageStatsCardController {
  private readonly store: SnapshotStore<UsageStatsCardStore>
  private rangeDays: number | 'custom' = 7
  private customFrom = ''
  private customTo = ''
  private summary: SummaryResponse | null = null
  private balance: BalanceResponse | null = null
  private loading = false
  private error: string | null = null
  private balanceRefreshing = false
  private abort: AbortController | null = null
  private readonly timer: ReturnType<typeof setInterval>

  constructor() {
    this.store = createSnapshotStore(this.projection())
    void this.pollSummary()
    void this.pollBalance()
    this.timer = setInterval(() => {
      void this.pollSummary()
      void this.pollBalance()
    }, REFRESH_INTERVAL_MS)
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
      balance: this.balance,
      loading: this.loading,
      error: this.error,
      rangeDays: this.rangeDays,
      customFrom: this.customFrom,
      customTo: this.customTo,
      balanceRefreshing: this.balanceRefreshing,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
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
      const summary = await fetchSummary(from, to, controller.signal)
      if (controller.signal.aborted) return
      this.summary = summary
      this.error = null
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
      this.balance = await fetchBalance()
    } catch (e) {
      this.balance = { balance: null, currency: 'CNY', updatedAt: null, error: String((e as Error)?.message ?? e), source: null }
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
            this.balance = await refreshBalance()
          } catch (e) {
            this.balance = { balance: null, currency: 'CNY', updatedAt: null, error: String((e as Error)?.message ?? e), source: null }
          }
          this.balanceRefreshing = false
          this.publish()
        })()
      },
    }
  }
}

/** The registered card's slot namespace. */
const CARD_NS = 'usage-stats' as const

/** Slot-registered composed props: standard kit, locale seat, injected face. */
type UsageStatsSlotProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<typeof CARD_NS>
  & InjectFace<UsageStatsCardFace>

/** The controlled card's widened t signature (the framework t is namespace-keyed). */
type CardTranslate = (key: string) => string

/**
 * Adapter that bridges the controller's injected snapshot and actions onto
 * the controlled UsageStatsCard against the slot-composed prop contract.
 */
export function UsageStatsSlotCard(props: UsageStatsSlotProps): ReactElement {
  const state = props.useUsageStatsCard((s) => s)
  const t = props.t as CardTranslate
  return (
    <UsageStatsCard
      t={t}
      summary={state.summary}
      balance={state.balance}
      loading={state.loading}
      error={state.error}
      rangeDays={state.rangeDays}
      customFrom={state.customFrom}
      customTo={state.customTo}
      onRangeDays={props.onRangeDays}
      onCustomFrom={props.onCustomFrom}
      onCustomTo={props.onCustomTo}
      onRefreshBalance={props.onRefreshBalance}
      balanceRefreshing={state.balanceRefreshing}
    />
  )
}
