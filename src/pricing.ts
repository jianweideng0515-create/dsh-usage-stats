import type { TokenBuckets } from './meter.ts'

/** 单个模型的每百万 token 单价（单位为对应货币，通常为美元）。 */
export interface ModelPrice {
  /** 未命中缓存的输入 token 单价。 */
  input: number
  /** 命中缓存（缓存读取）的输入 token 单价。 */
  cacheRead: number
  /** 写入缓存产生的输入 token 单价。 */
  cacheWrite: number
  /** 输出 token 单价。 */
  output: number
}

/** 价格配置：可按模型覆盖单价，可提供兜底价与货币单位。 */
export interface PriceConfig {
  prices?: Record<string, ModelPrice>
  defaultPrice?: ModelPrice
  currency?: string
}

/**
 * 内置价格表（每百万 token）。DeepSeek 官方价按 CNY；OpenCode Zen Go
 * （opencode-go provider）价格取自 pi-ai 官方 catalog（USD 口径）。
 * 货币标签以插件设置 currency 为准；混用两套计价时费用为估算值。
 */
export const DEFAULT_DEEPSEEK_PRICES: Record<string, ModelPrice> = {
  // DeepSeek 官方（CNY）
  'deepseek-chat': { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 },
  'deepseek-reasoner': { input: 4, cacheRead: 1, cacheWrite: 4, output: 16 },
  // OpenCode Zen Go（USD，来源 pi-ai catalog data/opencode-go.json）
  'deepseek-v4-flash': { input: 0.14, cacheRead: 0.0028, cacheWrite: 0, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, cacheRead: 0.003625, cacheWrite: 0, output: 0.87 },
  'glm-5.1': { input: 1.4, cacheRead: 0.26, cacheWrite: 0, output: 4.4 },
  'glm-5.2': { input: 1.4, cacheRead: 0.26, cacheWrite: 0, output: 4.4 },
  'hy3': { input: 0.14, cacheRead: 0.035, cacheWrite: 0, output: 0.58 },
  'kimi-k2.6': { input: 0.95, cacheRead: 0.16, cacheWrite: 0, output: 4 },
  'kimi-k2.7-code': { input: 0.95, cacheRead: 0.19, cacheWrite: 0, output: 4 },
  'kimi-k3': { input: 3, cacheRead: 0.3, cacheWrite: 0, output: 15 },
  'mimo-v2.5': { input: 0.14, cacheRead: 0.0028, cacheWrite: 0, output: 0.28 },
  'mimo-v2.5-pro': { input: 0.435, cacheRead: 0.003625, cacheWrite: 0, output: 0.87 },
  'minimax-m2.7': { input: 0.3, cacheRead: 0.06, cacheWrite: 0, output: 1.2 },
  'minimax-m3': { input: 0.3, cacheRead: 0.06, cacheWrite: 0, output: 1.2 },
  'qwen3.6-plus': { input: 0.5, cacheRead: 0.05, cacheWrite: 0.625, output: 3 },
  'qwen3.7-max': { input: 2.5, cacheRead: 0.5, cacheWrite: 3.125, output: 7.5 },
  'qwen3.7-plus': { input: 0.4, cacheRead: 0.04, cacheWrite: 0.5, output: 1.6 },
  'grok-4.5': { input: 2, cacheRead: 0.5, cacheWrite: 0, output: 6 },
}

/**
 * 合并价格表：内置表打底，用户覆盖优先。
 * @param userPrices 用户自定义价格，覆盖同名字典项。
 */
export function resolvePrices(
  userPrices?: Record<string, ModelPrice>,
): Record<string, ModelPrice> {
  return { ...DEFAULT_DEEPSEEK_PRICES, ...userPrices }
}

/**
 * 按每百万 token 单价估算一次用量的费用。各分项除以 1e6 后乘以对应单价，
 * 四项累加。未知模型且未提供兜底价时返回 0。
 *
 * 防御：defaultPrice 可能是 schemastery 对未配置对象字段解析出的空对象 {}，
 * 其单价字段为 undefined，直接参与乘法会产生 NaN 污染累计状态（NaN 经
 * JSON 序列化为 null）——空对象、缺失或非有限单价一律视为无价格，返回 0。
 */
export function priceBuckets(
  model: string,
  buckets: TokenBuckets,
  prices: Record<string, ModelPrice>,
  defaultPrice?: ModelPrice,
): number {
  const price = prices[model] ?? defaultPrice
  if (price === undefined || price === null || typeof price !== 'object') return 0
  const { input, cacheRead, cacheWrite, output } = price
  if (!Number.isFinite(input) || !Number.isFinite(cacheRead) || !Number.isFinite(cacheWrite) || !Number.isFinite(output)) {
    return 0
  }
  const perMillion = 1e6
  return (
    (buckets.uncachedInputTokens / perMillion) * input +
    (buckets.cacheReadTokens / perMillion) * cacheRead +
    (buckets.cacheWriteTokens / perMillion) * cacheWrite +
    (buckets.outputTokens / perMillion) * output
  )
}
