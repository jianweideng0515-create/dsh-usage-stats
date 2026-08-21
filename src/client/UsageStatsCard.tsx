import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import styles from './card.module.css'
import type { BalanceMap, BalanceResponse, SummaryResponse } from './api.ts'
import { fetchTopSessions } from './api.ts'
import type { TopSessionRow } from './api.ts'
import { costSymbol, formatCost, formatRate, formatTokens } from './format.ts'
import { DONUT_SEGMENT_VARS, donutSegments, DonutChart, TrendAreaChart, TREND_METRICS } from './charts.tsx'
import type { TrendMetric } from './charts.tsx'
import { KpiOverview } from './kpi.tsx'
import { QuotaTab } from './quota-tab.tsx'
import { PROVIDERS } from './providers.ts'
import type { ProviderId } from './providers.ts'

// 门面再导出：既有消费方（client/index、UsageStatsSection、测试）从本模块导入。
export { UsageStatsCardController, setStatsShared, statsShared } from './controller.ts'
export type { UsageStatsCardStore, UsageStatsCardActions, UsageStatsCardFace, StatsShared } from './controller.ts'
export type { ProviderId } from './providers.ts'
export type { TrendMetric } from './charts.tsx'

/** 统计卡片主体所需的 props（受控组件，数据由 controller 轮询提供）。 */
export interface UsageStatsCardProps {
  /** 文案读取器。 */
  t: (key: string) => string
  /** 区间汇总；null 表示尚未拿到数据。 */
  summary: SummaryResponse | null
  /** 各 provider 余额/配额快照表；null 表示尚未拿到数据。 */
  balances: BalanceMap | null
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
  /** 当前生效范围起止（controller 解析后；自定义未填时为 null）。 */
  rangeFrom: string | null
  rangeTo: string | null
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

/** 用量概览 Tab 内容：趋势图（指标可切换）+ 会话指标 + 模型明细 + 最贵会话。 */
function OverviewTab(props: {
  t: (key: string) => string
  summary: SummaryResponse
  costCurrency: string
}): ReactElement {
  const { t, summary, costCurrency } = props
  const [metric, setMetric] = useState<TrendMetric>('tokens')
  return (
    <>
      <div className={styles.trendHead}>
        <h4 className={styles.heading}>{t('trend.title')}</h4>
        <div className={styles.trendSwitch} role="group" aria-label={t('trend.title')}>
          {TREND_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={metric === m.key ? styles.trendSwitchOn : styles.trendSwitchBtn}
              onClick={() => setMetric(m.key)}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <TrendAreaChart t={t} costCurrency={costCurrency} metric={metric} series={summary.series} />
      {summary.perSession !== null ? (
        <dl className={styles.metrics}>
          <div><dt>{t('metric.lastHit')}</dt><dd>{summary.perSession.lastRequestHitRate === null ? '-' : formatRate(summary.perSession.lastRequestHitRate)}</dd></div>
          <div><dt>{t('metric.lastCost')}</dt><dd>{summary.perSession.lastRequestCost === null ? '-' : formatCost(summary.perSession.lastRequestCost)}</dd></div>
          <div><dt>{t('metric.sessionTurns')}</dt><dd>{summary.perSession.turns}</dd></div>
          <div><dt>{t('metric.sessionCost')}</dt><dd>{formatCost(summary.perSession.cost)}</dd></div>
        </dl>
      ) : null}
      <h4 className={styles.heading}>{t('model.table')}</h4>
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr><th>{t('metric.topModel')}</th><th className={styles.thRight}>{t('metric.requests')}</th><th className={styles.thRight}>{t('metric.tokens')}</th><th className={styles.thRight}>{t('metric.cost')}</th></tr></thead>
          <tbody>
            {summary.byModel.map((m, i) => (
              <tr key={m.model} className={styles.trHover}>
                <td>
                  <span className={styles.modelDot} style={{ background: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length] }} />
                  <strong>{m.model === '__unknown__' ? t('model.unknown') : m.model}</strong>
                </td>
                <td className={styles.tdRight}>{m.requests}</td>
                <td className={`${styles.tdRight} ${styles.tdStrong}`}>{formatTokens(m.tokens)}</td>
                <td className={styles.tdRight}>
                  <span className={styles.kpiCostVal}>{costSymbol(costCurrency)}{formatCost(m.cost)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary.uncountedRequests > 0 ? <p className={styles.status}>{t('metric.uncounted')}: {summary.uncountedRequests}</p> : null}
      <TopSessions t={t} costCurrency={costCurrency} refreshKey={summary} />
    </>
  )
}

/** 最贵会话排行（按费用降序 Top 10）：summary 每轮更新后跟随刷新。 */
function TopSessions(props: {
  t: (key: string) => string
  costCurrency: string
  refreshKey: unknown
}): ReactElement | null {
  const { t, costCurrency, refreshKey } = props
  const [rows, setRows] = useState<TopSessionRow[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchTopSessions(10).then((r) => {
      if (alive) setRows(r)
    }).catch(() => {
      if (alive) setRows(null)
    })
    return () => { alive = false }
  }, [refreshKey])
  if (rows === null || rows.length === 0) return null
  return (
    <>
      <h4 className={styles.heading}>{t('top.title')}</h4>
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr><th>{t('top.session')}</th><th>{t('top.workspace')}</th><th className={styles.thRight}>{t('metric.turns')}</th><th className={styles.thRight}>{t('metric.requests')}</th><th className={styles.thRight}>{t('metric.cost')}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sessionId} className={styles.trHover}>
                <td className={styles.tdStrong}>#{i + 1} {r.sessionId.slice(0, 8)}…</td>
                <td>{r.workspace === null || r.workspace === '' ? '-' : r.workspace.split(/[\\/]/).pop()}</td>
                <td className={styles.tdRight}>{r.turns}</td>
                <td className={styles.tdRight}>{r.requests}</td>
                <td className={styles.tdRight}>
                  <span className={styles.kpiCostVal}>{costSymbol(costCurrency)}{formatCost(r.cost)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** 模型与缓存 Tab：donut 占比 + 缓存效率诊断。 */
function ModelsTab(props: {
  t: (key: string) => string
  summary: SummaryResponse
  segments: Array<{ model: string; requests: number; share: number; colorVar: string }>
}): ReactElement {
  const { t, summary, segments } = props
  // 缓存效率诊断：命中率（成功绿）+ 节省 Tokens + 节省比例
  const inputTotal = summary.tokens.uncachedInputTokens + summary.tokens.cacheReadTokens + summary.tokens.cacheWriteTokens
  const savedRatio = inputTotal > 0 ? (summary.tokens.cacheReadTokens / inputTotal) * 100 : 0
  return (
    <div className={styles.chartRow}>
      <div className={styles.chartCell}>
        <h4 className={styles.heading}>{t('chart.donut')}</h4>
        {segments.length === 0 ? <p className={styles.status}>{t('chart.noData')}</p> : (
          <DonutChart t={t} segments={segments} total={summary.requests} centerLabel={t('metric.requests')} />
        )}
      </div>
      <div className={styles.chartCell}>
        <h4 className={styles.heading}>{t('chart.cacheDiag')}</h4>
        <div className={styles.cacheDiag}>
          <strong>{t('chart.cacheHigh')} ({formatRate(summary.avgCacheHitRate)})</strong>
          <span>{t('chart.cacheSaved')} {formatTokens(summary.tokens.cacheReadTokens)}</span>
          <div className={styles.cacheDiagRows}>
            <div className={styles.cacheDiagRow}><span>{t('kpi.hitTokens')}</span><strong>{formatTokens(summary.tokens.cacheReadTokens)}</strong></div>
            <div className={styles.cacheDiagRow}><span>{t('chart.savedRatio')}</span><strong>{savedRatio.toFixed(1)}%</strong></div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 统计卡片主体：控制栏 + 常驻 KPI + 三级 Tab + 日费用超限横幅。 */
export function UsageStatsCard(props: UsageStatsCardProps): ReactElement {
  const { t, summary, balances, loading, error } = props
  const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'quota'>('overview')
  const [provider, setProvider] = useState<ProviderId>('opencode')
  // 当前 provider 的余额/配额快照（多 provider 表按 provider id 取）
  const balance: BalanceResponse | null = balances?.[provider] ?? null
  const segments = useMemo(() => summary === null ? [] : donutSegments(summary.byModel), [summary])
  const currency = balance?.costCurrency ?? ''
  const alert = summary?.dailyAlert ?? null
  const alertTriggered = alert !== null && alert.todayCost >= alert.threshold

  /** 导出当前范围的按日×分模型明细 CSV（host 路由返回 attachment）。 */
  const exportCsv = (): void => {
    if (props.rangeFrom === null || props.rangeTo === null) return
    const a = document.createElement('a')
    a.href = `/api/dsh-usage-stats/export?from=${encodeURIComponent(props.rangeFrom)}&to=${encodeURIComponent(props.rangeTo)}`
    a.download = `usage-${props.rangeFrom}-to-${props.rangeTo}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className={styles.content}>
      {alertTriggered ? (
        <div className={styles.notifyBar} role="status">
          <svg className={styles.noticeIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span>
            {t('alert.daily')}: {costSymbol(currency)}{formatCost(alert.todayCost)} (≥ {costSymbol(currency)}{formatCost(alert.threshold)})
          </span>
        </div>
      ) : null}
      <div className={styles.controlBar}>
        <div className={styles.timeSegment}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={props.rangeDays === r.days ? styles.timeBtnActive : styles.timeBtn}
              onClick={() => props.onRangeDays(r.days)}
            >
              {t('range.' + r.key)}
            </button>
          ))}
          <button
            type="button"
            className={props.rangeDays === 'custom' ? styles.timeBtnActive : styles.timeBtn}
            onClick={() => props.onRangeDays('custom')}
          >
            {t('range.custom')}
          </button>
          <button
            type="button"
            className={styles.timeBtn}
            disabled={props.rangeFrom === null || props.rangeTo === null}
            title={t('export.csv')}
            onClick={exportCsv}
          >
            {t('export.csv')}
          </button>
        </div>
        <div className={styles.providerRow}>
          <span className={styles.providerLabel}>{t('provider.switch')}</span>
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={provider === p.key ? styles.providerPillActive : styles.providerPill}
              onClick={() => setProvider(p.key)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
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
          {/* KPI 4 卡 + Token 拆分：常驻，不随 Tab 切换 */}
          <KpiOverview t={t} summary={summary} provider={provider} balance={balance} />
          <div className={styles.tabNav}>
            {([
              { key: 'overview', labelKey: 'tab.overview' },
              { key: 'models', labelKey: 'tab.models' },
              { key: 'quota', labelKey: 'tab.quota' },
            ] as Array<{ key: 'overview' | 'models' | 'quota'; labelKey: string }>).map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeTab === tab.key ? styles.tabBtnActive : styles.tabBtn}
                onClick={() => setActiveTab(tab.key)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
          {activeTab === 'overview' ? (
            <OverviewTab t={t} summary={summary} costCurrency={currency} />
          ) : null}
          {activeTab === 'models' ? (
            <ModelsTab t={t} summary={summary} segments={segments} />
          ) : null}
          {activeTab === 'quota' ? (
            <QuotaTab t={t} provider={provider} summary={summary} balance={balance} balanceRefreshing={props.balanceRefreshing} onRefreshBalance={props.onRefreshBalance} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
