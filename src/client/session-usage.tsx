import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { fetchBalance, fetchSessionUsage } from './api.ts'
import type { BalanceResponse, PerSession, QuotaWindow } from './api.ts'
import styles from './card.module.css'

/**
 * 会话页用量面板（注册于 conversation.session.header.actions）：
 * 会话头部「用量」按钮 → 点击展开下拉面板，展示当前会话的
 * 本次命中 / 本次费用 / 完成轮次 / 会话轮次 / 会话费用 /
 * 平均缓存命中率 / Tokens 用量 / 账户余额。
 * session scope 由框架注入 sessionId（inject 首参），controller 持有。
 */

/** 面板投影快照。 */
export interface SessionUsageStore {
  open: boolean
  perSession: PerSession | null
  balance: BalanceResponse | null
  loading: boolean
  error: string | null
}

/** 会话用量注入面。 */
export interface SessionUsageFace {
  hooks: {
    sessionUsage: SnapshotStore<SessionUsageStore>
  }
  onToggle: () => void
}

const REFRESH_INTERVAL_MS = 30_000

/** 会话平均命中率：cacheRead / 全部输入类 token。 */
function sessionHitRate(session: PerSession): number {
  const input = session.uncachedInputTokens + session.cacheReadTokens + session.cacheWriteTokens
  return input <= 0 ? 0 : session.cacheReadTokens / input
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(2) + 'M'
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K'
  return String(tokens)
}

function formatCost(cost: number): string {
  return cost.toFixed(4)
}

function formatRate(rate: number): string {
  return (rate * 100).toFixed(2) + '%'
}

/** 会话用量 controller：面板开合 + 展开时轮询会话明细与余额。 */
export class SessionUsageController {
  private readonly store: SnapshotStore<SessionUsageStore>
  private open = false
  private perSession: PerSession | null = null
  private balance: BalanceResponse | null = null
  private loading = false
  private error: string | null = null
  private abort: AbortController | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private sessionId: string | null = null

  constructor() {
    this.store = createSnapshotStore(this.projection())
  }

  private projection(): SessionUsageStore {
    return { open: this.open, perSession: this.perSession, balance: this.balance, loading: this.loading, error: this.error }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private async poll(): Promise<void> {
    const sessionId = this.sessionId
    if (sessionId === null) return
    this.abort?.abort()
    const controller = new AbortController()
    this.abort = controller
    this.loading = true
    this.publish()
    const [session, balance] = await Promise.all([
      fetchSessionUsage(sessionId, controller.signal).catch((e) => {
        if (controller.signal.aborted) return null
        this.error = String((e as Error)?.message ?? e)
        return null
      }),
      fetchBalance(controller.signal).catch((e) => {
        if (controller.signal.aborted) return null
        return { balance: null, currency: 'CNY', updatedAt: null, error: String((e as Error)?.message ?? e), source: null } as BalanceResponse
      }),
    ])
    if (controller.signal.aborted) return
    if (session !== null) {
      this.perSession = session
      this.error = null
    }
    if (balance !== null) this.balance = balance
    this.loading = false
    this.publish()
  }

  private startPolling(): void {
    if (this.timer !== null) return
    void this.poll()
    this.timer = setInterval(() => { void this.poll() }, REFRESH_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.abort?.abort()
  }

  toggle(): void {
    this.open = !this.open
    if (this.open) this.startPolling()
    else this.stopPolling()
    this.publish()
  }

  /**
   * session scope 注入：框架在每次会话渲染时传入当前会话 ID。
   * 会话绑定/切换时立即清空旧数据并拉取一次（不依赖面板是否打开）：
   * 按钮上始终显示当前会话用量，重启/刷新后不会停留在 0。
   * 面板打开时另有 30s 轮询。
   */
  inject(sessionId: string): SessionUsageFace {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId
      this.perSession = null
      this.error = null
      void this.poll()
      this.publish()
    }
    return {
      hooks: { sessionUsage: this.store },
      onToggle: () => this.toggle(),
    }
  }
}

/** 触发按钮图标（内联 SVG，无外部依赖）。 */
function ChevronDownIcon(props: { open: boolean }): ReactElement {
  return (
    <svg
      className={props.open ? styles.chevronOpen : styles.chevronIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function CopyIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CheckIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** 脉冲状态点（绿色呼吸动画）。 */
function PulseDot(): ReactElement {
  return (
    <span className={styles.pulseDotContainer}>
      <span className={styles.pulseDotPing} />
      <span className={styles.pulseDot} />
    </span>
  )
}

/** 自适应 token 缩写：≥1M 用 M，否则 K。 */
function formatCompactTokens(tokens: number): { value: string; unit: string } {
  if (tokens >= 1_000_000) return { value: (tokens / 1_000_000).toFixed(2), unit: 'M' }
  if (tokens >= 1_000) return { value: (tokens / 1_000).toFixed(1), unit: 'K' }
  return { value: String(tokens), unit: '' }
}

/** 受控的用量按钮 + 展开面板（外部点击 / Escape 关闭）。 */
export function SessionUsageButton(props: {
  t: (key: string) => string
  state: SessionUsageStore
  onToggle: () => void
}): ReactElement {
  const { t, state, onToggle } = props
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState(false)

  // 点击面板外部关闭 + Escape 关闭
  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (rootRef.current !== null && !rootRef.current.contains(target)) onToggle()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onToggle()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [state.open, onToggle])

  const session = state.perSession
  const tokensTotal = session === null
    ? 0
    : session.uncachedInputTokens + session.cacheReadTokens + session.cacheWriteTokens + session.outputTokens
  // 无记录会话（插件计量开始前的历史会话）显示 - 占位，不显示 0 避免误读为重置。
  const tokens = session === null ? null : formatCompactTokens(tokensTotal)
  const avgHit = session === null ? 0 : sessionHitRate(session) * 100
  const recentHit = session?.lastRequestHitRate === null || session?.lastRequestHitRate === undefined ? null : session.lastRequestHitRate * 100
  const recentTokens = session?.lastRequestTokens === null || session?.lastRequestTokens === undefined ? null : session.lastRequestTokens
  const recentTokensCompact = recentTokens === null ? null : formatCompactTokens(recentTokens)
  // 本次消耗 = 一轮对话的消耗：进行中的轮（每发一次信息自动重置）优先，
  // 无进行中轮时回退最近完成的轮。
  const currentTurn = session?.currentTurn ?? null
  const turnTokens = currentTurn !== null ? currentTurn.tokens : (session?.lastTurnTokens ?? null)
  const turnCost = currentTurn !== null ? currentTurn.cost : (session?.lastTurnCost ?? null)
  const turnTokensCompact = turnTokens === null ? null : formatCompactTokens(turnTokens)
  const balance = state.balance
  // 有真实消耗但费用为 0：模型未配置单价（内置价格表外），费用按 0 计。
  const unpriced = session !== null && session.cost === 0 && tokensTotal > 0

  /** 重置倒计时：'2 天 3 小时后重置' / '5 小时后重置' / '30 分钟后重置'。 */
  const formatReset = (resetsAt: string | null): string => {
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

  const handleCopySummary = (): void => {
    const sessionText = session === null ? '' : `Tokens: ${tokensTotal} | Cost: ${session.cost.toFixed(4)}`
    const summaryText = [
      sessionText,
      balance?.quota !== null && balance?.quota !== undefined
        ? `Monthly quota: ${balance.quota.monthly?.percent ?? 0}%`
        : `Balance: ${balance?.balance === null || balance === null ? '-' : `${balance.balance} ${balance.currency}`}`,
      `Avg Cache Hit: ${avgHit.toFixed(2)}%`,
    ].filter(Boolean).join(' | ')
    if (navigator.clipboard?.writeText !== undefined) {
      void navigator.clipboard.writeText(summaryText)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const quota = balance?.quota ?? null
  const quotaRows = quota === null ? [] : ([
    { key: 'rolling', label: t('quota.rolling'), window: quota.rolling },
    { key: 'weekly', label: t('quota.weekly'), window: quota.weekly },
    { key: 'monthly', label: t('quota.monthly'), window: quota.monthly },
  ] as Array<{ key: string; label: string; window: QuotaWindow | null }>)

  return (
    <div className={styles.sessionUsageRoot} ref={rootRef}>
      <button
        type="button"
        className={state.open ? styles.sessionUsageActive : styles.sessionUsage}
        aria-expanded={state.open}
        aria-haspopup="true"
        onClick={onToggle}
      >
        <PulseDot />
        <span className={styles.labelMuted}>{t('session.usageLabel')}</span>
        <span className={styles.valHighlightTokens}>{tokens === null ? '-' : `${tokens.value}${tokens.unit}`}</span>
        <span className={styles.valSeparator}>|</span>
        <span className={styles.valHighlightCost}>{session === null ? '-' : formatCost(session.cost)}</span>
        <ChevronDownIcon open={state.open} />
      </button>
      {state.open ? (
        <div className={styles.sessionUsagePanel} role="dialog" aria-label={t('session.panelTitle')}>
          {/* Header：标题 */}
          <div className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <PulseDot />
              <span className={styles.panelTitle}>{t('session.panelTitle')}</span>
            </div>
          </div>
          {state.loading && session === null ? <p className={styles.panelStatus}>{t('loading')}</p> : null}
          {state.error !== null ? <p className={styles.panelStatus}>{t('error')}: {state.error}</p> : null}
          {!state.loading && state.error === null && session === null ? <p className={styles.panelStatus}>{t('session.noRecord')}</p> : null}
          {session !== null ? (
            <div className={styles.panelBody}>
              {/* Hero 卡：会话累计消耗（对称 2×2） */}
              <div>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionTitle}>{t('session.heroTitle')}</span>
                </div>
                <div className={styles.heroCard}>
                  <div className={styles.heroTopGrid}>
                    <div className={styles.heroCol}>
                      <div className={styles.statNumGroup}>
                        <span className={styles.statNumber}>{tokens?.value}</span>
                        <span className={styles.statUnit}>{tokens?.unit}</span>
                      </div>
                      <div className={styles.statLabel}>{t('session.heroTokens')}</div>
                    </div>
                    <div className={styles.heroCol}>
                      <div className={styles.statNumGroup}>
                        <span className={styles.statNumber}>{formatCost(session.cost)}{unpriced ? '*' : ''}</span>
                      </div>
                      <div className={styles.statLabel}>{t('session.heroCost')}</div>
                    </div>
                  </div>
                  <div className={styles.heroBottomGrid}>
                    <div className={styles.metaCol}>
                      <span className={styles.metaLabel}>{t('session.heroRounds')}</span>
                      <span className={styles.metaValText}>{session.turns} 次</span>
                    </div>
                    <div className={styles.metaCol}>
                      <span className={styles.metaLabel}>{t('session.heroAvgHit')}</span>
                      <span className={styles.metaValEmerald}>{avgHit.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* 最近单次对话（本轮）卡 */}
              <div>
                <div className={styles.sectionTitle} style={{ marginBottom: '6px' }}>
                  {t('session.recentTitle')}
                </div>
                <div className={styles.recentCard}>
                  <div className={styles.recentRowTop}>
                    <span className={styles.recentModel} title={session.lastModel ?? undefined}>{session.lastModel ?? '-'}</span>
                    <span className={styles.recentHitGroup}>
                      <span className={styles.recentHitLabel}>{t('session.recentHit')}</span>
                      <span className={styles.hitBadge}>{recentHit === null ? '-' : `${recentHit.toFixed(2)}%`}</span>
                    </span>
                  </div>
                  <div className={styles.recentRowBottom}>
                    <span>
                      {t('session.recentTokens')}: <strong className={styles.strongText}>{turnTokensCompact === null ? '-' : `${turnTokensCompact.value}${turnTokensCompact.unit} Tokens`}</strong>
                    </span>
                    <span>
                      {t('session.recentCost')}: <strong className={styles.strongText}>{turnCost === null ? '-' : formatCost(turnCost)}</strong>
                    </span>
                  </div>
                </div>
                {unpriced ? (
                  <p className={styles.unpricedHint}>{t('session.unpricedHint')}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {/* Footer：配额/余额详情 + 复制摘要 */}
          <div className={styles.panelFooter}>
            {quotaRows.length > 0 ? (
              <div className={styles.quotaRows}>
                {quotaRows.map((row) => (
                  <div key={row.key} className={styles.quotaRow}>
                    <span className={styles.quotaLabel}>{row.label}</span>
                    <span className={styles.quotaPercent}>{row.window === null ? '-' : `${row.window.percent}%`}</span>
                    <span className={styles.quotaReset}>{row.window === null ? '' : formatReset(row.window.resetsAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={styles.footerFlex}>
              <span className={styles.balanceText}>
                {t('session.balance')}: <strong className={styles.balanceVal}>{balance === null ? '-' : quota !== null
                  ? `${quota.monthly?.percent ?? 0}%`
                  : balance.balance === null
                    ? (balance.error ?? t('balance.unavailable'))
                    : `${balance.balance} ${balance.currency}`}</strong>
              </span>
              <button type="button" onClick={handleCopySummary} className={`${styles.btnCopy} ${copied ? styles.btnCopyCopied : ''}`}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                <span>{copied ? t('session.copied') : t('session.copy')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 会话页注册侧：slot 组合 props（header.utilities：头部右侧工具区）。 */
type SessionUsageSlotProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'usage-stats'>
  & InjectFace<SessionUsageFace>

/** 插槽适配：bridge 注入面到受控按钮组件。 */
export function SessionUsageSlotButton(props: SessionUsageSlotProps): ReactElement {
  const state = props.useSessionUsage((s) => s)
  const t = props.t as (key: string) => string
  return <SessionUsageButton t={t} state={state} onToggle={props.onToggle} />
}
