import { describe, expect, it } from 'vitest'
import { BalanceClient } from '../src/balance.ts'

/** Node 18+ 全局 Response 可用；此处用最小可用 Response 类型。 */
function resp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status })
}

function client(overrides: { fetchFn?: typeof fetch; getEnv?: (n: string) => string | undefined } = {}) {
  return new BalanceClient({
    fetchFn: overrides.fetchFn ?? (async () => resp({}, 200)) as typeof fetch,
    getEnv: overrides.getEnv ?? (() => 'sk-test'),
  })
}

describe('BalanceClient', () => {
  it('成功解析 DeepSeek 响应', async () => {
    const c = client({
      fetchFn: (async () => resp({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0', topped_up_balance: '12.34' }],
      }, 200)) as typeof fetch,
    })
    c.setDetect(() => ({ ok: true, endpoint: { baseUrl: 'https://api.deepseek.com', path: '/user/balance', apiKeyEnv: 'DEEPSEEK_API_KEY', source: 'manual' } }))
    const s = await c.refresh()
    expect(s.balance).toBe(12.34)
    expect(s.currency).toBe('CNY')
    expect(s.error).toBeNull()
  })

  it('检测失败返回错误不抛', async () => {
    const c = client()
    c.setDetect(() => ({ ok: false, reason: 'disabled' }))
    const s = await c.refresh()
    expect(s.balance).toBeNull()
    expect(s.error).toBe('disabled')
  })

  it('缺少 key 报错', async () => {
    const c = client({ getEnv: () => undefined })
    c.setDetect(() => ({ ok: true, endpoint: { baseUrl: 'https://api.deepseek.com', path: '/user/balance', apiKeyEnv: 'NOPE', source: 'manual' } }))
    const s = await c.refresh()
    expect(s.error).toContain('missing API key')
  })

  it('非 2xx 报错', async () => {
    const c = client({ fetchFn: (async () => resp({}, 401)) as typeof fetch })
    c.setDetect(() => ({ ok: true, endpoint: { baseUrl: 'https://x', path: '/b', apiKeyEnv: 'K', source: 'manual' } }))
    const s = await c.refresh()
    expect(s.error).toContain('401')
  })

  it('OpenCode /v1/usage 解析为三窗口配额快照', async () => {
    const c = client({
      fetchFn: (async () => resp({
        usage: {
          rolling: { status: 'ok', percent: 0, resetsAt: '2026-08-15T18:20:44.411Z' },
          weekly: { status: 'ok', percent: 42, resetsAt: '2026-08-17T00:00:00.411Z' },
          monthly: { status: 'ok', percent: 21, resetsAt: '2026-09-14T14:21:59.411Z' },
        },
      })) as typeof fetch,
    })
    c.setDetect(() => ({ ok: true, endpoint: { baseUrl: 'https://opencode.ai/zen/go/v1', path: '/usage', apiKeyEnv: 'OPENCODE_GO_API_KEY', source: 'auto:opencode-go' } }))
    const s = await c.refresh()
    expect(s.error).toBeNull()
    expect(s.balance).toBeNull()
    expect(s.quota).not.toBeNull()
    expect(s.quota?.rolling?.percent).toBe(0)
    expect(s.quota?.weekly?.percent).toBe(42)
    expect(s.quota?.monthly?.percent).toBe(21)
    expect(s.quota?.monthly?.resetsAt).toContain('2026-09-14')
  })

  it('OpenCode 部分窗口缺失时其余窗口仍返回', async () => {
    const c = client({
      fetchFn: (async () => resp({ usage: { monthly: { status: 'ok', percent: 8, resetsAt: null } } })) as typeof fetch,
    })
    c.setDetect(() => ({ ok: true, endpoint: { baseUrl: 'https://opencode.ai/zen/go/v1', path: '/usage', apiKeyEnv: 'K', source: 'auto:opencode-go' } }))
    const s = await c.refresh()
    expect(s.quota?.monthly?.percent).toBe(8)
    expect(s.quota?.weekly).toBeNull()
    expect(s.quota?.rolling).toBeNull()
  })

  it('OpenCode 格式缺失时按 unexpected response 处理', async () => {
    const c = client({ fetchFn: (async () => resp({ hello: 'world' })) as typeof fetch })
    c.setDetect(() => ({ ok: true, endpoint: { baseUrl: 'https://opencode.ai/zen/go/v1', path: '/usage', apiKeyEnv: 'K', source: 'auto:opencode-go' } }))
    const s = await c.refresh()
    expect(s.error).toBe('unexpected response')
  })
})
