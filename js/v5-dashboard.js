"use strict";
(function () {
  const ROUTE_URL = "data/routes-v50.json";
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
  const TRIPS_KEY = "hokkaido48Trips";
  const DRAFT_KEY = "hokkaido48V50JourneyDraft";
  const MANUAL_STATUS_KEY = "hokkaido48V5ManualRouteStatus";
  const CONFIRMED_STATUS_KEY = "hokkaido48V5ConfirmedRouteStatus";
  const PATH_ENCODING = "delta-base36-e9-v1";
  const VALID_STATUSES = ["未走破", "一部走破", "全線走破"];
  const PLAN_MODE = new URLSearchParams(window.location.search).get("plan") || "";
  const JourneyStore = window.Hokkaido48JourneyStore;
  const mapEl = document.getElementById("homeRecordMap");
  const summaryEl = document.getElementById("homeRecordSummary");
  const progressMetricsEl = document.getElementById("homeProgressMetrics");
  const journeySummaryEl = document.getElementById("homeJourneySummary");
  const recordUpdatedEl = document.getElementById("homeRecordUpdated");
  const scopeNoteEl = document.getElementById("homeRecordScopeNote");
  const breakdownTitleEl = document.getElementById("homeBreakdownTitle");
  const tripCountEl = document.getElementById("homeTripCount");
  const savedJourneyListEl = document.getElementById("homeSavedJourneyList");
  const savedJourneyCountEl = document.getElementById("homeSavedJourneyCount");
  const messageEl = document.getElementById("homeRecordMessage");
  const fitButton = document.getElementById("homeRecordFit");
  const planner = {
    empty: document.getElementById("homePlannerEmpty"),
    route: document.getElementById("homePlannerRoute"),
    number: document.getElementById("homePlannerRouteNumber"),
    status: document.getElementById("homePlannerRouteStatus"),
    title: document.getElementById("homePlannerRouteTitle"),
    start: document.getElementById("homePlannerRouteStart"),
    end: document.getElementById("homePlannerRouteEnd"),
    remaining: document.getElementById("homePlannerRouteRemaining"),
    note: document.getElementById("homePlannerRouteNote"),
    toggle: document.getElementById("homePlannerToggle"),
    clear: document.getElementById("homePlannerClear"),
    count: document.getElementById("homePlannerCandidateCount"),
    candidateEmpty: document.getElementById("homePlannerCandidateEmpty"),
    list: document.getElementById("homePlannerCandidateList"),
    actions: document.getElementById("homePlannerCandidateActions"),
    saveState: document.getElementById("homePlannerSaveState"),
    create: document.getElementById("homePlannerCreate")
  };
  if (!mapEl || typeof L === "undefined") return;

  let map, baseGroup, remainingGroup, actualGroup, labelGroup, clickGroup, fullBounds = null;
  let currentTrips = [];
  let routeCatalog = [];
  let selectedNumbers = [];
  let activeNumber = "";
  let plannerStartsFresh = false;
  const routeModels = new Map();

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

  function routeNumbersFromTrip(trip) {
    if (!trip || typeof trip !== "object") return [];
    if (trip.planSnapshot && Array.isArray(trip.planSnapshot.routeNumbers)) return trip.planSnapshot.routeNumbers.map(String).filter(Boolean);
    if (Array.isArray(trip.routeSegments) && trip.routeSegments.length) {
      return [...new Set(trip.routeSegments.map(segment => String(segment && segment.routeNumber || "")).filter(Boolean))];
    }
    if (Array.isArray(trip.routes)) return trip.routes.map(String).filter(Boolean);
    if (typeof trip.routes === "string") return trip.routes.split(/[、,\s→/]+/).map(value => value.replace(/[^0-9]/g, "")).filter(Boolean);
    return [];
  }

  function tripDateLabel(trip) {
    const start = trip && (trip.startDate || trip.date || trip.plannedDate) || "";
    const end = trip && trip.endDate || "";
    if (!start) return "日付未登録";
    return !end || end === start ? start : `${start} ～ ${end}`;
  }

  function tripMemoText(trip) {
    const values = [trip && trip.memo, trip && trip.impressions, trip && trip.actionLog];
    return String(values.find(value => typeof value === "string" && value.trim()) || "").trim();
  }

  function openPlannedJourney(index) {
    const trip = currentTrips[index];
    if (!trip || trip.planningStatus !== "planned") return;
    const numbers = routeNumbersFromTrip(trip).filter(number => routeCatalog.some(route => String(route.number) === number));
    const previous = readJson(DRAFT_KEY, {});
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}),
      schemaVersion: 5,
      savedAt: new Date().toISOString(),
      displayName: trip.tripName || "",
      journeyName: trip.tripName || "",
      plannedDate: trip.startDate || "",
      memo: trip.memo || "",
      selectedRegion: "",
      routeNumbers: numbers,
      routes: numbers.map(number => routeCatalog.find(route => String(route.number) === number)).filter(Boolean).map(route => ({
        number: route.number, name: route.name, start: route.start, end: route.end, status: route.displayStatusPreview
      })),
      roughPlan: trip.planSnapshot && trip.planSnapshot.roughPlan || null,
      editingTripId: trip.id || "",
      source: "v5-dashboard-open-planned-journey"
    }));
    window.location.href = "journey-plan.html";
  }

  function deletePlannedJourney(index, name) {
    const trip = currentTrips[index];
    if (!trip || trip.planningStatus !== "planned") return;
    if (!confirm(`計画「${name}」を削除しますか？\n実走記録は削除されません。`)) return;
    const nextTrips = currentTrips.slice();
    nextTrips.splice(index, 1);
    localStorage.setItem(TRIPS_KEY, JSON.stringify(nextTrips));
    render().catch(error => { console.error(error); messageEl.textContent = error.message || "走破記録マップを更新できませんでした。"; });
  }

  function renderSavedJourneys() {
    if (!savedJourneyListEl || !savedJourneyCountEl) return;
    savedJourneyListEl.innerHTML = "";
    savedJourneyCountEl.textContent = `${currentTrips.length}件`;
    if (!currentTrips.length) {
      savedJourneyListEl.innerHTML = '<div class="empty-box">保存済みの旅はありません。</div>';
      return;
    }
    const journeyRecords = JourneyStore ? JourneyStore.read() : { journeys: [] };
    currentTrips.map((trip, index) => ({ trip, index })).sort((a, b) => {
      const dateA = String(a.trip && (a.trip.startDate || a.trip.date || a.trip.plannedDate) || "");
      const dateB = String(b.trip && (b.trip.startDate || b.trip.date || b.trip.plannedDate) || "");
      return dateB.localeCompare(dateA);
    }).forEach(({ trip, index }) => {
      const name = String(trip && (trip.tripName || trip.displayName || trip.name) || "名称未登録");
      const numbers = routeNumbersFromTrip(trip);
      const planned = trip && trip.planningStatus === "planned";
      const memo = tripMemoText(trip);
      const ref = JourneyStore ? JourneyStore.tripRef(trip, index) : "";
      const parentJourney = JourneyStore ? JourneyStore.findJourneyForRef(journeyRecords, ref) : null;
      const card = document.createElement("article");
      card.className = `saved-journey-card${planned ? "" : " is-detail-link"}`;
      card.innerHTML = `
        <div class="saved-journey-card-head"><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(tripDateLabel(trip))}</p></div><span class="journey-kind ${planned ? "planned" : "recorded"}">${planned ? "計画" : "実走記録"}</span></div>
        <div class="saved-journey-routes">${numbers.length ? numbers.map(number => `国道${escapeHtml(number)}号`).join("・") : "路線情報なし"}</div>
        ${parentJourney ? `<span class="journey-parent-chip">${escapeHtml(parentJourney.title || "旅全体")}のDAY記録</span>` : ""}
        ${memo ? `<p class="saved-journey-memo">${escapeHtml(memo)}</p>` : ""}
        <div class="saved-journey-actions">${planned
          ? `<button class="journey-open-button" type="button">この計画を開く</button><a class="journey-gpx-button" href="gpx-import.html?trip=${index}">GPXを取り込む</a><button class="journey-delete-button" type="button">削除</button>`
          : `<a class="journey-detail-button" href="journey-detail.html?trip=${index}">旅の詳細・会計</a><a class="journey-gpx-button" href="route-status.html?trip=${index}">走破状態を確認</a>`}</div>`;
      if (planned) {
        card.querySelector(".journey-open-button").addEventListener("click", () => openPlannedJourney(index));
        card.querySelector(".journey-delete-button").addEventListener("click", () => deletePlannedJourney(index, name));
      } else {
        card.tabIndex = 0;
        card.setAttribute("aria-label", `${name}の旅詳細を開く`);
        const openDetail = event => {
          if (event.type === "click" && event.target.closest("a,button")) return;
          if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
          if (event.type === "keydown") event.preventDefault();
          window.location.href = `journey-detail.html?trip=${index}`;
        };
        card.addEventListener("click", openDetail);
        card.addEventListener("keydown", openDetail);
      }
      savedJourneyListEl.appendChild(card);
    });
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

  function decodeConfirmedGeometry(holder) {
    const geometry = holder && holder.confirmedGeometry;
    if (!geometry || geometry.format !== PATH_ENCODING || !Array.isArray(geometry.paths)) return [];
    const scale = Number(geometry.scale) || 1000000000;
    return geometry.paths.map(encoded => {
      let lat = 0, lon = 0;
      return String(encoded || "").split(",").map((token, index) => {
        const pair = token.split(":");
        if (pair.length !== 2) return null;
        const a = parseInt(pair[0], 36), b = parseInt(pair[1], 36);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        if (index === 0) { lat = a; lon = b; } else { lat += a; lon += b; }
        return [lat / scale, lon / scale];
      }).filter(Boolean);
    }).filter(path => path.length > 1);
  }

  function segmentPaths(segment) {
    const paths = decodeConfirmedGeometry(segment);
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
        paths.push(...decodeConfirmedGeometry(route));
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

  function buildTripStatusesByRoute(trips) {
    const statuses = new Map();
    trips.forEach(trip => {
      (Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : []).forEach(segment => {
        const number = String(segment && segment.routeNumber || "");
        const status = String(segment && segment.completionStatus || "");
        if (!number || !VALID_STATUSES.includes(status)) return;
        const previous = statuses.get(number);
        if (status === "全線走破" || !previous) statuses.set(number, status);
      });
    });
    return statuses;
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

  function geojsonDistanceMeters(geojson) {
    const paths = collectLines(geojson).map(line => line
      .map(point => Array.isArray(point) ? [Number(point[1]), Number(point[0])] : null)
      .filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1])));
    return uniquePathDistanceMeters(paths);
  }

  function fallbackDistanceByRoute(trips) {
    const meters = new Map();
    trips.forEach(trip => {
      (Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : []).forEach(segment => {
        const number = String(segment && segment.routeNumber || "");
        const value = Number(segment && segment.confirmedDistanceKm);
        const hasGeometry = Boolean(
          segment && segment.confirmedGeometry && Array.isArray(segment.confirmedGeometry.paths) && segment.confirmedGeometry.paths.length
        ) || Boolean(Array.isArray(segment && segment.confirmedPaths) && segment.confirmedPaths.length)
          || Boolean(Array.isArray(segment && segment.confirmedPath) && segment.confirmedPath.length);
        if (!number || !Number.isFinite(value) || value <= 0 || hasGeometry) return;
        meters.set(number, (meters.get(number) || 0) + value * 1000);
      });
    });
    return meters;
  }

  function statusStyle(status) {
    if (status === "全線走破") return { color: "#16a34a", weight: 5, opacity: .9 };
    return { color: "#64748b", weight: 3.2, opacity: status === "一部走破" ? .55 : .62 };
  }

  function actualPathStyle(status) {
    return {
      color: status === "全線走破" ? "#16a34a" : "#f97316",
      weight: 6,
      opacity: .98
    };
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

  function routeLatLonLines(geojson) {
    return collectLines(geojson).map(line => line
      .map(point => Array.isArray(point) ? [Number(point[1]), Number(point[0])] : null)
      .filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1])))
      .filter(line => line.length > 1);
  }

  function distanceToSegmentMeters(point, a, b) {
    const lat0 = Number(point[0]) * Math.PI / 180;
    const x1 = (Number(a[1]) - Number(point[1])) * 111320 * Math.cos(lat0);
    const y1 = (Number(a[0]) - Number(point[0])) * 110540;
    const x2 = (Number(b[1]) - Number(point[1])) * 111320 * Math.cos(lat0);
    const y2 = (Number(b[0]) - Number(point[0])) * 110540;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length2 = dx * dx + dy * dy;
    const ratio = length2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / length2)) : 0;
    return Math.hypot(x1 + ratio * dx, y1 + ratio * dy);
  }

  function buildActualSegmentIndex(actualPaths) {
    const cellDegrees = .002;
    const paddingDegrees = .001;
    const cells = new Map();
    const cellNumber = value => Math.floor(Number(value) / cellDegrees);
    const cellKey = (lat, lon) => `${lat}:${lon}`;
    actualPaths.forEach(path => {
      const points = normalizePath(path);
      for (let index = 1; index < points.length; index += 1) {
        const segment = [points[index - 1], points[index]];
        const minLat = cellNumber(Math.min(segment[0][0], segment[1][0]) - paddingDegrees);
        const maxLat = cellNumber(Math.max(segment[0][0], segment[1][0]) + paddingDegrees);
        const minLon = cellNumber(Math.min(segment[0][1], segment[1][1]) - paddingDegrees);
        const maxLon = cellNumber(Math.max(segment[0][1], segment[1][1]) + paddingDegrees);
        for (let lat = minLat; lat <= maxLat; lat += 1) {
          for (let lon = minLon; lon <= maxLon; lon += 1) {
            const key = cellKey(lat, lon);
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(segment);
          }
        }
      }
    });
    return { cells, cellDegrees, cellNumber, cellKey };
  }

  function pointNearActualPath(point, actualIndex, thresholdMeters = 65) {
    const lat = actualIndex.cellNumber(point[0]);
    const lon = actualIndex.cellNumber(point[1]);
    const segments = actualIndex.cells.get(actualIndex.cellKey(lat, lon)) || [];
    for (const segment of segments) {
      if (distanceToSegmentMeters(point, segment[0], segment[1]) <= thresholdMeters) return true;
    }
    return false;
  }

  function splitUntraveledSections(geojson, actualPaths) {
    const untraveled = [];
    const actualIndex = buildActualSegmentIndex(actualPaths);
    routeLatLonLines(geojson).forEach((line, lineIndex) => {
      let startIndex = null;
      for (let index = 1; index < line.length; index += 1) {
        const a = line[index - 1];
        const b = line[index];
        const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (!pointNearActualPath(midpoint, actualIndex)) {
          if (startIndex === null) startIndex = index - 1;
        } else if (startIndex !== null) {
          untraveled.push({ lineIndex, startIndex, endIndex: index - 1 });
          startIndex = null;
        }
      }
      if (startIndex !== null) untraveled.push({ lineIndex, startIndex, endIndex: line.length - 1 });
    });
    return untraveled;
  }

  function sectionsToPaths(geojson, sections) {
    const lines = routeLatLonLines(geojson);
    return (Array.isArray(sections) ? sections : []).map(section => {
      const line = lines[Number(section && section.lineIndex)];
      if (!line) return [];
      const startIndex = Math.max(0, Number(section.startIndex) || 0);
      const endIndex = Math.min(line.length - 1, Number(section.endIndex));
      return Number.isFinite(endIndex) && endIndex > startIndex
        ? line.slice(startIndex, endIndex + 1)
        : [];
    }).filter(path => path.length > 1);
  }

  function remainingSectionsForModel(model) {
    if (!model || model.route.displayStatusPreview === "全線走破") return [];
    if (Array.isArray(model.untraveledSections)) return model.untraveledSections;
    const lines = routeLatLonLines(model.geojson);
    const actualPaths = Array.isArray(model.route.actualPaths) ? model.route.actualPaths : [];
    model.untraveledSections = model.route.displayStatusPreview === "一部走破" && actualPaths.length
      ? splitUntraveledSections(model.geojson, actualPaths)
      : lines.map((line, lineIndex) => ({ lineIndex, startIndex: 0, endIndex: line.length - 1 }));
    return model.untraveledSections;
  }

  function untraveledPathsForModel(model) {
    if (!model || model.route.displayStatusPreview === "全線走破") return [];
    if (model.untraveledPaths) return model.untraveledPaths;
    model.untraveledPaths = sectionsToPaths(model.geojson, remainingSectionsForModel(model));
    return model.untraveledPaths;
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
    return counts;
  }

  function formatKm(meters) {
    const km = Math.max(0, Number(meters) || 0) / 1000;
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: km < 100 ? 1 : 0 }).format(km);
  }

  function restorePlannerDraft() {
    const draft = readJson(DRAFT_KEY, {});
    const editingExistingPlan = Boolean(draft && draft.editingTripId);
    plannerStartsFresh = PLAN_MODE === "new" || (editingExistingPlan && PLAN_MODE !== "edit");
    selectedNumbers = !plannerStartsFresh && Array.isArray(draft && draft.routeNumbers)
      ? [...new Set(draft.routeNumbers.map(String))]
      : [];
  }

  function savePlannerDraft() {
    const previous = readJson(DRAFT_KEY, {});
    const previousObject = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
    const selectedRoutes = selectedNumbers
      .map(number => routeCatalog.find(route => String(route.number) === number))
      .filter(Boolean);
    const remainingSections = {};
    selectedNumbers.forEach(number => {
      const model = routeModels.get(String(number));
      if (!model) return;
      remainingSections[String(number)] = remainingSectionsForModel(model).map(section => ({
        lineIndex: section.lineIndex,
        startIndex: section.startIndex,
        endIndex: section.endIndex
      }));
    });
    const draft = {
      ...(plannerStartsFresh ? {} : previousObject),
      schemaVersion: 5,
      savedAt: new Date().toISOString(),
      routeNumbers: selectedNumbers.slice(),
      routes: selectedRoutes.map(route => ({
        number: route.number,
        name: route.name,
        start: route.start,
        end: route.end,
        status: route.displayStatusPreview
      })),
      remainingSections,
      selectedRegion: "",
      roughPlan: null,
      source: "v5-integrated-home-planner"
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    plannerStartsFresh = false;
    if (planner.saveState) {
      planner.saveState.textContent = `自動保存済み ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    }
  }

  function renderPlannerCandidates() {
    if (!planner.list || !planner.count) return;
    const selectedRoutes = selectedNumbers
      .map(number => routeCatalog.find(route => String(route.number) === number))
      .filter(Boolean);
    planner.count.textContent = `${selectedRoutes.length}路線`;
    planner.candidateEmpty.hidden = selectedRoutes.length > 0;
    planner.actions.hidden = selectedRoutes.length === 0;
    planner.clear.disabled = selectedRoutes.length === 0;
    planner.list.innerHTML = "";
    selectedRoutes.forEach(route => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-planner-candidate-chip";
      button.setAttribute("aria-label", `国道${route.number}号を候補から外す`);
      button.innerHTML = `国道${escapeHtml(route.number)}号 <span aria-hidden="true">×</span>`;
      button.addEventListener("click", () => togglePlannerCandidate(String(route.number)));
      planner.list.appendChild(button);
    });
  }

  function showPlannerRoute(number, options = {}) {
    const model = routeModels.get(String(number));
    if (!model || !planner.route) return;
    activeNumber = String(number);
    remainingGroup.clearLayers();
    const remainingPaths = untraveledPathsForModel(model);
    remainingPaths.forEach(path => {
      L.polyline(path, {
        pane: "homeRecordRemaining",
        color: "#fde68a",
        weight: 9,
        opacity: .95,
        interactive: false
      }).addTo(remainingGroup);
    });

    const route = model.route;
    const status = route.displayStatusPreview || "未走破";
    const remainingMeters = status === "全線走破"
      ? 0
      : Math.max(0, Number(route.totalMeters || 0) - Number(route.traveledMeters || 0));
    planner.empty.hidden = true;
    planner.route.hidden = false;
    planner.number.textContent = route.number;
    planner.status.className = `status-badge ${statusClass(status)}`;
    planner.status.textContent = status;
    planner.title.textContent = route.name || `一般国道${route.number}号`;
    planner.start.textContent = route.start || "未登録";
    planner.end.textContent = route.end || "未登録";
    planner.remaining.textContent = status === "全線走破" ? "走破済み" : `${formatKm(remainingMeters)} km`;
    if (status === "全線走破") {
      planner.note.textContent = "全線走破済みのため、薄黄色の未走行区間はありません。候補への追加は可能です。";
    } else if (status === "一部走破" && route.actualPaths.length) {
      planner.note.textContent = "薄黄色＝未走行区間の目安です。橙色は保存済みの確定実走区間です。";
    } else if (status === "一部走破") {
      planner.note.textContent = "確定実走線が保存されていないため、国道全体を薄黄色で表示しています。";
    } else {
      planner.note.textContent = "未走破のため、国道全体を薄黄色で表示しています。";
    }
    const isSelected = selectedNumbers.includes(activeNumber);
    planner.toggle.textContent = isSelected ? "候補に追加済み（押すと解除）" : "この路線を今回の候補に追加";
    planner.toggle.classList.toggle("is-selected", isSelected);
    if (options.fit !== false && model.bounds && model.bounds.isValid()) {
      map.fitBounds(model.bounds, { padding: [28, 28], maxZoom: 9 });
    }
    if (window.matchMedia("(max-width: 760px)").matches && options.scroll !== false) {
      planner.route.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function togglePlannerCandidate(number) {
    const key = String(number);
    const index = selectedNumbers.indexOf(key);
    if (index >= 0) selectedNumbers.splice(index, 1);
    else selectedNumbers.push(key);
    savePlannerDraft();
    renderPlannerCandidates();
    if (activeNumber === key) showPlannerRoute(key, { fit: false, scroll: false });
  }

  function renderProgressMetrics(routes, counts, trips, allRouteTotal) {
    if (!progressMetricsEl) return;
    const routeTotal = routes.length || 48;
    const complete = counts["全線走破"] || 0;
    const routePercent = routeTotal ? complete / routeTotal * 100 : 0;
    const totalMeters = routes.reduce((sum, route) => sum + (Number(route.totalMeters) || 0), 0);
    const traveledMeters = routes.reduce((sum, route) => sum + (Number(route.traveledMeters) || 0), 0);
    const distancePercent = totalMeters ? Math.min(100, traveledMeters / totalMeters * 100) : 0;
    const routeWidth = Math.max(0, Math.min(100, routePercent));
    const distanceWidth = Math.max(0, Math.min(100, distancePercent));

    progressMetricsEl.innerHTML = `
      <article class="home-metric-card metric-routes">
        <div class="home-metric-top"><span class="home-metric-icon" aria-hidden="true">道</span><span>路線走破率</span></div>
        <div class="home-metric-value">${routePercent.toFixed(1)}<small>%</small></div>
        <p><strong>${complete}</strong> / ${routeTotal}攻略対象路線を全線走破</p>
        <div class="home-progress-track" aria-hidden="true"><span style="width:${routeWidth.toFixed(2)}%"></span></div>
      </article>
      <article class="home-metric-card metric-distance">
        <div class="home-metric-top"><span class="home-metric-icon" aria-hidden="true">km</span><span>距離走破率</span></div>
        <div class="home-metric-value">${distancePercent.toFixed(1)}<small>%</small></div>
        <p><strong>${formatKm(traveledMeters)} km</strong> / 対象総延長 ${formatKm(totalMeters)} km</p>
        <div class="home-progress-track" aria-hidden="true"><span style="width:${distanceWidth.toFixed(2)}%"></span></div>
      </article>`;

    const dates = trips.map(trip => new Date(trip && (trip.updatedAt || trip.endDate || trip.startDate || "")))
      .filter(date => !Number.isNaN(date.getTime())).sort((a, b) => b - a);
    const latest = dates[0];
    const latestText = latest ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(latest) : "記録なし";
    if (tripCountEl) tripCountEl.textContent = `${trips.length}件の旅を表示`;
    if (recordUpdatedEl) recordUpdatedEl.textContent = `最新記録：${latestText}`;
    if (breakdownTitleEl) breakdownTitleEl.textContent = `攻略対象${routeTotal}路線の内訳`;
    const excluded = Math.max(0, (Number(allRouteTotal) || routeTotal) - routeTotal);
    if (scopeNoteEl) scopeNoteEl.textContent = excluded
      ? `全${allRouteTotal}路線のうち海上国道${excluded}路線は集計対象外。共用区間は各路線の延長として集計しています。`
      : `全${routeTotal}路線を集計しています。`;
    if (journeySummaryEl) journeySummaryEl.innerHTML = `
      <div><span class="home-journey-icon" aria-hidden="true">↗</span><div><small>保存した旅</small><strong>${trips.length}<em>件</em></strong></div></div>
      <p>最終更新 <b>${latestText}</b></p>`;
  }

  function initMap() {
    map = L.map(mapEl, { zoomControl: true, preferCanvas: true }).setView([43.55, 142.45], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    map.createPane("homeRecordRemaining");
    map.getPane("homeRecordRemaining").style.zIndex = 440;
    map.createPane("homeRecordActual");
    map.getPane("homeRecordActual").style.zIndex = 450;
    map.createPane("homeRecordClick");
    map.getPane("homeRecordClick").style.zIndex = 610;
    map.createPane("homeRecordLabels");
    map.getPane("homeRecordLabels").style.zIndex = 620;
    map.getPane("homeRecordLabels").style.pointerEvents = "none";
    baseGroup = L.layerGroup().addTo(map);
    remainingGroup = L.layerGroup().addTo(map);
    actualGroup = L.layerGroup().addTo(map);
    clickGroup = L.layerGroup().addTo(map);
    labelGroup = L.layerGroup().addTo(map);
  }

  async function render() {
    messageEl.textContent = "走破記録マップを読み込んでいます…";
    baseGroup.clearLayers();
    remainingGroup.clearLayers();
    actualGroup.clearLayers();
    clickGroup.clearLayers();
    labelGroup.clearLayers();
    routeModels.clear();
    activeNumber = "";
    if (planner.empty && planner.route) {
      planner.empty.hidden = false;
      planner.route.hidden = true;
    }
    fullBounds = null;

    const response = await fetch(ROUTE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("路線データを読み込めませんでした。");
    const data = await response.json();
    routeCatalog = Array.isArray(data) ? data : [];
    const confirmed = readConfirmedStatuses();
    const manual = readManualStatuses();
    const trips = loadTrips();
    currentTrips = trips;
    renderSavedJourneys();
    const actualPathsByRoute = buildActualPathsByRoute(trips);
    const tripStatusesByRoute = buildTripStatusesByRoute(trips);
    const fallbackMetersByRoute = fallbackDistanceByRoute(trips);

    const routes = (Array.isArray(data) ? data : []).filter(route => route.challengeTarget !== false).map(route => {
      const copy = { ...route };
      const number = String(copy.number);
      const paths = actualPathsByRoute.get(number) || [];
      const entry = confirmed[number];
      const confirmedStatus = typeof entry === "string" ? entry : entry && entry.status;
      const humanConfirmed = Boolean(entry && typeof entry === "object" && entry.source === "v5-route-status-human-confirmed");
      const manualStatus = manual[number];
      const tripStatus = tripStatusesByRoute.get(number);
      const hasConfirmedStatus = VALID_STATUSES.includes(confirmedStatus);
      const hasManualStatus = VALID_STATUSES.includes(manualStatus);

      // 正本の優先順位：手動指定 > 人が確定した例外 > 現行Trip判定 > 旧V5確定 > 既存Route。
      // 人の例外確定と旧自動確定を区別し、Build69で直した古い誤確定は復活させない。
      if (!hasManualStatus && humanConfirmed && confirmedStatus === "全線走破") {
        copy.displayStatusPreview = confirmedStatus;
        copy.statusSource = "例外確認済み";
      } else if (!hasManualStatus && tripStatus === "全線走破") {
        copy.displayStatusPreview = tripStatus;
        copy.statusSource = "Trip判定";
      } else if (!hasManualStatus && humanConfirmed && hasConfirmedStatus) {
        copy.displayStatusPreview = confirmedStatus;
        copy.statusSource = "例外確認済み";
      } else if (!hasManualStatus && paths.length && VALID_STATUSES.includes(tripStatus)) {
        copy.displayStatusPreview = tripStatus;
        copy.statusSource = "Trip判定";
      } else if (!hasConfirmedStatus && !hasManualStatus && paths.length) {
        copy.displayStatusPreview = VALID_STATUSES.includes(tripStatus) ? tripStatus : (copy.displayStatusPreview === "全線走破" ? "全線走破" : "一部走破");
        copy.statusSource = "Trip実走線";
      }
      if (!humanConfirmed && hasConfirmedStatus && !VALID_STATUSES.includes(tripStatus)) {
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
    routeCatalog = routes;
    restorePlannerDraft();
    selectedNumbers = selectedNumbers.filter(number => routeCatalog.some(route => String(route.number) === number));
    renderPlannerCandidates();
    const counts = renderSummary(routes);

    let loaded = 0;
    let actualPathCount = 0;
    const results = await Promise.allSettled(routes.map(async route => {
      const r = await fetch(GEOJSON_PATH(route.number), { cache: "no-store" });
      if (!r.ok) throw new Error(String(route.number));
      const geojson = await r.json();
      route.totalMeters = geojsonDistanceMeters(geojson);
      if (route.displayStatusPreview === "全線走破") route.traveledMeters = route.totalMeters;
      else if (route.displayStatusPreview === "一部走破") {
        const actualMeters = uniquePathDistanceMeters(route.actualPaths);
        route.traveledMeters = Math.min(route.totalMeters, actualMeters || fallbackMetersByRoute.get(String(route.number)) || 0);
      } else route.traveledMeters = 0;
      const layer = L.geoJSON(geojson, { style: statusStyle(route.displayStatusPreview) }).addTo(baseGroup);
      const bounds = layer.getBounds();
      if (bounds && bounds.isValid()) fullBounds = fullBounds ? fullBounds.extend(bounds) : bounds;
      const model = { route, geojson, layer, bounds, untraveledPaths: null, untraveledSections: null };
      routeModels.set(String(route.number), model);
      L.geoJSON(geojson, {
        pane: "homeRecordClick",
        style: { color: "transparent", weight: 22, opacity: 0, fillOpacity: 0 },
        onEachFeature: (_feature, featureLayer) => featureLayer.on("click", event => {
          if (event && event.originalEvent) L.DomEvent.stop(event.originalEvent);
          showPlannerRoute(String(route.number));
        })
      }).addTo(clickGroup);

      // GPX解析画面で確定しTripへ保存したcanonical geometryを、走破状態に
      // 関係なくそのまま描画する。確定線を捨てず、全線走破は緑、一部走破は
      // オレンジで重ねることで解析・路線選択・ホームの表示を一致させる。
      const paths = Array.isArray(route.actualPaths) ? route.actualPaths : [];
      paths.forEach(path => {
        const actual = L.polyline(path, {
          pane: "homeRecordActual",
          ...actualPathStyle(route.displayStatusPreview),
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
    renderProgressMetrics(routes, counts, trips, Array.isArray(data) ? data.length : routes.length);
    const baseText = failed
      ? `${loaded}路線を表示。${failed}路線の地図データを読み込めませんでした。`
      : `${loaded}路線の現在の走破記録を表示しています。`;
    messageEl.textContent = `${baseText} 路線を選ぶと未走行区間を薄黄色で表示します。緑＝全線走破、橙＝確定実走区間、灰＝国道全体。確定実走線 ${actualPathCount}区間を反映。`;
    setTimeout(() => map.invalidateSize(), 80);
  }

  initMap();
  fitButton?.addEventListener("click", () => { if (fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [16, 16], maxZoom: 7 }); });
  planner.toggle?.addEventListener("click", () => { if (activeNumber) togglePlannerCandidate(activeNumber); });
  planner.create?.addEventListener("click", () => savePlannerDraft());
  planner.clear?.addEventListener("click", () => {
    selectedNumbers = [];
    savePlannerDraft();
    renderPlannerCandidates();
    if (activeNumber) showPlannerRoute(activeNumber, { fit: false, scroll: false });
  });
  render().catch(error => { console.error(error); messageEl.textContent = error.message || "走破記録マップを表示できませんでした。"; });
})();
