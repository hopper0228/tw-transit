import railCoordsData from './rail-coords.json';
import type { MetroSystemItem, RailStationItem } from './rail-directory';

type CoordMap = Record<string, [number, number]>;

const railCoords = railCoordsData as unknown as {
  metro: CoordMap;
  tra: CoordMap;
  thsr: CoordMap;
};

function approxDistSq(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = lat1 - lat2;
  const dLng = (lng1 - lng2) * 0.9;
  return dLat * dLat + dLng * dLng;
}

export function findNearestMetroStation(
  lat: number,
  lng: number,
  systems: MetroSystemItem[]
): {
  systemId: MetroSystemItem['id'];
  lineCode: string;
  stationId: string;
  stationName: string;
} | null {
  let best: {
    systemId: MetroSystemItem['id'];
    lineCode: string;
    stationId: string;
    stationName: string;
    sq: number;
  } | null = null;

  for (const sys of systems) {
    for (const line of sys.lines) {
      for (const st of line.stations) {
        const coord = railCoords.metro[`${sys.id}:${st.id}`];
        if (!coord) continue;
        const sq = approxDistSq(lat, lng, coord[0], coord[1]);
        if (!best || sq < best.sq) {
          best = {
            systemId: sys.id,
            lineCode: line.code,
            stationId: st.id,
            stationName: st.name,
            sq,
          };
        }
      }
    }
  }

  return best
    ? {
        systemId: best.systemId,
        lineCode: best.lineCode,
        stationId: best.stationId,
        stationName: best.stationName,
      }
    : null;
}

export function findNearestRailStation(
  lat: number,
  lng: number,
  stations: RailStationItem[],
  kind: 'tra' | 'thsr'
): { id: string; name: string } | null {
  const map = railCoords[kind];
  let best: { id: string; name: string; sq: number } | null = null;

  for (const st of stations) {
    const coord = map[st.id];
    if (!coord) continue;
    const sq = approxDistSq(lat, lng, coord[0], coord[1]);
    if (!best || sq < best.sq) {
      best = { id: st.id, name: st.name, sq };
    }
  }

  return best ? { id: best.id, name: best.name } : null;
}

export function getMetroStationCoord(
  systemId: string,
  stationId: string
): [number, number] | null {
  return railCoords.metro[`${systemId}:${stationId}`] || null;
}

export function getTraStationCoord(stationId: string): [number, number] | null {
  return railCoords.tra[stationId] || null;
}

export function getThsrStationCoord(stationId: string): [number, number] | null {
  return railCoords.thsr[stationId] || null;
}

/**
 * 依路線多邊形實際長度比例，計算進度 progress (0..1) 對應的經緯度座標與所在區段索引
 */
export function interpolateAlongPath(
  path: [number, number][],
  progress: number
): { lat: number; lng: number; segmentIndex: number } {
  if (path.length === 0) return { lat: 25.0468, lng: 121.5171, segmentIndex: 0 };
  if (path.length === 1) return { lat: path[0][0], lng: path[0][1], segmentIndex: 0 };

  const clamped = ((progress % 1) + 1) % 1;
  const segLengths: number[] = [];
  let total = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const dLat = path[i + 1][0] - path[i][0];
    const dLng = (path[i + 1][1] - path[i][1]) * 0.9;
    const len = Math.hypot(dLat, dLng);
    segLengths.push(len);
    total += len;
  }

  if (total <= 0) {
    return { lat: path[0][0], lng: path[0][1], segmentIndex: 0 };
  }

  let target = clamped * total;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i];
    if (target <= len || i === segLengths.length - 1) {
      const ratio = len > 0 ? Math.min(1, Math.max(0, target / len)) : 0;
      return {
        lat: path[i][0] + (path[i + 1][0] - path[i][0]) * ratio,
        lng: path[i][1] + (path[i + 1][1] - path[i][1]) * ratio,
        segmentIndex: i,
      };
    }
    target -= len;
  }

  const last = path[path.length - 1];
  return { lat: last[0], lng: last[1], segmentIndex: path.length - 2 };
}
