/** 常驻 KPI 区：指标卡 + 提供商动态卡 + Token 四分色拆分条。 */
import type { ReactElement } from 'react'
import styles from './card.module.css'
import type { BalanceResponse, SummaryResponse } from './api.ts'
import { costSymbol, formatCost, formatRate, formatTokens } from './format.ts'
import type { ProviderId } from './providers.ts'

/** KPI 卡内联图标（无外部依赖、无 emoji）。 */
function KpiIcon(props: { kind: 'chart' | 'send' | 'bolt' | 'wallet' | 'turns' | 'days' }): ReactElement {
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
  if (kind === 'turns') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-9-9" />
        <path d="M21 3v6h-6" />
      </svg>
    )
  }
  if (kind === 'days') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M3 10h18" />
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

/** 常驻 KPI 区：4 张 KPI 卡 + Token 四分色拆分（不随 Tab 切换）。 */
export function KpiOverview(props: {
  t: (key: string) => string
  summary: SummaryResponse
  provider: ProviderId
  balance: BalanceResponse | null
}): ReactElement {
  const { t, summary, provider, balance } = props
  // KPI 卡 4：提供商动态卡（配额 / 余额）
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
  } else {
    dynamicValue = balance?.balance !== null && balance?.balance !== undefined
      ? `${balance.balance} ${balance.currency}`
      : '-'
    dynamicChip = t('provider.prepay')
    dynamicSub = balance?.updatedAt !== null && balance?.updatedAt !== undefined
      ? `${t('balance.updated')} ${new Date(balance.updatedAt).toLocaleString()}`
      : t('provider.notConnected')
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
          <dd className={styles.kpiSub}>
            {t('kpi.costPrefix')}: <strong className={styles.kpiCostVal}>{costSymbol(balance?.costCurrency ?? '')}{formatCost(summary.cost)}</strong>
          </dd>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span>{t('metric.requests')}</span>
            <KpiIcon kind="send" />
          </div>
          <dd className={styles.kpiValue}>{summary.requests}</dd>
          <dd className={styles.kpiSub}>{summary.uncountedRequests > 0 ? `${t('metric.uncounted')} ${summary.uncountedRequests}` : ''}</dd>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span>{t('metric.turns')}</span>
            <KpiIcon kind="turns" />
          </div>
          <dd className={styles.kpiValue}>{summary.turns}</dd>
          <dd className={styles.kpiSub}>{t('metric.turns')}</dd>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span>{t('metric.activeDays')}</span>
            <KpiIcon kind="days" />
          </div>
          <dd className={styles.kpiValue}>{summary.activeDays}</dd>
          <dd className={styles.kpiSub}>{t('kpi.daysUnit')}</dd>
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
            <span className={styles.kpiDynamicLabel}>{provider === 'opencode' ? t('provider.opencode') : t('provider.deepseek')}</span>
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
