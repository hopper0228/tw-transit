import { FavoriteItem } from './types';

const STORAGE_KEY = 'tw_transit_favorites_v1';

const DEFAULT_FAVORITES: FavoriteItem[] = [
  {
    id: 'bus-Taipei-307',
    mode: 'bus',
    title: '307 公車',
    subtitle: '板橋前站 ⇄ 撫遠街',
    href: '/bus?city=Taipei&route=307',
  },
  {
    id: 'metro-TRTC-BL12',
    mode: 'metro',
    title: '捷運 台北車站',
    subtitle: '台北捷運 · 板南線',
    href: '/metro?system=TRTC&station=BL12',
  },
  {
    id: 'youbike-TPE001',
    mode: 'youbike',
    title: 'YouBike 捷運市政府站(3號出口)',
    subtitle: '台北市信義區忠孝東路五段',
    href: '/youbike?city=Taipei&q=市政府',
  },
];

export function getFavorites(): FavoriteItem[] {
  if (typeof window === 'undefined') return DEFAULT_FAVORITES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_FAVORITES));
      return DEFAULT_FAVORITES;
    }
    return JSON.parse(raw) as FavoriteItem[];
  } catch {
    return DEFAULT_FAVORITES;
  }
}

export function isFavorite(id: string): boolean {
  return getFavorites().some((item) => item.id === id);
}

export function toggleFavorite(item: FavoriteItem): FavoriteItem[] {
  const current = getFavorites();
  const exists = current.some((x) => x.id === item.id);
  const next = exists ? current.filter((x) => x.id !== item.id) : [item, ...current];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}
