import type { Context } from '@deepseek-ai/cordis'
// 以下 type 导入把对应 SDK 对 cordis Context 的类型增广纳入编译程序，使
// ctx.llm / ctx.agentDefaultModel 可选链访问可被类型系统识别；不注入即不构成硬依赖。
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** 余额模式的用户配置。 */
export interface BalanceSettings {
  /** auto：按当前默认 provider 自动推断；manual：使用固定 baseUrl；off：关闭。 */
  mode: 'auto' | 'manual' | 'off'
  /** manual 模式的余额端点基址。 */
  baseUrl?: string
  /** 余额接口路径；缺省 /user/balance。 */
  path?: string
  /** 读取 API key 的环境变量名；缺省 DEEPSEEK_API_KEY。 */
  apiKeyEnv?: string
  /** 定时刷新间隔（毫秒）。 */
  refreshMs?: number
}

/** 解析出的可拉取余额端点的完整信息。 */
export interface BalanceEndpoint {
  baseUrl: string
  path: string
  apiKeyEnv: string
  source: string
}

export type DetectResult = { ok: true; endpoint: BalanceEndpoint } | { ok: false; reason: string }

/** 默认凭据环境变量名（与 DeepSeek 适配器一致）。 */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_BALANCE_PATH = '/user/balance'

function isDeepSeekHost(hostname: string): boolean {
  return hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')
}

/** 按给定配置与运行时服务解析出可用的余额端点。 */
export function detectBalanceEndpoint(ctx: Context, settings: BalanceSettings): DetectResult {
  if (settings.mode === 'off') return { ok: false, reason: 'disabled' }
  if (settings.mode === 'manual') {
    if (settings.baseUrl === undefined || settings.baseUrl === '') {
      return { ok: false, reason: 'manual balance requires baseUrl' }
    }
    return {
      ok: true,
      endpoint: {
        baseUrl: settings.baseUrl,
        path: settings.path ?? DEFAULT_BALANCE_PATH,
        apiKeyEnv: settings.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
        source: 'manual',
      },
    }
  }

  // auto：按当前默认 provider 推断；三个服务均可能是缺省 ctx 上的可选成员。
  const selection = ctx.agentDefaultModel?.currentSelection()
  if (selection === undefined) return { ok: false, reason: 'no default model selection' }
  const provider = selection.provider
  const entries = ctx.llm?.listConfigurableProviders() ?? []
  const entry = entries.find((e) => e.provider === provider)
  if (entry === undefined) return { ok: false, reason: `provider ${provider} not found` }

  // 从命名空间取值，沿 settingsPath 逐层取 profile（任一层非对象即视为不可用）。
  const raw = ctx.settings?.get(settingsNamespace(entry.settingsNs))
  let profile: unknown = raw
  for (const key of entry.settingsPath) {
    if (typeof profile !== 'object' || profile === null) { profile = undefined; break }
    profile = (profile as Record<string, unknown>)[key]
  }
  if (typeof profile !== 'object' || profile === null) return { ok: false, reason: 'provider profile unavailable' }
  const record = profile as Record<string, unknown>
  const baseURL = typeof record.baseURL === 'string' ? record.baseURL
    : typeof record.baseUrl === 'string' ? record.baseUrl : undefined
  const apiKeyEnv = typeof record.apiKeyEnv === 'string' ? record.apiKeyEnv : undefined

  if (baseURL === undefined) return { ok: false, reason: 'provider does not expose an endpoint' }
  let hostname: string
  try {
    hostname = new URL(baseURL).hostname
  } catch {
    return { ok: false, reason: 'provider endpoint is not a valid URL' }
  }
  if (!isDeepSeekHost(hostname)) return { ok: false, reason: 'provider has no known balance endpoint' }
  const origin = new URL(baseURL).origin
  return {
    ok: true,
    endpoint: {
      baseUrl: origin,
      path: DEFAULT_BALANCE_PATH,
      apiKeyEnv: apiKeyEnv ?? DEFAULT_API_KEY_ENV,
      source: `auto:${provider}`,
    },
  }
}
