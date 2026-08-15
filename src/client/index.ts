import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings-surface SlotMap merge and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UsageStatsCardController, UsageStatsSlotCard } from './UsageStatsCard.tsx'
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
}
