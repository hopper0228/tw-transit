'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
}

export default function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
}: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-slate-900/10 bg-[#ffffff] text-[#111827] shadow-xl dark:border-slate-100/10 dark:bg-[#11141c] dark:text-[#eef0f5]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-900/8 px-5 py-4 dark:border-slate-100/8">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {badge && (
                <span className="rounded-md bg-[#eceff4] px-2 py-0.5 font-mono text-xs font-medium text-[#111827] dark:bg-[#1a1e28] dark:text-[#eef0f5]">
                  {badge}
                </span>
              )}
              <h2 className="truncate text-lg font-medium tracking-tight">
                {title}
              </h2>
            </div>
            {subtitle && (
              <p className="mt-1 truncate text-xs text-[#6b7487] dark:text-[#7a8296]">
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="關閉詳細資訊"
            className="rounded-lg p-1.5 text-[#6b7487] transition-colors duration-150 hover:bg-[#eceff4] hover:text-[#111827] dark:text-[#7a8296] dark:hover:bg-[#1a1e28] dark:hover:text-[#eef0f5]"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
