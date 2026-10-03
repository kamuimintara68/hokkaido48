const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const TRIPS = 'hokkaido48Trips';
const backupPath = process.env.GPX_BACKUP || path.join(__dirname, 'private-fixtures/backup-19.json');
const gpxPath = process.env.GPX_FIXTURE || path.join(__dirname, 'private-fixtures/20260927.gpx');
const iphoneBackupPath = process.env.IPHONE_BACKUP || path.join(__dirname, 'private-fixtures/iphone-18.json');
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

async function open(t, { storage = seed, synthetic = true, mobile = false, routeHandler, quotaBytes = null } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    isMobile: mobile, hasTouch: mobile, timezoneId: 'Asia/Tokyo' });
  t.after(() => context.close());
  // 初回のみseedをセット。アプリのlocalStorageをclear/removeしない。
  await context.addInitScript(({ values, quotaBytes }) => {
    if (!sessionStorage.getItem('testSeeded')) {
      Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
      sessionStorage.setItem('testSeeded', '1');
    }
    if (quotaBytes !== null) {
      const originalSet = Storage.prototype.setItem, originalGet = Storage.prototype.getItem;
      Storage.prototype.setItem = function(key, value) {
        const values = Object.fromEntries(Object.keys(localStorage).map(k => [k, originalGet.call(localStorage, k)]));
        values[String(key)] = String(value);
        const bytes = Object.entries(values).reduce((n, [k, v]) => n + 2 * (k.length + v.length), 0);
        if (this === localStorage && bytes > quotaBytes) throw new DOMException('UTF-16 quota', 'QuotaExceededError');
        return originalSet.call(this, key, value);
      };
    }
    window.__drawnPaths = [];
  }, {values: storage, quotaBytes});
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
      return r.fulfill({ contentType: 'application/javascript', body: source + '\nconst originalPolyline=L.polyline; L.polyline=function(points,options){window.__drawnPaths.push({points,options});return originalPolyline(points,options);}; const originalMap=L.map;L.map=function(...args){const map=originalMap(...args);window.__testMaps=window.__testMaps||{};window.__testMaps[typeof args[0]===\'string\'?args[0]:args[0].id]=map;return map;};' });
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
  await page.goto(base + '/v5.html');
  await page.waitForFunction(() => document.getElementById('homeRecordMessage').textContent.includes('確定実走線'));
  const existingMapPaths = await page.evaluate(() => window.__drawnPaths.filter(p => p.options?.pane === 'homeRecordActual').map(p => p.points));
  assert.ok(existingMapPaths.length > 0, '保存前の既存実走線を取得');
  await page.goto(base + '/gpx-import.html');
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
  const originalTargetPaths = (original[18].routeSegments || []).flatMap(s => s.confirmedGeometry ? decode(s.confirmedGeometry) : s.confirmedPaths || (s.confirmedPath ? [s.confirmedPath] : []));
  const replacedPaths = new Set(originalTargetPaths.map(p => JSON.stringify(p)));
  for (const line of existingMapPaths.filter(p => !replacedPaths.has(JSON.stringify(p)))) {
    assert.ok(actual.some(p => JSON.stringify(p) === JSON.stringify(line)), '対象外の既存実走線を保存後も地図に描画');
  }
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

test('iPhone実18Trip: UTF-16の5MiB制限内で9/27 GPXを新規保存し既存記録を保持',
  { timeout: 180000, skip: !fs.existsSync(gpxPath) || !fs.existsSync(iphoneBackupPath) }, async t => {
  const storage = JSON.parse(fs.readFileSync(iphoneBackupPath)).storage;
  const original = JSON.parse(storage[TRIPS]);
  assert.equal(original.length, 18);
  const page = await open(t, { storage, synthetic: false, mobile: true, quotaBytes: 5 * 1024 * 1024 });
  await analyze(page, gpxPath);
  await select(page, ['237', '38', '274', '242', '336']);
  await page.locator('#gpxSaveConfirmed').click();
  await page.waitForFunction(() => location.pathname.endsWith('/v5.html') || document.getElementById('gpxConfirmStatus')?.textContent.includes('保存容量が不足'));
  if (page.url().includes('gpx-import.html')) {
    const failed = await page.evaluate(() => ({ bytes: window.__failedBytes, candidate: window.__failedCandidate }));
    assert.fail(`新規保存に必要な容量 ${failed.bytes} bytes が5MiBを超えた`);
  }
  await page.waitForFunction(() => document.getElementById('homeRecordMessage').textContent.includes('確定実走線'));
  const after = await snapshot(page);
  const saved = JSON.parse(after[TRIPS]);
  assert.equal(saved.length, 19);
  assert.deepEqual(saved.slice(0, 18), original, '既存18Tripの全フィールド・geometryを保持');
  for (const key of Object.keys(storage).filter(k => k !== TRIPS)) assert.equal(after[key], storage[key]);
  // 修正前の9/27保存候補から取得。座標・頂点順・区間境界を含むハッシュ。
  const originalGeometryHashes = {
    '237': 'ca9dc5943e0306558d840e8876f1a8765e92b0f7ee29c2072d30a08e757cd230',
    '38': 'bee2d083114c79d78f5adc054d9c7ec5f7e21e72ad4e7f03bde8d29ee3154edf',
    '274': 'a755bbe28f5df2491c0d4e127d3a7d19d03a6de055f57f48dc196ed7edc90eed',
    '242': 'ce14f9d1fde89b2718f25586e254ec0654da948e15d5db928bb4c3171439fc36',
    '336': 'abca593b0dca9c02215dfe646e194ed82e6211088e3a1b40cf065d2dc6540ade'
  };
  assert.equal(saved[18].materialImports[0].gpx[0].previewTrack.length, 100);
  assert.equal(saved[18].materialImports[0].gpx[0].pointCount, 28390);
  assert.equal(saved[18].routeSegments.length, 5);
  const usedBytes = await page.evaluate(() => Object.entries(localStorage).reduce((n,[k,v]) => n+2*(k.length+v.length),0));
  assert.ok(usedBytes < 5 * 1024 * 1024, `保存後 ${usedBytes} bytes`);
  t.diagnostic(`保存後UTF-16 ${usedBytes} bytes / 空き ${5 * 1024 * 1024 - usedBytes} bytes`);
  for (const segment of saved[18].routeSegments) {
    assert.equal(createHash('sha256').update(JSON.stringify(decode(segment.confirmedGeometry))).digest('hex'), originalGeometryHashes[segment.routeNumber], '全頂点・座標・区間の穴を修正前と完全一致');
  }
  const actual = await page.evaluate(() => window.__drawnPaths.filter(p => p.options?.pane === 'homeRecordActual').map(p => p.points));
  for (const segment of saved[18].routeSegments) for (const line of decode(segment.confirmedGeometry)) {
    assert.ok(actual.some(p => JSON.stringify(p) === JSON.stringify(line)), '新規区間を実地図で描画');
  }
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
  const beforeHumanConfirmation = await snapshot(page);
  await page.locator('#rsSave').click();
  const afterHumanConfirmation = await snapshot(page);
  const humanStatus = JSON.parse(afterHumanConfirmation.hokkaido48V5ConfirmedRouteStatus);
  assert.deepEqual(humanStatus['38'], JSON.parse(beforeHumanConfirmation.hokkaido48V5ConfirmedRouteStatus)['38'], '他路線の確定状態を保持');
  for (const key of Object.keys(beforeHumanConfirmation).filter(k => k !== 'hokkaido48V5ConfirmedRouteStatus')) {
    assert.equal(afterHumanConfirmation[key], beforeHumanConfirmation[key], '確定時にTrip・geometry・他キーを保持');
  }
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

test('完走容量: 残り21路線の全頂点を各4回・84Trip追加＋512KiB予備から新規GPX保存・地図・バックアップ・クラウド形式',
  {timeout:240000, skip:!fs.existsSync(iphoneBackupPath)},async t=>{
  const {model}=require('./capacity-model.cjs');
  const {codec}=require('./storage-codec.cjs');
  const {window}=codec();
  const backup=JSON.parse(fs.readFileSync(iphoneBackupPath));
  const m=model(backup,4);
  assert.equal(m.remaining.length,21);assert.equal(m.trips.length,102);
  const packed=window.Hokkaido48TripStorage.encode(m.raw);
  const storage={...backup.storage,[TRIPS]:packed,capacityReserve:'R'.repeat(256*1024)};
  const page=await open(t,{storage,quotaBytes:5*1024*1024,mobile:true});
  await analyze(page);await select(page,['237']);
  const saved=await saveAndMap(page,103);
  assert.deepEqual(saved.slice(0,102),m.trips,'既存Trip・全頂点の文字列まで不変');
  const physical=await page.evaluate(()=>Object.entries(localStorage).reduce((n,[k,v])=>n+2*(k.length+v.length),0));
  assert.ok(physical<5*1024*1024);assert.ok(5*1024*1024-physical>1024*1024,'予備512KiBとは別に1MiB以上空き');
  t.diagnostic(`84Trip追加・さらに新規保存後 ${physical} bytes（512KiB予備込み）、空き ${5*1024*1024-physical} bytes`);
  const after=await snapshot(page);
  for(const [key,value]of Object.entries(storage).filter(([key])=>key!==TRIPS))assert.equal(after[key],value);
  const newPaths=decode(saved[102].routeSegments[0].confirmedGeometry);
  const mapPaths=await page.evaluate(()=>window.__drawnPaths.filter(p=>p.options?.pane==='homeRecordActual').map(p=>p.points));
  for(const line of newPaths)assert.ok(mapPaths.some(p=>JSON.stringify(p)===JSON.stringify(line)));
  // Backup export remains ordinary readable JSON, with exact full Trip fields.
  await page.goto(base+'/backup-v50.html');
  assert.match(await page.locator('#currentSummary').textContent(),/103件/);
  const download=page.waitForEvent('download');await page.locator('#exportButton').click();
  const artifact=await download;
  const exported=JSON.parse(fs.readFileSync(await artifact.path(),'utf8'));
  assert.deepEqual(JSON.parse(exported.storage[TRIPS]),saved);
  assert.ok(exported.storage[TRIPS].startsWith('['),'圧縮文字列をクラウド・バックアップへ流さない');
  // Test the actual existing synchronization serializer without a network client.
  await page.addScriptTag({path:path.join(root,'js/v5-cloud-sync.js')});
  const cloud=await page.evaluate(()=>window.Hokkaido48CloudSync.collectLocalData());
  const normalized=await page.evaluate(b=>window.Hokkaido48CloudSync.normalizePayload(b),{storage:exported.storage});
  assert.equal(cloud.storage[TRIPS],normalized.storage[TRIPS]);
  assert.equal(JSON.parse(cloud.storage[TRIPS]).length,103);
  assert.deepEqual(await snapshot(page),after,'バックアップ・同期形式検証は端末データを変更しない');
  // Actual V4 reader compatibility, without invoking its editing controls.
  await page.addScriptTag({path:path.join(root,'js/trip-data-v36.js')});
  const legacy=await page.evaluate(()=>window.Hokkaido48TripData.getTrips());
  assert.equal(legacy.length,103);
});

async function clickHomeRoute(page) {
  await page.locator('#homeRecordMap').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.__testMaps.homeRecordMap.setView([43,141.1],10,{animate:false}));
  await page.waitForFunction(()=>!window.__testMaps.homeRecordMap._animatingZoom&&!window.__testMaps.homeRecordMap._panAnim?._inProgress);
  const box=await page.locator('#homeRecordMap').boundingBox();
  const point=await page.evaluate(()=>{const p=window.__testMaps.homeRecordMap.latLngToContainerPoint([43,141.1]);return{x:p.x,y:p.y};});
  await page.mouse.click(box.x+point.x,box.y+point.y);
  await page.locator('#homePlannerEditStatus').waitFor({state:'visible'});
}
const cityRoute={...route,completionRule:{type:'city-arrival-accepted',note:'起点・終点が市の場合は、該当市内への到達で可'}};
test('ホーム地図を実クリック→市内ルール表示→候補外路線を手動全線→ホームで緑、Trip・geometry・他路線を保持',async t=>{
  const storage={...seed,[TRIPS]:JSON.stringify([...JSON.parse(seed[TRIPS]),{id:'partial-city',tripName:'市内確認',memo:'保持する🚗'.repeat(2000),
    confirmedRouteNumbers:['237'],routeSegments:[{routeNumber:'237',completionStatus:'一部走破',confirmedPaths:[road.slice(0,20).map(([lon,lat])=>[lat,lon])]}]}])};
  const page=await open(t,{storage,mobile:true,routeHandler:r=>r.fulfill({json:[cityRoute]})});
  await page.evaluate(()=>localStorage.setItem('hokkaido48Trips',localStorage.getItem('hokkaido48Trips')));
  const before=await snapshot(page);
  const beforePhysical=await page.evaluate(()=>localStorage.hokkaido48Trips);
  assert.ok(beforePhysical.startsWith('hokkaido48-lz16-v1:'));
  await page.goto(base+'/v5.html');
  await page.waitForFunction(()=>document.getElementById('homeRecordMessage').textContent.includes('確定実走線'));
  await clickHomeRoute(page);
  assert.equal(await page.locator('#homePlannerRouteStatus').textContent(),'一部走破');
  await page.locator('#homePlannerEditStatus').click();
  await page.waitForURL('**/route-status.html?route=237');
  await page.locator('select[data-route="237"]').waitFor({state:'visible'});
  assert.match(await page.locator('#rsTripSummary').textContent(),/市内への到達で可/);
  assert.equal(await page.locator('#rsTripSelect').isVisible(),false,'旅選択は不要');
  assert.equal(await page.locator('select[data-route="237"]').inputValue(),'一部走破','自動全線昇格しない');
  await page.locator('select[data-route="237"]').selectOption('全線走破');await page.locator('#rsSave').click();
  assert.match(await page.locator('#rsMessage').textContent(),/修正しました/);
  const after=await snapshot(page);
  assert.deepEqual(JSON.parse(after.hokkaido48V5ManualRouteStatus),{'38':'全線走破','237':'全線走破'});
  for(const key of Object.keys(before).filter(k=>k!=='hokkaido48V5ManualRouteStatus'))assert.equal(after[key],before[key]);
  assert.equal(await page.evaluate(()=>localStorage.hokkaido48Trips),beforePhysical,'圧縮物理データも不変');
  await page.getByRole('link',{name:'ホーム地図で確認',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('homeRecordMessage').textContent.includes('確定実走線'));
  await clickHomeRoute(page);assert.equal(await page.locator('#homePlannerRouteStatus').textContent(),'全線走破');
  assert.equal(await page.locator('.home-record-route-icon span.complete').textContent(),'237');
  await page.locator('#homePlannerEditStatus').click();await page.locator('select[data-route="237"]').waitFor({state:'visible'});
  await page.locator('select[data-route="237"]').selectOption('一部走破');await page.locator('#rsSave').click();
  assert.equal(JSON.parse((await snapshot(page)).hokkaido48V5ManualRouteStatus)['237'],'一部走破','本人の明示操作では修正し直せる');
});

test('路線の直接修正: キャンセル・容量失敗・競合・破損した状態データを上書きしない',async t=>{
  const page=await open(t);
  await page.goto(base+'/route-status.html?route=237');await page.locator('select[data-route="237"]').waitFor({state:'visible'});
  await page.locator('select[data-route="237"]').selectOption('全線走破');
  page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss());
  await page.locator('#rsSave').click();assert.deepEqual(await snapshot(page),seed);
  page.on('dialog',d=>d.accept());
  await page.evaluate(()=>{window.__set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='hokkaido48V5ManualRouteStatus')throw new DOMException('quota','QuotaExceededError');return window.__set.call(this,k,v)};});
  await page.locator('#rsSave').click();assert.match(await page.locator('#rsMessage').textContent(),/元の走破状態は保持/);assert.deepEqual(await snapshot(page),seed);
  await page.evaluate(()=>{Storage.prototype.setItem=window.__set;window.confirm=()=>{localStorage.setItem('hokkaido48V5ManualRouteStatus','{"38":"全線走破","39":"全線走破"}');return true;};});
  await page.locator('#rsSave').click();assert.match(await page.locator('#rsMessage').textContent(),/別画面/);
  assert.deepEqual(JSON.parse((await snapshot(page)).hokkaido48V5ManualRouteStatus),{'38':'全線走破','39':'全線走破'});
  await page.evaluate(()=>localStorage.setItem('hokkaido48V5ManualRouteStatus','{broken'));
  await page.locator('#rsSave').click();assert.match(await page.locator('#rsMessage').textContent(),/保存データを確認できない/);
  assert.equal((await snapshot(page)).hokkaido48V5ManualRouteStatus,'{broken');
});

test('路線直接修正: Tripがなくても本人判断で設定、未登録・不正な路線は保存不可',async t=>{
  const page=await open(t,{storage:{}});
  await page.goto(base+'/route-status.html?route=237');await page.locator('select[data-route="237"]').waitFor({state:'visible'});
  await page.locator('select[data-route="237"]').selectOption('全線走破');await page.locator('#rsSave').click();
  assert.deepEqual(await snapshot(page),{hokkaido48V5ManualRouteStatus:'{"237":"全線走破"}'});
  await page.locator('select[data-route="237"]').selectOption('未走破');await page.locator('#rsSave').click();
  assert.equal(JSON.parse((await snapshot(page)).hokkaido48V5ManualRouteStatus)['237'],'未走破');
  for(const q of ['999','invalid']){
    await page.goto(base+'/route-status.html?route='+q);
    await page.waitForFunction(()=>document.getElementById('rsRouteList').textContent.includes('指定した路線'));
    assert.equal(await page.locator('#rsSave').isDisabled(),true);assert.equal(await page.locator('select[data-route]').count(),0);
  }
});
