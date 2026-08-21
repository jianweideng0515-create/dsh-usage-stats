/**
 * CSS Module 死样式检测与清理：比对 card.module.css 中定义的类与
 * src/client 源码里的实际引用（styles.xxx 字面量 + 动态键名字符串），
 * 删除「所有选择器都只引用死类」的规则块。
 *
 * 用法：node scripts/css-usage.mjs [--write]   （缺省只报告，--write 才删除）
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const write = process.argv.includes('--write')
const cssPath = 'src/client/card.module.css'
const srcDir = 'src/client'

const css = readFileSync(cssPath, 'utf8')

// 1. 定义的类名（规则选择器里出现的 .name）
const defined = new Set()
for (const m of css.matchAll(/\.([A-Za-z_][\w-]*)/g)) defined.add(m[1])

// 2. 源码引用：styles.xxx 字面量 + 任意引号字符串（覆盖 styles[dynamicKey] 场景，宁多留勿误删）
const used = new Set()
const files = readdirSync(srcDir).filter((f) => /\.(ts|tsx)$/.test(f))
for (const f of files) {
  const text = readFileSync(join(srcDir, f), 'utf8')
  for (const m of text.matchAll(/styles\.([A-Za-z_]\w*)/g)) used.add(m[1])
  for (const m of text.matchAll(/['"]([A-Za-z_][\w-]*)['"]/g)) used.add(m[1])
}

const dead = [...defined].filter((n) => !used.has(n)).sort()
console.log(`defined: ${defined.size}, used: ${used.size}, dead: ${dead.length}`)
if (dead.length > 0) console.log('dead classes:', dead.join(', '))

/** 删除一条平铺规则（selector...{ body }），返回剩余文本与是否删除。 */
function removeRule(text, start) {
  const open = text.indexOf('{', start)
  if (open === -1) return { text, removed: false, next: text.length }
  // 找配对 }（无嵌套假设，但容忍一层 @media 内层由外层处理）
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) return { text, removed: false, next: text.length }
  // 选择器起点：向前找上一条规则的结束（} 或开头）
  let selStart = text.lastIndexOf('}', open)
  selStart = selStart === -1 ? 0 : selStart + 1
  const selector = text.slice(selStart, open)
  const names = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1])
  const removable = names.length > 0 && names.every((n) => dead.includes(n))
  if (!removable) return { text, removed: false, next: end + 1 }
  return { text: text.slice(0, selStart) + text.slice(end + 1).replace(/^\r?\n\r?\n/, '\n'), removed: true, next: selStart }
}

if (write) {
  let out = css
  let removedCount = 0
  let i = 0
  while (i < out.length) {
    const brace = out.indexOf('{', i)
    if (brace === -1) break
    const atRule = /@/.test(out.slice(Math.max(0, out.lastIndexOf('}', brace)) + 1, brace + 1))
    if (atRule) {
      // @media/@keyframes 等：跳过其整个块（内层规则多为状态变体，保守保留）
      let depth = 0
      let end = -1
      for (let j = brace; j < out.length; j++) {
        if (out[j] === '{') depth++
        else if (out[j] === '}') { depth--; if (depth === 0) { end = j; break } }
      }
      i = end === -1 ? out.length : end + 1
      continue
    }
    const r = removeRule(out, i)
    if (r.removed) { removedCount++; out = r.text }
    i = r.next
  }
  // 清理连续空行
  out = out.replace(/\n{3,}/g, '\n\n')
  writeFileSync(cssPath, out)
  console.log(`removed ${removedCount} rules -> ${cssPath}`)
} else {
  console.log('(dry run; pass --write to remove)')
}
