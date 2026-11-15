import {
  BusRouteDetail,
  BusRouteInfo,
  BusStopStatus,
  MetroStationDetail,
  ParkingLot,
  ThsrTrainRow,
  TraTrainRow,
  YouBikeStation,
} from './types';
import { FULL_METRO_SYSTEMS, FULL_TRA_STATIONS } from './rail-directory';

export const METRO_SYSTEMS = FULL_METRO_SYSTEMS;
export const TRA_STATIONS = FULL_TRA_STATIONS;

export const BUS_CITIES = [
  { code: 'Taipei', name: '雙北公車 (台北/新北)' },
  { code: 'Taoyuan', name: '桃園市' },
  { code: 'Taichung', name: '台中市' },
  { code: 'Tainan', name: '台南市' },
  { code: 'Kaohsiung', name: '高雄市' },
  { code: 'InterCity', name: '公路客運' },
];

export const MOCK_BUS_ROUTES: BusRouteInfo[] = [
  {
    routeUid: 'TPE-307',
    routeName: '307',
    city: 'Taipei',
    cityName: '雙北公車',
    departureStop: '板橋前站',
    destinationStop: '撫遠街',
    operatorName: '臺北客運 / 首都客運',
  },
  {
    routeUid: 'TPE-BL1',
    routeName: '藍1',
    city: 'Taipei',
    cityName: '雙北公車',
    departureStop: '蘆洲總站',
    destinationStop: '台北車站',
    operatorName: '三重客運',
  },
  {
    routeUid: 'TPE-235',
    routeName: '235',
    city: 'Taipei',
    cityName: '雙北公車',
    departureStop: '新莊',
    destinationStop: '國父紀念館',
    operatorName: '首都客運',
  },
  {
    routeUid: 'TPE-R30',
    routeName: '紅30',
    city: 'Taipei',
    cityName: '雙北公車',
    departureStop: '故宮博物院',
    destinationStop: '捷運劍潭站',
    operatorName: '中興巴士',
  },
  {
    routeUid: 'TPE-G1',
    routeName: '綠1',
    city: 'Taipei',
    cityName: '雙北公車',
    departureStop: '新店',
    destinationStop: '台北市政府',
    operatorName: '臺北客運',
  },
  {
    routeUid: 'TPE-ZX',
    routeName: '忠孝幹線',
    city: 'Taipei',
    cityName: '雙北公車',
    departureStop: '蘆洲',
    destinationStop: '松山車站',
    operatorName: '三重客運',
  },
  {
    routeUid: 'TXG-300',
    routeName: '300',
    city: 'Taichung',
    cityName: '台中市',
    departureStop: '靜宜大學',
    destinationStop: '臺中車站',
    operatorName: '台中客運 / 統聯 / 巨業',
  },
  {
    routeUid: 'KHH-R33',
    routeName: '紅33',
    city: 'Kaohsiung',
    cityName: '高雄市',
    departureStop: '明誠幹線',
    destinationStop: '鳳山商工',
    operatorName: '南台灣客運',
  },
  {
    routeUid: 'TYN-1',
    routeName: '1',
    city: 'Taoyuan',
    cityName: '桃園市',
    departureStop: '中壢公車站',
    destinationStop: '桃園巨蛋',
    operatorName: '桃園客運',
  },
  {
    routeUid: 'TNN-2',
    routeName: '2',
    city: 'Tainan',
    cityName: '台南市',
    departureStop: '崑山科大',
    destinationStop: '安平白鷺灣',
    operatorName: '府城客運',
  },
];

interface RawStop {
  name: string;
  lat: number;
  lng: number;
}

const ROUTE_STOPS_MAP: Record<string, RawStop[]> = {
  '307': [
    { name: '板橋前站', lat: 25.0142, lng: 121.4638 },
    { name: '捷運府中站', lat: 25.0085, lng: 121.4593 },
    { name: '新板特區(板橋車站)', lat: 25.0138, lng: 121.4671 },
    { name: '海山高中', lat: 25.0108, lng: 121.4748 },
    { name: '積穗國中', lat: 25.0054, lng: 121.4832 },
    { name: '中和環球購物中心', lat: 25.0068, lng: 121.4744 },
    { name: '連城路', lat: 24.9992, lng: 121.4915 },
    { name: '捷運景安站', lat: 24.9939, lng: 121.5051 },
    { name: '華中橋', lat: 25.0124, lng: 121.4963 },
    { name: '萬華車站', lat: 25.0332, lng: 121.5002 },
    { name: '捷運西門站', lat: 25.0421, lng: 121.5082 },
    { name: '中華路北站', lat: 25.0466, lng: 121.5096 },
    { name: '臺北車站(忠孝)', lat: 25.0468, lng: 121.5171 },
    { name: '捷運善導寺站', lat: 25.0448, lng: 121.5233 },
    { name: '華山文創園區', lat: 25.0442, lng: 121.5294 },
    { name: '捷運松江南京站', lat: 25.0521, lng: 121.5331 },
    { name: '捷運南京復興站', lat: 25.0523, lng: 121.5441 },
    { name: '臺北小巨蛋', lat: 25.0512, lng: 121.5502 },
    { name: '南京三民路口', lat: 25.0515, lng: 121.5641 },
    { name: '撫遠街', lat: 25.0575, lng: 121.5698 },
  ],
  '300': [
    { name: '靜宜大學', lat: 24.2259, lng: 120.5772 },
    { name: '弘光科技大學', lat: 24.2188, lng: 120.5815 },
    { name: '東海別墅', lat: 24.1818, lng: 120.5931 },
    { name: '榮總/東海大學', lat: 24.1825, lng: 120.6042 },
    { name: '澄清醫院', lat: 24.1782, lng: 120.6145 },
    { name: '秋紅谷', lat: 24.1672, lng: 120.6388 },
    { name: '新光/遠百', lat: 24.1645, lng: 120.6442 },
    { name: '市政府', lat: 24.1621, lng: 120.6485 },
    { name: '忠明國小', lat: 24.1566, lng: 120.6615 },
    { name: '科博館', lat: 24.1543, lng: 120.6669 },
    { name: '茄苳腳', lat: 24.1489, lng: 120.6732 },
    { name: '臺中醫院', lat: 24.1432, lng: 120.6775 },
    { name: '臺中車站', lat: 24.1368, lng: 120.6849 },
  ],
};

function buildGenericStops(route: BusRouteInfo): RawStop[] {
  return [
    { name: route.departureStop, lat: 25.0468, lng: 121.5171 },
    { name: `${route.cityName}行政中心`, lat: 25.0445, lng: 121.5245 },
    { name: '中山路口', lat: 25.0422, lng: 121.5315 },
    { name: '中正公園', lat: 25.0401, lng: 121.5392 },
    { name: '建國市場', lat: 25.0389, lng: 121.5461 },
    { name: '捷運轉運站', lat: 25.0375, lng: 121.5542 },
    { name: '文化中心', lat: 25.0395, lng: 121.5612 },
    { name: route.destinationStop, lat: 25.0412, lng: 121.5675 },
  ];
}

export function getMockBusRouteDetail(
  routeName: string,
  city: string,
  direction: 0 | 1
): BusRouteDetail {
  const route =
    MOCK_BUS_ROUTES.find(
      (r) => r.routeName === routeName && (city === 'All' || r.city === city)
    ) ||
    MOCK_BUS_ROUTES.find((r) => r.routeName === routeName) ||
    MOCK_BUS_ROUTES[0];

  const baseStops = ROUTE_STOPS_MAP[route.routeName] || buildGenericStops(route);
  const orderedStops = direction === 0 ? baseStops : [...baseStops].reverse();

  // 隨時間推進的模擬相位 (每 10 秒移動一點)
  const tick = Math.floor(Date.now() / 1000);
  const totalStops = orderedStops.length;
  const cycleSec = totalStops * 75;

  // 模擬 3 台車在路上行駛
  const vehicleSeeds = [
    { plate: 'EAL-1028', offset: 0, isLowFloor: true, isElectric: true },
    { plate: 'KKA-8892', offset: Math.floor(cycleSec * 0.35), isLowFloor: true, isElectric: false },
    { plate: 'FAD-5201', offset: Math.floor(cycleSec * 0.72), isLowFloor: false, isElectric: false },
  ];

  const vehiclePositions = vehicleSeeds.map((v) => {
    const progressSec = (tick + v.offset) % cycleSec;
    const exactStopFloat = (progressSec / cycleSec) * totalStops;
    return {
      ...v,
      exactStopFloat,
      nearStopIndex: Math.floor(exactStopFloat) % totalStops,
    };
  });

  const stops: BusStopStatus[] = orderedStops.map((s, idx) => {
    // 計算距離此站最近且即將抵達的公車
    let minEta = Infinity;
    let approaching: BusStopStatus['approachingBus'] = undefined;

    for (const v of vehiclePositions) {
      let diffStops = idx - v.exactStopFloat;
      if (diffStops < -0.25) continue; // 已經過站
      if (diffStops < 0) diffStops = 0;

      const etaSec = Math.round(diffStops * 75);
      if (etaSec < minEta) {
        minEta = etaSec;
        if (etaSec <= 180) {
          approaching = {
            plateNumb: v.plate,
            isLowFloor: v.isLowFloor,
            isElectric: v.isElectric,
            atStop: etaSec <= 35,
          };
        }
      }
    }

    const isUnstarted = !Number.isFinite(minEta);
    return {
      stopUid: `${route.routeUid}-${direction}-${idx}`,
      stopName: s.name,
      sequence: idx + 1,
      lat: s.lat,
      lng: s.lng,
      estimateSeconds: isUnstarted ? null : minEta,
      stopStatus: isUnstarted ? 1 : 0,
      approachingBus: approaching,
    };
  });

  const vehicles = vehiclePositions.map((v) => {
    const cur = orderedStops[v.nearStopIndex];
    const next = orderedStops[Math.min(v.nearStopIndex + 1, totalStops - 1)];
    const frac = v.exactStopFloat - Math.floor(v.exactStopFloat);
    return {
      plateNumb: v.plate,
      lat: cur.lat + (next.lat - cur.lat) * frac,
      lng: cur.lng + (next.lng - cur.lng) * frac,
      azimuth: 90,
      isLowFloor: v.isLowFloor,
      isElectric: v.isElectric,
      nearStopSeq: v.nearStopIndex + 1,
    };
  });

  return {
    route,
    direction,
    headsign:
      direction === 0 ? `往 ${route.destinationStop}` : `往 ${route.departureStop}`,
    stops,
    shape: orderedStops.map((s) => [s.lat, s.lng]),
    vehicles,
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  };
}

// ==========================================
// 捷運動態生成 (使用 FULL_METRO_SYSTEMS)
// ==========================================
export function getMockMetroStation(
  systemId: string,
  stationId: string
): MetroStationDetail {
  const sys = METRO_SYSTEMS.find((s) => s.id === systemId) || METRO_SYSTEMS[0];
  let foundLine = sys.lines[0];
  let foundStation = foundLine.stations[0];

  for (const line of sys.lines) {
    const st = line.stations.find((x) => x.id === stationId);
    if (st) {
      foundLine = line;
      foundStation = st;
      break;
    }
  }

  const sec = Math.floor(Date.now() / 1000);
  const next1 = (195 - (sec % 195)) + 15;
  const next2 = (240 - ((sec + 80) % 240)) + 20;

  const makeCrowd = (seed: number) =>
    sys.id === 'TRTC'
      ? ([1, 2, 3, 4, 5, 6].map((carIndex) => ({
          carIndex,
          level: (((carIndex + seed) % 4) + 1) as 1 | 2 | 3 | 4,
        })))
      : undefined;

  return {
    systemId: sys.id,
    systemName: sys.name,
    lineCode: foundLine.code,
    lineName: foundLine.name,
    lineColor: foundLine.color,
    stationId: foundStation.id,
    stationName: foundStation.name,
    platforms: [
      {
        platformName: '月台 1',
        destination: foundLine.terminals[1],
        nextTrainSeconds: next1,
        followingTrainSeconds: next1 + 210,
        carriages: makeCrowd(sec % 3),
      },
      {
        platformName: '月台 2',
        destination: foundLine.terminals[0],
        nextTrainSeconds: next2,
        followingTrainSeconds: next2 + 225,
        carriages: makeCrowd((sec + 2) % 3),
      },
    ],
    updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    source: 'mock',
  };
}

// ==========================================
// 台鐵動態生成 (使用 FULL_TRA_STATIONS)
// ==========================================
export function getMockTraData(
  mode: 'board' | 'od',
  stationId: string,
  fromId: string,
  toId: string
): TraTrainRow[] {
  const fromName = TRA_STATIONS.find((s) => s.id === fromId)?.name || '臺北';
  const toName = TRA_STATIONS.find((s) => s.id === toId)?.name || '臺中';
  const stationName = TRA_STATIONS.find((s) => s.id === stationId)?.name || '臺北';

  if (mode === 'board') {
    const boardRows: TraTrainRow[] = [
      {
        trainNo: '125',
        trainType: '新自強',
        direction: 0,
        originStation: '七堵',
        destinationStation: '屏東',
        departureTime: '16:50',
        delayMinutes: 0,
        statusText: '準點',
      },
      {
        trainNo: '2193',
        trainType: '區間',
        direction: 0,
        originStation: '基隆',
        destinationStation: '苗栗',
        departureTime: '16:58',
        delayMinutes: 3,
        statusText: '晚 3 分',
      },
      {
        trainNo: '139',
        trainType: '自強',
        direction: 0,
        originStation: '七堵',
        destinationStation: '潮州',
        departureTime: '17:12',
        delayMinutes: 0,
        statusText: '準點',
      },
      {
        trainNo: '1026',
        trainType: '區間快',
        direction: 1,
        originStation: '彰化',
        destinationStation: '七堵',
        departureTime: '16:54',
        delayMinutes: 0,
        statusText: '準點',
      },
      {
        trainNo: '432',
        trainType: '新自強',
        direction: 1,
        originStation: '新左營',
        destinationStation: '臺東',
        departureTime: '17:05',
        delayMinutes: 6,
        statusText: '晚 6 分',
      },
      {
        trainNo: '2212',
        trainType: '區間',
        direction: 1,
        originStation: '新竹',
        destinationStation: '基隆',
        departureTime: '17:18',
        delayMinutes: 0,
        statusText: '準點',
      },
    ];
    return boardRows.map((t) => ({
      ...t,
      originStation: t.originStation === stationName ? stationName : t.originStation,
    }));
  }

  return [
    {
      trainNo: '135',
      trainType: '新自強',
      direction: 0,
      originStation: fromName,
      destinationStation: toName,
      departureTime: '16:50',
      arrivalTime: '18:38',
      durationMinutes: 108,
      delayMinutes: 0,
      statusText: '準點',
    },
    {
      trainNo: '2033',
      trainType: '區間快',
      direction: 0,
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:08',
      arrivalTime: '19:22',
      durationMinutes: 134,
      delayMinutes: 2,
      statusText: '晚 2 分',
    },
    {
      trainNo: '141',
      trainType: '自強',
      direction: 0,
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:30',
      arrivalTime: '19:35',
      durationMinutes: 125,
      delayMinutes: 0,
      statusText: '準點',
    },
    {
      trainNo: '2199',
      trainType: '區間',
      direction: 0,
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:45',
      arrivalTime: '20:48',
      durationMinutes: 183,
      delayMinutes: 0,
      statusText: '準點',
    },
    {
      trainNo: '145',
      trainType: '普悠瑪',
      direction: 0,
      originStation: fromName,
      destinationStation: toName,
      departureTime: '18:10',
      arrivalTime: '19:52',
      durationMinutes: 102,
      delayMinutes: 0,
      statusText: '準點',
    },
  ];
}

// ==========================================
// 高鐵模擬資料
// ==========================================
export const THSR_STATIONS = [
  { id: '0990', name: '南港' },
  { id: '1000', name: '台北' },
  { id: '1010', name: '板橋' },
  { id: '1020', name: '桃園' },
  { id: '1030', name: '新竹' },
  { id: '1035', name: '苗栗' },
  { id: '1040', name: '台中' },
  { id: '1043', name: '彰化' },
  { id: '1047', name: '雲林' },
  { id: '1050', name: '嘉義' },
  { id: '1060', name: '台南' },
  { id: '1070', name: '左營' },
];

export function getMockThsrTrains(fromId: string, toId: string): ThsrTrainRow[] {
  const fromName = THSR_STATIONS.find((s) => s.id === fromId)?.name || '台北';
  const toName = THSR_STATIONS.find((s) => s.id === toId)?.name || '台中';

  return [
    {
      trainNo: '0145',
      originStation: fromName,
      destinationStation: toName,
      departureTime: '16:51',
      arrivalTime: '17:37',
      durationMinutes: 46,
      stopPattern: '直達',
      standardSeatStatus: 'limited',
      businessSeatStatus: 'available',
      nonReservedCars: '10-12車',
    },
    {
      trainNo: '0663',
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:01',
      arrivalTime: '17:58',
      durationMinutes: 57,
      stopPattern: '跳蛙',
      standardSeatStatus: 'available',
      businessSeatStatus: 'available',
      nonReservedCars: '10-12車',
    },
    {
      trainNo: '0845',
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:11',
      arrivalTime: '18:14',
      durationMinutes: 63,
      stopPattern: '站站停',
      standardSeatStatus: 'available',
      businessSeatStatus: 'available',
      nonReservedCars: '9-12車',
    },
    {
      trainNo: '0245',
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:21',
      arrivalTime: '18:08',
      durationMinutes: 47,
      stopPattern: '直達',
      standardSeatStatus: 'full',
      businessSeatStatus: 'limited',
      nonReservedCars: '10-12車',
    },
    {
      trainNo: '0667',
      originStation: fromName,
      destinationStation: toName,
      departureTime: '17:41',
      arrivalTime: '18:37',
      durationMinutes: 56,
      stopPattern: '跳蛙',
      standardSeatStatus: 'available',
      businessSeatStatus: 'available',
      nonReservedCars: '10-12車',
    },
  ];
}

// ==========================================
// YouBike 模擬資料
// ==========================================
export const MOCK_YOUBIKE_STATIONS: YouBikeStation[] = [
  {
    stationUid: 'TPE001',
    stationName: '捷運市政府站(3號出口)',
    city: 'Taipei',
    address: '忠孝東路五段2號旁',
    lat: 25.0409,
    lng: 121.5665,
    totalDocks: 48,
    availableBikes20: 14,
    availableBikes20E: 4,
    availableReturnDocks: 30,
    serviceStatus: 1,
    updatedAt: '剛剛',
  },
  {
    stationUid: 'TPE002',
    stationName: '捷運台北車站(M8出口)',
    city: 'Taipei',
    address: '忠孝西路一段49號對面',
    lat: 25.0462,
    lng: 121.5186,
    totalDocks: 60,
    availableBikes20: 26,
    availableBikes20E: 7,
    availableReturnDocks: 27,
    serviceStatus: 1,
    updatedAt: '剛剛',
  },
  {
    stationUid: 'TPE003',
    stationName: '捷運國父紀念館站(2號出口)',
    city: 'Taipei',
    address: '光復南路/忠孝東路四段口',
    lat: 25.0413,
    lng: 121.5579,
    totalDocks: 36,
    availableBikes20: 2,
    availableBikes20E: 1,
    availableReturnDocks: 33,
    serviceStatus: 1,
    updatedAt: '1 分鐘前',
  },
  {
    stationUid: 'TPE004',
    stationName: '信義廣場(台北101)',
    city: 'Taipei',
    address: '松智路與信義路五段口',
    lat: 25.0338,
    lng: 121.5645,
    totalDocks: 42,
    availableBikes20: 38,
    availableBikes20E: 4,
    availableReturnDocks: 0,
    serviceStatus: 1,
    updatedAt: '剛剛',
  },
  {
    stationUid: 'NWT001',
    stationName: '捷運板橋站(1號出口)',
    city: 'NewTaipei',
    address: '縣民大道二段7號',
    lat: 25.0139,
    lng: 121.4638,
    totalDocks: 55,
    availableBikes20: 19,
    availableBikes20E: 5,
    availableReturnDocks: 31,
    serviceStatus: 1,
    updatedAt: '剛剛',
  },
  {
    stationUid: 'TXG001',
    stationName: '臺中火車站(前站廣場)',
    city: 'Taichung',
    address: '台灣大道一段1號',
    lat: 24.1369,
    lng: 120.6849,
    totalDocks: 50,
    availableBikes20: 22,
    availableBikes20E: 6,
    availableReturnDocks: 22,
    serviceStatus: 1,
    updatedAt: '剛剛',
  },
  {
    stationUid: 'KHH001',
    stationName: '捷運美麗島站(1號出口)',
    city: 'Kaohsiung',
    address: '中山一路115號',
    lat: 22.6314,
    lng: 120.3019,
    totalDocks: 40,
    availableBikes20: 11,
    availableBikes20E: 3,
    availableReturnDocks: 26,
    serviceStatus: 1,
    updatedAt: '剛剛',
  },
];

// ==========================================
// 停車場模擬資料
// ==========================================
export const MOCK_PARKING_LOTS: ParkingLot[] = [
  {
    carParkId: 'PK-TPE-01',
    name: '府前廣場地下停車場',
    city: 'Taipei',
    address: '台北市信義區松壽路1號地下',
    lat: 25.0376,
    lng: 121.5637,
    totalSpaces: 1998,
    availableSpaces: 342,
    fareDescription: '平日 $30/時 · 假日 $40/時',
    parkingType: '地下',
    updatedAt: '剛剛',
  },
  {
    carParkId: 'PK-TPE-02',
    name: '臺北車站東區地下停車場',
    city: 'Taipei',
    address: '台北市中正區北平西路3號地下',
    lat: 25.0475,
    lng: 121.5191,
    totalSpaces: 450,
    availableSpaces: 8,
    fareDescription: '每小時 $50 · 當日最高 $300',
    parkingType: '地下',
    updatedAt: '1 分鐘前',
  },
  {
    carParkId: 'PK-TPE-03',
    name: '松壽廣場地下停車場',
    city: 'Taipei',
    address: '台北市信義區松智路15號地下',
    lat: 25.0361,
    lng: 121.5661,
    totalSpaces: 446,
    availableSpaces: 0,
    fareDescription: '平日 $40/時 · 假日 $60/時',
    parkingType: '地下',
    updatedAt: '剛剛',
  },
  {
    carParkId: 'PK-NWT-01',
    name: '板橋車站地下停車場',
    city: 'NewTaipei',
    address: '新北市板橋區縣民大道二段7號',
    lat: 25.0141,
    lng: 121.4643,
    totalSpaces: 850,
    availableSpaces: 124,
    fareDescription: '每小時 $40 · 最高 $240/日',
    parkingType: '地下',
    updatedAt: '剛剛',
  },
  {
    carParkId: 'PK-TXG-01',
    name: '臺中市市政公園地下停車場',
    city: 'Taichung',
    address: '台中市西屯區台灣大道三段99號',
    lat: 24.1618,
    lng: 120.6468,
    totalSpaces: 890,
    availableSpaces: 215,
    fareDescription: '每小時 $20 · 單日最高 $150',
    parkingType: '地下',
    updatedAt: '剛剛',
  },
  {
    carParkId: 'PK-KHH-01',
    name: '高雄文化中心地下停車場',
    city: 'Kaohsiung',
    address: '高雄市苓雅區五福一路67號',
    lat: 22.6266,
    lng: 120.3174,
    totalSpaces: 620,
    availableSpaces: 89,
    fareDescription: '每小時 $30 · 單日最高 $180',
    parkingType: '地下',
    updatedAt: '剛剛',
  },
];
