import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the conversation SlotMap merge ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { UsageStatsCardController, setStatsShared } from './UsageStatsCard.tsx'
import { UsageStatsSection } from './UsageStatsSection.tsx'
import { SessionUsageController, SessionUsageSlotButton } from './session-usage.tsx'
import { zh, en } from './locales.ts'
import type { UsageStatsCopy } from './locales.ts'

export const name = 'usage-stats'
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']
const NS = 'usage-stats'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** usage-stats settings-card copy. */
    'usage-stats': keyof UsageStatsCopy
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stats: dictionaries')
  const bound = ctx.locale.bind(NS)
  const t = (key: string) => bound(key as keyof UsageStatsCopy)
  const controller = new UsageStatsCardController()
  // 共享 face（左侧导航 Tab 与 controller 共用同一 store，数据一致）。
  setStatsShared({ face: controller.inject(), t })

  // 左侧导航专属 Tab（settings.section 一级入口）：不挂在「插件」分类下。
  // 导航图标由 shell 的 navIcon(id) 硬编码映射（未知 id 回退齿轮图标），
  // 页内头部自绘柱状图图标作为品牌识别。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-stats',
    order: 40,
    label: () => t('nav.usage'),
    locale: NS,
  }, UsageStatsSection))

  // 会话页：右上角「用量」按钮 + 展开面板（session scope 自动注入当前会话 ID）。
  // 挂在 header.utilities（标题相邻操作组之外的右对齐工具区）而非 actions。
  const sessionController = new SessionUsageController()
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'usage-stats-session',
    order: 20,
    locale: NS,
    inject: (sessionId) => sessionController.inject(sessionId),
  }, SessionUsageSlotButton))
}
