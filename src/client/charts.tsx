/** 无库 SVG 图表：模型占比 Donut + 用量趋势柱状图（含指标切换与 hover 明细）。 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import styles from './card.module.css'
import { costSymbol, formatCost, formatCnTokens, formatRate } from './format.ts'

/** donut 段色：从主题语义色派生（段 1-5 + 其他）。 */
export const DONUT_SEGMENT_VARS = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-alias-state-info-primary, var(--dsw-alias-state-business-primary))',
  'var(--dsw-alias-label-tertiary)',
]

/** 按请求数取模型占比段：Top 5 + 「其他」聚合；返回段与图例行。 */
export function donutSegments(models: Array<{ model: string; requests: number }>): Array<{ model: string; requests: number; share: number; colorVar: string }> {
  const total = models.reduce((sum, m) => sum + m.requests, 0)
  if (total <= 0) return []
  const top = models.slice(0, 5)
  const rest = models.slice(5).reduce((sum, m) => sum + m.requests, 0)
  const entries = rest > 0
    ? [...top, { model: '__other__', requests: rest }]
    : top
  return entries.map((m, i) => ({
    model: m.model,
    requests: m.requests,
    share: m.requests / total,
    colorVar: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length],
  }))
}

/** 模型占比 SVG 环形图（参考原型 stroke-dasharray donut，无库）。 */
export function DonutChart(props: {
  t: (key: string) => string
  segments: Array<{ model: string; requests: number; share: number; colorVar: string }>
  total: number
  centerLabel: string
}): ReactElement {
  const { t, segments, total, centerLabel } = props
  const R = 15.9155 // 周长 100 的圆半径（参考原型同款）
  const track = `M 18 2.0845 a ${R} ${R} 0 0 1 0 31.831 a ${R} ${R} 0 0 1 0 -31.831`
  let cursor = 0
  return (
    <div className={styles.donutWrap}>
      <div className={styles.donutSvgWrap}>
        <svg viewBox="0 0 36 36" className={styles.donutSvg} role="img" aria-label={segments.map((s) => `${s.model}: ${Math.round(s.share * 100)}%`).join('; ')}>
          <path d={track} fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth="4" />
          {segments.map((s) => {
            const offset = cursor * 100
            cursor += s.share
            return (
              <path
                key={s.model}
                d={track}
                fill="none"
                stroke={s.colorVar}
                strokeWidth="4"
                strokeDasharray={`${Math.max(0.4, s.share * 100)} 100`}
                strokeDashoffset={`${-offset}`}
              />
            )
          })}
        </svg>
        <div className={styles.donutHole}>
          <span className={styles.donutTotal}>{total}</span>
          <span className={styles.donutTotalLabel}>{centerLabel}</span>
        </div>
      </div>
      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.model}>
            <span className={styles.legendDot} style={{ background: s.colorVar }} />
            <span className={styles.legendModel}>{s.model === '__other__' ? t('chart.other') : s.model}</span>
            <span className={styles.legendShare}>{Math.round(s.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 桶内模型分段：tokens 降序 Top 5 + 「其他」聚合，取色与模型占比 Donut 一致。 */
export function bucketSegments(
  point: { byModel: Array<{ model: string; tokens: number }> },
  t: (key: string) => string,
): Array<{ model: string; tokens: number; colorVar: string }> {
  const label = (model: string): string => model === '__unknown__' ? t('model.unknown') : model
  const sorted = [...point.byModel].sort((a, b) => b.tokens - a.tokens)
  if (sorted.length <= 5) {
    return sorted.map((m, i) => ({ model: label(m.model), tokens: m.tokens, colorVar: DONUT_SEGMENT_VARS[i % DONUT_SEGMENT_VARS.length] }))
  }
  const top = sorted.slice(0, 5)
  const rest = sorted.slice(5).reduce((sum, m) => sum + m.tokens, 0)
  return [
    ...top.map((m, i) => ({ model: label(m.model), tokens: m.tokens, colorVar: DONUT_SEGMENT_VARS[i] })),
    { model: t('chart.other'), tokens: rest, colorVar: DONUT_SEGMENT_VARS[5] },
  ]
}

/** 趋势图指标：token 总量（按模型堆叠）/ 费用 / 请求数。 */
export type TrendMetric = 'tokens' | 'cost' | 'requests'

export const TREND_METRICS: Array<{ key: TrendMetric; labelKey: string }> = [
  { key: 'tokens', labelKey: 'trend.metric.tokens' },
  { key: 'cost', labelKey: 'trend.metric.cost' },
  { key: 'requests', labelKey: 'trend.metric.requests' },
]

/** 用量趋势柱状图（无库 SVG + CSS）：指标切换 + Y 轴刻度 + 按模型分段 + hover 明细 tooltip。 */
export function TrendAreaChart(props: {
  t: (key: string) => string
  costCurrency: string
  metric: TrendMetric
  series: Array<{ bucket: string; tokens: number; cost: number; requests: number; hitRate: number; byModel: Array<{ model: string; tokens: number }> }>
}): ReactElement {
  const { t, costCurrency, metric, series } = props
  const [hover, setHover] = useState<number | null>(null)
  const width = 600
  const height = 140
  const padY = 12
  const padX = 4
  if (series.length < 2) {
    return <p className={styles.status}>{t('chart.insufficientData')}</p>
  }
  // 指标取值与格式：tokens 中文万/亿；费用带货币符号；请求数取整。
  const valueOf = (p: { tokens: number; cost: number; requests: number }): number =>
    metric === 'tokens' ? p.tokens : metric === 'cost' ? p.cost : p.requests
  const fmt = metric === 'tokens'
    ? formatCnTokens
    : metric === 'cost'
      ? (v: number): string => `${costSymbol(costCurrency)}${formatCost(v)}`
      : (v: number): string => String(Math.round(v))
  // Y 轴上限 = 数据最大值 / 0.8：最高柱严格占纵轴高度的 80%（顶部留白 20%）
  const dataMax = Math.max(...series.map((p) => valueOf(p)), 0)
  // 请求数为整数口径，上限向上取整避免小数刻度
  const axisMax = dataMax <= 0 ? 1 : metric === 'requests' ? Math.max(1, Math.ceil(dataMax / 0.8)) : dataMax / 0.8
  const innerH = height - padY * 2
  const y = (v: number): number => padY + innerH - (v / axisMax) * innerH
  // Y 轴刻度：0 / 25% / 50% / 75% / 100% × axisMax
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => axisMax * f)
  const colW = (width - padX * 2) / series.length
  const barW = Math.max(3, colW * 0.45)
  const barX = (i: number): number => padX + i * colW + (colW - barW) / 2
  // X 轴日期刻度抽样：超过 12 天时均匀取约 12 个（含首尾）
  const tickStep = Math.max(1, Math.ceil(series.length / 12))
  const xTicks = series.filter((_, i) => i % tickStep === 0 || (i === series.length - 1 && (series.length - 1) % tickStep !== 0))
  const hovered = hover !== null ? series[hover] : null
  const hoverCenter = hover !== null ? ((hover + 0.5) / series.length) * 100 : 0
  return (
    <div className={styles.trendChart}>
      <div className={styles.trendBody}>
        <div className={styles.trendYAxis} aria-hidden="true">
          {ticks.map((v) => (
            <span
              key={v}
              className={styles.trendYTick}
              style={{
                top: `${(y(v) / height) * 100}%`,
                transform: v === 0 ? 'translateY(0)' : v === axisMax ? 'translateY(-100%)' : 'translateY(-50%)',
              }}
            >
              {fmt(v)}
            </span>
          ))}
        </div>
        <div className={styles.trendPlot} onMouseLeave={() => setHover(null)}>
          <svg
            className={styles.trendSvg}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={series.map((p) => `${p.bucket}: ${fmt(valueOf(p))}`).join('; ')}
          >
            {/* 网格线：对齐 Y 轴刻度 */}
            {ticks.map((v) => (
              <line
                key={v}
                x1={padX} x2={width - padX}
                y1={y(v).toFixed(1)} y2={y(v).toFixed(1)}
                stroke="var(--dsw-alias-border-l2)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map((p, i) => {
              // 堆叠基准 = 内区底部（与 0 刻度线/网格一致），避免底部 padY 留白造成柱顶错位
              let base = height - padY
              return (
                <g key={p.bucket} onMouseEnter={() => setHover(i)}>
                  {/* 整列透明命中区：整列可悬停 */}
                  <rect data-trend-hit="true" className={styles.trendHit} x={padX + i * colW} y={padY} width={colW} height={innerH} fill="transparent" />
                  {/* hover 列高亮背景 */}
                  {hover === i ? (
                    <rect x={padX + i * colW} y={padY} width={colW} height={innerH} fill="var(--dsw-alias-state-business-primary)" opacity="0.06" />
                  ) : null}
                  {(metric === 'tokens'
                    ? bucketSegments(p, t).map((s) => ({ key: s.model, value: s.tokens, colorVar: s.colorVar }))
                    : [{ key: metric, value: valueOf(p), colorVar: 'var(--dsw-alias-state-business-primary)' }]
                  ).map((s) => {
                    const segH = (s.value / axisMax) * innerH
                    const top = base - segH
                    base = top
                    return (
                      <rect
                        key={s.key}
                        x={barX(i)}
                        y={top}
                        width={barW}
                        height={Math.max(0, segH)}
                        fill={s.colorVar}
                      />
                    )
                  })}
                </g>
              )
            })}
          </svg>
          {hovered !== null ? (
            <div
              className={styles.trendTooltip}
              style={{
                left: `${hoverCenter}%`,
                transform: hoverCenter > 78 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
              role="tooltip"
            >
              <div className={styles.tooltipDate}>{hovered.bucket}</div>
              {metric === 'tokens' ? (
                <>
                  <div className={styles.tooltipRow}><span>{t('trend.total')}</span><strong>{formatCnTokens(hovered.tokens)}</strong></div>
                  <div className={styles.tooltipRow}><span>{t('trend.cost')}</span><strong>{costSymbol(costCurrency)}{formatCost(hovered.cost)}</strong></div>
                  <div className={styles.tooltipModels}>
                    {bucketSegments(hovered, t).map((s) => (
                      <div className={styles.tooltipModel} key={s.model}>
                        <span className={styles.dot} style={{ background: s.colorVar }} />
                        <span className={styles.tooltipModelName}>{s.model}</span>
                        <strong>{formatCnTokens(s.tokens)}</strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.tooltipRow}><span>{metric === 'cost' ? t('trend.cost') : t('metric.requests')}</span><strong>{fmt(valueOf(hovered))}</strong></div>
                  <div className={styles.tooltipRow}><span>{t('trend.total')}</span><strong>{formatCnTokens(hovered.tokens)}</strong></div>
                </>
              )}
              <div className={styles.tooltipRow}><span>{t('trend.hitRate')}</span><strong>{formatRate(hovered.hitRate)}</strong></div>
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.trendAxis}>
        {xTicks.map((p) => (
          <span key={p.bucket} className={styles.trendTick}>{p.bucket.slice(5)}</span>
        ))}
      </div>
    </div>
  )
}
