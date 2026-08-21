import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageStatsStore, trimByDay, trimSessions } from '../src/store.ts'
import { createEmptyBucket, localDateKey } from '../src/meter.ts'
import type { DayBucket, SessionRecord, UsageStatsState } from '../src/meter.ts'

const dirs: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-stats-'))
  dirs.push(dir)
  return join(dir, 'stats.json')
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('UsageStatsStore', () => {
  it('round-trip：save 后 load 得到相同状态', () => {
    const file = tempFile()
    const store = new UsageStatsStore(file)
    const state: UsageStatsState = {
      totals: { ...createEmptyBucket(), requests: 3, uncachedInputTokens: 150 },
      byDay: { [localDateKey(Date.now())]: { bucket: { ...createEmptyBucket(), requests: 3 }, byModel: {} } },
      sessions: {},
    }
    store.save(state, '2026-01-01T00:00:00.000Z')
    const loaded = store.load()
    expect(loaded).not.toBeNull()
    expect(loaded!.totals.requests).toBe(3)
    expect(loaded!.totals.uncachedInputTokens).toBe(150)
    expect(store.lastInstalledAt()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('文件不存在时 load 返回 null', () => {
    const store = new UsageStatsStore(join(tempFile(), 'nope.json'))
    expect(store.load()).toBeNull()
    expect(store.lastInstalledAt()).toBeNull()
  })

  it('损坏 JSON 备份为 .bak 并返回 null', () => {
    const file = tempFile()
    writeFileSync(file, '{broken json')
    const store = new UsageStatsStore(file)
    expect(store.load()).toBeNull()
    expect(existsSync(file + '.bak')).toBe(true)
  })

  it('trimByDay 只保留最近 730 天', () => {
    const byDay: Record<string, DayBucket> = {}
    const now = Date.now()
    for (let i = 0; i < 740; i++) {
      const key = localDateKey(now - i * 86_400_000)
      byDay[key] = { bucket: createEmptyBucket(), byModel: {} }
    }
    trimByDay(byDay, now)
    expect(Object.keys(byDay).length).toBeLessThanOrEqual(731)
  })

  it('trimSessions 按 lastRequestAt 保留最近 500 条', () => {
    const sessions: Record<string, SessionRecord> = {}
    for (let i = 0; i < 510; i++) {
      sessions['s' + i] = {
        sessionId: 's' + i, workspace: null, createdAt: '', turns: 0, requests: 0, cost: 0,
        lastRequestAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        lastModel: null, lastRequestCost: null, lastRequestHitRate: null,
      }
    }
    trimSessions(sessions)
    expect(Object.keys(sessions).length).toBe(500)
  })

  it('余额快照表随文件持久化并可恢复', () => {
    const file = tempFile()
    const store = new UsageStatsStore(file)
    const state: UsageStatsState = {
      totals: createEmptyBucket(),
      byDay: {},
      sessions: {},
    }
    const balance = {
      savedAt: '2026-08-20T00:00:00.000Z',
      providers: {
        deepseek: { balance: 12.34, currency: 'CNY', updatedAt: '2026-08-20T00:00:00.000Z', error: null, source: null, quota: null, costCurrency: 'CNY' },
      },
    }
    store.save(state, null, balance)
    // 新实例模拟重启：load 后可取回快照表
    const reloaded = new UsageStatsStore(file)
    reloaded.load()
    const restored = reloaded.lastBalance()
    expect(restored).not.toBeNull()
    expect(restored!.savedAt).toBe('2026-08-20T00:00:00.000Z')
    expect(restored!.providers.deepseek.balance).toBe(12.34)
  })

  it('无余额节（旧文件）lastBalance 返回 null，形状不符按缺失处理', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({
      version: 1,
      meta: { installedAt: '2026-01-01T00:00:00.000Z', lastSavedAt: '2026-01-01T00:00:00.000Z' },
      totals: createEmptyBucket(),
      byDay: {},
      sessions: {},
    }))
    const store = new UsageStatsStore(file)
    expect(store.load()).not.toBeNull()
    expect(store.lastBalance()).toBeNull()

    const bad = tempFile()
    writeFileSync(bad, JSON.stringify({
      version: 1,
      meta: { installedAt: '2026-01-01T00:00:00.000Z', lastSavedAt: '2026-01-01T00:00:00.000Z' },
      totals: createEmptyBucket(),
      byDay: {},
      sessions: {},
      balance: { savedAt: 'x' }, // 缺 providers：形状不符
    }))
    const store2 = new UsageStatsStore(bad)
    store2.load()
    expect(store2.lastBalance()).toBeNull()
  })
})
