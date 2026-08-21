import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createEmptyBucket, localDateKey } from './meter.ts'
import type { DayBucket, ModelBucket, SessionRecord, UsageStatsState } from './meter.ts'
import type { BalanceSnapshot } from './balance.ts'

/** 持久化的余额/配额快照表（重启恢复用，避免重启后余额卡空窗）。 */
export interface PersistedBalance {
  savedAt: string
  providers: Record<string, BalanceSnapshot>
}

/** 持久化文件形状（version 1；balance 节为可选增量，旧文件缺失兼容）。 */
export interface PersistedFile {
  version: 1
  meta: { installedAt: string; lastSavedAt: string }
  totals: ModelBucket
  byDay: Record<string, DayBucket>
  sessions: Record<string, SessionRecord>
  balance?: PersistedBalance
}

export const BY_DAY_RETENTION_DAYS = 730
export const SESSIONS_RETENTION_MAX = 500

/** 就地裁剪 byDay：只保留最近 730 个日期键。 */
export function trimByDay(byDay: Record<string, DayBucket>, now: number): void {
  const cutoff = localDateKey(now - (BY_DAY_RETENTION_DAYS - 1) * 86_400_000)
  for (const key of Object.keys(byDay)) {
    if (key < cutoff) delete byDay[key]
  }
}

/** 就地裁剪 sessions：按 lastRequestAt 升序淘汰最旧，保留最近 max 条。 */
export function trimSessions(sessions: Record<string, SessionRecord>, max = SESSIONS_RETENTION_MAX): void {
  const keys = Object.keys(sessions)
  if (keys.length <= max) return
  const sorted = keys
    .map((id) => ({ id, at: sessions[id].lastRequestAt ?? '' }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  for (const entry of sorted.slice(0, sorted.length - max)) delete sessions[entry.id]
}

export class UsageStatsStore {
  private lastInstalled: string | null = null
  private lastLoadedBalance: PersistedBalance | null = null

  constructor(private readonly filePath: string) {}

  /** 读取持久化状态；不存在/损坏/版本不符返回 null（损坏时备份 .bak）。 */
  load(): UsageStatsState | null {
    if (!existsSync(this.filePath)) return null
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch {
      return null
    }
    let parsed: PersistedFile
    try {
      parsed = JSON.parse(raw) as PersistedFile
    } catch {
      this.backup()
      return null
    }
    if (parsed.version !== 1 || typeof parsed.totals !== 'object' || parsed.totals === null) {
      this.backup()
      return null
    }
    this.lastInstalled = parsed.meta?.installedAt ?? null
    // 余额节宽松校验：形状不符按缺失处理，不影响计量状态恢复。
    this.lastLoadedBalance = parsed.balance !== undefined && typeof parsed.balance === 'object' && parsed.balance !== null
      && typeof parsed.balance.providers === 'object' && parsed.balance.providers !== null
      ? parsed.balance
      : null
    return {
      totals: { ...createEmptyBucket(), ...parsed.totals },
      byDay: parsed.byDay ?? {},
      sessions: parsed.sessions ?? {},
    }
  }

  /** load 时记录的余额快照表；从未 load 或文件无该节返回 null。 */
  lastBalance(): PersistedBalance | null {
    return this.lastLoadedBalance
  }

  /** load 时记录 meta.installedAt；从未 load 返回 null。 */
  lastInstalledAt(): string | null {
    return this.lastInstalled
  }

  /** 裁剪后原子写盘（tmp + rename）。失败抛错，由调用方告警。 */
  save(state: UsageStatsState, installedAt: string | null, balance?: PersistedBalance): void {
    const now = Date.now()
    const byDay = { ...state.byDay }
    trimByDay(byDay, now)
    const sessions = { ...state.sessions }
    trimSessions(sessions)
    const file: PersistedFile = {
      version: 1,
      meta: {
        installedAt: installedAt ?? new Date(now).toISOString(),
        lastSavedAt: new Date(now).toISOString(),
      },
      totals: state.totals,
      byDay,
      sessions,
      ...(balance === undefined ? {} : { balance }),
    }
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, '.dsh-usage-stats.tmp')
    writeFileSync(tmp, JSON.stringify(file), 'utf8')
    renameSync(tmp, this.filePath)
  }

  private backup(): void {
    try {
      renameSync(this.filePath, this.filePath + '.bak')
    } catch {
      // 备份失败不阻断重建
    }
  }
}
