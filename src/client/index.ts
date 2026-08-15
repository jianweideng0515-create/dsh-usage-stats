import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the conversation SlotMap merge ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { UsageStatsCardController, UsageStatsSlotCard } from './UsageStatsCard.tsx'
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

  interface SlotMap {
    /**
     * The plugin configuration section's card seat (ui-plugin-config),
     * independently of any family group: usage-stats is a standalone plugin
     * and registers its own card here instead of a family child slot.
     */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stats: dictionaries')
  const controller = new UsageStatsCardController()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'usage-stats',
    order: 90,
    locale: NS,
    inject: () => controller.inject(),
  }, UsageStatsSlotCard))

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
