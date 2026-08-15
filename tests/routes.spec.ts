import { describe, expect, it } from 'vitest'
import { parseRange } from '../src/query.ts'
import { isLoopbackRequest } from '../src/routes.ts'
import type { IncomingMessage } from 'node:http'

describe('routes helpers', () => {
  it('parseRange 拒绝非法输入', () => {
    expect(parseRange('x', undefined, Date.now()).ok).toBe(false)
  })
  it('isLoopbackRequest 拒绝非 loopback 地址', () => {
    const req = { socket: { remoteAddress: '192.168.1.2' }, headers: {} } as unknown as IncomingMessage
    expect(isLoopbackRequest(req)).toBe(false)
  })
})
