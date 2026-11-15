export type TransportMode = 'bus' | 'metro' | 'tra' | 'thsr' | 'youbike' | 'parking';

export type DataSourceMode = 'tdx' | 'opendata' | 'mock';

export interface BusStopStatus {
  stopUid: string;
  stopName: string;
  sequence: number;
  lat: number;
  lng: number;
  /** 預估到站秒數；null 表示未發車、末班已過或無資料 */
  estimateSeconds: number | null;
  /** 狀態代碼：0=正常, 1=尚未發車, 2=交管不停靠, 3=末班車已過, 4=今日未營運 */
  stopStatus: 0 | 1 | 2 | 3 | 4;
  /** 若有車即將進站或剛過站，顯示車牌與車輛屬性 */
  approachingBus?: {
    plateNumb: string;
    isLowFloor: boolean;
    isElectric: boolean;
    atStop: boolean; // true 表示正停靠本站
  };
}

export interface BusRouteInfo {
  routeUid: string;
  routeName: string;
  city: string;
  cityName: string;
  departureStop: string;
  destinationStop: string;
  operatorName: string;
  distanceMeters?: number;
}

export interface BusRouteDetail {
  route: BusRouteInfo;
  direction: 0 | 1; // 0: 去程, 1: 返程
  headsign: string;
  stops: BusStopStatus[];
  /** 地圖軌跡座標 */
  shape: [number, number][];
  /** 即時移動中的車輛 */
  vehicles: {
    plateNumb: string;
    lat: number;
    lng: number;
    azimuth: number;
    isLowFloor: boolean;
    isElectric: boolean;
    nearStopSeq: number;
  }[];
  updatedAt: string;
  sourceUpdatedAt?: number;
  source: DataSourceMode;
}

export interface MetroCarriageCrowd {
  carIndex: number; // 1 ~ 6
  level: 1 | 2 | 3 | 4; // 1=舒適(綠), 2=普通(黃), 3=略多(橘), 4=擁擠(紅)
}

export interface MetroPlatformArrival {
  platformName: string;
  destination: string;
  nextTrainSeconds: number;
  followingTrainSeconds: number;
  carriages?: MetroCarriageCrowd[];
}

export interface MetroStationDetail {
  systemId: 'TRTC' | 'NTMC' | 'TYMC' | 'TMRT' | 'KRTC' | 'KLRT';
  systemName: string;
  lineCode: string;
  lineName: string;
  lineColor: string;
  stationId: string;
  stationName: string;
  platforms: MetroPlatformArrival[];
  liveVehicles?: LiveRailVehicle[];
  updatedAt: string;
  sourceUpdatedAt?: number;
  source: DataSourceMode;
}

export interface TraTrainRow {
  trainNo: string;
  trainType: '新自強' | '普悠瑪' | '太魯閣' | '自強' | '莒光' | '區間快' | '區間';
  direction: 0 | 1; // 0=順行(南下/東), 1=逆行(北上/西)
  originStation: string;
  destinationStation: string;
  departureTime: string;
  arrivalTime?: string;
  durationMinutes?: number;
  delayMinutes: number; // 0 = 準點
  statusText: string;
}

export interface ThsrTrainRow {
  trainNo: string;
  originStation: string;
  destinationStation: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  stopPattern: '直達' | '跳蛙' | '站站停';
  standardSeatStatus: 'available' | 'limited' | 'full';
  businessSeatStatus: 'available' | 'limited' | 'full';
  nonReservedCars: string; // 例如 "10-12車"
}

export interface YouBikeStation {
  stationUid: string;
  stationName: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  totalDocks: number;
  availableBikes20: number; // YouBike 2.0
  availableBikes20E: number; // YouBike 2.0E 電輔車
  availableReturnDocks: number;
  serviceStatus: 0 | 1 | 2; // 1=正常營運
  updatedAt: string;
  distanceMeters?: number;
}

export interface ParkingLot {
  carParkId: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  totalSpaces: number;
  /** null 表示僅有靜態總格位與費率資訊，無即時剩餘車位連線 */
  availableSpaces: number | null;
  fareDescription: string;
  parkingType: '立體' | '平面' | '地下';
  updatedAt: string;
  distanceMeters?: number;
}

export interface LiveRailVehicle {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  color?: string;
}

export interface FavoriteItem {
  id: string;
  mode: TransportMode;
  title: string;
  subtitle: string;
  href: string;
}
