'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';

/* ------------------------------------------------------------------ 스켈레톤 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="mb-3 h-5 w-1/2" />
          <Skeleton className="mb-2 h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- 빈 상태 */

export function EmptyState({
  icon = 'puzzle',
  title,
  desc,
  action,
}: {
  icon?: IconName;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <Icon name={icon} size={30} className="mb-3 text-neutral-300" />
      <p className="text-[15px] font-semibold text-neutral-700">{title}</p>
      {desc && <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-500">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ 에러 배너 */

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5">
      <Icon name="warning" size={17} className="mt-0.5 text-red-500" />
      <p className="flex-1 text-[13px] leading-relaxed text-red-800">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 text-[13px] font-bold text-red-700 underline">
          다시
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- 바텀시트 모달 */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white
                   animate-slide-up sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="text-[16px] font-bold">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="tap -mr-2 w-11 text-neutral-400">
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer && <div className="border-t border-neutral-200 bg-white px-4 py-3 safe-bottom">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- 확인 대화 */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '삭제',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5">
        <p className="text-[16px] font-bold">{title}</p>
        {message && <p className="mt-2 text-[14px] leading-relaxed text-neutral-600">{message}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={onCancel} className="btn-ghost flex-1">
            취소
          </button>
          <button onClick={onConfirm} className={`${danger ? 'btn-danger' : 'btn-primary'} flex-1`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- 토스트 */

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  };

  const node = msg ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-6">
      <div className="rounded-full bg-neutral-900/92 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">
        {msg}
      </div>
    </div>
  ) : null;

  return { show, node };
}

/* ------------------------------------------------------------------- 진행률 바 */

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-neutral-200 ${className}`}>
      <div
        className="h-full rounded-full bg-brand transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- 섹션 헤더 */

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[15px] font-bold text-neutral-800">{children}</h2>
      {right}
    </div>
  );
}

/* ------------------------------------------------------- 멀티 선택 (검증자 등) */

export function MultiPicker<T extends { id: string; name: string }>({
  options,
  selected,
  onChange,
  max,
}: {
  options: T[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      if (max && selected.length >= max) return;
      onChange([...selected, id]);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={`tap rounded-full border px-3.5 text-[14px] font-semibold transition ${
              on ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-600'
            }`}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
