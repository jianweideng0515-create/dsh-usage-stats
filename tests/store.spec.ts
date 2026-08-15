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
})
