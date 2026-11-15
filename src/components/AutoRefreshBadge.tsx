'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';

interface AutoRefreshBadgeProps {
  /** 每幾秒自動向後端同步一次，預設 30 秒 */
  intervalSeconds?: number;
  /** 倒數歸零時觸發的後端背景同步函式 */
  onRefresh: () => void;
  /** 使用者手動點擊時觸發的前端本地即時重算函式（不呼叫後端 API） */
  onManualRefresh?: () => void;
  /** 目前是否正在向後端請求資料 */
  isRefreshing: boolean;
  /** 最後更新時間字串 (用來偵測資料剛完成更新) */
  lastUpdated?: string;
}

export default function AutoRefreshBadge({
  intervalSeconds = 30,
  onRefresh,
  onManualRefresh,
  isRefreshing,
  lastUpdated,
}: AutoRefreshBadgeProps) {
  const [countdown, setCountdown] = useState(intervalSeconds);
  const [justUpdated, setJustUpdated] = useState(false);

  const onRefreshRef = useRef(onRefresh);
  const prevRefreshingRef = useRef(isRefreshing);
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // 獨立的每秒倒數計時器：分頁隱藏時自動暫停，切回時若超過間隔則立即更新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current !== null) {
        const elapsedSec = (Date.now() - hiddenAtRef.current) / 1000;
        hiddenAtRef.current = null;
        if (elapsedSec >= intervalSeconds) {
          setCountdown(0);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalSeconds]);

  // 當 countdown 歸零時觸發更新並重設倒數
  useEffect(() => {
    if (countdown === 0) {
      onRefreshRef.current();
      const resetTimer = setTimeout(() => {
        setCountdown(intervalSeconds);
      }, 50);
      return () => clearTimeout(resetTimer);
    }
  }, [countdown, intervalSeconds]);

  // 偵測更新完成：顯示「已更新」綠色提示 2 秒
  useEffect(() => {
    const wasRefreshing = prevRefreshingRef.current;
    prevRefreshingRef.current = isRefreshing;

    if (wasRefreshing && !isRefreshing) {
      const showTimer = setTimeout(() => setJustUpdated(true), 0);
      const hideTimer = setTimeout(() => setJustUpdated(false), 2000);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [isRefreshing]);

  const handleManualClick = () => {
    if (onManualRefresh) {
      onManualRefresh();
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 1800);
      return;
    }
    setCountdown(intervalSeconds);
    onRefreshRef.current();
  };

  const progressPct = Math.min(
    100,
    Math.max(0, ((intervalSeconds - countdown) / intervalSeconds) * 100)
  );

  return (
    <button
      type="button"
      onClick={handleManualClick}
      title={
        onManualRefresh
          ? '點擊立即重算前端最新時間與狀態（不重打後端 API；背景每 30 秒自動同步）'
          : '點擊立即更新資料（分頁背景時自動暫停輪詢）'
      }
      className={`group relative overflow-hidden rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
        justUpdated
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-xs dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          : isRefreshing
          ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {/* 底部進度條 */}
      <span
        className={`absolute bottom-0 left-0 h-0.5 transition-all duration-1000 ease-linear ${
          justUpdated
            ? 'bg-emerald-500'
            : isRefreshing
            ? 'bg-blue-500'
            : 'bg-slate-400/60 dark:bg-slate-500/60'
        }`}
        style={{ width: `${progressPct}%` }}
      />

      <span className="relative flex items-center gap-1.5">
        {isRefreshing ? (
          <>
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
            <span>更新中...</span>
          </>
        ) : justUpdated ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>已更新 {lastUpdated ? `(${lastUpdated})` : ''}</span>
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5 transition-transform group-hover:rotate-90" />
            <span className="tabular-nums">{countdown}s 後更新</span>
          </>
        )}
      </span>
    </button>
  );
}
