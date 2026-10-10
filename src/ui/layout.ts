import { CONFIG } from '../config';
import { icons, icon } from './icons';

const segment = () => `<div class="seg" role="group" aria-label="走り方">${Object.entries(CONFIG.profiles).map(([key, value]) => `<button data-profile="${key}" aria-pressed="${key === 'mtb'}">${icon(key === 'road' ? 'road' : key)}${value.label}</button>`).join('')}</div>`;
const action = (name: string, label: string, glyph: string, cls = 'fab', id = '') => `<button ${id ? `id="${id}"` : ''} class="${cls}" data-action="${name}" aria-label="${label}">${icon(glyph)}${cls.split(' ').includes('btn') || cls === '' ? label : ''}</button>`;
export function mountUI() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `${icons}<main class="app">
    <aside id="panel" class="sidebar" aria-label="ルート情報">
      <button id="panel-toggle" class="sheet-grip m-only" aria-controls="panel-content" aria-expanded="false" aria-label="ルート情報を開く"></button>
      <div class="brand"><div class="brand-mark" aria-hidden="true">${icon('route')}</div><span class="brand-name">ルートビルダー</span>${action('import', 'GPXを読み込む', 'upload', 'icon-btn', 'import')}${action('share', '共有URLをコピー', 'share', 'icon-btn')}</div>
      <div id="panel-content" class="sb-scroll">
        <div class="controls">${segment()}<label class="toggle-row"><span>道に沿う <small>OFFで直線</small></span><span class="switch"><input id="follow" data-follow type="checkbox" checked aria-label="道に沿う"><span></span></span></label></div>
        <div class="route-name"><input id="route-name" aria-label="ルート名" maxlength="200" value="新しいルート"></div>
        <div class="peek-row"><input id="mobile-name" class="route-title" aria-label="ルート名" maxlength="200" value="新しいルート">${action('garmin', 'ガーミン', 'download', 'btn primary')}</div>
        <div id="status" class="status" role="status" aria-live="polite"><span class="dot"></span><span id="notice"></span></div>
        <input id="share-url" aria-label="共有URL" readonly hidden>
        <dl class="stats"><div class="stat main"><dt>距離</dt><dd class="num" id="summary">—<small>km</small></dd></div><div id="stats"></div></dl>
        <section class="section"><div class="section-head"><h2>標高</h2><small>なぞると地図に位置を表示</small></div><div id="chart" class="chart"></div><div class="legend" aria-label="勾配の凡例">${['〜3%', '3〜6%', '6〜9%', '9〜12%', '12%〜', '下り'].map((label, i) => `<span><i style="background:var(--g${['0','3','6','9','12','down'][i]})"></i>${label}</span>`).join('')}</div></section>
        <section class="section"><div class="section-head"><h2>通過する峠・山</h2><small>OSM登録地物</small></div><p id="places-status" class="empty"></p><ul id="places" class="list"></ul></section>
        <section class="section" aria-labelledby="poi-heading"><div class="section-head"><h2 id="poi-heading">補給・休憩</h2><small>ルート近傍のOSM登録地物</small></div><div id="poi-chips" class="chips" role="group" aria-label="表示する種類"></div><p id="poi-status" class="empty" role="status"></p><div id="gap-note" class="gap-note" hidden></div><ul id="poi-list" class="list"></ul><button id="poi-more" class="more-btn" hidden>さらに表示</button><label class="check-row"><input id="poi-gpx" type="checkbox" checked>表示中の補給・休憩を含める（FIT・GPX）</label></section>
        <details class="section"><summary><div class="section-head"><h2>経由点 <span id="point-count" class="num">0</span></h2><svg class="chev" width="18" height="18"><use href="#i-chev"/></svg></div></summary><ol id="waypoints" class="list"></ol></details>
        <section class="section"><p class="note">経路は通行可能性を保証しません。現地の規制・通行状況を確認してください。<br>ルート: BRouter / 地物: © OpenStreetMap contributors / 標高: 地理院タイル<br>登降は5mヒステリシスによる概算</p></section>
      </div>
      <footer class="sb-foot">${action('garmin', 'ガーミンへ送る', 'download', 'btn primary', 'garmin')}${action('export', 'GPX', 'download', 'btn', 'export')}${action('share', '共有', 'share', 'btn', 'share')}</footer>
    </aside>
    <div id="map" aria-label="ルート作成地図">
      <div class="map-ui m-top m-only">${segment()}<div style="position:relative"><button class="fab" id="menu-btn" aria-label="メニュー" aria-controls="menu-pop" aria-expanded="false">${icon('more')}</button><div id="menu-pop" class="menu-pop"><label class="toggle-row">道に沿う<span class="switch"><input data-follow type="checkbox" checked aria-label="道に沿う"><span></span></span></label><hr>${action('export', 'GPXで保存', 'download', '')}${action('import', 'GPXを読み込む', 'upload', '')}${action('share', '共有URLをコピー', 'share', '')}<hr>${action('reprofile-all', '全区間を現在の設定で引き直す', 'route', '')}${action('clear', 'ルートを全消去', 'trash', '')}</div></div></div>
      <div id="hint" class="map-ui hint-chip d-only">地図をクリックで経由点を追加 · ルート上をドラッグで経由点を挿入</div>
      <div class="map-ui fab-col"><div style="position:relative"><button class="fab" id="layer-btn" aria-label="背景地図を選ぶ" aria-controls="layer-pop" aria-expanded="false">${icon('layers')}</button><div id="layer-pop" class="layer-pop" role="dialog" aria-label="背景地図"></div></div><div class="fab-group zoom">${action('zoom-in','拡大','plus')}${action('zoom-out','縮小','minus')}</div>${action('locate','現在地','locate')}</div>
      <div class="map-ui edit-bar d-only" role="toolbar" aria-label="編集">${action('undo','元に戻す','undo','','undo')}${action('fit','全体表示','fit','','fit')}<span class="sep"></span>${action('reprofile-all','全区間を引き直す','route','','reprofile-all')}${action('clear','全消去','trash','','clear')}</div>
      <div class="map-ui m-tools m-only">${action('undo','元に戻す','undo')}${action('fit','全体表示','fit')}</div>
    </div><input id="file" type="file" accept=".gpx,application/gpx+xml" hidden><select id="profile" hidden>${Object.keys(CONFIG.profiles).map(key => `<option value="${key}">${key}</option>`).join('')}</select>
  </main>
  <dialog id="garmin-dialog" class="garmin-dialog" aria-labelledby="garmin-title">
    <h2 id="garmin-title">FITをGarmin Connectへ取り込む</h2>
    <p>FITファイルをダウンロードしました。</p>
    <h3>PC</h3>
    <ol><li>Garmin Connect（connect.garmin.com）を開く。</li><li>「トレーニングとプランニング」→「コース」→「コースをインポート」で、このFITを選択。</li><li>保存して「デバイスに送信」。</li></ol>
    <h3>スマホ</h3>
    <ol><li>ダウンロードしたFITをファイルアプリで開く。</li><li>「共有」→「Connect」→ 保存 →「デバイスに送信」。</li></ol>
    <p>うまくいかない場合はPCのGarmin Connectから取り込んでください。</p>
    <p class="note">Garminの画面名は変わることがあります。</p>
    <label class="check-row"><input id="garmin-hide-instructions" type="checkbox">次回から表示しない</label>
    <button id="garmin-close" class="btn primary" autofocus>閉じる</button>
  </dialog>`;
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    if (!button.id) button.onclick = () => document.getElementById(button.dataset.action!)?.click();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(button => button.onclick = () => {
    const select = document.getElementById('profile') as HTMLSelectElement;
    select.value = button.dataset.profile!; select.dispatchEvent(new Event('change'));
  });
  document.querySelectorAll<HTMLInputElement>('[data-follow]').forEach(input => { if (!input.id) input.onchange = () => {
    const primary = document.getElementById('follow') as HTMLInputElement; primary.checked = input.checked; primary.dispatchEvent(new Event('change'));
  }; });
}
