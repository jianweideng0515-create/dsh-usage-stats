import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { fetchBalance, fetchSessionUsage } from './api.ts'
import type { BalanceResponse, PerSession } from './api.ts'
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

  /** session scope 注入：框架传入当前会话 ID。 */
  inject(sessionId: string): SessionUsageFace {
    this.sessionId = sessionId
    return {
      hooks: { sessionUsage: this.store },
      onToggle: () => this.toggle(),
    }
  }
}

/** 受控的用量按钮 + 展开面板（点击面板外部关闭）。 */
export function SessionUsageButton(props: {
  t: (key: string) => string
  state: SessionUsageStore
  onToggle: () => void
}): ReactElement {
  const { t, state, onToggle } = props
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 点击面板外部关闭（按钮自身除外）
  useEffect(() => {
    if (!state.open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (rootRef.current !== null && !rootRef.current.contains(target)) onToggle()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [state.open, onToggle])

  const session = state.perSession
  const tokensTotal = session === null
    ? 0
    : session.uncachedInputTokens + session.cacheReadTokens + session.cacheWriteTokens + session.outputTokens

  return (
    <div className={styles.sessionUsageRoot} ref={rootRef}>
      <button
        type="button"
        className={state.open ? styles.sessionUsageActive : styles.sessionUsage}
        aria-expanded={state.open}
        onClick={onToggle}
      >
        {t('session.usage')}
      </button>
      {state.open ? (
        <div className={styles.sessionUsagePanel} role="dialog" aria-label={t('session.usage')}>
          {state.loading && session === null ? <p className={styles.status}>{t('loading')}</p> : null}
          {state.error !== null ? <p className={styles.status}>{t('error')}: {state.error}</p> : null}
          {session !== null ? (
            <dl className={styles.sessionUsageMetrics}>
              <div><dt>{t('metric.lastHit')}</dt><dd>{session.lastRequestHitRate === null ? '-' : formatRate(session.lastRequestHitRate)}</dd></div>
              <div><dt>{t('metric.lastCost')}</dt><dd>{session.lastRequestCost === null ? '-' : formatCost(session.lastRequestCost)}</dd></div>
              <div><dt>{t('metric.turns')}</dt><dd>{session.turns}</dd></div>
              <div><dt>{t('metric.sessionTurns')}</dt><dd>{session.turns}</dd></div>
              <div><dt>{t('metric.sessionCost')}</dt><dd>{formatCost(session.cost)}</dd></div>
              <div><dt>{t('metric.avgHitRate')}</dt><dd>{formatRate(sessionHitRate(session))}</dd></div>
              <div><dt>{t('metric.tokens')}</dt><dd>{formatTokens(tokensTotal)}</dd></div>
              <div><dt>{t('balance.title')}</dt><dd>{state.balance === null ? '-' : state.balance.balance === null
                ? (state.balance.error ?? t('balance.unavailable'))
                : `${state.balance.balance} ${state.balance.currency}`}</dd></div>
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** 会话页注册侧：slot 组合 props。 */
type SessionUsageSlotProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'usage-stats'>
  & InjectFace<SessionUsageFace>

/** 插槽适配：bridge 注入面到受控按钮组件。 */
export function SessionUsageSlotButton(props: SessionUsageSlotProps): ReactElement {
  const state = props.useSessionUsage((s) => s)
  const t = props.t as (key: string) => string
  return <SessionUsageButton t={t} state={state} onToggle={props.onToggle} />
}
