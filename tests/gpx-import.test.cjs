const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const TRIPS = 'hokkaido48Trips';
const backupPath = process.env.GPX_BACKUP || path.join(__dirname, 'private-fixtures/backup-19.json');
const gpxPath = process.env.GPX_FIXTURE || path.join(__dirname, 'private-fixtures/20260927.gpx');
const route = { number: '237', start: 'テスト起点', end: 'テスト終点', status: '未走破',
  displayStatusPreview: '未走破', challengeTarget: true, primaryRegion: '道北', regions: ['道北'], distance: 16 };
const road = Array.from({ length: 201 }, (_, i) => [141 + i / 1000, 43]);
const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: road } }] };
function gpx(offset = 0) {
  // 約5%を国道から外す。全線候補でも、その穴を全線geometryで埋めてはいけない。
  const points = road.map(([lon, lat], i) => `<trkpt lat="${lat + offset + (i >= 95 && i <= 105 ? .01 : 0)}" lon="${lon}"><time>${new Date(Date.UTC(2026, 8, 27, 0, 0, i * 10)).toISOString()}</time></trkpt>`);
  return Buffer.from(`<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`);
}
const seed = { [TRIPS]: JSON.stringify([{ id: 'protected-trip', tripName: '既存旅', routes: '38',
  routeSegments: [{ routeNumber: '38', completionStatus: '全線走破', confirmedPaths: [[[43, 143], [43.01, 143]]] }],
  materialImports: [], memo: '保持する' }]),
  hokkaido48V5ManualRouteStatus: '{"38":"全線走破"}',
  hokkaido48V5ConfirmedRouteStatus: '{"38":{"status":"全線走破","source":"v5-route-status-human-confirmed"}}',
  hokkaido48V5DataManagerBackups: '既存バックアップを削除しない', cloudSentinel: 'no-cloud-write' };
let server, base, browser;
before(async () => {
  server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.json': 'application/json', '.geojson': 'application/json' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`; // 8765/8766と別origin、永続profileなし。
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-webgl', '--no-zygote'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function open(t, { storage = seed, synthetic = true, mobile = false, routeHandler } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, timezoneId: 'Asia/Tokyo' });
  t.after(() => context.close());
  // 初回のみseedをセット。アプリのlocalStorageをclear/removeしない。
  await context.addInitScript(values => {
    if (!sessionStorage.getItem('testSeeded')) {
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
      sessionStorage.setItem('testSeeded', '1');
    }
    window.__drawnPaths = [];
  }, storage);
  const errors = [], external = [];
  await context.route('**/*', async r => {
    const url = new URL(r.request().url());
    if (url.origin === base) {
      if (url.pathname === '/data/routes-v50.json' && routeHandler) return routeHandler(r);
      if (synthetic && url.pathname === '/data/routes-v50.json') return r.fulfill({ json: [route] });
      if (synthetic && url.pathname.startsWith('/data/geojson/')) return r.fulfill({ json: geojson });
      return r.continue();
    }
    if (url.href === 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js') {
      const source = fs.readFileSync(require.resolve('leaflet/dist/leaflet.js'), 'utf8');
      // 実Leafletを使い、描画へ渡った正本座標も検証する。
      return r.fulfill({ contentType: 'application/javascript', body: source + '\nconst originalPolyline=L.polyline; L.polyline=function(points,options){window.__drawnPaths.push({points,options});return originalPolyline(points,options);};' });
    }
    if (url.href === 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css') {
      return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(require.resolve('leaflet/dist/leaflet.css')) });
    }
    if (url.hostname.endsWith('.tile.openstreetmap.org')) {
      return r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64') });
    }
    external.push(url.origin); return r.abort(); // クラウドを含む外部書込みは通さない。
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  t.after(() => { assert.deepEqual(errors, [], 'ブラウザJavaScriptエラーなし'); assert.deepEqual(external, [], '予期しない外部通信なし'); });
  await page.goto(base + '/gpx-import.html');
  return page;
}
async function snapshot(page) { return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))); }
async function analyze(page, payload = { name: 'fixture.gpx', mimeType: 'text/xml', buffer: gpx() }) {
  await page.locator('#gpxFile').setInputFiles(payload);
  await page.waitForFunction(() => !document.getElementById('gpxAnalyze').disabled);
  await page.locator('#gpxAnalyze').click();
  await page.waitForFunction(() => document.getElementById('gpxStatus').textContent.startsWith('解析完了'), { timeout: 120000 });
}
async function select(page, numbers) {
  for (const row of await page.locator('.gpx-candidate-row').all()) {
    const number = await row.getAttribute('data-route-number');
    const checkbox = row.locator('input');
    if (await checkbox.isEnabled()) await checkbox.setChecked(numbers.includes(number));
  }
}
function decode(geometry) {
  return geometry.paths.map(encoded => {
    let lat = 0, lon = 0;
    return encoded.split(',').map((token, i) => {
      const [a, b] = token.split(':').map(v => parseInt(v, 36));
      lat = i ? lat + a : a; lon = i ? lon + b : b;
      return [lat / geometry.scale, lon / geometry.scale];
    });
  });
}
async function saveAndMap(page, expectedCount) {
  await page.locator('#gpxSaveConfirmed').click();
  await page.waitForURL('**/v5.html?gpxSaved=1');
  await page.waitForFunction(() => document.getElementById('homeRecordMessage').textContent.includes('確定実走線'));
  const saved = JSON.parse((await snapshot(page))[TRIPS]);
  assert.equal(saved.length, expectedCount);
  assert.ok(await page.locator('#homeRecordMap canvas').count(), '実Leaflet canvasを描画');
  assert.match(await page.locator('#homeSavedJourneyCount').textContent(), new RegExp(String(expectedCount)));
  return saved;
}

test('9/27実GPX: 二重登録拒否→同じTripへ置換→ホーム→19Trip→正本地図',
  { timeout: 180000, skip: !fs.existsSync(gpxPath) || !fs.existsSync(backupPath) }, async t => {
  const storage = JSON.parse(fs.readFileSync(backupPath)).storage;
  storage.hokkaido48V5DataManagerBackups = 'existing-backup';
  const original = JSON.parse(storage[TRIPS]);
  assert.equal(original.length, 19);
  const page = await open(t, { storage, synthetic: false });
  await analyze(page, gpxPath);
  assert.equal(await page.locator('#gpxPointCount').textContent(), '28,390点');
  assert.equal(await page.locator('#gpxDistance').textContent(), '359.5 km');
  const numbers = ['237', '38', '274', '242', '336'];
  for (const n of numbers) assert.equal(await page.locator(`[data-route-number="${n}"]`).count(), 1);
  await select(page, numbers);
  for (const target of ['__new__', '0']) {
    await page.locator('#gpxTripSelect').selectOption(target);
    await page.locator('#gpxSaveConfirmed').click();
    assert.match(await page.locator('#gpxConfirmStatus').textContent(), /二重登録/);
    assert.deepEqual(await snapshot(page), storage);
  }
  await page.locator('#gpxTripSelect').selectOption('18');
  await select(page, numbers);
  const saved = await saveAndMap(page, 19);
  assert.deepEqual(saved.slice(0, 18), original.slice(0, 18), '対象外18Tripとgeometryを保持');
  assert.equal(saved[18].id, original[18].id);
  assert.equal(saved[18].materialImports.length, 1, '名前が変わっても同じGPXは置換');
  assert.equal(saved[18].gpxRouteConfirmations.length, 1);
  assert.equal(saved[18].routeSegments.length, 5);
  assert.deepEqual(saved[18].routeSegments.map(s => s.routeNumber).sort(), numbers.sort());
  assert.ok(saved[18].routeSegments.every(s => s.completionStatus === '一部走破'));
  const actual = await page.evaluate(() => window.__drawnPaths.filter(p => p.options?.pane === 'homeRecordActual').map(p => p.points));
  for (const segment of saved[18].routeSegments) for (const line of decode(segment.confirmedGeometry)) {
    assert.ok(actual.some(p => JSON.stringify(p) === JSON.stringify(line)), '保存した一致区間をホームで描画');
  }
  const after = await snapshot(page);
  for (const key of Object.keys(storage).filter(k => k !== TRIPS)) assert.equal(after[key], storage[key]);
  fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'artifacts/real-gpx-home.png'), fullPage: true });
  await page.goto(base + '/gpx-import.html');
  await analyze(page, { name: 'renamed.gpx', mimeType: 'text/xml', buffer: fs.readFileSync(gpxPath) });
  await select(page, numbers);
  await page.locator('#gpxSaveConfirmed').click();
  assert.match(await page.locator('#gpxConfirmStatus').textContent(), /二重登録/);
  assert.deepEqual(await snapshot(page), after, '新規fingerprintでも別Tripを拒否');
});

test('全線候補は一致した区間だけ一部走破で新規保存、他の記録と手動全線を保持', async t => {
  const page = await open(t);
  await analyze(page);
  assert.match(await page.locator('[data-route-number="237"]').textContent(), /全線走破候補・要確認/);
  await select(page, ['237']);
  const saved = await saveAndMap(page, 2);
  assert.deepEqual(saved[0], JSON.parse(seed[TRIPS])[0]);
  const segment = saved[1].routeSegments[0];
  assert.equal(segment.completionStatus, '一部走破');
  assert.equal(segment.nearFullCompletion, true);
  const paths = decode(segment.confirmedGeometry);
  assert.equal(paths.length, 2, '国道を外れた部分に穴を残す');
  assert.ok(paths.flat().length < road.length);
  assert.equal(saved[1].gpxRouteConfirmations[0].routes[0].confirmedGeometry, undefined);
  const after = await snapshot(page);
  for (const key of Object.keys(seed).filter(k => k !== TRIPS)) assert.equal(after[key], seed[key]);
  // route-statusで人が全線を確定できる状態を保つ。
  await page.goto(base + '/route-status.html?trip=1');
  await page.waitForFunction(() => document.querySelector('[data-route="237"]'));
  assert.match(await page.locator('.route-status-row[data-route="237"]').textContent(), /全線走破/);
  await page.locator('select[data-route="237"]').selectOption('全線走破');
  await page.locator('#rsSave').click();
  const humanStatus = JSON.parse((await snapshot(page)).hokkaido48V5ConfirmedRouteStatus);
  assert.equal(humanStatus['237'].status, '全線走破');
  assert.equal(humanStatus['237'].source, 'v5-route-status-human-confirmed');
  assert.equal(JSON.parse((await snapshot(page))[TRIPS])[1].routeSegments[0].completionStatus, '一部走破');
});

test('スマホ幅: 路線データ読込完了まで解析・保存開始を禁止', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const page = await open(t, { mobile: true, routeHandler: async r => { await gate; await r.fulfill({ json: [route] }); } });
  await page.locator('#gpxFile').setInputFiles({ name: 'mobile.gpx', mimeType: 'text/xml', buffer: gpx() });
  assert.equal(await page.locator('#gpxAnalyze').isDisabled(), true);
  await page.evaluate(() => document.getElementById('gpxAnalyze').dispatchEvent(new Event('click')));
  assert.match(await page.locator('#gpxStatus').textContent(), /読み込み完了/);
  assert.equal(await page.locator('#gpxSaveConfirmed').isDisabled(), true);
  assert.deepEqual(await snapshot(page), seed);
  release();
  await page.waitForFunction(() => !document.getElementById('gpxAnalyze').disabled);
  await page.locator('#gpxAnalyze').click();
  await page.waitForFunction(() => document.getElementById('gpxStatus').textContent.startsWith('解析完了'));
  assert.equal(await page.locator('[data-route-number="237"]').count(), 1);
});

test('路線データのHTTP失敗・空データは解析できない', async t => {
  for (const response of [{ status: 503, body: 'unavailable' }, { json: [] }]) {
    const page = await open(t, { routeHandler: r => r.fulfill(response) });
    await page.waitForFunction(() => document.getElementById('gpxStatus').textContent.includes('読み込めません'));
    await page.locator('#gpxFile').setInputFiles({ name: 'fixture.gpx', mimeType: 'text/xml', buffer: gpx() });
    assert.equal(await page.locator('#gpxAnalyze').isDisabled(), true);
    assert.deepEqual(await snapshot(page), seed);
  }
});

test('再解析の地図読込失敗・不正GPXで前回の候補を保存できない', async t => {
  const page = await open(t);
  await analyze(page);
  await page.route('**/data/geojson/*.geojson', r => r.fulfill({ status: 503, body: 'unavailable' }));
  await page.locator('#gpxAnalyze').click();
  await page.waitForFunction(() => document.getElementById('candidateCount').textContent === '解析失敗');
  assert.equal(await page.locator('#gpxSaveConfirmed').isDisabled(), true);
  assert.equal(await page.locator('.gpx-candidate-row').count(), 0);
  await page.locator('#gpxFile').setInputFiles({ name: 'invalid.gpx', mimeType: 'text/xml', buffer: Buffer.from('<broken') });
  await page.locator('#gpxAnalyze').click();
  await page.waitForFunction(() => document.getElementById('gpxStatus').textContent.includes('XML'));
  assert.equal(await page.locator('#gpxSaveConfirmed').isDisabled(), true);
  assert.deepEqual(await snapshot(page), seed);
});

test('容量不足では既存Trip・geometry・全キーを保持、復旧後に再保存可能', async t => {
  const page = await open(t);
  await analyze(page);
  await page.locator('#gpxTripSelect').selectOption('0');
  await select(page, ['237']);
  await page.evaluate(() => {
    window.originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'hokkaido48Trips') throw new DOMException('full', 'QuotaExceededError');
      return window.originalSet.call(this, key, value);
    };
  });
  await page.locator('#gpxSaveConfirmed').click();
  assert.match(await page.locator('#gpxConfirmStatus').textContent(), /保存容量が不足/);
  assert.deepEqual(await snapshot(page), seed);
  assert.ok(page.url().endsWith('/gpx-import.html'));
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSet; });
  const saved = await saveAndMap(page, 1);
  assert.equal(saved[0].id, 'protected-trip');
  assert.equal(saved[0].routeSegments[0].completionStatus, '全線走破');
});

test('書込後の検証失敗を復元、不正な既存Tripは上書きしない', async t => {
  const page = await open(t);
  await analyze(page);
  await select(page, ['237']);
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem, originalGet = Storage.prototype.getItem;
    let failRead = false, writes = 0;
    Storage.prototype.setItem = function(k, v) { const result = originalSet.call(this, k, v); if (k === 'hokkaido48Trips' && ++writes === 1) failRead = true; return result; };
    Storage.prototype.getItem = function(k) { if (k === 'hokkaido48Trips' && failRead) { failRead = false; return '[]'; } return originalGet.call(this, k); };
    window.restoreStorage = () => { Storage.prototype.setItem = originalSet; Storage.prototype.getItem = originalGet; };
  });
  await page.locator('#gpxSaveConfirmed').click();
  assert.match(await page.locator('#gpxConfirmStatus').textContent(), /直前のTripデータへ復元しました/);
  await page.evaluate(() => window.restoreStorage());
  assert.deepEqual(await snapshot(page), seed);
  await page.evaluate(() => localStorage.setItem('hokkaido48Trips', '{broken'));
  await page.locator('#gpxSaveConfirmed').click();
  assert.match(await page.locator('#gpxConfirmStatus').textContent(), /既存Tripを読み込めない/);
  assert.equal((await snapshot(page))[TRIPS], '{broken');
});

test('確認ダイアログ中の別画面変更、紐づけ先変更を上書きしない', async t => {
  const page = await open(t);
  await analyze(page);
  await select(page, ['237']);
  await page.evaluate(() => { window.confirm = () => { localStorage.setItem('hokkaido48Trips', '[{"id":"other-tab","memo":"latest"}]'); return true; }; });
  await page.locator('#gpxSaveConfirmed').click();
  assert.match(await page.locator('#gpxConfirmStatus').textContent(), /別画面でTripが変更/);
  assert.equal((await snapshot(page))[TRIPS], '[{"id":"other-tab","memo":"latest"}]');
  await page.locator('#gpxTripSelect').selectOption('0');
  await page.locator('#gpxSaveConfirmed').click();
  assert.match(await page.locator('#gpxConfirmStatus').textContent(), /紐づけ先のTripが変更/);
});

test('新規fingerprint: ファイル名変更は同一Trip内で置換、時刻と距離が似た別軌跡は登録できる', async t => {
  const page = await open(t);
  await analyze(page);
  await select(page, ['237']);
  const first = await saveAndMap(page, 2);
  const oldHash = first[1].materialImports[0].gpx[0].trackFingerprint;
  assert.match(oldHash, /^sha256-track-v1:/);
  await page.goto(base + '/gpx-import.html?trip=1');
  await analyze(page, { name: 'renamed.gpx', mimeType: 'text/xml', buffer: gpx() });
  await select(page, ['237']);
  const replaced = await saveAndMap(page, 2);
  assert.equal(replaced[1].materialImports.length, 1);
  assert.equal(replaced[1].routeSegments.length, 1);
  assert.equal(replaced[1].materialImports[0].gpx[0].trackFingerprint, oldHash);
  await page.goto(base + '/gpx-import.html');
  await analyze(page, { name: 'different.gpx', mimeType: 'text/xml', buffer: gpx(.000005) });
  await select(page, ['237']);
  const distinct = await saveAndMap(page, 3);
  assert.notEqual(distinct[2].materialImports[0].gpx[0].trackFingerprint, oldHash);
});

test('再解析中はファイル・Trip変更と前回候補の保存を禁止', async t => {
  const page = await open(t);
  await analyze(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/data/geojson/*.geojson', async r => { await gate; await r.fulfill({ json: geojson }); });
  await page.locator('#gpxAnalyze').click();
  await page.waitForFunction(() => document.getElementById('gpxFile').disabled);
  assert.equal(await page.locator('#gpxTripSelect').isDisabled(), true);
  assert.equal(await page.locator('#gpxSaveConfirmed').isDisabled(), true);
  await page.evaluate(() => document.getElementById('gpxSaveConfirmed').dispatchEvent(new Event('click')));
  assert.deepEqual(await snapshot(page), seed);
  release();
  await page.waitForFunction(() => document.getElementById('gpxStatus').textContent.startsWith('解析完了'));
  assert.equal(await page.locator('#gpxFile').isDisabled(), false);
  assert.equal(await page.locator('#gpxTripSelect').isDisabled(), false);
});

test('復元書込み自体が失敗した場合は成功や未変更を表示しない', async t => {
  const page = await open(t);
  await analyze(page);
  await select(page, ['237']);
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem, originalGet = Storage.prototype.getItem;
    let writes = 0, failRead = false;
    Storage.prototype.setItem = function(k, v) {
      if (k === 'hokkaido48Trips' && ++writes > 1) throw new DOMException('rollback blocked', 'QuotaExceededError');
      const result = originalSet.call(this, k, v); if (k === 'hokkaido48Trips') failRead = true; return result;
    };
    Storage.prototype.getItem = function(k) { if (k === 'hokkaido48Trips' && failRead) { failRead = false; return '[]'; } return originalGet.call(this, k); };
  });
  await page.locator('#gpxSaveConfirmed').click();
  const message = await page.locator('#gpxConfirmStatus').textContent();
  assert.match(message, /自動復元を完了できませんでした/);
  assert.doesNotMatch(message, /データは変更されていません|復元しました/);
  assert.deepEqual(JSON.parse((await snapshot(page))[TRIPS])[0], JSON.parse(seed[TRIPS])[0]);
  for (const key of Object.keys(seed).filter(k => k !== TRIPS)) assert.equal((await snapshot(page))[key], seed[key]);
  assert.ok(page.url().endsWith('/gpx-import.html'));
});

test('同じTripの別GPX・音声資料・旧geometryを保持して置換する', async t => {
  const page = await open(t);
  await analyze(page);
  await select(page, ['237']);
  const initial = await saveAndMap(page, 2);
  const trip = initial[1];
  const otherGpx = { fileName: 'other.gpx', pointCount: 10, distanceKm: 1, sizeBytes: 100 };
  const audio = [{ fileName: 'voice.wav', note: '保持する' }];
  trip.materialImports[0].gpx.push(otherGpx);
  trip.materialImports[0].audio = audio;
  const legacy = { id: 'legacy', routeNumber: '237', source: 'v5-gpx-human-confirmed',
    confirmedPaths: [[[43, 141], [43.01, 141]]], completionStatus: '一部走破' };
  trip.routeSegments.push(legacy);
  // 旧geometryの路線番号一致だけで他GPXを置換しないことを検証する。
  trip.gpxRouteConfirmations[0].routeNumbers = [];
  await page.evaluate(trips => localStorage.setItem('hokkaido48Trips', JSON.stringify(trips)), initial);
  await page.goto(base + '/gpx-import.html?trip=1');
  await analyze(page, { name: 'renamed.gpx', mimeType: 'text/xml', buffer: gpx() });
  await select(page, ['237']);
  const saved = await saveAndMap(page, 2);
  assert.deepEqual(saved[1].materialImports[0].gpx, [otherGpx]);
  assert.deepEqual(saved[1].materialImports[0].audio, audio);
  assert.deepEqual(saved[1].routeSegments.find(s => s.id === 'legacy'), legacy);
  assert.equal(saved[1].routeSegments.length, 2);
});
