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
})
