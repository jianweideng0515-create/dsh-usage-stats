import { useEffect, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { UsageStatsCard, statsShared } from './UsageStatsCard.tsx'
import type { UsageStatsCardStore } from './UsageStatsCard.tsx'
import styles from './card.module.css'

/**
 * 设置页左侧导航独立 Tab（settings.section）整页组件。
 * section 槽不提供 inject face（官方 GeneralSection 同），组件通过
 * useSyncExternalStore 直接订阅 apply 注入的共享 controller store。
 */
export function UsageStatsSection(_props: PropsRuntime<'settings.section'>): ReactElement {
  const shared = statsShared
  if (shared === null) return <div />
  const state = useSyncExternalStore<UsageStatsCardStore>(
    (cb) => shared.face.hooks.usageStatsCard.subscribe(cb),
    () => shared.face.hooks.usageStatsCard.getSnapshot(),
  )
  const t = shared.t
  // 整页常显：挂载即展开（开始轮询），默认展示最近 7 天数据，无需手动展开卡片。
  useEffect(() => {
    if (!shared.face.hooks.usageStatsCard.getSnapshot().expanded) {
      shared.face.onToggleExpanded()
    }
    // 仅挂载时执行一次（face 为 apply 期共享实例，稳定）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className={styles.sectionPage}>
      <div className={styles.sectionHeaderRow}>
        <span className={styles.sectionIconBadge} aria-hidden="true">
          {/* 内联柱状图图标（与卡片 badge 同款，无 emoji） */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <rect x="7" y="12" width="3" height="6" rx="0.8" />
            <rect x="13" y="8" width="3" height="10" rx="0.8" />
            <rect x="19" y="5" width="3" height="13" rx="0.8" />
          </svg>
        </span>
        <div className={styles.sectionHeaderText}>
          <h3 className={styles.sectionPageTitle}>{t('settings.title')}</h3>
          <p className={styles.sectionPageDesc}>{t('settings.description')}</p>
        </div>
      </div>
      <UsageStatsCard
        t={t}
        summary={state.summary}
        balances={state.balances}
        loading={state.loading}
        error={state.error}
        rangeDays={state.rangeDays}
        customFrom={state.customFrom}
        customTo={state.customTo}
        onRangeDays={shared.face.onRangeDays}
        onCustomFrom={shared.face.onCustomFrom}
        onCustomTo={shared.face.onCustomTo}
        onRefreshBalance={shared.face.onRefreshBalance}
        balanceRefreshing={state.balanceRefreshing}
      />
    </div>
  )
}
