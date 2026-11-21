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
import { useTransitStore } from '@/lib/transit-store';
import { FavoriteItem, MetroSystemSnapshot, ThsrTrainRow, TraTrainRow } from '@/lib/types';

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
    code: 'BUS',
    title: '公車即時動態',
    desc: '雙北、桃園、台中、台南、高雄與公路客運到站時間',
    icon: Bus,
    dotColor: 'bg-blue-600',
  },
  {
    href: '/metro',
    code: 'MRT',
    title: '捷運 / 輕軌',
    desc: '北捷、新北捷、機捷、中捷、高捷月台倒數與即時列車位置',
    icon: TramFront,
    dotColor: 'bg-teal-600',
  },
  {
    href: '/tra',
    code: 'TRA',
    title: '台鐵火車',
    desc: '各站北上南下即時看板、誤點狀態與目標站篩選',
    icon: TrainFront,
    dotColor: 'bg-indigo-600',
  },
  {
    href: '/thsr',
    code: 'THSR',
    title: '台灣高鐵',
    desc: '北上南下班次時刻、停靠模式與標準／商務座餘位',
    icon: Zap,
    dotColor: 'bg-orange-600',
  },
  {
    href: '/youbike',
    code: 'UBIKE',
    title: 'YouBike 微笑單車',
    desc: '鄰近站點可借 2.0 / 2.0E 電輔車數與可還空位',
    icon: Bike,
    dotColor: 'bg-amber-600',
  },
  {
    href: '/parking',
    code: 'PARK',
    title: '即時停車場',
    desc: '路外停車場即時剩餘車位、費率說明與導航',
    icon: ParkingCircle,
    dotColor: 'bg-violet-600',
  },
];

export default function HomePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const { nowMs, getCached } = useTransitStore();

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

  // 從已預載的前端共享快取讀取即時看板摘要（0 額外 API 請求）
  const metroCached = getCached<MetroSystemSnapshot>('metro:snapshot:TRTC');
  const traCached = getCached<{ trains?: TraTrainRow[] }>('tra:board:1000');
  const thsrCached = getCached<{ trains?: ThsrTrainRow[] }>('thsr:board:1000');

  const bl12 = metroCached?.data?.stations?.['BL12'];
  const traNext = traCached?.data?.trains?.[0];
  const thsrNext = thsrCached?.data?.trains?.[0];

  const liveClock =
    nowMs > 0
      ? new Date(nowMs).toLocaleTimeString('zh-TW', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '--:--';

  return (
    <div className="space-y-10">
      {/* 非對稱雙欄 Hero：左側查詢入口 + 右側即時車站看板預覽 */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
        <div className="space-y-5 lg:col-span-7">
          <div className="space-y-2">
            <h1 className="text-2xl font-medium tracking-tight text-[#111827] dark:text-[#eef0f5] sm:text-4xl sm:leading-tight">
              全台大眾運輸即時看板
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-[#4b5565] dark:text-[#a3a9b8] sm:text-base">
              整合公車、捷運、台鐵、高鐵、YouBike 與停車場的即時到離站與剩餘車位資訊
            </p>
          </div>

          {/* 搜尋框 */}
          <div className="relative max-w-xl">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7487] dark:text-[#7a8296]"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋路線或站名，例如 307、台北車站、市政府"
              className="h-11 w-full rounded-lg border border-slate-900/10 bg-[#ffffff] pl-10 pr-10 text-sm text-[#111827] outline-none transition-colors duration-150 placeholder:text-[#6b7487] focus:border-[#0f4c81] dark:border-slate-100/10 dark:bg-[#11141c] dark:text-[#eef0f5] dark:placeholder:text-[#7a8296] dark:focus:border-[#38bdf8]"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6b7487] transition-colors hover:bg-[#eceff4] hover:text-[#111827] dark:hover:bg-[#1a1e28] dark:hover:text-[#eef0f5]"
                aria-label="清除搜尋"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}

            {/* 即時搜尋下拉建議 */}
            {query.trim() && (
              <div className="transit-card absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden text-left shadow-lg">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-[#6b7487]">搜尋中</div>
                ) : results.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-[#6b7487]">
                    找不到「{query}」的相關交通資訊
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-900/8 dark:divide-slate-100/8">
                    {results.map((item, idx) => (
                      <li key={`${item.mode}-${idx}`}>
                        <Link
                          href={item.href}
                          className="flex items-center justify-between px-4 py-3 transition-colors duration-150 hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]"
                        >
                          <div className="flex items-center gap-3">
                            <span className="rounded-md bg-[#eceff4] px-2 py-0.5 font-mono text-[11px] font-medium text-[#4b5565] dark:bg-[#1a1e28] dark:text-[#a3a9b8]">
                              {item.badge}
                            </span>
                            <div>
                              <div className="text-sm font-medium text-[#111827] dark:text-[#eef0f5]">
                                {item.title}
                              </div>
                              <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">
                                {item.subtitle}
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-[#6b7487]" strokeWidth={1.5} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右側產品時刻表預覽卡片（Moment） */}
        <div className="transit-card overflow-hidden lg:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-900/8 bg-[#f5f7fa] px-4 py-2.5 dark:border-slate-100/8 dark:bg-[#1a1e28]">
            <span className="text-xs font-medium text-[#4b5565] dark:text-[#a3a9b8]">
              台北樞紐即時摘要
            </span>
            <span className="font-mono text-xs tabular-nums text-[#6b7487] dark:text-[#7a8296]">
              {liveClock}
            </span>
          </div>
          <div className="divide-y divide-slate-900/8 dark:divide-slate-100/8">
            <Link
              href="/metro"
              className="flex items-center justify-between px-4 py-3 transition-colors duration-150 hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]"
            >
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-teal-600" />
                <div>
                  <div className="text-sm font-medium text-[#111827] dark:text-[#eef0f5]">
                    捷運板南線 台北車站
                  </div>
                  <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">
                    {bl12?.platforms?.[0]?.destination || '往 南港展覽館'}
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-medium tabular-nums text-[#111827] dark:text-[#eef0f5]">
                {bl12?.platforms?.[0] && bl12.platforms[0].nextTrainSeconds >= 0
                  ? bl12.platforms[0].nextTrainSeconds <= 30
                    ? '進站中'
                    : `${Math.floor(bl12.platforms[0].nextTrainSeconds / 60)} 分`
                  : '同步中'}
              </span>
            </Link>

            <Link
              href="/tra"
              className="flex items-center justify-between px-4 py-3 transition-colors duration-150 hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]"
            >
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-indigo-600" />
                <div>
                  <div className="text-sm font-medium text-[#111827] dark:text-[#eef0f5]">
                    台鐵 臺北站
                  </div>
                  <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">
                    {traNext
                      ? `${traNext.trainType} ${traNext.trainNo} 往${traNext.destinationStation}`
                      : '北上・南下即時看板'}
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-medium tabular-nums text-[#111827] dark:text-[#eef0f5]">
                {traNext ? traNext.departureTime : '--:--'}
              </span>
            </Link>

            <Link
              href="/thsr"
              className="flex items-center justify-between px-4 py-3 transition-colors duration-150 hover:bg-[#f5f7fa] dark:hover:bg-[#1a1e28]"
            >
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-orange-600" />
                <div>
                  <div className="text-sm font-medium text-[#111827] dark:text-[#eef0f5]">
                    台灣高鐵 台北站
                  </div>
                  <div className="text-xs text-[#6b7487] dark:text-[#7a8296]">
                    {thsrNext
                      ? `${thsrNext.trainNo} 次 往${thsrNext.destinationStation}`
                      : '北上・南下對號與自由座'}
                  </div>
                </div>
              </div>
              <span className="font-mono text-sm font-medium tabular-nums text-[#111827] dark:text-[#eef0f5]">
                {thsrNext ? thsrNext.departureTime : '--:--'}
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* 六大運具專屬入口 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-[#111827] dark:text-[#eef0f5]">
            運具查詢
          </h2>
          <span className="font-mono text-xs text-[#6b7487] dark:text-[#7a8296]">
            6 種運具
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="transit-card group flex flex-col justify-between p-5 transition-colors duration-150 hover:border-slate-900/20 hover:bg-[#ffffff] dark:hover:border-slate-100/20 dark:hover:bg-[#151923]"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eceff4] text-[#4b5565] dark:bg-[#1a1e28] dark:text-[#a3a9b8]">
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${card.dotColor}`} />
                      <span className="font-mono text-[11px] text-[#6b7487] dark:text-[#7a8296]">
                        {card.code}
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-4 text-base font-medium text-[#111827] dark:text-[#eef0f5]">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#4b5565] dark:text-[#a3a9b8]">
                    {card.desc}
                  </p>
                </div>

                <div className="mt-4 flex items-center text-xs font-medium text-[#6b7487] transition-colors duration-150 group-hover:text-[#111827] dark:text-[#7a8296] dark:group-hover:text-[#eef0f5]">
                  開啟看板
                  <ArrowRight className="ml-1.5 h-4 w-4" strokeWidth={1.5} />
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
            <Star className="h-4 w-4 text-[#6b7487] dark:text-[#7a8296]" strokeWidth={1.5} />
            <h2 className="text-base font-medium text-[#111827] dark:text-[#eef0f5]">
              常用收藏
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((fav) => (
              <Link
                key={fav.id}
                href={fav.href}
                className="transit-card flex items-center justify-between px-4 py-3.5 transition-colors duration-150 hover:border-slate-900/20 dark:hover:border-slate-100/20"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[#111827] dark:text-[#eef0f5]">
                    {fav.title}
                  </div>
                  <div className="truncate text-xs text-[#6b7487] dark:text-[#7a8296]">
                    {fav.subtitle}
                  </div>
                </div>
                <button
                  onClick={(e) => handleRemoveFavorite(e, fav)}
                  title="取消收藏"
                  className="ml-2 rounded-lg p-1.5 text-amber-500 transition-colors hover:bg-[#eceff4] dark:hover:bg-[#1a1e28]"
                >
                  <Star className="h-4 w-4 fill-amber-400" strokeWidth={1.5} />
                </button>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
