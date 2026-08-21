/** 展示格式化纯函数（KPI 卡、表格、图表共用）。 */

/** Token 紧凑格式：M/K 缩写（KPI 卡、模型表用）。 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(2) + 'M'
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K'
  return String(tokens)
}

/** 费用固定四位小数。 */
export function formatCost(cost: number): string {
  return cost.toFixed(4)
}

/** 命中率展示：百分比保留两位小数（如 99.84%）。 */
export function formatRate(rate: number): string {
  return (rate * 100).toFixed(2) + '%'
}

/** 费用计价货币符号：CNY → ¥，USD → $，其他货币原样前缀。 */
export function costSymbol(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return currency === '' ? '' : `${currency} `
}

/** 中文 token 单位：≥1 亿显示亿（两位小数），≥1 万显示万（一位小数），否则原样。 */
export function formatCnTokens(tokens: number): string {
  if (tokens >= 1e8) return `${(tokens / 1e8).toFixed(2)}亿`
  if (tokens >= 1e4) return `${(tokens / 1e4).toFixed(1)}万`
  return String(tokens)
}
