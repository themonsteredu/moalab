'use client';

import { useId } from 'react';

/** 부드러운 면적 스파크라인 */
export function Sparkline({
  data,
  color = '#0FB5AB',
  height = 44,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const gid = useId().replace(/:/g, '');
  if (data.length < 2) return <div style={{ height }} />;

  const W = 100;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = height - ((v - min) / span) * (height - 6) - 3;
    return [x, y] as const;
  });

  // 부드럽게 잇기 (카디널 근사)
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }

  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} className="w-full" aria-hidden>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${W} ${height} L 0 ${height} Z`} fill={`url(#g${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 요일별 막대 — 목표 달성한 날은 위에 점이 붙는다 */
export function WeekBars({
  values,
  labels,
  goal = 1,
}: {
  values: number[];
  labels: string[];
  goal?: number;
}) {
  const max = Math.max(...values, goal, 1);
  return (
    <div className="flex items-end justify-between gap-1.5" style={{ height: 118 }}>
      {values.map((v, i) => {
        const hit = v >= goal;
        const h = Math.max(4, (v / max) * 86);
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <span className={`h-3.5 text-[9px] ${hit ? 'text-accent' : 'text-transparent'}`}>●</span>
            <div className="flex w-full flex-1 items-end justify-center">
              <div
                className={`w-full max-w-[13px] origin-bottom animate-grow rounded-full ${
                  hit ? 'bg-accent' : 'bg-neutral-200'
                }`}
                style={{ height: h, animationDelay: `${i * 45}ms` }}
                title={`${labels[i]} ${v}건`}
              />
            </div>
            <span className="text-[10.5px] font-semibold text-neutral-400">{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface TimelineRow {
  id: string;
  label: string;
  /** 0~1 로 정규화된 시작·끝 위치 */
  start: number;
  end: number;
  color: string;
  note?: string;
  href?: string;
}

/**
 * 마감 타임라인 — 오늘부터 마감일까지를 막대로.
 * 어떤 프로그램이 언제까지인지 한눈에 보인다.
 */
export function Timeline({
  rows,
  ticks,
  onPick,
}: {
  rows: TimelineRow[];
  ticks: string[];
  onPick?: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[13px] text-neutral-400">마감일이 잡힌 프로그램이 없어요.</p>;
  }
  return (
    <div>
      <div className="space-y-2">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick?.(r.id)}
            className="flex w-full items-center gap-2 text-left"
            title={r.note}
          >
            <span className="w-[74px] shrink-0 truncate text-[11.5px] font-semibold text-neutral-500">
              {r.label}
            </span>
            <span className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <span
                className="absolute inset-y-0 rounded-full transition-all"
                style={{
                  left: `${r.start * 100}%`,
                  width: `${Math.max(4, (r.end - r.start) * 100)}%`,
                  backgroundColor: r.color,
                }}
              />
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between pl-[82px]">
        {ticks.map((t) => (
          <span key={t} className="text-[10px] text-neutral-400">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 큰 숫자 + 변화량 + 미니 차트를 담는 대시보드 카드 */
export function StatCard({
  icon,
  label,
  value,
  delta,
  deltaTone = 'up',
  children,
  accentBg = 'bg-brand',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'up' | 'down';
  children?: React.ReactNode;
  accentBg?: string;
}) {
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-white ${accentBg}`}>
          {icon}
        </span>
        <span className="truncate text-[12px] text-neutral-400">{label}</span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[22px] font-black leading-none text-neutral-900">{value}</span>
        {delta && (
          <span className={`text-[11.5px] font-bold ${deltaTone === 'down' ? 'text-red-600' : 'text-accent'}`}>
            {delta}
          </span>
        )}
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
