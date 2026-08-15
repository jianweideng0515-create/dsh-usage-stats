import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { detectBalanceEndpoint } from '../src/provider-detect.ts'

function fakeCtx(overrides: Record<string, unknown>): Context {
  return {
    agentDefaultModel: { currentSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }) },
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

  it('auto：无 baseURL 不可推断', () => {
    const ctx = fakeCtx({
      llm: { listConfigurableProviders: () => [{ provider: 'opencode-go', displayName: 'x', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'] }] },
      settings: { get: () => ({ providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } }) },
    })
    const r = detectBalanceEndpoint(ctx, { mode: 'auto' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('does not expose')
  })

  it('off 模式禁用', () => {
    expect(detectBalanceEndpoint(fakeCtx({}), { mode: 'off' }).ok).toBe(false)
  })
})
