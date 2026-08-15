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

/** DeepSeek 内置价格表（每百万 token，单位为美元）。 */
export const DEFAULT_DEEPSEEK_PRICES: Record<string, ModelPrice> = {
  'deepseek-chat': { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 },
  'deepseek-reasoner': { input: 4, cacheRead: 1, cacheWrite: 4, output: 16 },
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
 */
export function priceBuckets(
  model: string,
  buckets: TokenBuckets,
  prices: Record<string, ModelPrice>,
  defaultPrice?: ModelPrice,
): number {
  const price = prices[model] ?? defaultPrice
  if (!price) return 0
  const perMillion = 1e6
  return (
    (buckets.uncachedInputTokens / perMillion) * price.input +
    (buckets.cacheReadTokens / perMillion) * price.cacheRead +
    (buckets.cacheWriteTokens / perMillion) * price.cacheWrite +
    (buckets.outputTokens / perMillion) * price.output
  )
}
