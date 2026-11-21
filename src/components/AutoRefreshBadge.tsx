'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useTransitStore } from '@/lib/transit-store';

interface AutoRefreshBadgeProps {
  /** 保留介面相容性；實際由全域 TransitStoreProvider 統一每 30 秒背景同步 */
  intervalSeconds?: number;
  /** 保留介面相容性 */
  onRefresh?: () => void;
  /** 使用者手動點擊時觸發的前端本地即時重算函式（不呼叫後端 API） */
  onManualRefresh?: () => void;
  /** 頁面初次缺少快取時的載入狀態 */
  isRefreshing: boolean;
  /** 最後更新時間字串 */
  lastUpdated?: string;
}

export default function AutoRefreshBadge({
  intervalSeconds = 30,
  onManualRefresh,
  isRefreshing,
}: AutoRefreshBadgeProps) {
  const {
    syncCountdown,
    isSyncing,
    justUpdated: globalJustUpdated,
    triggerFrontendRefresh,
    triggerSyncAll,
  } = useTransitStore();
  const [localJustUpdated, setLocalJustUpdated] = useState(false);

  const busy = isRefreshing || isSyncing;
  const justUpdated = !busy && (globalJustUpdated || localJustUpdated);
  const prevBusyRef = useRef(busy);

  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;

    if (wasBusy && !busy && !globalJustUpdated) {
      const showTimer = setTimeout(() => setLocalJustUpdated(true), 0);
      const hideTimer = setTimeout(() => setLocalJustUpdated(false), 2000);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [busy, globalJustUpdated]);

  const handleManualClick = () => {
    if (onManualRefresh) {
      onManualRefresh();
    } else {
      triggerFrontendRefresh();
    }
    void triggerSyncAll();
  };

  const progressPct = Math.min(
    100,
    Math.max(0, ((intervalSeconds - syncCountdown) / intervalSeconds) * 100)
  );

  return (
    <button
      type="button"
      onClick={handleManualClick}
      title="點擊立即同步後端最新資料並重算時間；全站每 30 秒自動背景同步"
      className={`group relative overflow-hidden rounded-lg border px-3 py-2 text-xs font-medium transition-colors duration-150 ${
        justUpdated
          ? 'border-emerald-600/25 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-950/40 dark:text-emerald-300'
          : busy
          ? 'border-[#0f4c81]/30 bg-[#eceff4] text-[#0f4c81] dark:border-sky-400/30 dark:bg-[#1a1e28] dark:text-sky-300'
          : 'border-slate-900/10 bg-[#ffffff] text-[#4b5565] hover:bg-[#eceff4] hover:text-[#111827] dark:border-slate-100/10 dark:bg-[#11141c] dark:text-[#a3a9b8] dark:hover:bg-[#1a1e28] dark:hover:text-[#eef0f5]'
      }`}
    >
      {/* 底部進度條（使用 transform scaleX 避免重排） */}
      <span
        className={`absolute bottom-0 left-0 h-0.5 w-full origin-left transition-transform duration-1000 ease-linear ${
          justUpdated
            ? 'bg-[#16a34a] dark:bg-[#4cc38a]'
            : busy
            ? 'bg-[#0f4c81] dark:bg-[#38bdf8]'
            : 'bg-slate-400/50 dark:bg-slate-500/50'
        }`}
        style={{ transform: `scaleX(${progressPct / 100})` }}
      />

      <span className="relative flex items-center gap-2">
        {busy ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            <span>同步中</span>
          </>
        ) : justUpdated ? (
          <>
            <CheckCircle2
              className="h-4 w-4 text-[#16a34a] dark:text-[#4cc38a]"
              strokeWidth={1.5}
            />
            <span>已更新</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
            <span>即時更新</span>
          </>
        )}
      </span>
    </button>
  );
}
