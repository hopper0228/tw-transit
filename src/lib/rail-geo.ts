import railCoordsData from './rail-coords.json';

type CoordMap = Record<string, [number, number]>;

const railCoords = railCoordsData as unknown as {
  metro: CoordMap;
  tra: CoordMap;
  thsr: CoordMap;
};

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
