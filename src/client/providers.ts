/** 提供商维度（影响 KPI 动态卡与配额/余额视图）。 */
export type ProviderId = 'opencode' | 'deepseek'

export const PROVIDERS: Array<{ key: ProviderId; labelKey: string }> = [
  { key: 'opencode', labelKey: 'provider.opencode' },
  { key: 'deepseek', labelKey: 'provider.deepseek' },
]
