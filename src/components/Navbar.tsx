'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bike,
  Bus,
  Home,
  ParkingCircle,
  TrainFront,
  TramFront,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { href: '/', label: '首頁', icon: Home, activeColor: 'text-slate-900 dark:text-white' },
  { href: '/bus', label: '公車', icon: Bus, activeColor: 'text-blue-600 dark:text-blue-400' },
  { href: '/metro', label: '捷運', icon: TramFront, activeColor: 'text-teal-600 dark:text-teal-400' },
  { href: '/tra', label: '台鐵', icon: TrainFront, activeColor: 'text-indigo-600 dark:text-indigo-400' },
  { href: '/thsr', label: '高鐵', icon: Zap, activeColor: 'text-orange-600 dark:text-orange-400' },
  { href: '/youbike', label: 'YouBike', icon: Bike, activeColor: 'text-amber-600 dark:text-amber-400' },
  { href: '/parking', label: '停車場', icon: ParkingCircle, activeColor: 'text-violet-600 dark:text-violet-400' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [sourceMode, setSourceMode] = useState<'mock' | 'opendata' | 'tdx'>('opendata');

  useEffect(() => {
    fetch('/api/transit/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.source === 'tdx' || data?.source === 'opendata' || data?.source === 'mock') {
          setSourceMode(data.source);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      {/* Desktop & Mobile Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/80">
        <div className="mx-auto flex h-15 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-teal-500 text-sm font-extrabold text-white shadow-sm shadow-blue-600/20 transition-transform group-hover:scale-105">
              台
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                台灣通 · TW Transit
              </span>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                全台大眾運輸即時看板
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden items-center gap-1 rounded-2xl bg-slate-100/80 p-1 ring-1 ring-slate-200/60 dark:bg-slate-900/80 dark:ring-slate-800 md:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    isActive
                      ? `bg-white shadow-xs ring-1 ring-slate-200/80 dark:bg-slate-800 dark:ring-slate-700 ${item.activeColor}`
                      : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Data Mode Indicator */}
          <div className="flex items-center gap-2">
            <span
              title={
                sourceMode === 'tdx'
                  ? '已連接交通部 TDX 即時 API'
                  : '雙北公車 / YouBike / 停車場已接通政府即時 OpenData；軌道運具為模擬資料'
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold shadow-2xs ${
                sourceMode === 'tdx'
                  ? 'border-emerald-200/80 bg-emerald-50/90 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : sourceMode === 'opendata'
                  ? 'border-sky-200/80 bg-sky-50/90 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/60 dark:text-sky-300'
                  : 'border-amber-200/80 bg-amber-50/90 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  sourceMode === 'tdx'
                    ? 'bg-emerald-500'
                    : sourceMode === 'opendata'
                    ? 'bg-sky-500 animate-pulse'
                    : 'bg-amber-500 animate-pulse'
                }`}
              />
              {sourceMode === 'tdx'
                ? 'TDX 即時連線'
                : sourceMode === 'opendata'
                ? '政府即時 OpenData'
                : '模擬即時模式'}
            </span>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/90 md:hidden">
        <div className="grid grid-cols-7 gap-0.5 px-1.5 py-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[10px] font-semibold transition ${
                  isActive
                    ? `bg-slate-100/90 dark:bg-slate-800/90 ${item.activeColor}`
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
