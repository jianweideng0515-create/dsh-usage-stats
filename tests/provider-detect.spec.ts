import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { detectBalanceEndpoint, detectBalanceEndpoints } from '../src/provider-detect.ts'

function fakeCtx(overrides: Record<string, unknown>, provider = 'opencode-go'): Context {
  return {
    agentDefaultModel: { currentSelection: () => ({ provider, model: 'deepseek-v4-flash' }) },
    llm: { listConfigurableProviders: () => [] },
    settings: { get: () => undefined },
    ...overrides,
  } as unknown as Context
}

describe('detectBalanceEndpoint', () => {
  it('manual 模式直接使用配置', () => {
    const ctx = fakeCtx({})
    const r = detectBalanceEndpoint(ctx, { mode: 'manual', baseUrl: 'https://api.deepseek.com' })
    expect(r.ok && r.endpoint.source).toBe('manual')
    expect(r.ok && r.endpoint.path).toBe('/user/balance')
  })

  it('auto：DeepSeek 官方 baseURL 自动推断', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'opencode-go', displayName: 'x', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'] }] },
      settings: { get: () => ({ providers: { 'opencode-go': { baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'MY_KEY' } } }) },
    })
    const r = detectBalanceEndpoint(ctx, { mode: 'auto' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.endpoint.baseUrl).toBe('https://api.deepseek.com')
      expect(r.endpoint.path).toBe('/user/balance')
      expect(r.endpoint.apiKeyEnv).toBe('MY_KEY')
      expect(r.endpoint.source).toBe('auto:opencode-go')
    }
  })

  it('auto：非 DeepSeek baseURL 不可推断', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'opencode-go', displayName: 'x', settingsNs: 'ns', settingsPath: [] }] },
      settings: { get: () => ({ baseURL: 'https://api.inferera.com/v1' }) },
    })
    const r = detectBalanceEndpoint(ctx, { mode: 'auto' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('no known balance endpoint')
  })

  it('auto：opencode-go 无 baseURL 走已知端点表（/v1/usage）', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'opencode-go', displayName: 'x', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'] }] },
      settings: { get: () => ({ providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } }) },
    })
    const r = detectBalanceEndpoint(ctx, { mode: 'auto' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.endpoint.baseUrl).toBe('https://opencode.ai/zen/go/v1')
      expect(r.endpoint.path).toBe('/usage')
      expect(r.endpoint.apiKeyEnv).toBe('OPENCODE_GO_API_KEY')
      expect(r.endpoint.source).toBe('auto:opencode-go')
    }
  })

  it('auto：opencode.ai 主机 baseURL 推断 /usage', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'opencode-go', displayName: 'x', settingsNs: 'ns', settingsPath: [] }] },
      settings: { get: () => ({ baseURL: 'https://opencode.ai/zen/go/v1' }) },
    })
    const r = detectBalanceEndpoint(ctx, { mode: 'auto' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.endpoint.path).toBe('/usage')
  })

  it('auto：未知 provider 无 baseURL 不可推断', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'mystery-provider', displayName: 'x', settingsNs: 'ns', settingsPath: [] }] },
      settings: { get: () => ({ apiKeyEnv: 'X_KEY' }) },
    }, 'mystery-provider')
    const r = detectBalanceEndpoint(ctx, { mode: 'auto' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('does not expose')
  })

  it('off 模式禁用', () => {
    expect(detectBalanceEndpoint(fakeCtx({}), { mode: 'off' }).ok).toBe(false)
  })
})

describe('detectBalanceEndpoints', () => {
  it('auto：llm provider + 已知表兜底（opencode-go 与 deepseek 均可检测）', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'opencode-go', displayName: 'x', settingsNs: 'ns', settingsPath: [] }] },
      settings: { get: () => undefined },
    })
    const map = detectBalanceEndpoints(ctx, { mode: 'auto' })
    // opencode-go 归一化为展示 key 'opencode'（来自 llm 列表）；deepseek 不在列表时由已知表兜底
    expect(map['opencode'].ok).toBe(true)
    expect(map['deepseek'].ok).toBe(true)
    if (map['deepseek'].ok) {
      expect(map['deepseek'].endpoint.baseUrl).toBe('https://api.deepseek.com')
      expect(map['deepseek'].endpoint.path).toBe('/user/balance')
      expect(map['deepseek'].endpoint.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
      expect(map['deepseek'].endpoint.source).toBe('auto:deepseek')
    }
  })

  it('auto：profile 配置覆盖已知表默认（apiKeyEnv/baseURL）', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'deepseek', displayName: 'x', settingsNs: 'ns', settingsPath: ['providers', 'deepseek'] }] },
      settings: { get: () => ({ providers: { deepseek: { baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'MY_DS_KEY' } } }) },
    })
    const map = detectBalanceEndpoints(ctx, { mode: 'auto' })
    expect(map['deepseek'].ok).toBe(true)
    if (map['deepseek'].ok) {
      expect(map['deepseek'].endpoint.baseUrl).toBe('https://api.deepseek.com')
      expect(map['deepseek'].endpoint.path).toBe('/user/balance')
      expect(map['deepseek'].endpoint.apiKeyEnv).toBe('MY_DS_KEY')
    }
  })

  it('manual 模式单端点（key 为 manual）', () => {
    const map = detectBalanceEndpoints(fakeCtx({}), { mode: 'manual', baseUrl: 'https://api.deepseek.com' })
    expect(map.manual.ok).toBe(true)
    if (map.manual.ok) expect(map.manual.endpoint.source).toBe('manual')
  })

  it('off 模式返回空表', () => {
    expect(detectBalanceEndpoints(fakeCtx({}), { mode: 'off' })).toEqual({})
  })
})
