"use strict";

(function () {
  const ROUTE_DATA_URL = "data/routes-v50.json";
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
  const TRIPS_KEY = "hokkaido48Trips";
  const DRAFT_KEY = "hokkaido48V50JourneyDraft";
  const MANUAL_STATUS_KEY = "hokkaido48V5ManualRouteStatus";
  const CONFIRMED_STATUS_KEY = "hokkaido48V5ConfirmedRouteStatus";
  const PATH_ENCODING = "delta-base36-e9-v1";
  const VALID_STATUSES = ["未走破", "一部走破", "全線走破"];
  const HIT_DISTANCE_METERS = 85;

  const el = id => document.getElementById(id);
  const dom = {
    map: el("plannerMap"), message: el("plannerMapMessage"), fit: el("plannerFit"), locate: el("plannerLocate"),
    filters: el("plannerFilters"), actual: el("plannerActualPaths"), empty: el("plannerInfoEmpty"), info: el("plannerRouteInfo"),
    number: el("plannerRouteNumber"), status: el("plannerRouteStatus"), title: el("plannerRouteTitle"),
    start: el("plannerRouteStart"), end: el("plannerRouteEnd"), total: el("plannerRouteTotal"),
    traveled: el("plannerRouteTraveled"), remaining: el("plannerRouteRemaining"), progress: el("plannerRouteProgress"),
    rule: el("plannerRouteRule"), relatedCount: el("plannerRelatedCount"), relatedTrips: el("plannerRelatedTrips"),
    shared: el("plannerSharedRoutes"), toggle: el("plannerToggleCandidate"),
    clear: el("plannerClearCandidates"), candidateEmpty: el("plannerCandidateEmpty"),
    candidateList: el("plannerCandidateList"), candidateActions: el("plannerCandidateActions"), saveState: el("plannerSaveState"),
    candidateHint: el("plannerCandidateHint"), candidateCount: el("plannerCandidateCount")
  };
  if (!dom.map || typeof L === "undefined") return;

  let routes = [];
  let trips = [];
  let models = [];
  let selectedNumbers = [];
  let activeNumber = "";
  let activeNearbyNumbers = [];
  let currentFilter = "remaining";
  let map;
  let routeGroup;
  let actualGroup;
  let candidateGroup;
  let focusGroup;
  let labelGroup;
  let clickGroup;
  let locationGroup;
  let fullBounds = null;
  const actualPathsByRoute = new Map();
  const fallbackMetersByRoute = new Map();

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function statusClass(status) {
    if (status === "全線走破") return "complete";
    if (status === "一部走破") return "partial";
    return "untraveled";
  }

  function normalizePath(path) {
    if (!Array.isArray(path)) return [];
    return path
      .filter(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(point => [Number(point[0]), Number(point[1])]);
  }

  function decodeConfirmedGeometry(holder) {
    const geometry = holder && holder.confirmedGeometry;
    if (!geometry || geometry.format !== PATH_ENCODING || !Array.isArray(geometry.paths)) return [];
    const scale = Number(geometry.scale) || 1000000000;
    return geometry.paths.map(encoded => {
      let lat = 0;
      let lon = 0;
      return String(encoded || "").split(",").map((token, index) => {
        const pair = token.split(":");
        if (pair.length !== 2) return null;
        const a = parseInt(pair[0], 36);
        const b = parseInt(pair[1], 36);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        if (index === 0) { lat = a; lon = b; } else { lat += a; lon += b; }
        return [lat / scale, lon / scale];
      }).filter(Boolean);
    }).filter(path => path.length > 1);
  }

  function segmentPaths(segment) {
    const paths = decodeConfirmedGeometry(segment);
    (Array.isArray(segment && segment.confirmedPaths) ? segment.confirmedPaths : []).forEach(path => {
      const normalized = normalizePath(path);
      if (normalized.length > 1) paths.push(normalized);
    });
    if (!paths.length && Array.isArray(segment && segment.confirmedPath)) {
      const normalized = normalizePath(segment.confirmedPath);
      if (normalized.length > 1) paths.push(normalized);
    }
    return paths;
  }

  function confirmationPaths(trip, routeNumber) {
    const paths = [];
    (Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : []).forEach(confirmation => {
      (Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : []).forEach(item => {
        if (String(item && (item.routeNumber ?? item.number) || "") !== String(routeNumber)) return;
        paths.push(...decodeConfirmedGeometry(item));
        (Array.isArray(item && item.confirmedPaths) ? item.confirmedPaths : []).forEach(path => {
          const normalized = normalizePath(path);
          if (normalized.length > 1) paths.push(normalized);
        });
      });
    });
    return paths;
  }

  function addActualPath(number, path) {
    const key = String(number || "");
    if (!key || path.length < 2) return;
    if (!actualPathsByRoute.has(key)) actualPathsByRoute.set(key, []);
    actualPathsByRoute.get(key).push(path);
  }

  function buildTripEvidence() {
    actualPathsByRoute.clear();
    fallbackMetersByRoute.clear();
    trips.forEach(trip => {
      const segmentNumbers = new Set();
      (Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : []).forEach(segment => {
        const number = String(segment && segment.routeNumber || "");
        if (!number) return;
        const paths = segmentPaths(segment);
        if (paths.length) segmentNumbers.add(number);
        paths.forEach(path => addActualPath(number, path));
        const fallbackKm = Number(segment && segment.confirmedDistanceKm);
        if (!paths.length && Number.isFinite(fallbackKm) && fallbackKm > 0) {
          fallbackMetersByRoute.set(number, (fallbackMetersByRoute.get(number) || 0) + fallbackKm * 1000);
        }
      });

      const confirmationNumbers = new Set();
      (Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : []).forEach(confirmation => {
        (Array.isArray(confirmation && confirmation.routeNumbers) ? confirmation.routeNumbers : []).forEach(number => confirmationNumbers.add(String(number)));
        (Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : []).forEach(item => {
          const number = String(item && (item.routeNumber ?? item.number) || "");
          if (number) confirmationNumbers.add(number);
        });
      });
      confirmationNumbers.forEach(number => {
        if (segmentNumbers.has(number)) return;
        confirmationPaths(trip, number).forEach(path => addActualPath(number, path));
      });
    });
  }

  function applyStoredStatuses() {
    const confirmed = readJson(CONFIRMED_STATUS_KEY, {});
    const manual = readJson(MANUAL_STATUS_KEY, {});
    const tripStatuses = new Map();
    trips.forEach(trip => {
      (Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : []).forEach(segment => {
        const number = String(segment && segment.routeNumber || "");
        const status = String(segment && segment.completionStatus || "");
        if (!number || !VALID_STATUSES.includes(status)) return;
        const previous = tripStatuses.get(number);
        if (status === "全線走破" || !previous) tripStatuses.set(number, status);
      });
    });
    routes.forEach(route => {
      const number = String(route.number);
      if (route.challengeTarget === false) return;
      const tripStatus = tripStatuses.get(number);
      const confirmedEntry = confirmed && confirmed[number];
      const confirmedStatus = typeof confirmedEntry === "string" ? confirmedEntry : confirmedEntry && confirmedEntry.status;
      const humanConfirmed = Boolean(confirmedEntry && typeof confirmedEntry === "object" && confirmedEntry.source === "v5-route-status-human-confirmed");
      const manualStatus = manual && manual[number];

      // 正本の優先順位をホームと統一する。
      // 手動指定 > 人が確定した例外 > 現行Trip判定 > 旧V5確定 > routes-v50既存状態。
      if (VALID_STATUSES.includes(manualStatus)) {
        route.displayStatusPreview = manualStatus;
        route.displayStatusSource = "manual";
      } else if (humanConfirmed && confirmedStatus === "全線走破") {
        route.displayStatusPreview = confirmedStatus;
        route.displayStatusSource = "human-confirmed";
      } else if (tripStatus === "全線走破") {
        route.displayStatusPreview = tripStatus;
        route.displayStatusSource = "trip-evidence";
      } else if (humanConfirmed && VALID_STATUSES.includes(confirmedStatus)) {
        route.displayStatusPreview = confirmedStatus;
        route.displayStatusSource = "human-confirmed";
      } else if (VALID_STATUSES.includes(tripStatus)) {
        route.displayStatusPreview = tripStatus;
        route.displayStatusSource = "trip-evidence";
      } else if (actualPathsByRoute.has(number) && route.displayStatusPreview !== "全線走破") {
        route.displayStatusPreview = "一部走破";
        route.displayStatusSource = "trip-path";
      } else if (VALID_STATUSES.includes(confirmedStatus)) {
        route.displayStatusPreview = confirmedStatus;
        route.displayStatusSource = "legacy-confirmed";
      }
    });
  }

  function collectLines(node, output = []) {
    if (!node || typeof node !== "object") return output;
    if (node.type === "FeatureCollection" && Array.isArray(node.features)) node.features.forEach(feature => collectLines(feature, output));
    else if (node.type === "Feature") collectLines(node.geometry, output);
    else if (node.type === "LineString" && Array.isArray(node.coordinates)) output.push(node.coordinates);
    else if (node.type === "MultiLineString" && Array.isArray(node.coordinates)) node.coordinates.forEach(line => { if (Array.isArray(line)) output.push(line); });
    return output;
  }

  function haversineMeters(a, b) {
    const rad = Math.PI / 180;
    const lat1 = Number(a[0]) * rad;
    const lat2 = Number(b[0]) * rad;
    const dLat = (Number(b[0]) - Number(a[0])) * rad;
    const dLon = (Number(b[1]) - Number(a[1])) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function pointKey(point) {
    return `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
  }

  function uniquePathDistanceMeters(paths) {
    const edges = new Set();
    let meters = 0;
    (Array.isArray(paths) ? paths : []).forEach(path => {
      const points = normalizePath(path);
      for (let index = 1; index < points.length; index += 1) {
        const a = pointKey(points[index - 1]);
        const b = pointKey(points[index]);
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (edges.has(edge)) continue;
        edges.add(edge);
        meters += haversineMeters(points[index - 1], points[index]);
      }
    });
    return meters;
  }

  function routeGeometryInfo(geojson) {
    const lines = collectLines(geojson).map(line => line
      .map(point => Array.isArray(point) ? [Number(point[1]), Number(point[0])] : null)
      .filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1])))
      .filter(line => line.length > 1);
    const ranked = lines.map(line => ({ line, meters: uniquePathDistanceMeters([line]) })).sort((a, b) => b.meters - a.meters);
    const main = ranked.length ? ranked[0].line : [];
    return {
      lines,
      totalMeters: uniquePathDistanceMeters(lines),
      startPoint: main.length ? main[0] : null,
      endPoint: main.length ? main[main.length - 1] : null,
      labelPoint: main.length ? pointAlongLine(main, .5) : null
    };
  }

  function pointAlongLine(line, fraction) {
    if (!line.length) return null;
    const segments = [];
    let total = 0;
    for (let index = 1; index < line.length; index += 1) {
      const meters = haversineMeters(line[index - 1], line[index]);
      segments.push(meters);
      total += meters;
    }
    const target = total * fraction;
    let moved = 0;
    for (let index = 0; index < segments.length; index += 1) {
      if (moved + segments[index] >= target) {
        const ratio = segments[index] ? (target - moved) / segments[index] : 0;
        return [
          line[index][0] + (line[index + 1][0] - line[index][0]) * ratio,
          line[index][1] + (line[index + 1][1] - line[index][1]) * ratio
        ];
      }
      moved += segments[index];
    }
    return line[line.length - 1];
  }

  function lineStyle(model) {
    if (model.route.displayStatusPreview === "全線走破") return { color: "#1c9a74", weight: 5, opacity: .9 };
    return { color: "#697786", weight: 4, opacity: model.route.displayStatusPreview === "一部走破" ? .55 : .78 };
  }

  function makeLabelIcon(model) {
    const number = String(model.route.number);
    const selected = selectedNumbers.includes(number);
    const focused = activeNumber === number && !selected;
    return L.divIcon({
      className: "planner-route-label-icon",
      html: `<span class="${statusClass(model.route.displayStatusPreview)}${selected ? " is-selected" : ""}${focused ? " is-active-route" : ""}">${escapeHtml(model.route.number)}</span>`,
      iconSize: null,
      iconAnchor: [20, 13]
    });
  }

  function initMap() {
    map = L.map(dom.map, { zoomControl: true, preferCanvas: true }).setView([43.45, 142.65], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    map.createPane("plannerActualPane");
    map.getPane("plannerActualPane").style.zIndex = 450;
    map.createPane("plannerCandidatePane");
    map.getPane("plannerCandidatePane").style.zIndex = 575;
    map.createPane("plannerFocusPane");
    map.getPane("plannerFocusPane").style.zIndex = 590;
    map.createPane("plannerLabelPane");
    map.getPane("plannerLabelPane").style.zIndex = 620;
    map.getPane("plannerLabelPane").style.pointerEvents = "none";
    map.createPane("plannerClickPane");
    map.getPane("plannerClickPane").style.zIndex = 650;
    routeGroup = L.layerGroup().addTo(map);
    actualGroup = L.layerGroup().addTo(map);
    candidateGroup = L.layerGroup().addTo(map);
    focusGroup = L.layerGroup().addTo(map);
    labelGroup = L.layerGroup().addTo(map);
    clickGroup = L.layerGroup().addTo(map);
    locationGroup = L.layerGroup().addTo(map);
    map.on("locationfound", event => {
      locationGroup.clearLayers();
      L.circle(event.latlng, { radius: Math.max(25, event.accuracy || 25), color: "#2474d2", weight: 1, fillColor: "#73b7ff", fillOpacity: .16, interactive: false }).addTo(locationGroup);
      L.circleMarker(event.latlng, { radius: 8, color: "#fff", weight: 3, fillColor: "#2474d2", fillOpacity: 1 }).bindTooltip("現在地").addTo(locationGroup);
      map.setView(event.latlng, 10);
      dom.message.textContent = "現在地を表示しました。近くの国道をタップしてください。";
    });
    map.on("locationerror", () => { dom.message.textContent = "現在地を取得できませんでした。端末の位置情報設定を確認してください。"; });
    setTimeout(() => map.invalidateSize(), 100);
  }

  async function loadRouteModel(route) {
    const response = await fetch(GEOJSON_PATH(route.number), { cache: "no-store" });
    if (!response.ok) throw new Error(`国道${route.number}号`);
    const geojson = await response.json();
    const geometry = routeGeometryInfo(geojson);
    const baseLayer = L.geoJSON(geojson, { style: lineStyle({ route }), interactive: false });
    const clickLayer = L.geoJSON(geojson, {
      pane: "plannerClickPane",
      style: { color: "transparent", weight: 24, opacity: 0, fillOpacity: 0 },
      onEachFeature: (_feature, featureLayer) => featureLayer.on("click", event => {
        if (event && event.originalEvent) L.DomEvent.stop(event.originalEvent);
        handleRouteClick(String(route.number), event.latlng);
      })
    });
    const bounds = baseLayer.getBounds();
    const model = {
      route, geojson, ...geometry, baseLayer, clickLayer, bounds,
      traveledMeters: route.displayStatusPreview === "全線走破"
        ? geometry.totalMeters
        : Math.min(geometry.totalMeters, uniquePathDistanceMeters(actualPathsByRoute.get(String(route.number)) || []) || fallbackMetersByRoute.get(String(route.number)) || 0),
      actualLayers: []
    };
    model.candidateLayer = L.geoJSON(geojson, {
      pane: "plannerCandidatePane",
      style: { color: "#7c3aed", weight: 8, opacity: 1 },
      interactive: false
    });
    model.focusLayer = L.geoJSON(geojson, {
      pane: "plannerFocusPane",
      style: { color: "#1674c9", weight: 8, opacity: 1 },
      interactive: false
    });
    if (geometry.labelPoint) model.label = L.marker(geometry.labelPoint, { pane: "plannerLabelPane", interactive: false, icon: makeLabelIcon(model) });
    (actualPathsByRoute.get(String(route.number)) || []).forEach(path => {
      model.actualLayers.push(L.polyline(path, { pane: "plannerActualPane", color: "#f17832", weight: 5, opacity: 1, interactive: false }));
    });
    return model;
  }

  function isVisible(model) {
    const number = String(model.route.number);
    if (selectedNumbers.includes(number) || activeNumber === number) return true;
    if (currentFilter === "all") return true;
    if (currentFilter === "untraveled") return model.route.displayStatusPreview === "未走破";
    return model.route.displayStatusPreview !== "全線走破";
  }

  function applyMapFilter(options = {}) {
    routeGroup.clearLayers();
    actualGroup.clearLayers();
    candidateGroup.clearLayers();
    focusGroup.clearLayers();
    labelGroup.clearLayers();
    clickGroup.clearLayers();
    const visible = models.filter(isVisible).sort((a, b) => {
      const aSelected = selectedNumbers.includes(String(a.route.number)) ? 1 : 0;
      const bSelected = selectedNumbers.includes(String(b.route.number)) ? 1 : 0;
      return aSelected - bSelected;
    });
    visible.forEach(model => {
      model.baseLayer.setStyle(lineStyle(model));
      model.baseLayer.addTo(routeGroup);
      model.clickLayer.addTo(clickGroup);
      if (model.label) {
        model.label.setIcon(makeLabelIcon(model));
        model.label.addTo(labelGroup);
      }
    });
    // 表示フィルターは国道全体の下地だけに適用する。
    // Tripで確定した実走線は記録そのものなので、全線走破などで下地が非表示でも残す。
    if (dom.actual.checked) models.forEach(model => model.actualLayers.forEach(layer => layer.addTo(actualGroup)));
    // 確認中・候補追加済みの路線は実走線より前面へ重ね、路線全体を常に判別できるようにする。
    selectedNumbers.forEach(number => {
      const model = models.find(item => String(item.route.number) === String(number));
      if (model && model.candidateLayer) model.candidateLayer.addTo(candidateGroup);
    });
    if (activeNumber && !selectedNumbers.includes(String(activeNumber))) {
      const focused = models.find(item => String(item.route.number) === String(activeNumber));
      if (focused && focused.focusLayer) focused.focusLayer.addTo(focusGroup);
    }
    const labels = { untraveled: "未走破", remaining: "未走破・一部走破", all: "全" };
    dom.message.textContent = `${labels[currentFilter]}路線 ${visible.length}本を表示中。国道線をタップすると詳細が開きます。`;
    if (options.fit && fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [18, 18], maxZoom: 7 });
    setTimeout(() => map.invalidateSize(), 30);
  }

  function distanceToSegmentMeters(point, a, b) {
    const lat0 = point.lat * Math.PI / 180;
    const x1 = (a[1] - point.lng) * 111320 * Math.cos(lat0);
    const y1 = (a[0] - point.lat) * 110540;
    const x2 = (b[1] - point.lng) * 111320 * Math.cos(lat0);
    const y2 = (b[0] - point.lat) * 110540;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length2 = dx * dx + dy * dy;
    const ratio = length2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / length2)) : 0;
    return Math.hypot(x1 + ratio * dx, y1 + ratio * dy);
  }

  function modelDistanceToPoint(model, point) {
    let best = Infinity;
    for (const line of model.lines) {
      for (let index = 1; index < line.length; index += 1) {
        best = Math.min(best, distanceToSegmentMeters(point, line[index - 1], line[index]));
        if (best < 3) return best;
      }
    }
    return best;
  }

  function nearbyRoutes(point, primaryNumber) {
    const latitudePadding = .0012;
    const longitudePadding = .0018;
    const candidates = models.filter(model => {
      if (!model.bounds || !model.bounds.isValid()) return false;
      const southWest = model.bounds.getSouthWest();
      const northEast = model.bounds.getNorthEast();
      return point.lat >= southWest.lat - latitudePadding && point.lat <= northEast.lat + latitudePadding
        && point.lng >= southWest.lng - longitudePadding && point.lng <= northEast.lng + longitudePadding;
    }).map(model => ({ model, distance: modelDistanceToPoint(model, point) }))
      .filter(item => item.distance <= HIT_DISTANCE_METERS || String(item.model.route.number) === String(primaryNumber))
      .sort((a, b) => a.distance - b.distance || Number(a.model.route.number) - Number(b.model.route.number));
    return candidates.map(item => item.model);
  }

  function handleRouteClick(number, point) {
    const nearby = nearbyRoutes(point, number);
    activeNearbyNumbers = nearby.map(model => String(model.route.number));
    showRouteInfo(number, nearby);
  }

  function routeNumbersFromTrip(trip) {
    if (!trip || typeof trip !== "object") return [];
    if (trip.planSnapshot && Array.isArray(trip.planSnapshot.routeNumbers)) return trip.planSnapshot.routeNumbers.map(String).filter(Boolean);
    if (Array.isArray(trip.routeSegments) && trip.routeSegments.length) return [...new Set(trip.routeSegments.map(segment => String(segment && segment.routeNumber || "")).filter(Boolean))];
    if (Array.isArray(trip.routes)) return trip.routes.map(String).filter(Boolean);
    if (typeof trip.routes === "string") return trip.routes.split(/[、,\s→/]+/).map(value => value.replace(/[^0-9]/g, "")).filter(Boolean);
    return [];
  }

  function relatedTrips(number) {
    return trips.filter(trip => routeNumbersFromTrip(trip).includes(String(number))).sort((a, b) => {
      const dateA = String(a && (a.startDate || a.date || a.plannedDate || a.updatedAt) || "");
      const dateB = String(b && (b.startDate || b.date || b.plannedDate || b.updatedAt) || "");
      return dateB.localeCompare(dateA);
    });
  }

  function formatKm(meters) {
    const km = Math.max(0, Number(meters) || 0) / 1000;
    return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: km < 100 ? 1 : 0 }).format(km)} km`;
  }

  function showRouteInfo(number, nearby = []) {
    const model = models.find(item => String(item.route.number) === String(number));
    if (!model) return;
    if (nearby.length) activeNearbyNumbers = nearby.map(item => String(item.route.number));
    else nearby = activeNearbyNumbers.map(routeNumber => models.find(item => String(item.route.number) === routeNumber)).filter(Boolean);
    activeNumber = String(number);
    dom.empty.hidden = true;
    dom.info.hidden = false;
    const route = model.route;
    const status = route.displayStatusPreview || "未走破";
    const traveled = status === "全線走破" ? model.totalMeters : model.traveledMeters;
    const remaining = Math.max(0, model.totalMeters - traveled);
    const progress = model.totalMeters ? Math.min(100, traveled / model.totalMeters * 100) : 0;
    dom.number.textContent = route.number;
    dom.status.className = `status-badge ${statusClass(status)}`;
    dom.status.textContent = status;
    dom.title.textContent = route.name || `一般国道${route.number}号`;
    dom.start.textContent = route.start || "未登録";
    dom.end.textContent = route.end || "未登録";
    dom.total.textContent = formatKm(model.totalMeters);
    dom.traveled.textContent = traveled ? formatKm(traveled) : "0 km";
    dom.remaining.textContent = status === "全線走破" ? "走破済み" : formatKm(remaining);
    dom.progress.style.width = `${progress.toFixed(2)}%`;
    dom.rule.textContent = route.completionRule && route.completionRule.note ? route.completionRule.note : "起点から終点までの確定走行で全線走破です。";

    const related = relatedTrips(number);
    dom.relatedCount.textContent = `${related.length}件`;
    dom.relatedTrips.innerHTML = related.length
      ? related.slice(0, 3).map(trip => `<span>${escapeHtml(trip.startDate || trip.date || "日付未登録")}｜${escapeHtml(trip.tripName || trip.displayName || "名称未登録")}</span>`).join("")
      : "<em>まだ記録はありません</em>";

    const alternatives = nearby.filter(item => String(item.route.number) !== String(number));
    dom.shared.hidden = alternatives.length === 0;
    dom.shared.innerHTML = alternatives.length
      ? `<strong>この位置には別の国道もあります</strong><div>${[model, ...alternatives].map(item => `<button type="button" data-route="${escapeHtml(item.route.number)}" class="${String(item.route.number) === String(number) ? "active" : ""}">国道${escapeHtml(item.route.number)}号</button>`).join("")}</div>`
      : "";
    dom.shared.querySelectorAll("button[data-route]").forEach(button => button.addEventListener("click", () => showRouteInfo(button.dataset.route, nearby)));

    const isSelected = selectedNumbers.includes(String(number));
    dom.toggle.textContent = isSelected ? "候補に追加済み（押すと解除）" : "この路線を今回の候補に追加";
    dom.toggle.classList.toggle("is-selected", isSelected);
    if (dom.candidateHint) dom.candidateHint.textContent = isSelected
      ? `現在${selectedNumbers.length}路線を選択中。地図から別の国道をタップして続けられます。`
      : `現在${selectedNumbers.length}路線を選択中。この路線を追加しても、続けて別の路線を選べます。`;
    applyMapFilter();
    if (window.matchMedia("(max-width: 760px)").matches) dom.info.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveDraft() {
    const previous = readJson(DRAFT_KEY, {});
    const selectedRoutes = selectedNumbers.map(number => routes.find(route => String(route.number) === number)).filter(Boolean);
    const draft = {
      ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}),
      schemaVersion: 5,
      savedAt: new Date().toISOString(),
      routeNumbers: selectedNumbers.slice(),
      routes: selectedRoutes.map(route => ({ number: route.number, name: route.name, start: route.start, end: route.end, status: route.displayStatusPreview })),
      selectedRegion: "",
      roughPlan: null,
      source: "v5-map-first-planner"
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    if (dom.saveState) dom.saveState.textContent = `自動保存済み ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  }

  function restoreDraft() {
    const draft = readJson(DRAFT_KEY, {});
    selectedNumbers = Array.isArray(draft && draft.routeNumbers) ? [...new Set(draft.routeNumbers.map(String))] : [];
  }

  function renderCandidates() {
    const selected = selectedNumbers.map(number => models.find(model => String(model.route.number) === number)).filter(Boolean);
    if (dom.candidateCount) dom.candidateCount.textContent = `${selected.length}路線`;
    dom.candidateEmpty.hidden = selected.length > 0;
    dom.candidateActions.hidden = selected.length === 0;
    dom.clear.disabled = selected.length === 0;
    dom.candidateList.innerHTML = "";
    selected.forEach(model => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planner-candidate-chip";
      button.innerHTML = `<b>国道${escapeHtml(model.route.number)}号</b><span>${escapeHtml(model.route.start)} → ${escapeHtml(model.route.end)}</span><i aria-label="候補から外す">×</i>`;
      button.addEventListener("click", () => toggleCandidate(String(model.route.number)));
      dom.candidateList.appendChild(button);
    });
  }

  function toggleCandidate(number) {
    const key = String(number);
    const index = selectedNumbers.indexOf(key);
    if (index >= 0) selectedNumbers.splice(index, 1); else selectedNumbers.push(key);
    saveDraft();
    renderCandidates();
    applyMapFilter();
    if (activeNumber === key) showRouteInfo(key);
  }

  function bindEvents() {
    dom.filters.addEventListener("change", event => {
      if (event.target && event.target.name === "plannerFilter") {
        currentFilter = event.target.value;
        applyMapFilter();
      }
    });
    dom.actual.addEventListener("change", () => applyMapFilter());
    dom.fit.addEventListener("click", () => { if (fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [18, 18], maxZoom: 7 }); });
    dom.locate.addEventListener("click", () => {
      dom.message.textContent = "現在地を確認しています…";
      map.locate({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    });
    dom.toggle.addEventListener("click", () => { if (activeNumber) toggleCandidate(activeNumber); });
    dom.clear.addEventListener("click", () => {
      selectedNumbers = [];
      saveDraft();
      renderCandidates();
      applyMapFilter();
      if (activeNumber) showRouteInfo(activeNumber);
    });
  }

  initMap();
  bindEvents();
  Promise.all([
    fetch(ROUTE_DATA_URL, { cache: "no-store" }).then(response => {
      if (!response.ok) throw new Error(`路線データ読込失敗: ${response.status}`);
      return response.json();
    })
  ]).then(async ([data]) => {
    routes = (Array.isArray(data) ? data : []).filter(route => route.challengeTarget !== false);
    trips = readJson(TRIPS_KEY, []);
    if (!Array.isArray(trips)) trips = [];
    buildTripEvidence();
    applyStoredStatuses();
    restoreDraft();
    selectedNumbers = selectedNumbers.filter(number => routes.some(route => String(route.number) === number));
    dom.message.textContent = `${routes.length}路線の地図を読み込んでいます…`;
    const results = await Promise.allSettled(routes.map(loadRouteModel));
    models = results.filter(result => result.status === "fulfilled").map(result => result.value);
    models.forEach(model => {
      if (model.bounds && model.bounds.isValid()) fullBounds = fullBounds ? fullBounds.extend(model.bounds) : L.latLngBounds(model.bounds);
    });
    const failed = results.length - models.length;
    renderCandidates();
    applyMapFilter({ fit: true });
    if (failed) dom.message.textContent += ` ${failed}路線は地図データを読み込めませんでした。`;
  }).catch(error => {
    console.error(error);
    dom.message.textContent = error.message || "計画マップを読み込めませんでした。";
  });
})();
