/** 余额与配额 Tab：OpenCode 订阅配额三窗口 + DeepSeek 官方余额。 */
import type { ReactElement } from 'react'
import styles from './card.module.css'
import type { BalanceResponse, SummaryResponse } from './api.ts'
import type { ProviderId } from './providers.ts'

/** 配额窗口状态分级：百分比 → chip 文案键、chip 类与进度条颜色。 */
function quotaLevel(percent: number): { labelKey: string; colorVar: string; chipClass: string } {
  if (percent >= 85) return { labelKey: 'quota.high', colorVar: 'var(--dsw-alias-state-error-primary)', chipClass: 'chipError' }
  if (percent >= 60) return { labelKey: 'quota.elevated', colorVar: 'var(--dsw-alias-state-warn-primary)', chipClass: 'chipAmber' }
  if (percent >= 30) return { labelKey: 'quota.normal', colorVar: 'var(--dsw-alias-state-info-primary, var(--dsw-alias-state-business-primary))', chipClass: 'chipBlue' }
  return { labelKey: 'quota.abundant', colorVar: 'var(--dsw-alias-state-success-primary)', chipClass: 'chipEmerald' }
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
export function QuotaTab(props: {
  t: (key: string) => string
  provider: ProviderId
  summary: SummaryResponse
  balance: BalanceResponse | null
  balanceRefreshing: boolean
  onRefreshBalance: () => void
}): ReactElement | null {
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
        {balance.balance <= 0 ? (
          // 欠费/零余额：不估算可用天数，直接提示充值
          <div className={styles.deepseekEstimate}>{t('balance.negative')}</div>
        ) : estDays !== null ? (
          <div className={styles.deepseekEstimate}>
            {t('balance.estimate')} {estDays} {t('balance.days')} · {t('balance.sufficient')}
          </div>
        ) : null}
        <div className={styles.deepseekActions}>
          {/* 充值：跳转 DeepSeek 官方充值页。壳会把 <a> 点击重写为内嵌预览
              （DeepSeek 拒绝 frame 嵌入），故显式 window.open 强制新标签页。 */}
          <a
            className={styles.btnPrimary}
            href="https://platform.deepseek.com/top_up"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault()
              window.open('https://platform.deepseek.com/top_up', '_blank', 'noopener,noreferrer')
            }}
          >
            {t('balance.recharge')}
          </a>
          <button type="button" className={styles.refresh} disabled={balanceRefreshing} onClick={onRefreshBalance}>
            {balanceRefreshing ? t('balance.refreshing') : t('balance.refresh')}
          </button>
        </div>
        {balance.updatedAt !== null ? <p className={styles.status}>{t('balance.updated')}: {new Date(balance.updatedAt).toLocaleString()}</p> : null}
        {balance.source !== null ? <p className={styles.status}>{t('balance.source')}: {balance.source.source}</p> : null}
      </div>
    )
  }
  // ProviderId 仅剩 opencode/deepseek 两支，代码不可达（保持类型收窄完整性）
  return null
}
