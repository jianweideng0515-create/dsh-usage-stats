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

/**
 * 安全读取 ctx 服务：cordis 4 的 ctx 是 Proxy，未注入的服务名即使存在也
 * 会在属性读取时抛 "cannot get property X without inject"（可选链拦不住
 * getter）。detect 的调用方可能持有一个未声明这些服务的 ctx（测试），
 * 这里把读取失败视为服务缺失，返回 undefined 走 reason 分支。
 */
function serviceOrUndefined<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx as unknown as Record<string, T>)[name]
  } catch {
    return undefined
  }
}

/**
 * 按给定配置与运行时服务解析出可用的余额端点。
 * @param ctx - 插件上下文（服务读取失败按缺失处理）。
 * @param settings - 余额配置。
 * @param settingsService - 可选：调用方已捕获的 settings 服务（cordis 的
 *   ctx.inject 可选注入结果）；缺省时尝试从 ctx 安全读取。
 */
export function detectBalanceEndpoint(
  ctx: Context,
  settings: BalanceSettings,
  settingsService?: { get(ns: unknown): unknown },
): DetectResult {
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

  // auto：按当前默认 provider 推断；三个服务均可能缺失（未注入或未挂载）。
  const agentDefaultModel = serviceOrUndefined<{ currentSelection(): { provider: string; model: string } }>(ctx, 'agentDefaultModel')
  const selection = agentDefaultModel?.currentSelection()
  if (selection === undefined) return { ok: false, reason: 'no default model selection' }
  const provider = selection.provider

  // 已知 provider 的内置端点表：profile 不暴露 baseURL（端点由适配器内置）时
  // 也能推断余额/配额接口。key 仍取 profile 的 apiKeyEnv（或默认名）。
  const knownProviderEndpoints: Record<string, { baseUrl: string; path: string; apiKeyEnv: string }> = {
    // OpenCode Zen Go（opencode.ai）：订阅制，官方配额接口 GET /v1/usage
    'opencode-go': { baseUrl: 'https://opencode.ai/zen/go/v1', path: '/usage', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
  }

  const llm = serviceOrUndefined<{ listConfigurableProviders(): Array<{ provider: string; settingsNs: string; settingsPath: readonly string[] }> }>(ctx, 'llm')
  const entries = llm?.listConfigurableProviders() ?? []
  const entry = entries.find((e) => e.provider === provider)
  if (entry === undefined) return { ok: false, reason: `provider ${provider} not found` }

  // 从命名空间取值，沿 settingsPath 逐层取 profile（任一层非对象即视为不可用）。
  const settingsServiceValue = settingsService
    ?? serviceOrUndefined<{ get(ns: unknown): unknown }>(ctx, 'settings')
  const raw = settingsServiceValue?.get(settingsNamespace(entry.settingsNs))
  let profile: unknown = raw
  for (const key of entry.settingsPath) {
    if (typeof profile !== 'object' || profile === null) { profile = undefined; break }
    profile = (profile as Record<string, unknown>)[key]
  }
  const record = (typeof profile === 'object' && profile !== null ? profile : {}) as Record<string, unknown>
  const baseURL = typeof record.baseURL === 'string' ? record.baseURL
    : typeof record.baseUrl === 'string' ? record.baseUrl : undefined
  const apiKeyEnv = typeof record.apiKeyEnv === 'string' ? record.apiKeyEnv : undefined

  // profile 无 baseURL（适配器内置端点）时查已知 provider 表。
  if (baseURL === undefined) {
    const known = knownProviderEndpoints[provider]
    if (known !== undefined) {
      return {
        ok: true,
        endpoint: {
          baseUrl: known.baseUrl,
          path: known.path,
          apiKeyEnv: apiKeyEnv ?? known.apiKeyEnv,
          source: `auto:${provider}`,
        },
      }
    }
    return { ok: false, reason: 'provider does not expose an endpoint' }
  }
  let hostname: string
  try {
    hostname = new URL(baseURL).hostname
  } catch {
    return { ok: false, reason: 'provider endpoint is not a valid URL' }
  }
  if (isDeepSeekHost(hostname)) {
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
  if (hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai')) {
    const origin = new URL(baseURL).origin
    return {
      ok: true,
      endpoint: {
        baseUrl: origin,
        path: '/usage',
        apiKeyEnv: apiKeyEnv ?? 'OPENCODE_GO_API_KEY',
        source: `auto:${provider}`,
      },
    }
  }
  return { ok: false, reason: 'provider has no known balance endpoint' }
}
