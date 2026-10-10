export const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
export const CONFIG = {
  fit: { speedKmh: { mtb: 12, gravel: 18, road: 25 } },
  profiles: { mtb: { label: '山サイ', api: 'mtb' }, gravel: { label: 'グラベル', api: 'gravel' }, road: { label: 'ロード', api: 'fastbike' } },
  routing: { debounceMs: 500, concurrency: 2, timeoutMs: 30000, cacheSize: 512 },
  elevation: { zoom: 14, tileIds: ['dem5a_png', 'dem_png'], intervalM: 20, hysteresisM: 5 },
  places: { passRadiusM: 100, peakRadiusM: 150, marginDegrees: 0.003, debounceMs: 1200 },
  poi: {
    gapWarnKm: 20,
    categories: {
      conv: { conditions: ['["shop"="convenience"]'], label: 'コンビニ', color: 'var(--poi-conv)', on: true },
      shop: { conditions: ['["shop"~"^(supermarket|general|grocery|greengrocer|bakery|deli)$"]'], label: '商店', color: 'var(--poi-shop)', on: true },
      vend: { conditions: ['["amenity"="vending_machine"][!"vending"]', '["amenity"="vending_machine"]["vending"~"drinks"]'], label: '自販機', color: 'var(--poi-vend)', on: true },
      water: { conditions: ['["amenity"="drinking_water"]', '["man_made"="water_tap"]["drinking_water"="yes"]', '["natural"="spring"]["drinking_water"="yes"]'], label: '水場', color: 'var(--poi-water)', on: true },
      wc: { conditions: ['["amenity"="toilets"]'], label: 'トイレ', color: 'var(--poi-wc)', on: false },
      michi: { conditions: ['["name"~"^道の駅"]', '["highway"~"^(rest_area|services)$"]["name"~"道の駅"]'], label: '道の駅', color: 'var(--poi-michi)', on: true },
    },
    radii: { conv: 300, shop: 300, vend: 100, water: 200, wc: 200, michi: 500 },
  },
};
export type Profile = keyof typeof CONFIG.profiles;
export const BASE_LAYERS = [
  { name: '地理院 標準', url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', maxNativeZoom: 18, attribution: GSI_ATTRIBUTION },
  { name: '地理院 淡色', url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', maxNativeZoom: 18, attribution: GSI_ATTRIBUTION },
  { name: '地理院 写真', url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', maxNativeZoom: 18, attribution: GSI_ATTRIBUTION },
  { name: '地理院 陰影起伏', url: 'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png', maxNativeZoom: 16, attribution: GSI_ATTRIBUTION },
  { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNativeZoom: 19, attribution: OSM_ATTRIBUTION },
] as const;
