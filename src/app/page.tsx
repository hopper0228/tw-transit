'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bike,
  Bus,
  ParkingCircle,
  Search,
  Star,
  TrainFront,
  TramFront,
  X,
  Zap,
} from 'lucide-react';
import { getFavorites, toggleFavorite } from '@/lib/favorites';
import { FavoriteItem } from '@/lib/types';

interface SearchResultItem {
  mode: 'bus' | 'metro' | 'tra' | 'thsr' | 'youbike' | 'parking';
  badge: string;
  title: string;
  subtitle: string;
  href: string;
}

const MODE_CARDS = [
  {
    href: '/bus',
    title: '公車即時查詢',
    desc: '雙北、桃園、台中、台南、高雄與公路客運到站動態',
    badge: '主要服務',
    icon: Bus,
    colorBg: 'bg-blue-50 dark:bg-blue-950/40',
    colorText: 'text-blue-600 dark:text-blue-400',
    borderHover: 'hover:border-blue-300 dark:hover:border-blue-700',
  },
  {
    href: '/metro',
    title: '捷運 / 輕軌',
    desc: '北捷、機捷、中捷、高捷月台倒數與車廂擁擠度',
    icon: TramFront,
    colorBg: 'bg-teal-50 dark:bg-teal-950/40',
    colorText: 'text-teal-600 dark:text-teal-400',
    borderHover: 'hover:border-teal-300 dark:hover:border-teal-700',
  },
  {
    href: '/tra',
    title: '台鐵火車',
    desc: '車站順逆行即時看板、起訖時刻表與列車誤點資訊',
    icon: TrainFront,
    colorBg: 'bg-indigo-50 dark:bg-indigo-950/40',
    colorText: 'text-indigo-600 dark:text-indigo-400',
    borderHover: 'hover:border-indigo-300 dark:hover:border-indigo-700',
  },
  {
    href: '/thsr',
    title: '台灣高鐵',
    desc: '直達/跳蛙車次查詢、對號座與自由座即時燈號',
    icon: Zap,
    colorBg: 'bg-orange-50 dark:bg-orange-950/40',
    colorText: 'text-orange-600 dark:text-orange-400',
    borderHover: 'hover:border-orange-300 dark:hover:border-orange-700',
  },
  {
    href: '/youbike',
    title: 'YouBike 微笑單車',
    desc: '即時可借 2.0 / 2.0E 電輔車數與可還空位查詢',
    icon: Bike,
    colorBg: 'bg-amber-50 dark:bg-amber-950/40',
    colorText: 'text-amber-600 dark:text-amber-400',
    borderHover: 'hover:border-amber-300 dark:hover:border-amber-700',
  },
  {
    href: '/parking',
    title: '即時停車場',
    desc: '路外停車場即時剩餘車位、收費標準與一鍵導航',
    icon: ParkingCircle,
    colorBg: 'bg-violet-50 dark:bg-violet-950/40',
    colorText: 'text-violet-600 dark:text-violet-400',
    borderHover: 'hover:border-violet-300 dark:hover:border-violet-700',
  },
];

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setFavorites(getFavorites()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      if (!trimmed) {
        setResults([]);
        return;
      }
      setSearching(true);
      fetch(`/api/transit/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => setResults(data.results || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, trimmed ? 180 : 0);

    return () => clearTimeout(timer);
  }, [query]);

  const handleRemoveFavorite = (e: React.MouseEvent, item: FavoriteItem) => {
    e.preventDefault();
    e.stopPropagation();
    setFavorites(toggleFavorite(item));
  };

  return (
    <div className="space-y-8">
      {/* Hero & 全域智慧搜尋 */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            想去哪裡？一秒查詢全台即時交通
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            選擇下方運具，或直接搜尋公車路線、車站、YouBike 與停車場
          </p>

          {/* 搜尋框 */}
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋路線或站名，例如：307、台北車站、市政府、板橋..."
              className="w-full rounded-xl border border-slate-300 bg-slate-50 py-3.5 pl-11 pr-10 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-blue-400"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="清除搜尋"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* 即時搜尋下拉建議 */}
            {query.trim() && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-slate-500">搜尋中...</div>
                ) : results.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-slate-500">
                    找不到「{query}」的相關交通資訊
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {results.map((item, idx) => (
                      <li key={`${item.mode}-${idx}`}>
                        <Link
                          href={item.href}
                          className="flex items-center justify-between px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <div className="flex items-center gap-3">
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {item.badge}
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                {item.title}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {item.subtitle}
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-slate-400" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 六大運具專屬入口 (B 模式核心) */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            選擇交通工具
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            各自獨立乾淨視圖
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className={`group relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/70 ${card.borderHover}`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${card.colorBg} ${card.colorText}`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    {card.badge && (
                      <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {card.desc}
                  </p>
                </div>

                <div className="mt-4 flex items-center text-xs font-semibold text-slate-400 transition-colors group-hover:text-slate-700 dark:group-hover:text-slate-200">
                  進入查詢 <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 常用收藏快捷區 */}
      {favorites.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              常用收藏快捷
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((fav) => (
              <Link
                key={fav.id}
                href={fav.href}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-800/60"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {fav.title}
                  </div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {fav.subtitle}
                  </div>
                </div>
                <button
                  onClick={(e) => handleRemoveFavorite(e, fav)}
                  title="取消收藏"
                  className="ml-2 rounded-lg p-1.5 text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Star className="h-4 w-4 fill-amber-400" />
                </button>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
