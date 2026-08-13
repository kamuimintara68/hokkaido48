"use strict";

(function () {
  const ROUTE_DATA_URL = "data/routes-v50.json";
  const TRIPS_KEY = "hokkaido48Trips";
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
  const el = id => document.getElementById(id);

  const fileInput = el("gpxFile");
  const tripSelect = el("gpxTripSelect");
  const analyzeButton = el("gpxAnalyze");
  const statusEl = el("gpxStatus");
  const summaryEl = el("gpxSummary");
  const fileNameEl = el("gpxFileName");
  const pointCountEl = el("gpxPointCount");
  const distanceEl = el("gpxDistance");
  const startTimeEl = el("gpxStartTime");
  const endTimeEl = el("gpxEndTime");
  const durationEl = el("gpxDuration");
  const candidatesEl = el("gpxCandidates");
  const candidateCountEl = el("candidateCount");
  const fitButton = el("gpxFit");
  const mapMessageEl = el("gpxMapMessage");
  const confirmCountEl = el("gpxConfirmCount");
  const saveConfirmedButton = el("gpxSaveConfirmed");
  const confirmStatusEl = el("gpxConfirmStatus");
  const nextStatusLink = el("gpxNextStatus");
  const flowReadEl = el("gpxFlowRead");
  const flowConfirmEl = el("gpxFlowConfirm");
  const flowSaveEl = el("gpxFlowSave");

  let map, trackGroup, candidateGroup, routeLabelGroup, currentBounds = null;
  let routes = [];
  let latestTrackSegments = [];
  let latestCandidates = [];
  let latestAnalysis = null;
  const confirmedNumbers = new Set();


  function setFlowStage(stage) {
    const items = [flowReadEl, flowConfirmEl, flowSaveEl];
    items.forEach((node, index) => {
      if (!node) return;
      node.classList.toggle("is-done", index < stage);
      node.classList.toggle("is-active", index === stage);
    });
    if (stage >= 3 && flowSaveEl) {
      flowSaveEl.classList.remove("is-active");
      flowSaveEl.classList.add("is-done");
    }
  }

  function initMap() {
    map = L.map("gpxMap", { zoomControl: true, preferCanvas: true }).setView([43.45, 142.65], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    trackGroup = L.layerGroup().addTo(map);
    candidateGroup = L.layerGroup().addTo(map);
    routeLabelGroup = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
  }

  function loadTrips() {
    let trips = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]");
      if (Array.isArray(parsed)) trips = parsed;
    } catch {}
    tripSelect.innerHTML = '<option value="__new__">新しい実走記録として取り込む</option>';
    trips.forEach((trip, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const name = String(trip.tripName || trip.displayName || trip.name || "名称未登録");
      const date = String(trip.startDate || trip.date || trip.plannedDate || "日付未登録");
      option.textContent = `${date}　${name}${trip.planningStatus === "planned" ? "（計画）" : ""}`;
      tripSelect.appendChild(option);
    });
    const requestedTrip = new URLSearchParams(window.location.search).get("trip");
    if (requestedTrip !== null && /^\d+$/.test(requestedTrip) && Number(requestedTrip) < trips.length) {
      tripSelect.value = requestedTrip;
      statusEl.textContent = `紐づけ先を選択済み：${tripSelect.options[tripSelect.selectedIndex].textContent}`;
    }
  }

  function haversine(a, b) {
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const lat1 = a[0] * rad, lat2 = b[0] * rad;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function totalDistance(points) {
    let meters = 0;
    for (let i = 1; i < points.length; i += 1) meters += haversine(points[i - 1], points[i]);
    return meters;
  }

  function parseGpx(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("GPXをXMLとして読み込めませんでした。");
    const nodes = [...xml.getElementsByTagNameNS("*", "trkpt")];
    const points = nodes.map(node => {
      const lat = Number(node.getAttribute("lat"));
      const lon = Number(node.getAttribute("lon"));
      const timeNode = [...node.children].find(child => child.localName === "time");
      return { lat, lon, time: timeNode ? timeNode.textContent.trim() : "" };
    }).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    if (points.length < 2) throw new Error("GPXに十分なトラック点がありません。");
    return points;
  }

  function formatDateTime(value) {
    if (!value) return "時刻なし";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(date);
  }

  function formatTimeOnly(value) {
    if (!value) return "時刻なし";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(date);
  }

  function formatDuration(start, end) {
    if (!start || !end) return "時刻なし";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "時刻なし";
    const totalMinutes = Math.round(ms / 60000);
    return `${Math.floor(totalMinutes / 60)}時間${totalMinutes % 60}分`;
  }

  function collectLines(node, output = []) {
    if (!node || typeof node !== "object") return output;
    if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
      node.features.forEach(feature => collectLines(feature, output));
    } else if (node.type === "Feature") {
      collectLines(node.geometry, output);
    } else if (node.type === "LineString" && Array.isArray(node.coordinates)) {
      output.push(node.coordinates);
    } else if (node.type === "MultiLineString" && Array.isArray(node.coordinates)) {
      node.coordinates.forEach(line => output.push(line));
    }
    return output;
  }

  function downsample(array, maxPoints) {
    if (array.length <= maxPoints) return array.slice();
    const step = (array.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i += 1) out.push(array[Math.round(i * step)]);
    return out;
  }

  function routePolylineSample(geojson, maxPoints = 900) {
    const lines = collectLines(geojson)
      .map(line => line
        .map(coord => Array.isArray(coord) && coord.length >= 2 ? [Number(coord[1]), Number(coord[0])] : null)
        .filter(Boolean)
        .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])))
      .filter(line => line.length >= 2);
    if (!lines.length) return [];
    const total = lines.reduce((sum, line) => sum + line.length, 0);
    return lines.map(line => {
      const share = Math.max(2, Math.round(maxPoints * line.length / total));
      return downsample(line, Math.min(line.length, share));
    });
  }

  function bbox(points) {
    return points.reduce((b, p) => ({
      minLat: Math.min(b.minLat, p[0]), maxLat: Math.max(b.maxLat, p[0]),
      minLon: Math.min(b.minLon, p[1]), maxLon: Math.max(b.maxLon, p[1])
    }), { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
  }

  function boxesNear(a, b, pad = 0.03) {
    return !(a.maxLat < b.minLat - pad || a.minLat > b.maxLat + pad || a.maxLon < b.minLon - pad || a.minLon > b.maxLon + pad);
  }

  function bearingDeg(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a[0] * rad, lat2 = b[0] * rad;
    const dLon = (b[1] - a[1]) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  function headingDifference(a, b) {
    let d = Math.abs(a - b) % 180;
    if (d > 90) d = 180 - d;
    return d;
  }

  function pointSegmentDistanceMeters(point, a, b) {
    const lat0 = point[0] * Math.PI / 180;
    const mx = 111320 * Math.cos(lat0);
    const my = 110540;
    const ax = (a[1] - point[1]) * mx;
    const ay = (a[0] - point[0]) * my;
    const bx = (b[1] - point[1]) * mx;
    const by = (b[0] - point[0]) * my;
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;
    let t = denom > 0 ? -(ax * dx + ay * dy) / denom : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx;
    const y = ay + t * dy;
    return Math.hypot(x, y);
  }

  function prepareRouteSegments(lines) {
    const segments = [];
    lines.forEach(line => {
      for (let i = 1; i < line.length; i += 1) {
        const a = line[i - 1], b = line[i];
        segments.push({ a, b, bearing: bearingDeg(a, b) });
      }
    });
    return segments;
  }

  function nearestAlignedRoute(trackSegment, routeSegments) {
    let nearest = Infinity;
    let aligned = Infinity;
    let alignedAngle = 90;
    for (const routeSeg of routeSegments) {
      const d = pointSegmentDistanceMeters(trackSegment.mid, routeSeg.a, routeSeg.b);
      if (d < nearest) nearest = d;
      if (d > 220) continue;
      const diff = headingDifference(trackSegment.bearing, routeSeg.bearing);
      if (diff <= 42 && d < aligned) {
        aligned = d;
        alignedAngle = diff;
        if (aligned <= 12 && diff <= 12) break;
      }
    }
    return { nearest, aligned, alignedAngle };
  }

  function buildTrackSegments(trackPoints) {
    const segments = [];
    for (let i = 1; i < trackPoints.length; i += 1) {
      const a = [trackPoints[i - 1].lat, trackPoints[i - 1].lon];
      const b = [trackPoints[i].lat, trackPoints[i].lon];
      const meters = haversine(a, b);
      segments.push({
        a, b,
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        meters,
        bearing: bearingDeg(a, b),
        startTime: trackPoints[i - 1].time || "",
        endTime: trackPoints[i].time || "",
        valid: Number.isFinite(meters) && meters > 0 && meters <= 3000
      });
    }
    return segments;
  }

  function trackMapOverlapAgainstRoute(trackSegments, routeLines) {
    const routeSegments = prepareRouteSegments(routeLines);
    const MATCH = 105;
    const STRONG = 55;
    const CORE = 30;
    const BRIDGE = 175;
    let matchedMeters = 0;
    let strongMeters = 0;
    let coreMeters = 0;
    let longestContinuous = 0;
    let currentContinuous = 0;
    let minDistance = Infinity;
    const matchedMask = new Uint8Array(trackSegments.length);
    const strongMask = new Uint8Array(trackSegments.length);
    const coreMask = new Uint8Array(trackSegments.length);
    const alignedDistances = new Float32Array(trackSegments.length);
    const matchedDistanceValues = [];
    alignedDistances.fill(Infinity);

    for (let i = 0; i < trackSegments.length; i += 1) {
      const segment = trackSegments[i];
      if (!segment.valid) continue;
      const match = nearestAlignedRoute(segment, routeSegments);
      minDistance = Math.min(minDistance, match.nearest);
      alignedDistances[i] = match.aligned;

      const isMatch = match.aligned <= MATCH;
      const isStrong = match.aligned <= STRONG && match.alignedAngle <= 30;
      const isCore = match.aligned <= CORE && match.alignedAngle <= 25;
      if (isMatch) {
        matchedMask[i] = 1;
        matchedMeters += segment.meters;
        matchedDistanceValues.push(match.aligned);
        currentContinuous += segment.meters;
        if (isCore) {
          coreMask[i] = 1;
          coreMeters += segment.meters;
        }
        if (isStrong) {
          strongMask[i] = 1;
          strongMeters += segment.meters;
        }
      } else if (match.aligned <= BRIDGE && currentContinuous > 0 && segment.meters <= 600) {
        // 短いGPSずれやGeoJSONのずれだけは連続区間を切らない。
        currentContinuous += segment.meters;
      } else {
        longestContinuous = Math.max(longestContinuous, currentContinuous);
        currentContinuous = 0;
      }
    }
    longestContinuous = Math.max(longestContinuous, currentContinuous);
    let firstMatchedIndex = -1;
    for (let i = 0; i < matchedMask.length; i += 1) {
      if (matchedMask[i]) {
        firstMatchedIndex = i;
        break;
      }
    }
    const firstMatchedTime = firstMatchedIndex >= 0
      ? (trackSegments[firstMatchedIndex].startTime || trackSegments[firstMatchedIndex].endTime || "")
      : "";
    matchedDistanceValues.sort((a, b) => a - b);
    const medianMatchDistance = matchedDistanceValues.length
      ? matchedDistanceValues[Math.floor(matchedDistanceValues.length / 2)]
      : Infinity;
    return { matchedMeters, strongMeters, coreMeters, longestContinuous, minDistance, medianMatchDistance, matchedMask, strongMask, coreMask, alignedDistances, firstMatchedIndex, firstMatchedTime };
  }

  function confidenceFor(metrics, planned = false) {
    const km = metrics.matchedMeters / 1000;
    const longest = metrics.longestContinuous / 1000;
    const strong = metrics.strongMeters / 1000;
    const core = metrics.coreMeters / 1000;
    const coreRatio = km > 0 ? core / km : 0;
    const strongRatio = km > 0 ? strong / km : 0;
    const parallelSuspect = km >= 5 && Number.isFinite(metrics.medianMatchDistance)
      && metrics.medianMatchDistance >= 45 && coreRatio < 0.20 && strongRatio < 0.75;
    metrics.parallelSuspect = parallelSuspect;
    metrics.coreRatio = coreRatio;
    metrics.strongRatio = strongRatio;

    // 出発前に攻略対象として選んだ路線は、短距離でも候補から落とさない。
    if (planned) {
      if (parallelSuspect) return "攻略対象・並走注意";
      if (km >= 5 && longest >= 3 && strong >= 2.5) return "有力";
      if (km >= 3) return "攻略対象・短区間";
      if (km >= 0.3) return "攻略対象・要確認";
      return "除外";
    }

    // V5運用ルール：3km未満は原則除外、3〜5kmは参考、5km以上を通常判定。
    if (km < 3) return "除外";
    if (parallelSuspect) return "並走疑い";
    if (km < 5) return "短区間・参考";
    if (longest >= 3 && strong >= 2.5) return "有力";
    if (longest >= 1.5 && strong >= 1.0) return "候補";
    return "参考";
  }

  function addSharedSegmentAnalysis(results, trackSegments) {
    results.forEach(item => {
      let independentMeters = 0;
      let sharedMeters = 0;
      const sharedBy = new Map();
      for (let i = 0; i < trackSegments.length; i += 1) {
        if (!trackSegments[i].valid || !item.matchedMask[i]) continue;
        const others = results.filter(other => other !== item && other.matchedMask[i]);
        if (others.length) {
          sharedMeters += trackSegments[i].meters;
          others.forEach(other => {
            const n = String(other.route.number);
            sharedBy.set(n, (sharedBy.get(n) || 0) + trackSegments[i].meters);
          });
        } else {
          independentMeters += trackSegments[i].meters;
        }
      }
      item.independentMeters = independentMeters;
      item.sharedMeters = sharedMeters;
      item.sharedWith = [...sharedBy.entries()]
        .filter(([, meters]) => meters >= 700)
        .sort((a, b) => b[1] - a[1])
        .map(([number, meters]) => ({ number, meters }));
      const ratio = item.matchedMeters ? sharedMeters / item.matchedMeters : 0;
      item.overlapClass = sharedMeters >= 2000 && ratio >= 0.65 ? "共用区間中心" : "独立一致区間あり";
    });
  }

  async function analyzeCandidates(trackPoints) {
    const trackLatLngs = trackPoints.map(p => [p.lat, p.lon]);
    const trackBox = bbox(trackLatLngs);
    const trackSegments = buildTrackSegments(trackPoints);
    latestTrackSegments = trackSegments;
    const results = [];
    let completed = 0;
    const plannedSet = new Set(selectedTripInfo().plannedNumbers.map(String));
    const targets = routes.filter(route => route.challengeTarget !== false);

    for (const route of targets) {
      completed += 1;
      statusEl.textContent = `地図上の一致区間を照合中… ${completed}/${targets.length}`;
      try {
        const response = await fetch(GEOJSON_PATH(route.number), { cache: "no-store" });
        if (!response.ok) continue;
        const geojson = await response.json();
        const routeLines = routePolylineSample(geojson, 900);
        const routePoints = routeLines.flat();
        if (routePoints.length < 2 || !boxesNear(trackBox, bbox(routePoints), 0.02)) continue;

        const metrics = trackMapOverlapAgainstRoute(trackSegments, routeLines);
        const planned = plannedSet.has(String(route.number));
        const confidence = confidenceFor(metrics, planned);
        if (confidence !== "除外") results.push({ route, geojson, routeLines, confidence, planned, ...metrics });
      } catch {}
      if (completed % 3 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    addSharedSegmentAnalysis(results, trackSegments);
    const rank = { "有力": 6, "攻略対象・短区間": 5, "攻略対象・要確認": 4, "攻略対象・並走注意": 3, "候補": 3, "短区間・参考": 2, "参考": 1, "並走疑い": 0 };
    results.sort((a, b) => {
      const ai = a.firstMatchedIndex >= 0 ? a.firstMatchedIndex : Number.MAX_SAFE_INTEGER;
      const bi = b.firstMatchedIndex >= 0 ? b.firstMatchedIndex : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      const r = (rank[b.confidence] || 0) - (rank[a.confidence] || 0);
      if (r) return r;
      return b.matchedMeters - a.matchedMeters;
    });
    latestCandidates = results;
    return results;
  }

  function maskToPolylines(mask, trackSegments) {
    const lines = [];
    let current = [];
    for (let i = 0; i < trackSegments.length; i += 1) {
      const seg = trackSegments[i];
      if (mask[i] && seg.valid) {
        if (!current.length) current.push(seg.a);
        current.push(seg.b);
      } else if (current.length) {
        if (current.length >= 2) lines.push(current);
        current = [];
      }
    }
    if (current.length >= 2) lines.push(current);
    return lines;
  }



  function lineLength(line) {
    let meters = 0;
    for (let i = 1; i < line.length; i += 1) meters += haversine(line[i - 1], line[i]);
    return meters;
  }

  function pointAtHalfDistance(line) {
    if (!line || line.length < 2) return line && line[0] ? line[0] : null;
    const total = lineLength(line);
    if (!Number.isFinite(total) || total <= 0) return line[Math.floor(line.length / 2)];
    const target = total / 2;
    let acc = 0;
    for (let i = 1; i < line.length; i += 1) {
      const seg = haversine(line[i - 1], line[i]);
      if (acc + seg >= target) {
        const ratio = seg > 0 ? (target - acc) / seg : 0;
        return [
          line[i - 1][0] + (line[i][0] - line[i - 1][0]) * ratio,
          line[i - 1][1] + (line[i][1] - line[i - 1][1]) * ratio
        ];
      }
      acc += seg;
    }
    return line[line.length - 1];
  }

  function routeLabelPoint(item) {
    const lines = maskToPolylines(item.matchedMask, latestTrackSegments);
    if (!lines.length) return null;
    let best = lines[0];
    let bestLength = lineLength(best);
    for (let i = 1; i < lines.length; i += 1) {
      const length = lineLength(lines[i]);
      if (length > bestLength) {
        best = lines[i];
        bestLength = length;
      }
    }
    return pointAtHalfDistance(best);
  }

  function renderRouteLabels(items, activeIndex = -1) {
    routeLabelGroup.clearLayers();
    items.forEach((item, index) => {
      const point = routeLabelPoint(item);
      if (!point) return;
      const active = index === activeIndex;
      const icon = L.divIcon({
        className: 'gpx-route-label-icon',
        html: `<span class="${active ? 'is-active' : ''}">${item.route.number}</span>`,
        iconSize: [46, 26],
        iconAnchor: [23, 13]
      });
      L.marker(point, { icon, interactive: false, keyboard: false, zIndexOffset: active ? 1200 : 700 }).addTo(routeLabelGroup);
    });
  }

  function keepMapVisible() {
    const panel = document.querySelector(".gpx-map-panel");
    if (!panel) return;
    requestAnimationFrame(() => {
      map.invalidateSize();
      const rect = panel.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const visibleEnough = rect.top < viewportHeight - 120 && rect.bottom > 120;
      if (!visibleEnough) {
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  function highlightCandidate(index) {
    const item = latestCandidates[index];
    if (!item) return;
    [...candidatesEl.querySelectorAll(".gpx-candidate-row")].forEach((row, i) => row.classList.toggle("is-active", i === index));
    candidateGroup.clearLayers();
    renderRouteLabels(latestCandidates, index);

    // 国道GeoJSONは細い灰線で位置確認用。判定の正本は、その上のオレンジ色GPX一致区間。
    L.geoJSON(item.geojson, {
      style: { color: "#64748b", weight: 3, opacity: 0.32, interactive: false }
    }).addTo(candidateGroup);

    const matchedLines = maskToPolylines(item.matchedMask, latestTrackSegments);
    matchedLines.forEach(line => {
      L.polyline(line, { color: "#f97316", weight: 7, opacity: 0.95, interactive: false }).addTo(candidateGroup);
    });

    if (matchedLines.length) {
      const group = L.featureGroup(matchedLines.map(line => L.polyline(line)));
      const bounds = group.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
    }
    const shared = item.sharedWith.length
      ? `。共用候補：${item.sharedWith.slice(0, 3).map(v => `国道${v.number}号`).join("・")}`
      : "";
    mapMessageEl.textContent = `国道${item.route.number}号：オレンジ線がGPXとGeoJSONの地図上一致区間です${shared}。`;
    keepMapVisible();
  }


  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function loadStoredTrips() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function normalizeRouteNumbers(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
  }

  function selectedTripInfo() {
    const value = tripSelect.value;
    if (value === "__new__") return { index: -1, trip: null, plannedNumbers: [] };
    const index = Number(value);
    const trips = loadStoredTrips();
    const trip = Number.isInteger(index) && index >= 0 ? trips[index] : null;
    const plannedNumbers = trip && trip.planSnapshot && Array.isArray(trip.planSnapshot.routeNumbers)
      ? trip.planSnapshot.routeNumbers.map(String)
      : normalizeRouteNumbers(trip && trip.routes);
    return { index, trip, plannedNumbers };
  }

  function updateConfirmUi() {
    const count = confirmedNumbers.size;
    confirmCountEl.textContent = `${count}路線選択`;
    saveConfirmedButton.disabled = !latestAnalysis || count === 0;
    if (latestAnalysis) setFlowStage(count > 0 ? 2 : 1); else setFlowStage(0);
    [...candidatesEl.querySelectorAll(".gpx-candidate-row")].forEach(row => {
      row.classList.toggle("is-confirmed", confirmedNumbers.has(String(row.dataset.routeNumber || "")));
    });
  }

  function compactTrackPreview(points, maxPoints = 300) {
    const source = points.map(p => ({ lat: Number(p.lat), lng: Number(p.lon), time: p.time || "" }));
    if (source.length <= maxPoints) return source;
    const step = (source.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i += 1) out.push(source[Math.round(i * step)]);
    return out;
  }

  function compactPath(path, maxPoints = 180) {
    if (!Array.isArray(path) || path.length <= maxPoints) return Array.isArray(path) ? path.map(p => [Number(p[0]), Number(p[1])]) : [];
    const step = (path.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i += 1) {
      const p = path[Math.round(i * step)];
      out.push([Number(p[0]), Number(p[1])]);
    }
    return out;
  }

  function localDateFromIso(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = type => parts.find(p => p.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function candidateSaveSnapshot(item) {
    const lines = maskToPolylines(item.matchedMask, latestTrackSegments).map(line => compactPath(line));
    return {
      routeNumber: String(item.route.number),
      confidence: item.confidence,
      overlapClass: item.overlapClass,
      matchedKm: Number((item.matchedMeters / 1000).toFixed(2)),
      longestMatchedKm: Number((item.longestContinuous / 1000).toFixed(2)),
      independentKm: Number((item.independentMeters / 1000).toFixed(2)),
      sharedKm: Number((item.sharedMeters / 1000).toFixed(2)),
      sharedWith: item.sharedWith.map(v => String(v.number)),
      confirmedPaths: lines
    };
  }

  function buildRouteSegments(selectedItems, existingSegments = [], options = {}) {
    const gpxFileName = String(options.gpxFileName || "");
    const importId = String(options.importId || "");
    const replaceNumbers = new Set((options.replaceNumbers || []).map(String));
    selectedItems.forEach(item => replaceNumbers.add(String(item.route.number)));

    const keep = Array.isArray(existingSegments) ? existingSegments.filter(seg => {
      if (!seg) return false;
      const number = String(seg.routeNumber || "");
      const source = String(seg.source || "");
      const segFileName = String(seg.gpxFileName || "");
      // 同じGPXを再確定した場合は、そのGPX由来の以前の確定区間を丸ごと置換する。
      if (source === "v5-gpx-human-confirmed" && gpxFileName && segFileName === gpxFileName) return false;
      // Build43以前の区間にはgpxFileNameが無いため、同じGPXの過去確認に含まれていた路線だけ除去する。
      if (source === "v5-gpx-human-confirmed" && !segFileName && replaceNumbers.has(number)) return false;
      return true;
    }) : [];

    const added = selectedItems.map(item => {
      const snap = candidateSaveSnapshot(item);
      return {
        id: `segment-v50-gpx-${snap.routeNumber}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        routeNumber: snap.routeNumber,
        source: "v5-gpx-human-confirmed",
        verification: "human-confirmed-route",
        gpxFileName,
        materialImportId: importId,
        confirmedDistanceKm: snap.matchedKm,
        confirmedPaths: snap.confirmedPaths,
        gpxMatch: {
          confidence: snap.confidence,
          overlapClass: snap.overlapClass,
          longestMatchedKm: snap.longestMatchedKm,
          independentKm: snap.independentKm,
          sharedKm: snap.sharedKm,
          sharedWith: snap.sharedWith
        }
      };
    });
    return keep.concat(added);
  }


  function showNextStatusLink(tripIndex) {
    if (!nextStatusLink) return;
    const index = Number(tripIndex);
    nextStatusLink.href = Number.isInteger(index) && index >= 0 ? `route-status.html?trip=${index}` : "route-status.html";
    nextStatusLink.hidden = false;
  }

  function saveConfirmedRoutes() {
    if (!latestAnalysis || confirmedNumbers.size === 0) return;
    const selectedItems = latestCandidates.filter(item => confirmedNumbers.has(String(item.route.number)));
    if (!selectedItems.length) return;
    const routeText = selectedItems.map(item => `国道${item.route.number}号`).join("・");
    const target = selectedTripInfo();
    const targetText = target.trip ? `「${target.trip.tripName || "名称未登録"}」` : "新しい実走記録";
    if (!window.confirm(`${targetText}へ ${routeText} を今回走った国道として保存します。\n保存した実走区間は走破記録へ自動反映されます。通常の確認はこの1回で完了です。`)) return;

    const trips = loadStoredTrips();
    const now = new Date().toISOString();
    const a = latestAnalysis;
    const previewTrack = compactTrackPreview(a.points);
    const importRecord = {
      id: `material-v50-gpx-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      schemaVersion: 1,
      importedAt: now,
      source: "Version5.0 GPX confirmed import",
      dateRange: { start: a.startTime || "", end: a.endTime || "" },
      gpx: [{
        fileName: a.fileName,
        sizeBytes: a.fileSize || 0,
        pointCount: a.points.length,
        distanceKm: Number((a.meters / 1000).toFixed(2)),
        startTime: a.startTime || "",
        endTime: a.endTime || "",
        previewTrack
      }],
      audio: [], transcripts: [], photos: [], fileBodiesStored: false
    };
    const confirmation = {
      schemaVersion: 1,
      confirmedAt: now,
      source: "v5-gpx-map-human-confirmation",
      fileName: a.fileName,
      routeNumbers: selectedItems.map(item => String(item.route.number)),
      routes: selectedItems.map(candidateSaveSnapshot)
    };

    if (target.trip && target.index >= 0 && trips[target.index]) {
      const trip = { ...trips[target.index] };
      const sameFile = value => String(value || "") === String(a.fileName || "");
      const previousConfirmations = Array.isArray(trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations.slice() : [];
      const previousForThisFile = previousConfirmations.filter(item => sameFile(item && item.fileName));
      const previousNumbers = [...new Set(previousForThisFile.flatMap(item => Array.isArray(item.routeNumbers) ? item.routeNumbers.map(String) : []))];

      // 同じGPXを再解析・再確定した場合は、以前の同ファイル取込を置換する。
      const imports = (Array.isArray(trip.materialImports) ? trip.materialImports.slice() : []).filter(item => {
        const gpxs = Array.isArray(item && item.gpx) ? item.gpx : [];
        return !gpxs.some(g => sameFile(g && g.fileName));
      });
      imports.push(importRecord);
      trip.materialImports = imports;

      const confirmations = previousConfirmations.filter(item => !sameFile(item && item.fileName));
      confirmations.push(confirmation);
      trip.gpxRouteConfirmations = confirmations;
      const allConfirmedNumbers = [...new Set(confirmations.flatMap(item => Array.isArray(item.routeNumbers) ? item.routeNumbers.map(String) : []))];

      trip.routeSegments = buildRouteSegments(selectedItems, trip.routeSegments, {
        gpxFileName: a.fileName,
        importId: importRecord.id,
        replaceNumbers: previousNumbers
      });
      trip.routes = allConfirmedNumbers.join(",");
      trip.confirmedRouteNumbers = allConfirmedNumbers;
      trip.updatedAt = now;
      if (trip.planningStatus === "planned") trip.planningStatus = "recorded";
      trip.source = String(trip.source || "").includes("Version5.0") ? trip.source : `${trip.source || "existing trip"} + Version5.0 GPX`;
      trips[target.index] = trip;
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
      confirmStatusEl.textContent = `保存しました：${trip.tripName || "名称未登録"} ／ ${routeText}。実走区間は走破記録へ自動反映済みです。通常はここで完了です。`;
      setFlowStage(3);
      showNextStatusLink(target.index);
    } else {
      const date = localDateFromIso(a.startTime) || new Date().toISOString().slice(0,10);
      const baseName = a.fileName.replace(/\.gpx$/i, "") || `${date} 実走`;
      const trip = {
        id: `trip-v50-gpx-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        schemaVersion: 3,
        tripName: baseName,
        startDate: date,
        endDate: localDateFromIso(a.endTime) || date,
        routes: selectedItems.map(item => String(item.route.number)).join(","),
        routeSegments: buildRouteSegments(selectedItems, [], { gpxFileName: a.fileName, importId: importRecord.id }),
        actionLog: "", timeline: "", impressions: "", improvements: "", thumbnail: "", ferment: "", noteArticle: "",
        memo: `GPXから作成：${a.fileName}`,
        createdAt: now, updatedAt: now,
        source: "Version5.0 GPX human confirmed journey",
        planningStatus: "recorded",
        materialImports: [importRecord],
        confirmedRouteNumbers: confirmation.routeNumbers.slice(),
        gpxRouteConfirmations: [confirmation]
      };
      trips.push(trip);
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
      confirmStatusEl.textContent = `新しい実走記録を保存しました：${trip.tripName} ／ ${routeText}。実走区間は走破記録へ自動反映済みです。通常はここで完了です。`;
      setFlowStage(3);
      loadTrips();
      tripSelect.value = String(trips.length - 1);
      showNextStatusLink(trips.length - 1);
    }
  }

  function cityArrivalRuleTag(route) {
    const rule = route && route.completionRule;
    if (!rule || rule.type !== "city-arrival-accepted") return "";
    const cities = Array.isArray(rule.acceptedCities) ? rule.acceptedCities.filter(Boolean) : [];
    if (!cities.length) return '<span class="gpx-city-rule-tag">市内到達判定あり</span>';
    return `<span class="gpx-city-rule-tag">市内判定：${escapeHtml(cities.join("・"))}</span>`;
  }

  function renderCandidates(items) {
    candidateGroup.clearLayers();
    routeLabelGroup.clearLayers();
    candidatesEl.innerHTML = "";
    candidateCountEl.textContent = `${items.length}路線候補`;
    if (!items.length) {
      candidatesEl.innerHTML = '<div class="empty-box">地図上一致区間として判定できる国道候補はありませんでした。</div>';
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "gpx-candidate-row";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.dataset.routeNumber = String(item.route.number);
      const matchedKm = (item.matchedMeters / 1000).toFixed(1);
      const longestKm = (item.longestContinuous / 1000).toFixed(1);
      const independentKm = (item.independentMeters / 1000).toFixed(1);
      const sharedKm = (item.sharedMeters / 1000).toFixed(1);
      const sharedText = item.sharedWith.length
        ? ` ／ 共用候補：${item.sharedWith.slice(0, 3).map(v => `国道${v.number}号`).join("・")}`
        : "";
      const planned = Boolean(item.planned) || selectedTripInfo().plannedNumbers.includes(String(item.route.number));
      const cityRuleTag = cityArrivalRuleTag(item.route);
      row.dataset.overlap = item.overlapClass;
      const medianText = Number.isFinite(item.medianMatchDistance) ? ` ／ 中央距離 約${Math.round(item.medianMatchDistance)}m` : "";
      const guardTag = item.confidence === "並走疑い" ? '<span class="gpx-guard-tag">高速・並走の可能性</span>' : (item.confidence === "短区間・参考" ? '<span class="gpx-short-tag">3〜5km短区間</span>' : '');
      row.innerHTML = `<div class="gpx-candidate-check"><input type="checkbox" aria-label="国道${escapeHtml(item.route.number)}号を今回走った国道として選択"><div class="candidate-copy"><strong>${index + 1}. 国道${escapeHtml(item.route.number)}号</strong><span>${escapeHtml(item.route.start)} → ${escapeHtml(item.route.end)}</span>${planned ? '<span class="gpx-plan-tag">出発前の攻略対象</span>' : ''}${cityRuleTag}${guardTag}<em>${escapeHtml(item.overlapClass)}</em><span class="map-check">クリックで一致区間を確認</span></div></div><div><b>${escapeHtml(item.confidence)}</b><span>初回一致 ${escapeHtml(formatTimeOnly(item.firstMatchedTime))} ／ 地図一致 ${matchedKm}km ／ 最長一致 ${longestKm}km</span><span>最接近 約${Math.round(item.minDistance)}m${escapeHtml(medianText)} ／ 一致内訳：独立 ${independentKm}km ／ 共用 ${sharedKm}km${escapeHtml(sharedText)}</span></div>`;
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.checked = confirmedNumbers.has(String(item.route.number));
      if (!planned && item.confidence === "並走疑い") {
        checkbox.disabled = true;
        checkbox.title = "高速道路などの並走誤判定を疑うため、ここでは確定できません。地図で確認し、必要ならデータ管理で手動修正してください。";
      }
      checkbox.addEventListener("click", event => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        const number = String(item.route.number);
        if (checkbox.checked) confirmedNumbers.add(number); else confirmedNumbers.delete(number);
        highlightCandidate(index);
        updateConfirmUi();
      });
      row.addEventListener("click", () => highlightCandidate(index));
      row.addEventListener("keydown", event => {
        if (event.key === "Enter") {
          event.preventDefault();
          highlightCandidate(index);
        }
      });
      candidatesEl.appendChild(row);
    });

    highlightCandidate(0);
    updateConfirmUi();
  }

  async function analyze() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    analyzeButton.disabled = true;
    statusEl.textContent = "GPXを解析しています…";
    try {
      const text = await file.text();
      const points = parseGpx(text);
      const latLngs = points.map(point => [point.lat, point.lon]);
      const meters = totalDistance(latLngs);
      const timed = points.filter(point => point.time);
      const startTime = timed.length ? timed[0].time : "";
      const endTime = timed.length ? timed[timed.length - 1].time : "";

      fileNameEl.textContent = file.name;
      pointCountEl.textContent = `${points.length.toLocaleString("ja-JP")}点`;
      distanceEl.textContent = `${(meters / 1000).toFixed(1)} km`;
      startTimeEl.textContent = formatDateTime(startTime);
      endTimeEl.textContent = formatDateTime(endTime);
      durationEl.textContent = formatDuration(startTime, endTime);
      summaryEl.hidden = false;

      trackGroup.clearLayers();
      candidateGroup.clearLayers();
      routeLabelGroup.clearLayers();
      const polyline = L.polyline(latLngs, { color: "#0f766e", weight: 5, opacity: 0.86, interactive: false }).addTo(trackGroup);
      currentBounds = polyline.getBounds();
      if (currentBounds.isValid()) map.fitBounds(currentBounds, { padding: [18, 18], maxZoom: 10 });

      latestAnalysis = { fileName: file.name, fileSize: file.size || 0, points, meters, startTime, endTime };
      confirmedNumbers.clear();
      confirmStatusEl.textContent = "";
      const candidates = await analyzeCandidates(points);
      setFlowStage(1);
      renderCandidates(candidates);
      statusEl.textContent = `解析完了：${points.length.toLocaleString("ja-JP")}点／${(meters / 1000).toFixed(1)} km。候補をクリックして地図上一致区間を確認し、今回走った国道を1回だけ確定してください。`;
    } catch (error) {
      statusEl.textContent = error && error.message ? error.message : "GPX解析に失敗しました。";
      summaryEl.hidden = true;
    } finally {
      analyzeButton.disabled = !fileInput.files.length;
    }
  }

  fileInput.addEventListener("change", () => {
    latestAnalysis = null;
    confirmedNumbers.clear();
    setFlowStage(0);
    updateConfirmUi();
    confirmStatusEl.textContent = "";
    analyzeButton.disabled = !fileInput.files.length;
    statusEl.textContent = fileInput.files.length ? `選択：${fileInput.files[0].name}` : "GPXファイルを選択してください。";
  });
  analyzeButton.addEventListener("click", analyze);
  saveConfirmedButton.addEventListener("click", saveConfirmedRoutes);
  tripSelect.addEventListener("change", () => { if (latestCandidates.length) renderCandidates(latestCandidates); });
  fitButton.addEventListener("click", () => {
    candidateGroup.clearLayers();
    renderRouteLabels(latestCandidates, -1);
    [...candidatesEl.querySelectorAll(".gpx-candidate-row")].forEach(row => row.classList.remove("is-active"));
    mapMessageEl.textContent = "GPX実走線の全体表示です。候補をクリックすると一致区間を強調します。";
    if (currentBounds && currentBounds.isValid()) map.fitBounds(currentBounds, { padding: [18, 18], maxZoom: 10 });
  });

  setFlowStage(0);
  initMap();
  loadTrips();
  fetch(ROUTE_DATA_URL, { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error(`路線データ読込失敗: ${response.status}`);
      return response.json();
    })
    .then(data => { routes = Array.isArray(data) ? data : []; })
    .catch(error => { statusEl.textContent = error.message; });
})();
