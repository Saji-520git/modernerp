import * as React from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Chart theming, in the shape shadcn/ui uses — trimmed to what this app needs
 * and written against Recharts 3.
 *
 * shadcn's stock chart.tsx targets Recharts 2 and carries a theme-map and
 * legend machinery we do not use. The part worth keeping is the idea: a series
 * is named once in a config, and its colour is published as a CSS custom
 * property (`--color-<key>`) on the container. Series then reference
 * `var(--color-revenue)` instead of a hex literal, so one config drives the
 * chart, its legend and its tooltip, and a token change moves all three.
 *
 * Colours are given as CSS values, so passing `hsl(var(--primary))` makes a
 * chart follow the light/dark toggle exactly like every other component.
 */
export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = React.createContext<ChartConfig | null>(null);

export function useChartConfig(): ChartConfig {
  return React.useContext(ChartContext) ?? {};
}

export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  /** A single Recharts chart element — ResponsiveContainer accepts exactly one. */
  children: React.ReactElement;
}) {
  // Publish each series colour as a custom property on the wrapper.
  const style = React.useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [key, item] of Object.entries(config)) vars[`--color-${key}`] = item.color;
    return vars as React.CSSProperties;
  }, [config]);

  return (
    <ChartContext.Provider value={config}>
      <div
        data-chart
        style={style}
        className={cn(
          'w-full [&_.recharts-cartesian-grid_line]:stroke-border',
          '[&_.recharts-cartesian-axis-tick_text]:fill-content-muted',
          '[&_.recharts-cartesian-axis-tick_text]:text-[10px]',
          '[&_.recharts-surface]:overflow-visible',
          className,
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

type TooltipEntry = { dataKey?: string | number; name?: string; value?: number; color?: string };

/**
 * Tooltip body. Passed to Recharts as `<Tooltip content={<ChartTooltipContent …/>} />`
 * — Recharts clones it with `active` / `payload` / `label` at render time, which
 * is why those are optional here.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  /** Render a value; defaults to its raw string form. */
  formatter?: (value: number, key: string) => string;
  labelFormatter?: (label: string | number) => string;
}) {
  const config = useChartConfig();
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-token-md border border-border bg-popover px-2.5 py-2 shadow-token-md">
      {label !== undefined && (
        <p className="mb-1 text-[11px] font-semibold text-popover-foreground">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => {
          const key = String(entry.dataKey ?? entry.name ?? i);
          const meta = config[key];
          return (
            <div key={key + i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: meta?.color ?? entry.color }}
                />
                <span className="text-[11px] text-content-secondary">{meta?.label ?? key}</span>
              </span>
              <span className="text-[11.5px] font-bold tabular-nums text-popover-foreground">
                {formatter && typeof entry.value === 'number'
                  ? formatter(entry.value, key)
                  : String(entry.value ?? '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
