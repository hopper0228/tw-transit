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
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white shadow-sm">
              台
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                台灣通 · TW Transit
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                全大眾交通即時查詢
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden items-center gap-1 md:flex">
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
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? `bg-slate-100 dark:bg-slate-800/80 ${item.activeColor}`
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
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
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                sourceMode === 'tdx'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : sourceMode === 'opendata'
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
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
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 md:hidden">
        <div className="grid grid-cols-7 px-1 py-1.5">
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
                className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-medium ${
                  isActive
                    ? item.activeColor
                    : 'text-slate-500 dark:text-slate-400'
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
