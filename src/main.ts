import 'leaflet/dist/leaflet.css';
import './style.css';
import { createMap } from './map';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><h1>ルートビルダー</h1><p>自転車で、次の道へ</p></header>
  <main><div id="map" aria-label="ルート作成地図"></div><aside id="panel"><h2>ルートを描く</h2><p>地図をクリックして経由点を追加</p></aside></main>`;
createMap('map');
