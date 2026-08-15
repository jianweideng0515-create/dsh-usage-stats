import { useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
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

/** 命中率展示：百分比保留两位小数（如 99.84%）。 */
function formatRate(rate: number): string {
  return (rate * 100).toFixed(2) + '%'
}

/** donut 段色：从主题语义色派生（段 1-5 + 其他）。 */
const DONUT_SEGMENT_VARS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-alias-state-info-primary, var(--dsw-alias-state-business-primary))',
  'var(--dsw-alias-label-tertiary)',
]

/** 按请求数取模型占比段：Top 5 + 「其他」聚合；返回段与图例行。 */
function donutSegments(models: Array<{ model: string; requests: number }>): Array<{ model: string; requests: number; share: number; colorVar: string }> {
  const total = models.reduce((sum, m) => sum + m.requests, 0)
  if (total <= 0) return []
  const top = models.slice(0, 5)
  const rest = models.slice(5).reduce((sum, m) => sum + m.requests, 0)
  const entries = rest > 0
    ? [...top, { model: '__other__', requests: rest }]
    : top
  return entries.map((m, i) => ({
    model: m.model,
    requests: m.requests,
    share: m.requests / total,
    colorVar: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length],
  }))
}

/** 模型占比 SVG 环形图（参考原型 stroke-dasharray donut，无库）。 */
function DonutChart(props: {
  t: (key: string) => string
  segments: Array<{ model: string; requests: number; share: number; colorVar: string }>
  total: number
  centerLabel: string
}): ReactElement {
  const { t, segments, total, centerLabel } = props
  const R = 15.9155 // 周长 100 的圆半径（参考原型同款）
  const track = `M 18 2.0845 a ${R} ${R} 0 0 1 0 31.831 a ${R} ${R} 0 0 1 0 -31.831`
  let cursor = 0
  return (
    <div className={styles.donutWrap}>
      <div className={styles.donutSvgWrap}>
        <svg viewBox="0 0 36 36" className={styles.donutSvg} role="img" aria-label={segments.map((s) => `${s.model}: ${Math.round(s.share * 100)}%`).join('; ')}>
          <path d={track} fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth="4" />
          {segments.map((s) => {
            const offset = cursor * 100
            cursor += s.share
            return (
              <path
                key={s.model}
                d={track}
                fill="none"
                stroke={s.colorVar}
                strokeWidth="4"
                strokeDasharray={`${Math.max(0.4, s.share * 100)} 100`}
                strokeDashoffset={`${-offset}`}
              />
            )
          })}
        </svg>
        <div className={styles.donutHole}>
          <span className={styles.donutTotal}>{total}</span>
          <span className={styles.donutTotalLabel}>{centerLabel}</span>
        </div>
      </div>
      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.model}>
            <span className={styles.legendDot} style={{ background: s.colorVar }} />
            <span className={styles.legendModel}>{s.model === '__other__' ? t('chart.other') : s.model}</span>
            <span className={styles.legendShare}>{Math.round(s.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** KPI 卡内联图标（无外部依赖、无 emoji）。 */
function KpiIcon(props: { kind: 'chart' | 'send' | 'bolt' | 'wallet' }): ReactElement {
  const { kind } = props
  if (kind === 'chart') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3v18h18" />
        <rect x="7" y="12" width="3" height="6" rx="0.8" />
        <rect x="13" y="8" width="3" height="10" rx="0.8" />
        <rect x="19" y="5" width="3" height="13" rx="0.8" />
      </svg>
    )
  }
  if (kind === 'send') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 2 11 13" />
        <path d="M22 2 15 22l-4-9-9-4Z" />
      </svg>
    )
  }
  if (kind === 'bolt') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  )
}

/** 单条 SVG 折线（无库）：数据点不足阈值时返回 null，由调用方显示占位。 */
function MiniLine(props: {
  values: number[]
  colorVar: string
  dashed?: boolean
  format: (value: number) => string
}): ReactElement | null {
  const { values, colorVar, dashed, format } = props
  if (values.length < MIN_LINE_POINTS) return null
  const width = 120
  const height = 36
  const max = Math.max(...values, 1e-9)
  const min = Math.min(...values)
  const span = Math.max(max - min, 1e-9)
  const stepX = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((v, i) => `${(i * stepX).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ')
  return (
    <svg
      className={styles.miniLine}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={values.map((v, i) => `${i}: ${format(v)}`).join('; ')}
    >
      <polyline
        points={points}
        fill="none"
        stroke={colorVar}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={dashed ? '3 2' : undefined}
      />
      {values.map((v, i) => (
        <circle key={i} cx={(i * stepX).toFixed(1)} cy={(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)} r="1.6" fill={colorVar} />
      ))}
    </svg>
  )
}

/** 折线图最少数据点（数据不足时折线无意义，显示占位文案）。 */
const MIN_LINE_POINTS = 4

/** Token 四分色（参考原型配色：输入蓝 / 缓存读绿 / 缓存写黄 / 输出紫）。 */
const TOKEN_SPLIT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#6366f1']

/** Token 四分色堆叠拆分条 + 图例（参考原型 tokenSplitBar）。 */
function TokenSplitBar(props: {
  t: (key: string) => string
  buckets: Array<{ label: string; tokens: number }>
}): ReactElement {
  const { t, buckets } = props
  const total = buckets.reduce((sum, b) => sum + b.tokens, 0)
  return (
    <div className={styles.tokenSplit}>
      <div className={styles.tokenStacked} role="img" aria-label={buckets.map((b, i) => `${b.label}: ${formatTokens(b.tokens)} (${total > 0 ? Math.round((b.tokens / total) * 100) : 0}%)`).join('; ')}>
        {buckets.map((b, i) => (
          <span
            key={b.label}
            className={styles.tokenStackedSeg}
            style={{
              width: total > 0 ? `${(b.tokens / total) * 100}%` : '0%',
              background: TOKEN_SPLIT_COLORS[i % TOKEN_SPLIT_COLORS.length],
            }}
          />
        ))}
      </div>
      <div className={styles.tokenLegend}>
        {buckets.map((b, i) => (
          <span key={b.label} className={styles.tokenItem}>
            <span className={styles.dot} style={{ background: TOKEN_SPLIT_COLORS[i % TOKEN_SPLIT_COLORS.length] }} />
            {b.label} {formatTokens(b.tokens)}
            <span className={styles.tokenShare}>{total > 0 ? `${Math.round((b.tokens / total) * 100)}%` : '0%'}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** 用量趋势面积折线（无库 SVG）：网格线 + 渐变面积 + 折线 + 数据点 + 日期刻度。 */
function TrendAreaChart(props: {
  t: (key: string) => string
  series: Array<{ bucket: string; tokens: number }>
}): ReactElement {
  const { t, series } = props
  const width = 600
  const height = 140
  const padY = 12
  const padX = 4
  if (series.length < 2) {
    return <p className={styles.status}>{t('chart.insufficientData')}</p>
  }
  const max = Math.max(...series.map((p) => p.tokens), 1e-9)
  const min = Math.min(...series.map((p) => p.tokens))
  const span = Math.max(max - min, 1e-9)
  const innerH = height - padY * 2
  const x = (i: number): number => padX + (i * (width - padX * 2)) / (series.length - 1)
  const y = (v: number): number => padY + innerH - ((v - min) / span) * innerH
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.tokens).toFixed(1)}`).join(' ')
  const area = `${line} L${x(series.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`
  return (
    <div className={styles.trendChart}>
      <svg
        className={styles.trendSvg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={series.map((p) => `${p.bucket}: ${formatTokens(p.tokens)}`).join('; ')}
      >
        <defs>
          <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dsw-alias-state-business-primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--dsw-alias-state-business-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* 网格线（三等分） */}
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={padX} x2={width - padX}
            y1={(padY + (innerH * i) / 3).toFixed(1)}
            y2={(padY + (innerH * i) / 3).toFixed(1)}
            stroke="var(--dsw-alias-border-l2)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="url(#trendAreaGrad)" />
        <path d={line} fill="none" stroke="var(--dsw-alias-state-business-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {series.map((p, i) => (
          <circle key={p.bucket} cx={x(i).toFixed(1)} cy={y(p.tokens).toFixed(1)} r="3" fill="var(--dsw-alias-state-business-primary)" stroke="var(--dsw-alias-bg-layer-3)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className={styles.trendAxis}>
        {series.map((p) => (
          <span key={p.bucket} className={styles.trendTick}>{p.bucket.slice(5)}</span>
        ))}
      </div>
    </div>
  )
}

/** 提供商维度（影响 KPI 动态卡与配额/余额视图）。 */
export type ProviderId = 'opencode' | 'deepseek' | 'openai' | 'ollama'

const PROVIDERS: Array<{ key: ProviderId; labelKey: string }> = [
  { key: 'opencode', labelKey: 'provider.opencode' },
  { key: 'deepseek', labelKey: 'provider.deepseek' },
  { key: 'openai', labelKey: 'provider.openai' },
  { key: 'ollama', labelKey: 'provider.ollama' },
]

/** 常驻 KPI 区：4 张 KPI 卡 + Token 四分色拆分（不随 Tab 切换）。 */
function KpiOverview(props: {
  t: (key: string) => string
  summary: SummaryResponse
  provider: ProviderId
  balance: BalanceResponse | null
}): ReactElement {
  const { t, summary, provider, balance } = props
  // KPI 卡 4：提供商动态卡（配额 / 余额 / 额度 / 本地）
  let dynamicValue = '-'
  let dynamicChip = ''
  let dynamicSub = ''
  if (provider === 'opencode') {
    dynamicValue = balance?.quota?.weekly?.percent !== null && balance?.quota?.weekly?.percent !== undefined
      ? `${balance.quota.weekly.percent}%`
      : '-'
    dynamicChip = t('provider.weeklyQuota')
    dynamicSub = balance?.quota?.weekly?.resetsAt !== null && balance?.quota?.weekly?.resetsAt !== undefined
      ? `${t('kpi.quotaUsed')} ${dynamicValue}`
      : t('provider.notConnected')
  } else if (provider === 'deepseek') {
    dynamicValue = balance?.balance !== null && balance?.balance !== undefined
      ? `${balance.balance} ${balance.currency}`
      : '-'
    dynamicChip = t('provider.prepay')
    dynamicSub = balance?.updatedAt !== null && balance?.updatedAt !== undefined
      ? `${t('balance.updated')} ${new Date(balance.updatedAt).toLocaleString()}`
      : t('provider.notConnected')
  } else if (provider === 'openai') {
    dynamicChip = t('provider.monthlyLimit')
    dynamicSub = t('provider.notConnected')
  } else {
    dynamicChip = t('provider.localFree')
    dynamicSub = t('provider.notConnected')
  }
  return (
    <>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span>{t('metric.tokens')}</span>
            <KpiIcon kind="chart" />
          </div>
          <dd className={styles.kpiValue} title={t('metric.tokensHint')}>{formatTokens(summary.tokens.total)}</dd>
          <dd className={styles.kpiSub}>{t('kpi.costPrefix')}: {formatCost(summary.cost)}</dd>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span>{t('metric.requests')}</span>
            <KpiIcon kind="send" />
          </div>
          <dd className={styles.kpiValue}>{summary.requests}</dd>
          <dd className={styles.kpiSub}>{summary.turns} {t('metric.turns')} · {summary.activeDays} {t('kpi.daysUnit')}</dd>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span>{t('metric.avgHitRate')}</span>
            <KpiIcon kind="bolt" />
          </div>
          <dd className={styles.kpiValueEmerald}>{formatRate(summary.avgCacheHitRate)}</dd>
          <dd className={styles.kpiSub}>{t('kpi.hitTokens')} {formatTokens(summary.tokens.cacheReadTokens)}</dd>
        </div>
        <div className={styles.kpiCardDynamic}>
          <div className={styles.kpiTopRow}>
            <span className={styles.kpiDynamicLabel}>{provider === 'opencode' ? t('provider.opencode') : provider === 'deepseek' ? t('provider.deepseek') : provider === 'openai' ? t('provider.openai') : t('provider.ollama')}</span>
            <span className={`${styles.chip} ${styles.chipBlue}`}>{dynamicChip}</span>
          </div>
          <dd className={styles.kpiValueAccent}>{dynamicValue}</dd>
          <dd className={styles.kpiSub}>{dynamicSub}</dd>
        </div>
      </div>
      <TokenSplitBar
        t={t}
        buckets={[
          { label: t('tokens.input'), tokens: summary.tokens.uncachedInputTokens },
          { label: t('tokens.cacheRead'), tokens: summary.tokens.cacheReadTokens },
          { label: t('tokens.cacheWrite'), tokens: summary.tokens.cacheWriteTokens },
          { label: t('tokens.output'), tokens: summary.tokens.outputTokens },
        ]}
      />
    </>
  )
}

/** 用量概览 Tab 内容：趋势面积图 + 会话指标 + 模型明细（KPI 与 Token 拆分在 Tab 上方常驻）。 */
function OverviewTab(props: {
  t: (key: string) => string
  summary: SummaryResponse
}): ReactElement {
  const { t, summary } = props
  return (
    <>
      <h4 className={styles.heading}>{t('trend.title')}</h4>
      <TrendAreaChart t={t} series={summary.series} />
      {summary.perSession !== null ? (
        <dl className={styles.metrics}>
          <div><dt>{t('metric.lastHit')}</dt><dd>{summary.perSession.lastRequestHitRate === null ? '-' : formatRate(summary.perSession.lastRequestHitRate)}</dd></div>
          <div><dt>{t('metric.lastCost')}</dt><dd>{summary.perSession.lastRequestCost === null ? '-' : formatCost(summary.perSession.lastRequestCost)}</dd></div>
          <div><dt>{t('metric.sessionTurns')}</dt><dd>{summary.perSession.turns}</dd></div>
          <div><dt>{t('metric.sessionCost')}</dt><dd>{formatCost(summary.perSession.cost)}</dd></div>
        </dl>
      ) : null}
      <h4 className={styles.heading}>{t('model.table')}</h4>
      <table className={styles.table}>
        <thead><tr><th>{t('metric.topModel')}</th><th className={styles.thRight}>{t('metric.requests')}</th><th className={styles.thRight}>{t('metric.tokens')}</th><th className={styles.thRight}>{t('metric.cost')}</th></tr></thead>
        <tbody>
          {summary.byModel.map((m, i) => (
            <tr key={m.model} className={styles.trHover}>
              <td>
                <span className={styles.modelDot} style={{ background: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length] }} />
                <strong>{m.model}</strong>
                {m.model === '__unknown__' ? <span className={styles.unknownTag}>__unknown__</span> : null}
              </td>
              <td className={styles.tdRight}>{m.requests}</td>
              <td className={`${styles.tdRight} ${styles.tdStrong}`}>{formatTokens(m.tokens)}</td>
              <td className={styles.tdRight}>{formatCost(m.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.uncountedRequests > 0 ? <p className={styles.status}>{t('metric.uncounted')}: {summary.uncountedRequests}</p> : null}
    </>
  )
}

/** 模型与缓存 Tab：donut 占比 + 缓存效率诊断 + 命中率/费用折线。 */
function ModelsTab(props: {
  t: (key: string) => string
  summary: SummaryResponse
  segments: Array<{ model: string; requests: number; share: number; colorVar: string }>
  hitRateSeries: number[]
  costSeries: number[]
  costAllZero: boolean
}): ReactElement {
  const { t, summary, segments, hitRateSeries, costSeries, costAllZero } = props
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
      <div className={styles.chartCell}>
        <h4 className={styles.heading}>{t('chart.hitRate')}</h4>
        {hitRateSeries.length >= MIN_LINE_POINTS
          ? <MiniLine values={hitRateSeries} colorVar="var(--dsw-alias-state-success-primary)" dashed format={formatRate} />
          : <p className={styles.status}>{t('chart.insufficientData')}</p>}
      </div>
      <div className={styles.chartCell}>
        <h4 className={styles.heading}>{t('chart.cost')}</h4>
        {costAllZero
          ? <p className={styles.status}>{t('chart.noCost')}</p>
          : costSeries.length >= MIN_LINE_POINTS
            ? <MiniLine values={costSeries} colorVar="var(--dsw-alias-state-business-primary)" format={formatCost} />
            : <p className={styles.status}>{t('chart.insufficientData')}</p>}
      </div>
    </div>
  )
}

/** 配额窗口状态分级：百分比 → chip 文案键、chip 类与进度条颜色。 */
function quotaLevel(percent: number): { labelKey: string; colorVar: string; chipClass: string } {
  if (percent >= 85) return { labelKey: 'quota.high', colorVar: 'var(--dsw-alias-state-error-primary)', chipClass: 'chipError' }
  if (percent >= 60) return { labelKey: 'quota.elevated', colorVar: 'var(--dsw-alias-state-warn-primary)', chipClass: 'chipAmber' }
  if (percent >= 30) return { labelKey: 'quota.normal', colorVar: 'var(--dsw-alias-state-info-primary, var(--dsw-alias-state-business-primary))', chipClass: 'chipBlue' }
  return { labelKey: 'quota.abundant', colorVar: 'var(--dsw-alias-state-success-primary)', chipClass: 'chipEmerald' }
}

/** 单个配额窗口进度条卡（滚动/每周/每月，参考原型 quotaCard）。 */
function QuotaWindowCard(props: {
  t: (key: string) => string
  label: string
  window: { percent: number; resetsAt: string | null } | null
  highlight: boolean
}): ReactElement {
  const { t, label, window, highlight } = props
  if (window === null) {
    return (
      <div className={`${styles.quotaCard} ${highlight ? styles.quotaCardActive : ''}`}>
        <div className={styles.quotaCardTop}>
          <span className={styles.quotaCardLabel}>{label}</span>
          <span className={`${styles.chip} ${styles.chipNeutral}`}>-</span>
        </div>
        <div className={styles.quotaCardValue}>-</div>
        <div className={styles.progressBarBg}><div className={styles.progressBarFill} style={{ width: '0%', background: 'var(--dsw-alias-label-tertiary)' }} /></div>
        <div className={styles.quotaCardReset}>
          <span>{t('quota.resetLabel')}</span>
          <strong>-</strong>
        </div>
      </div>
    )
  }
  const level = quotaLevel(window.percent)
  return (
    <div className={`${styles.quotaCard} ${highlight ? styles.quotaCardActive : ''}`}>
      <div className={styles.quotaCardTop}>
        <span className={styles.quotaCardLabel}>{label}</span>
        <span className={`${styles.chip} ${styles[level.chipClass]}`}>{t(level.labelKey)}</span>
      </div>
      <div className={styles.quotaCardValue}>
        {window.percent}<span className={styles.quotaCardUnit}>%</span>
        <span className={styles.quotaCardUsed} style={{ color: level.colorVar }}>
          {highlight ? `${t('quota.remaining')} ${100 - window.percent}%` : `${t('quota.used')} ${window.percent}%`}
        </span>
      </div>
      <div className={styles.progressBarBg}>
        <div className={styles.progressBarFill} style={{ width: `${Math.min(100, window.percent)}%`, background: level.colorVar }} />
      </div>
      <div className={styles.quotaCardReset}>
        <span>{t('quota.resetLabel')}</span>
        <strong>{formatResetCountdown(window.resetsAt, t)}</strong>
      </div>
    </div>
  )
}

/** 余额与配额 Tab：按提供商展示余额/配额（参考原型 Tab 3）。 */
function QuotaTab(props: {
  t: (key: string) => string
  provider: ProviderId
  summary: SummaryResponse
  balance: BalanceResponse | null
  balanceRefreshing: boolean
  onRefreshBalance: () => void
}): ReactElement {
  const { t, provider, summary, balance, balanceRefreshing, onRefreshBalance } = props
  const quota = balance?.quota ?? null
  if (balance === null) return <p className={styles.status}>{t('loading')}</p>
  if (provider === 'opencode') {
    if (quota === null) return <p className={styles.status}>{t('balance.unavailable')}{balance.error !== null ? `: ${balance.error}` : ''}</p>
    const rows = [
      { key: 'rolling', label: t('quota.rolling'), window: quota.rolling },
      { key: 'weekly', label: t('quota.weekly'), window: quota.weekly },
      { key: 'monthly', label: t('quota.monthly'), window: quota.monthly },
    ] as const
    return (
      <div className={styles.quotaView}>
        <div className={styles.quotaGrid}>
          {rows.map((row) => (
            <QuotaWindowCard key={row.key} t={t} label={row.label} window={row.window} highlight={row.key === 'weekly'} />
          ))}
        </div>
        <div className={styles.noticeBar}>
          <svg className={styles.noticeIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span>{t('quota.notice')}</span>
        </div>
      </div>
    )
  }
  if (provider === 'deepseek') {
    if (balance.balance === null) {
      return <p className={styles.status}>{t('balance.unavailable')}{balance.error !== null ? `: ${balance.error}` : ''}</p>
    }
    // 预计可用天数：按选定范围内日均消耗估算（cost / 活跃天数）。
    const dailyCost = summary.activeDays > 0 ? summary.cost / summary.activeDays : 0
    const estDays = dailyCost > 0 ? Math.floor(balance.balance / dailyCost) : null
    return (
      <div className={styles.deepseekCard}>
        <div className={styles.deepseekRow}>
          <span className={styles.deepseekLabel}>{t('provider.deepseek')} · {t('balance.amount')}</span>
          <span className={`${styles.chip} ${styles.chipBlue}`}>{t('provider.prepay')}</span>
        </div>
        <div className={styles.deepseekAmount}>{balance.balance} <span className={styles.deepseekCurrency}>{balance.currency}</span></div>
        {estDays !== null ? (
          <div className={styles.deepseekEstimate}>
            {t('balance.estimate')} {estDays} {t('balance.days')} · {t('balance.sufficient')}
          </div>
        ) : null}
        <div className={styles.deepseekActions}>
          <button type="button" className={styles.btnPrimary}>{t('balance.recharge')}</button>
          <button type="button" className={styles.refresh} disabled={balanceRefreshing} onClick={onRefreshBalance}>
            {balanceRefreshing ? t('balance.refreshing') : t('balance.refresh')}
          </button>
        </div>
        {balance.updatedAt !== null ? <p className={styles.status}>{t('balance.updated')}: {new Date(balance.updatedAt).toLocaleString()}</p> : null}
        {balance.source !== null ? <p className={styles.status}>{t('balance.source')}: {balance.source.source}</p> : null}
      </div>
    )
  }
  if (provider === 'openai') {
    return (
      <div className={styles.placeholderCard}>
        <div className={styles.placeholderRow}>
          <span className={styles.placeholderTitle}>{t('provider.openaiLimit')}</span>
          <span className={`${styles.chip} ${styles.chipNeutral}`}>{t('provider.monthlyLimit')}</span>
        </div>
        <div className={styles.placeholderValue}>-</div>
        <p className={styles.status}>{t('provider.openaiSub')}</p>
      </div>
    )
  }
  return (
    <div className={styles.placeholderCard}>
      <div className={styles.placeholderRow}>
        <span className={styles.placeholderTitle}>{t('provider.ollamaTitle')}</span>
        <span className={`${styles.chip} ${styles.chipEmerald}`}>{t('provider.localFree')}</span>
      </div>
      <p className={styles.status}>{t('provider.ollamaDesc')}</p>
    </div>
  )
}

/** 重置倒计时文案：'2 天 3 小时后重置' / '5 小时后重置' / '30 分钟后重置'。 */
function formatResetCountdown(resetsAt: string | null, t: (key: string) => string): string {
  if (resetsAt === null) return ''
  const ms = Date.parse(resetsAt) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return t('quota.resetSoon')
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes} ${t('quota.minutes')}${t('quota.after')}`
  const hours = Math.floor(totalMinutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) {
    const restHours = hours - days * 24
    return restHours > 0 ? `${days} ${t('quota.days')} ${restHours} ${t('quota.hours')}${t('quota.after')}` : `${days} ${t('quota.days')}${t('quota.after')}`
  }
  return `${hours} ${t('quota.hours')}${t('quota.after')}`
}

/** 统计卡片主体：折叠卡头 + 控制栏 + 4 KPI 卡 + 三级 Tab。 */
export function UsageStatsCard(props: UsageStatsCardProps): ReactElement {
  const { t, summary, balance, loading, error } = props
  const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'quota'>('overview')
  const [provider, setProvider] = useState<ProviderId>('opencode')
  const segments = useMemo(() => summary === null ? [] : donutSegments(summary.byModel), [summary])
  const hitRateSeries = summary?.series.map((p) => p.hitRate) ?? []
  const costSeries = summary?.series.map((p) => p.cost) ?? []
  const costAllZero = summary !== null && summary.cost === 0 && summary.uncountedRequests > 0

  return (
    <div className={styles.content}>
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
            <OverviewTab t={t} summary={summary} />
          ) : null}
          {activeTab === 'models' ? (
            <ModelsTab t={t} summary={summary} segments={segments} hitRateSeries={hitRateSeries} costSeries={costSeries} costAllZero={costAllZero} />
          ) : null}
          {activeTab === 'quota' ? (
            <QuotaTab t={t} provider={provider} summary={summary} balance={balance} balanceRefreshing={props.balanceRefreshing} onRefreshBalance={props.onRefreshBalance} />
          ) : null}
        </>
      ) : null}
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
  /** 卡片是否展开；收起时不渲染内容且暂停轮询。 */
  expanded: boolean
}

/** controller 暴露的动作。 */
export interface UsageStatsCardActions {
  onRangeDays: (days: number | 'custom') => void
  onCustomFrom: (value: string) => void
  onCustomTo: (value: string) => void
  onRefreshBalance: () => void
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
  private balance: BalanceResponse | null = null
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
      balance: this.balance,
      loading: this.loading,
      error: this.error,
      rangeDays: this.rangeDays,
      customFrom: this.customFrom,
      customTo: this.customTo,
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
      this.balance = { balance: null, currency: 'CNY', updatedAt: null, error: String((e as Error)?.message ?? e), source: null, quota: null, costCurrency: 'CNY' }
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
            this.balance = { balance: null, currency: 'CNY', updatedAt: null, error: String((e as Error)?.message ?? e), source: null, quota: null, costCurrency: 'CNY' }
          }
          this.balanceRefreshing = false
          this.publish()
        })()
      },
      onToggleExpanded: () => this.toggleExpanded(),
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
 * 可折叠外壳：图标 badge + 标题 + 「已激活」chip + 描述 + chevron，
 * 点击展开/收起统计内容。收起时内容不渲染（DOM 干净），controller 同步暂停轮询。
 */
export function StatsCardShell(props: {
  t: CardTranslate
  title: string
  description: string
  expanded: boolean
  onToggle: () => void
  children: ReactElement | null
}): ReactElement {
  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={props.expanded}
        aria-label={props.t(props.expanded ? 'settings.collapse' : 'settings.expand')}
        title={props.description}
        onClick={props.onToggle}
      >
        <span className={styles.iconBadge} aria-hidden="true">
          {/* 内联柱状图图标（无外部依赖、无 emoji） */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <rect x="7" y="12" width="3" height="6" rx="0.8" />
            <rect x="13" y="8" width="3" height="10" rx="0.8" />
            <rect x="19" y="5" width="3" height="13" rx="0.8" />
          </svg>
        </span>
        <span className={styles.headText}>
          <span className={styles.nameRow}>
            <span className={styles.name}>{props.title}</span>
            <span className={styles.activeBadge}>{props.t('card.active')}</span>
          </span>
          <span className={styles.description}>{props.description}</span>
        </span>
        <span className={props.expanded ? styles.chevronOpen : styles.chevron}>▾</span>
      </button>
      {props.expanded ? <div className={styles.body}>{props.children}</div> : null}
    </div>
  )
}

/**
 * Adapter that bridges the controller's injected snapshot and actions onto
 * the collapsible shell and the controlled UsageStatsCard.
 */
export function UsageStatsSlotCard(props: UsageStatsSlotProps): ReactElement {
  const state = props.useUsageStatsCard((s) => s)
  const t = props.t as CardTranslate
  return (
    <StatsCardShell
      t={t}
      title={t('settings.title')}
      description={t('settings.description')}
      expanded={state.expanded}
      onToggle={props.onToggleExpanded}
    >
      {state.expanded ? (
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
      ) : null}
    </StatsCardShell>
  )
}
