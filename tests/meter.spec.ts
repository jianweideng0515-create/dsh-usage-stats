import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { UsageStatsMeter, hitRateOf, localDateKey, UNKNOWN_MODEL } from '../src/meter.ts'

function ev(type: SessionEvent['type'], data: unknown, time = 1_750_000_000_000): SessionEvent {
  return { type, data, time } as SessionEvent
}

describe('UsageStatsMeter', () => {
  it('记一次完整请求：request/header + step/start + usage chunk + step/end + turn/end', () => {
    const meter = new UsageStatsMeter()
    meter.applyEvent('s1', 'D:\\work', ev('request/header', { header: { config: { provider: 'p', model: 'deepseek-chat' } }, reason: 'initial' }))
    meter.applyEvent('s1', 'D:\\work', ev('step/start', { turn: 1, step: 1 }))
    meter.applyEvent('s1', 'D:\\work', ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 10 } } }))
    meter.applyEvent('s1', 'D:\\work', ev('step/end', { turn: 1, step: 1 }))
    meter.applyEvent('s1', 'D:\\work', ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    const s = meter.state()
    expect(s.totals.requests).toBe(1)
    expect(s.totals.turns).toBe(1)
    expect(s.totals.uncachedInputTokens).toBe(100)
    expect(s.totals.cacheReadTokens).toBe(30)
    expect(s.totals.cacheWriteTokens).toBe(10)
    expect(s.totals.outputTokens).toBe(20)
    const day = s.byDay[localDateKey(1_750_000_000_000)]
    expect(day).toBeDefined()
    expect(day.byModel['deepseek-chat'].requests).toBe(1)
    expect(day.byModel['deepseek-chat'].uncachedInputTokens).toBe(100)
    expect(s.sessions['s1'].requests).toBe(1)
    expect(s.sessions['s1'].turns).toBe(1)
  })

  it('同一 (turn,step) 的 message usage 替换 chunk usage 不双计', () => {
    const meter = new UsageStatsMeter()
    meter.applyEvent('s1', null, ev('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }))
    meter.applyEvent('s1', null, ev('step/start', { turn: 1, step: 1 }))
    meter.applyEvent('s1', null, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } } }))
    meter.applyEvent('s1', null, ev('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 110, outputTokens: 25 } }))
    meter.applyEvent('s1', null, ev('step/end', { turn: 1, step: 1 }))
    const s = meter.state()
    expect(s.totals.uncachedInputTokens).toBe(110)
    expect(s.totals.outputTokens).toBe(25)
    expect(s.totals.requests).toBe(1)
  })

  it('无 usage 的 step 只计 requests', () => {
    const meter = new UsageStatsMeter()
    meter.applyEvent('s1', null, ev('step/start', { turn: 1, step: 1 }))
    meter.applyEvent('s1', null, ev('step/end', { turn: 1, step: 1 }))
    const s = meter.state()
    expect(s.totals.requests).toBe(1)
    expect(s.totals.outputTokens).toBe(0)
  })

  it('中止轮次不计 turns 且不回溯已记账 usage', () => {
    const meter = new UsageStatsMeter()
    meter.applyEvent('s1', null, ev('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }))
    meter.applyEvent('s1', null, ev('step/start', { turn: 1, step: 1 }))
    meter.applyEvent('s1', null, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 50, outputTokens: 5 } } }))
    meter.applyEvent('s1', null, ev('step/end', { turn: 1, step: 1 }))
    meter.applyEvent('s1', null, ev('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }))
    const s = meter.state()
    expect(s.totals.turns).toBe(0)
    expect(s.totals.uncachedInputTokens).toBe(50)
  })

  it('多会话分别记账；按事件时间落入不同日期', () => {
    const meter = new UsageStatsMeter()
    const t1 = Date.UTC(2026, 7, 15, 2, 0, 0)  // 本地时区日期取决于运行环境，用 localDateKey 对照
    const t2 = t1 + 86_400_000
    meter.applyEvent('a', 'W1', ev('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }, t1))
    meter.applyEvent('a', 'W1', ev('step/start', { turn: 1, step: 1 }, t1))
    meter.applyEvent('a', 'W1', ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } }, t1))
    meter.applyEvent('a', 'W1', ev('step/end', { turn: 1, step: 1 }, t1))
    meter.applyEvent('b', 'W2', ev('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }, t2))
    meter.applyEvent('b', 'W2', ev('step/start', { turn: 1, step: 1 }, t2))
    meter.applyEvent('b', 'W2', ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 20, outputTokens: 2 } } }, t2))
    meter.applyEvent('b', 'W2', ev('step/end', { turn: 1, step: 1 }, t2))
    const s = meter.state()
    expect(s.sessions['a'].workspace).toBe('W1')
    expect(s.sessions['b'].workspace).toBe('W2')
    expect(s.totals.uncachedInputTokens).toBe(30)
    const d1 = localDateKey(t1)
    const d2 = localDateKey(t2)
    if (d1 !== d2) {
      expect(s.byDay[d1].bucket.uncachedInputTokens).toBe(10)
      expect(s.byDay[d2].bucket.uncachedInputTokens).toBe(20)
    }
  })

  it('无 header 的 step 归入 UNKNOWN_MODEL', () => {
    const meter = new UsageStatsMeter()
    meter.applyEvent('s1', null, ev('step/start', { turn: 1, step: 1 }))
    const s = meter.state()
    expect(Object.keys(s.byDay[localDateKey(1_750_000_000_000)].byModel)).toContain(UNKNOWN_MODEL)
  })

  it('hitRateOf 口径：cacheRead / 全部输入类 token', () => {
    expect(hitRateOf({ uncachedInputTokens: 70, cacheReadTokens: 30, cacheWriteTokens: 0, outputTokens: 10 })).toBeCloseTo(0.3)
    expect(hitRateOf({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 })).toBe(0)
  })

  it('restore 后用保存的状态继续累计', () => {
    const meter = new UsageStatsMeter()
    meter.applyEvent('s1', null, ev('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }))
    meter.applyEvent('s1', null, ev('step/start', { turn: 1, step: 1 }))
    meter.applyEvent('s1', null, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } } }))
    const saved = meter.state()
    const meter2 = new UsageStatsMeter()
    meter2.restore(saved)
    meter2.applyEvent('s1', null, ev('step/end', { turn: 1, step: 1 }))
    meter2.applyEvent('s1', null, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(meter2.state().totals.turns).toBe(1)
    expect(meter2.state().totals.uncachedInputTokens).toBe(100)
  })

  it('setPriceResolver 切换费用计算', () => {
    const meter = new UsageStatsMeter()
    meter.setPriceResolver(() => 42)
    meter.applyEvent('s1', null, ev('request/header', { header: { config: { provider: 'p', model: 'm' } }, reason: 'initial' }))
    meter.applyEvent('s1', null, ev('step/start', { turn: 1, step: 1 }))
    meter.applyEvent('s1', null, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } }))
    expect(meter.state().totals.cost).toBe(42)
  })
})
