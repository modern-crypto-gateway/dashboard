/* eslint-disable react-refresh/only-export-components -- small chart kit */
import * as React from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import { cn } from '@/lib/utils'

/*
 * Chart kit for the console. Conventions (see the dataviz skill):
 * one axis, recessive grid, 2px lines, rounded bar ends, a crosshair +
 * tooltip on every plot, text in ink tokens (never the series colour),
 * lead series in the signal colour.
 */

export type Point = { key: string; label: string; [series: string]: string | number }

export type Series = {
  key: string
  name: string
  /** CSS colour (token var). */
  color: string
  /** Optional area fill colour; defaults to color. */
  fill?: string
}

export const compactUsd = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`
  return `$${n.toFixed(0)}`
}

export const fullUsd = (n: number): string =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ── Tooltip ─────────────────────────────────────────────── */

function TooltipCard({
  active,
  payload,
  label,
  format,
  series,
}: TooltipProps<number, string> & {
  format: (n: number) => string
  series: Series[]
}) {
  if (!active || !payload?.length) return null
  const title = (payload[0]?.payload as Point | undefined)?.label ?? label
  return (
    <div className="min-w-[160px] rounded-xl border border-border bg-[var(--bg-1)] px-3 py-2.5 text-xs shadow-[var(--shadow-md)]">
      <div className="mb-1.5 font-medium text-foreground">{title}</div>
      <div className="space-y-1">
        {series.map((s) => {
          const p = payload.find((x) => x.dataKey === s.key)
          if (!p) return null
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-[var(--fg-2)]">{s.name}</span>
              <span className="figure ml-auto pl-4 font-medium text-foreground">
                {format(Number(p.value ?? 0))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const axisTick = { fill: 'var(--fg-3)', fontSize: 11 }

/* ── Area trend (one or more series, same unit) ──────────── */

export function AreaTrend({
  data,
  series,
  height = 260,
  format = fullUsd,
  axisFormat = compactUsd,
  className,
}: {
  data: Point[]
  series: Series[]
  height?: number
  format?: (n: number) => string
  axisFormat?: (n: number) => string
  className?: string
}) {
  const uid = React.useId().replace(/:/g, '')
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.fill ?? s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.fill ?? s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="key"
            tickFormatter={(_, i) => data[i]?.label ?? ''}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={10}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={axisFormat}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: 'var(--fg-3)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={<TooltipCard format={format} series={series} />}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#${uid}-${s.key})`}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-1)', fill: s.color }}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Bars ─────────────────────────────────────────────────── */

export function BarTrend({
  data,
  series,
  height = 200,
  format = fullUsd,
  axisFormat = compactUsd,
  className,
}: {
  data: Point[]
  series: Series[]
  height?: number
  format?: (n: number) => string
  axisFormat?: (n: number) => string
  className?: string
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="24%" barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="key"
            tickFormatter={(_, i) => data[i]?.label ?? ''}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={10}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={axisFormat}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--bg-hover)' }}
            content={<TooltipCard format={format} series={series} />}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.color}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ── Sparkline (stat tiles) ──────────────────────────────── */

export function Spark({
  values,
  color = 'var(--chart-1)',
  fill = 'var(--chart-1-fill)',
  height = 40,
  className,
}: {
  values: number[]
  color?: string
  fill?: string
  height?: number
  className?: string
}) {
  const uid = React.useId().replace(/:/g, '')
  const data = values.map((v, i) => ({ i, v }))
  return (
    <div className={cn('w-full', className)} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity={0.3} />
              <stop offset="100%" stopColor={fill} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${uid})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SparkBars({
  values,
  color = 'var(--chart-1-fill)',
  height = 40,
  className,
}: {
  values: number[]
  color?: string
  height?: number
  className?: string
}) {
  const max = Math.max(1, ...values)
  return (
    <div className={cn('flex w-full items-end gap-[3px]', className)} style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-[3px]"
          style={{
            height: `${Math.max(6, (v / max) * 100)}%`,
            background: v > 0 ? color : 'var(--chart-muted)',
            opacity: v > 0 ? 1 : 0.6,
          }}
        />
      ))}
    </div>
  )
}

/* ── Donut with centre label ─────────────────────────────── */

export type Slice = { key: string; name: string; value: number; color: string }

export function Donut({
  slices,
  size = 180,
  thickness = 22,
  center,
  format = fullUsd,
}: {
  slices: Slice[]
  size?: number
  thickness?: number
  center?: React.ReactNode
  format?: (n: number) => string
}) {
  const data = slices.filter((s) => s.value > 0)
  const total = data.reduce((a, s) => a + s.value, 0)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data.length ? data : [{ key: 'none', name: 'None', value: 1, color: 'var(--chart-muted)' }]}
            dataKey="value"
            nameKey="name"
            innerRadius={size / 2 - thickness}
            outerRadius={size / 2}
            paddingAngle={data.length > 1 ? 2 : 0}
            cornerRadius={4}
            stroke="none"
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
          >
            {(data.length ? data : [{ key: 'none', color: 'var(--chart-muted)' }]).map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
          {data.length > 0 && (
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0]
                const v = Number(p.value ?? 0)
                return (
                  <div className="rounded-xl border border-border bg-[var(--bg-1)] px-3 py-2 text-xs shadow-[var(--shadow-md)]">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: (p.payload as Slice).color }} />
                      <span className="font-medium">{p.name}</span>
                    </div>
                    <div className="figure mt-1 text-foreground">
                      {format(v)}{' '}
                      <span className="text-[var(--fg-2)]">· {((v / total) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                )
              }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {center && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {center}
        </div>
      )}
    </div>
  )
}

/* ── Segmented bar (one whole, split into parts) ─────────── */

export function SegmentedBar({
  parts,
  className,
}: {
  parts: Array<{ key: string; value: number; color: string; name: string }>
  className?: string
}) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  return (
    <div className={cn('flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--chart-muted)]', className)}>
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.key}
              title={`${p.name}: ${p.value}`}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ))}
    </div>
  )
}

/* ── Segmented control (time range etc.) ─────────────────── */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex h-8 items-center rounded-[10px] bg-[var(--bg-active)] p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-[var(--fg-2)] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            value === o.value && 'bg-[var(--bg-1)] text-foreground shadow-[var(--shadow-sm)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
