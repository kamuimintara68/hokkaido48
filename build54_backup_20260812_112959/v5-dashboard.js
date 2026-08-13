"use strict";
(function () {
  const ROUTE_URL = "data/routes-v50.json";
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
  const TRIPS_KEY = "hokkaido48Trips";
  const MANUAL_STATUS_KEY = "hokkaido48V5ManualRouteStatus";
  const CONFIRMED_STATUS_KEY = "hokkaido48V5ConfirmedRouteStatus";
  const VALID_STATUSES = ["未走破", "一部走破", "全線走破"];
  const mapEl = document.getElementById("homeRecordMap");
  const summaryEl = document.getElementById("homeRecordSummary");
  const messageEl = document.getElementById("homeRecordMessage");
  const fitButton = document.getElementById("homeRecordFit");
  if (!mapEl || typeof L === "undefined") return;

  let map, baseGroup, actualGroup, labelGroup, fullBounds = null;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readConfirmedStatuses() {
    const value = readJson(CONFIRMED_STATUS_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function readManualStatuses() {
    const value = readJson(MANUAL_STATUS_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function loadTrips() {
    const value = readJson(TRIPS_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function normalizePath(path) {
    if (!Array.isArray(path)) return [];
    return path
      .filter(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(point => [Number(point[0]), Number(point[1])]);
  }

  function segmentPaths(segment) {
    const paths = [];
    if (Array.isArray(segment && segment.confirmedPaths)) {
      segment.confirmedPaths.forEach(path => {
        const normalized = normalizePath(path);
        if (normalized.length > 1) paths.push(normalized);
      });
    }
    if (!paths.length && Array.isArray(segment && segment.confirmedPath)) {
      const normalized = normalizePath(segment.confirmedPath);
      if (normalized.length > 1) paths.push(normalized);
    }
    return paths;
  }

  function confirmationPaths(trip, routeNumber) {
    const paths = [];
    const confirmations = Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : [];
    confirmations.forEach(confirmation => {
      const routes = Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : [];
      routes.forEach(route => {
        if (String(route && (route.routeNumber ?? route.number) || "") !== String(routeNumber)) return;
        const confirmedPaths = Array.isArray(route && route.confirmedPaths) ? route.confirmedPaths : [];
        confirmedPaths.forEach(path => {
          const normalized = normalizePath(path);
          if (normalized.length > 1) paths.push(normalized);
        });
      });
    });
    return paths;
  }

  function buildActualPathsByRoute(trips) {
    const byRoute = new Map();
    function add(number, path) {
      const key = String(number || "");
      if (!key || path.length < 2) return;
      if (!byRoute.has(key)) byRoute.set(key, []);
      byRoute.get(key).push(path);
    }
    trips.forEach(trip => {
      const segments = Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : [];
      const segmentPathNumbers = new Set();
      segments.forEach(segment => {
        const number = String(segment && segment.routeNumber || "");
        if (!number) return;
        const confirmed = segmentPaths(segment);
        if (confirmed.length) segmentPathNumbers.add(number);
        confirmed.forEach(path => add(number, path));
      });
      const confirmationNumbers = new Set();
      const confirmations = Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : [];
      confirmations.forEach(confirmation => {
        const numbers = Array.isArray(confirmation && confirmation.routeNumbers) ? confirmation.routeNumbers : [];
        numbers.forEach(number => confirmationNumbers.add(String(number)));
        const items = Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : [];
        items.forEach(item => {
          const number = String(item && (item.routeNumber ?? item.number) || "");
          if (number) confirmationNumbers.add(number);
        });
      });
      confirmationNumbers.forEach(number => {
        // routeSegments側に確定線がある場合は同じV5確定線を二重描画しない。
        if (segmentPathNumbers.has(number)) return;
        confirmationPaths(trip, number).forEach(path => add(number, path));
      });
    });
    return byRoute;
  }

  function statusStyle(status) {
    if (status === "全線走破") return { color: "#16a34a", weight: 5, opacity: .9 };
    return { color: "#64748b", weight: 3.2, opacity: status === "一部走破" ? .55 : .62 };
  }

  function collectLines(node, out = []) {
    if (!node || typeof node !== "object") return out;
    if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
      node.features.forEach(feature => collectLines(feature, out));
    } else if (node.type === "Feature") {
      collectLines(node.geometry, out);
    } else if (node.type === "LineString" && Array.isArray(node.coordinates)) {
      out.push(node.coordinates);
    } else if (node.type === "MultiLineString" && Array.isArray(node.coordinates)) {
      node.coordinates.forEach(line => { if (Array.isArray(line)) out.push(line); });
    }
    return out;
  }

  function longestLineMidpoint(geojson, fallback) {
    const lines = collectLines(geojson).filter(line => Array.isArray(line) && line.length >= 2);
    let best = null;
    for (const line of lines) {
      const pts = line.map(p => L.latLng(Number(p[1]), Number(p[0]))).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (pts.length < 2) continue;
      let total = 0;
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const m = pts[i - 1].distanceTo(pts[i]);
        segs.push(m); total += m;
      }
      if (!best || total > best.total) best = { pts, segs, total };
    }
    if (!best) return fallback;
    const target = best.total / 2;
    let moved = 0;
    for (let i = 0; i < best.segs.length; i++) {
      const next = moved + best.segs[i];
      if (next >= target) {
        const r = best.segs[i] ? (target - moved) / best.segs[i] : 0;
        return L.latLng(
          best.pts[i].lat + (best.pts[i + 1].lat - best.pts[i].lat) * r,
          best.pts[i].lng + (best.pts[i + 1].lng - best.pts[i].lng) * r
        );
      }
      moved = next;
    }
    return best.pts[best.pts.length - 1];
  }

  function longestActualPathMidpoint(paths, fallback) {
    let best = null;
    (Array.isArray(paths) ? paths : []).forEach(path => {
      const pts = normalizePath(path).map(p => L.latLng(p[0], p[1]));
      if (pts.length < 2) return;
      let total = 0;
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const m = pts[i - 1].distanceTo(pts[i]);
        segs.push(m); total += m;
      }
      if (!best || total > best.total) best = { pts, segs, total };
    });
    if (!best) return fallback;
    const target = best.total / 2;
    let moved = 0;
    for (let i = 0; i < best.segs.length; i++) {
      const next = moved + best.segs[i];
      if (next >= target) {
        const r = best.segs[i] ? (target - moved) / best.segs[i] : 0;
        return L.latLng(
          best.pts[i].lat + (best.pts[i + 1].lat - best.pts[i].lat) * r,
          best.pts[i].lng + (best.pts[i + 1].lng - best.pts[i].lng) * r
        );
      }
      moved = next;
    }
    return best.pts[best.pts.length - 1];
  }

  function renderSummary(routes) {
    const counts = { "未走破": 0, "一部走破": 0, "全線走破": 0 };
    routes.forEach(route => { if (counts[route.displayStatusPreview] !== undefined) counts[route.displayStatusPreview] += 1; });
    summaryEl.innerHTML = `
      <div class="home-record-stat untraveled"><strong>${counts["未走破"]}</strong><span>未走破</span></div>
      <div class="home-record-stat partial"><strong>${counts["一部走破"]}</strong><span>一部走破</span></div>
      <div class="home-record-stat complete"><strong>${counts["全線走破"]}</strong><span>全線走破</span></div>`;
  }

  function initMap() {
    map = L.map(mapEl, { zoomControl: true, preferCanvas: true }).setView([43.55, 142.45], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    map.createPane("homeRecordActual");
    map.getPane("homeRecordActual").style.zIndex = 450;
    map.createPane("homeRecordLabels");
    map.getPane("homeRecordLabels").style.zIndex = 620;
    map.getPane("homeRecordLabels").style.pointerEvents = "none";
    baseGroup = L.layerGroup().addTo(map);
    actualGroup = L.layerGroup().addTo(map);
    labelGroup = L.layerGroup().addTo(map);
  }

  async function render() {
    messageEl.textContent = "走破記録マップを読み込んでいます…";
    baseGroup.clearLayers();
    actualGroup.clearLayers();
    labelGroup.clearLayers();
    fullBounds = null;

    const response = await fetch(ROUTE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("路線データを読み込めませんでした。");
    const data = await response.json();
    const confirmed = readConfirmedStatuses();
    const manual = readManualStatuses();
    const trips = loadTrips();
    const actualPathsByRoute = buildActualPathsByRoute(trips);

    const routes = (Array.isArray(data) ? data : []).filter(route => route.challengeTarget !== false).map(route => {
      const copy = { ...route };
      const number = String(copy.number);
      const paths = actualPathsByRoute.get(number) || [];
      const entry = confirmed[number];
      const confirmedStatus = typeof entry === "string" ? entry : entry && entry.status;
      const manualStatus = manual[number];
      const hasConfirmedStatus = VALID_STATUSES.includes(confirmedStatus);
      const hasManualStatus = VALID_STATUSES.includes(manualStatus);

      // Tripに人間確定済みの実走線がある場合、未確定Routeを最低でも「一部走破」として表示する。
      // ただしV5走破確定・手動状態がある場合は、そちらを正本として優先する。
      if (!hasConfirmedStatus && !hasManualStatus && paths.length && copy.displayStatusPreview !== "全線走破") {
        copy.displayStatusPreview = "一部走破";
        copy.statusSource = "Trip実走線";
      }
      if (hasConfirmedStatus) {
        copy.displayStatusPreview = confirmedStatus;
        copy.statusSource = "V5走破確定";
      }
      if (hasManualStatus) {
        copy.displayStatusPreview = manualStatus;
        copy.statusSource = "手動";
      }
      copy.actualPaths = paths;
      return copy;
    });
    renderSummary(routes);

    let loaded = 0;
    let actualPathCount = 0;
    const results = await Promise.allSettled(routes.map(async route => {
      const r = await fetch(GEOJSON_PATH(route.number), { cache: "no-store" });
      if (!r.ok) throw new Error(String(route.number));
      const geojson = await r.json();
      const layer = L.geoJSON(geojson, { style: statusStyle(route.displayStatusPreview) }).addTo(baseGroup);
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) fullBounds = fullBounds ? fullBounds.extend(bounds) : bounds;

      const paths = route.displayStatusPreview === "一部走破" ? route.actualPaths : [];
      paths.forEach(path => {
        const actual = L.polyline(path, {
          pane: "homeRecordActual",
          color: "#f97316",
          weight: 6,
          opacity: .98,
          interactive: false
        }).addTo(actualGroup);
        actualPathCount += 1;
        const actualBounds = actual.getBounds();
        if (actualBounds.isValid()) fullBounds = fullBounds ? fullBounds.extend(actualBounds) : actualBounds;
      });

      const detail = route.displayStatusPreview === "一部走破"
        ? (paths.length ? "<br><small>橙＝確定実走区間／灰＝未走破を含む国道全体</small>" : "<br><small>確定実走線の保存データなし</small>")
        : "";
      layer.bindPopup(`<strong>国道${route.number}号</strong><br>${route.start} → ${route.end}<br><b>${route.displayStatusPreview}</b>${detail}`);

      if (route.displayStatusPreview !== "未走破" && bounds && bounds.isValid()) {
        const fallback = longestLineMidpoint(geojson, bounds.getCenter());
        const point = route.displayStatusPreview === "一部走破" && paths.length
          ? longestActualPathMidpoint(paths, fallback)
          : fallback;
        const icon = L.divIcon({
          className: "home-record-route-icon",
          html: `<span class="${route.displayStatusPreview === "全線走破" ? "complete" : "partial"}">${route.number}</span>`,
          iconSize: [42, 24], iconAnchor: [21, 12]
        });
        L.marker(point, { icon, pane: "homeRecordLabels", interactive: false }).addTo(labelGroup);
      }
      loaded += 1;
    }));
    if (fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [16, 16], maxZoom: 7 });
    const failed = results.filter(item => item.status === "rejected").length;
    const baseText = failed
      ? `${loaded}路線を表示。${failed}路線の地図データを読み込めませんでした。`
      : `${loaded}路線の現在の走破記録を表示しています。`;
    messageEl.textContent = `${baseText} 緑＝全線走破、橙＝確定実走区間、灰＝未走破または残り区間。確定実走線 ${actualPathCount}区間を反映。`;
    setTimeout(() => map.invalidateSize(), 80);
  }

  initMap();
  fitButton?.addEventListener("click", () => { if (fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [16, 16], maxZoom: 7 }); });
  render().catch(error => { console.error(error); messageEl.textContent = error.message || "走破記録マップを表示できませんでした。"; });
})();
