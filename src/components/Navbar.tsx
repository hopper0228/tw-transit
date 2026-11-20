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
      <header className="sticky top-0 z-40 border-b border-slate-900/8 bg-white dark:border-slate-100/8 dark:bg-[#0b0d14]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f4c81] text-sm font-medium text-white dark:bg-slate-100 dark:text-[#0b0d14]">
              台
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-medium tracking-tight text-[#111827] dark:text-[#eef0f5]">
                台灣通 TW Transit
              </span>
              <span className="text-[11px] text-[#6b7487] dark:text-[#7a8296]">
                全台大眾運輸即時看板
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
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-[#eceff4] text-[#111827] dark:bg-[#1a1e28] dark:text-[#eef0f5]'
                      : 'text-[#4b5565] hover:bg-[#f5f7fa] hover:text-[#111827] dark:text-[#a3a9b8] dark:hover:bg-[#11141c] dark:hover:text-[#eef0f5]'
                  }`}
                >
                  <Icon className="h-4 w-4 text-current" strokeWidth={1.5} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Data Mode Indicator */}
          <div className="flex items-center">
            <span
              title={
                sourceMode === 'tdx'
                  ? '已連接交通部 TDX 即時 API'
                  : '雙北公車 / YouBike / 停車場已接通政府即時 OpenData；軌道運具為模擬資料'
              }
              className="inline-flex items-center gap-2 rounded-md border border-slate-900/8 bg-[#f5f7fa] px-2.5 py-1 font-mono text-[11px] text-[#4b5565] dark:border-slate-100/8 dark:bg-[#11141c] dark:text-[#a3a9b8]"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  sourceMode === 'tdx'
                    ? 'bg-[#16a34a] dark:bg-[#4cc38a]'
                    : sourceMode === 'opendata'
                    ? 'bg-[#0f4c81] dark:bg-[#38bdf8]'
                    : 'bg-amber-600'
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
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-900/8 bg-white dark:border-slate-100/8 dark:bg-[#0b0d14] md:hidden">
        <div className="grid grid-cols-7 gap-1 px-2 py-1.5">
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
                className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-[#eceff4] text-[#111827] dark:bg-[#1a1e28] dark:text-[#eef0f5]'
                    : 'text-[#6b7487] hover:text-[#111827] dark:text-[#7a8296] dark:hover:text-[#eef0f5]'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
