/** usage-stats 客户端文案键（zh 为键集基准，en 全量对应）。 */
export interface UsageStatsCopy {
  'settings.title': string
  'settings.description': string
  'settings.enabled': string
  'settings.enabledHint': string
  'session.usageLabel': string
  'session.panelTitle': string
  'session.statusOk': string
  'session.heroTitle': string
  'session.heroTokens': string
  'session.heroCost': string
  'session.heroRounds': string
  'session.heroAvgHit': string
  'session.recentTitle': string
  'session.recentHit': string
  'session.recentTokens': string
  'session.recentCost': string
  'session.copy': string
  'session.copied': string
  'session.balance': string
  'session.unpricedHint': string
  'quota.monthly': string
  'quota.weekly': string
  'quota.rolling': string
  'range.last7': string
  'range.last14': string
  'range.last30': string
  'range.last90': string
  'range.custom': string
  'range.from': string
  'range.to': string
  'metric.tokens': string
  'metric.tokensHint': string
  'metric.requests': string
  'metric.turns': string
  'metric.activeDays': string
  'metric.avgHitRate': string
  'metric.topModel': string
  'metric.cost': string
  'metric.uncounted': string
  'metric.lastHit': string
  'metric.lastCost': string
  'metric.sessionTurns': string
  'metric.sessionCost': string
  'balance.title': string
  'balance.amount': string
  'balance.updated': string
  'balance.refresh': string
  'balance.refreshing': string
  'balance.unavailable': string
  'balance.source': string
  'model.table': string
  'trend.title': string
  'chart.donut': string
  'chart.hitRate': string
  'chart.cost': string
  'chart.other': string
  'chart.noData': string
  'chart.insufficientData': string
  'chart.noCost': string
  'loading': string
  'error': string
  'tokens.input': string
  'tokens.cacheRead': string
  'tokens.cacheWrite': string
  'tokens.output': string
  'tokens.total': string
  'settings.overridden': string
  'settings.reset': string
  'settings.readOnly': string
  'settings.inherit': string
  'settings.on': string
  'settings.off': string
  'settings.expand': string
  'settings.collapse': string
  'settings.save': string
  'settings.saving': string
  'settings.discard': string
  'settings.unsaved': string
  'settings.saveFailed': string
  'settings.invalidNumber': string
}

/** usage-stats 文案键联合（PluginSettingsCard 复用的 settings.* 公共键据此类型化）。 */
export type SettingsCardKey = keyof typeof zh

/** 简体中文字典（键集基准）。 */
export const zh: UsageStatsCopy = {
  'settings.title': 'API 用量统计',
  'settings.description': 'Token、请求、轮次、缓存命中、费用估算与余额。',
  'settings.enabled': '启用用量统计',
  'settings.enabledHint': '关闭后停止统计与余额刷新。',
  'session.usageLabel': '用量:',
  'session.panelTitle': '用量与开销',
  'session.statusOk': '服务正常',
  'session.heroTitle': '会话累计消耗',
  'session.heroTokens': 'Tokens 用量',
  'session.heroCost': '会话总费用',
  'session.heroRounds': '完成轮次',
  'session.heroAvgHit': '平均命中',
  'session.recentTitle': '最近单次请求',
  'session.recentHit': '缓存命中率',
  'session.recentTokens': '本次消耗',
  'session.recentCost': '本次费用',
  'session.copy': '复制摘要',
  'session.copied': '已复制',
  'session.balance': '账户余额',
  'session.unpricedHint': '* 该模型未配置单价，费用按 0 计（可在插件设置中配置价格）',
  'quota.monthly': '月额度已用',
  'quota.weekly': '周额度已用',
  'quota.rolling': '滚动额度已用',
  'range.last7': '最近 7 天',
  'range.last14': '最近 14 天',
  'range.last30': '最近 30 天',
  'range.last90': '最近 90 天',
  'range.custom': '自定义',
  'range.from': '开始日期',
  'range.to': '结束日期',
  'metric.tokens': 'Tokens 用量',
  'metric.tokensHint': '输入 / 缓存读 / 缓存写 / 输出分项与合计。',
  'metric.requests': '请求数量',
  'metric.turns': '完成轮次',
  'metric.activeDays': '活跃天数',
  'metric.avgHitRate': '平均缓存命中率',
  'metric.topModel': '最常用模型',
  'metric.cost': '费用估算',
  'metric.uncounted': '未计价请求',
  'metric.lastHit': '本次命中',
  'metric.lastCost': '本次费用',
  'metric.sessionTurns': '当前会话轮次',
  'metric.sessionCost': '会话费用',
  'balance.title': '账户余额',
  'balance.amount': '余额',
  'balance.updated': '更新时间',
  'balance.refresh': '刷新',
  'balance.refreshing': '刷新中…',
  'balance.unavailable': '余额不可用',
  'balance.source': '来源',
  'model.table': '模型明细',
  'trend.title': '用量趋势',
  'chart.donut': '模型占比',
  'chart.hitRate': '命中率趋势',
  'chart.cost': '费用趋势',
  'chart.other': '其他',
  'chart.noData': '暂无数据',
  'chart.insufficientData': '数据点不足，暂不展示趋势',
  'chart.noCost': '暂无费用数据（模型未计价）',
  'loading': '加载中…',
  'error': '加载失败',
  'tokens.input': '输入',
  'tokens.cacheRead': '缓存读',
  'tokens.cacheWrite': '缓存写',
  'tokens.output': '输出',
  'tokens.total': '合计',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',
  'settings.invalidNumber': '请输入数字，留空则使用默认值。',
}

/** 英文字典（与 zh 键集完全一致）。 */
export const en: UsageStatsCopy = {
  'settings.title': 'API usage stats',
  'settings.description': 'Tokens, requests, turns, cache hits, cost estimates and balance.',
  'settings.enabled': 'Enable usage stats',
  'settings.enabledHint': 'When off, tracking and balance refresh stop.',
  'session.usageLabel': 'Usage:',
  'session.panelTitle': 'Usage & cost',
  'session.statusOk': 'All systems normal',
  'session.heroTitle': 'Session totals',
  'session.heroTokens': 'Tokens used',
  'session.heroCost': 'Session cost',
  'session.heroRounds': 'Rounds',
  'session.heroAvgHit': 'Avg hit',
  'session.recentTitle': 'Last request',
  'session.recentHit': 'Cache hit rate',
  'session.recentTokens': 'Cost this request',
  'session.recentCost': 'Fee this request',
  'session.copy': 'Copy summary',
  'session.copied': 'Copied',
  'session.balance': 'Account balance',
  'session.unpricedHint': '* Model has no configured price; cost counted as 0 (configure prices in plugin settings)',
  'quota.monthly': 'Monthly quota used',
  'quota.weekly': 'Weekly quota used',
  'quota.rolling': 'Rolling quota used',
  'range.last7': 'Last 7 days',
  'range.last14': 'Last 14 days',
  'range.last30': 'Last 30 days',
  'range.last90': 'Last 90 days',
  'range.custom': 'Custom',
  'range.from': 'From',
  'range.to': 'To',
  'metric.tokens': 'Tokens used',
  'metric.tokensHint': 'Input / cache read / cache write / output split and total.',
  'metric.requests': 'Requests',
  'metric.turns': 'Turns completed',
  'metric.activeDays': 'Active days',
  'metric.avgHitRate': 'Avg cache hit rate',
  'metric.topModel': 'Top model',
  'metric.cost': 'Estimated cost',
  'metric.uncounted': 'Unpriced requests',
  'metric.lastHit': 'Last hit rate',
  'metric.lastCost': 'Last request cost',
  'metric.sessionTurns': 'Session turns',
  'metric.sessionCost': 'Session cost',
  'balance.title': 'Account balance',
  'balance.amount': 'Balance',
  'balance.updated': 'Updated',
  'balance.refresh': 'Refresh',
  'balance.refreshing': 'Refreshing…',
  'balance.unavailable': 'Balance unavailable',
  'balance.source': 'Source',
  'model.table': 'Model breakdown',
  'trend.title': 'Usage trend',
  'chart.donut': 'Model share',
  'chart.hitRate': 'Hit rate trend',
  'chart.cost': 'Cost trend',
  'chart.other': 'Others',
  'chart.noData': 'No data yet',
  'chart.insufficientData': 'Not enough data points for a trend',
  'chart.noCost': 'No cost data (models unpriced)',
  'loading': 'Loading…',
  'error': 'Load failed',
  'tokens.input': 'Input',
  'tokens.cacheRead': 'Cache read',
  'tokens.cacheWrite': 'Cache write',
  'tokens.output': 'Output',
  'tokens.total': 'Total',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset to default',
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
}
