import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEEPSEEK_PRICES,
  priceBuckets,
  resolvePrices,
} from '../src/pricing.js'

describe('priceBuckets', () => {
  it('deepseek-chat 各分项每百万 token 计费', () => {
    const prices = resolvePrices()
    const cost = priceBuckets(
      'deepseek-chat',
      {
        uncachedInputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 1_000_000,
      },
      prices,
    )
    // 2 + 0.5 + 2 + 8 = 12.5
    expect(cost).toBe(12.5)
  })

  it('未知模型且无兜底价返回 0', () => {
    const prices = resolvePrices()
    const cost = priceBuckets(
      'unknown-model',
      {
        uncachedInputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      prices,
    )
    expect(cost).toBe(0)
  })

  it('未知型号且提供 defaultPrice 时按兜底价计费', () => {
    const prices = resolvePrices()
    const defaultPrice = { input: 1, cacheRead: 0, cacheWrite: 0, output: 0 }
    const cost = priceBuckets(
      'unknown-model',
      {
        uncachedInputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      prices,
      defaultPrice,
    )
    expect(cost).toBe(1)
  })

  it('defaultPrice 为空对象（schemastery 未配置解析结果）时返回 0 而非 NaN', () => {
    // 回归：schemastery 对未配置的对象字段解析为空对象 {}（truthy），旧实现
    // 会继续用 price.input（undefined）参与乘法得到 NaN，NaN 经 JSON 序列化
    // 为 null，污染持久化的 cost 字段。
    const prices = resolvePrices()
    const cost = priceBuckets(
      'unknown-model',
      {
        uncachedInputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      prices,
      {} as { input: number; cacheRead: number; cacheWrite: number; output: number },
    )
    expect(Number.isFinite(cost)).toBe(true)
    expect(cost).toBe(0)
  })
})

describe('resolvePrices', () => {
  it('用户覆盖优先于内置表', () => {
    const prices = resolvePrices({
      'deepseek-chat': { input: 9, cacheRead: 0.5, cacheWrite: 2, output: 8 },
    })
    expect(prices['deepseek-chat'].input).toBe(9)
    // 未覆盖的模型仍保留内置价
    expect(prices['deepseek-reasoner'].input).toBe(
      DEFAULT_DEEPSEEK_PRICES['deepseek-reasoner'].input,
    )
  })
})
