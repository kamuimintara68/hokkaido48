"use strict";

(function () {
  const ROUTE_DATA_URL = "data/routes-v50.json";
  const SELECTION_KEY = "hokkaido48V50JourneyDraft";
  const REGIONS = ["道北", "道央", "道東", "道南"];
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;

  const el = id => document.getElementById(id);
  const regionButtons = el("regionButtons"), routeList = el("routeList"), routeHint = el("routeHint");
  const routeSectionTitle = el("routeSectionTitle"), statusSummary = el("statusSummary");
  const showComplete = el("showComplete"), showActualPaths = el("showActualPaths"), selectionEmpty = el("selectionEmpty");
  const selectionList = el("selectionList"), selectionActions = el("selectionActions");
  const clearSelection = el("clearSelection"), saveSelection = el("saveSelection");
  const saveMessage = el("saveMessage"), mapMessage = el("mapMessage"), fitMapButton = el("fitMap");
  const journeyName = el("journeyName"), journeyDate = el("journeyDate"), journeyMemo = el("journeyMemo");
  const confirmOverlay = el("confirmOverlay"), confirmName = el("confirmName"), confirmDate = el("confirmDate");
  const confirmRegion = el("confirmRegion"), confirmRoutes = el("confirmRoutes"), confirmMemo = el("confirmMemo");
  const cancelFormalSave = el("cancelFormalSave"), confirmFormalSave = el("confirmFormalSave");
  const savedJourneyList = el("savedJourneyList"), journeyCount = el("journeyCount");
  const roughPlanPanel = el("roughPlanPanel"), roughPlanStatus = el("roughPlanStatus");
  const roughPlanSteps = el("roughPlanSteps"), roughPlanDistance = el("roughPlanDistance");
  const rebuildRoughPlan = el("rebuildRoughPlan"), confirmRoughPlan = el("confirmRoughPlan");

  let routes = [], selectedRegion = "", selectedNumbers = [];
  let map, routeLayerGroup, routeClickLayerGroup, routeLabelLayerGroup, actualPathLayerGroup, mapBounds = null;
  let storedTrips = [];
  const geojsonCache = new Map();
  const routeLayers = new Map();
  let autoSaveTimer = null;
  let roughPlanGeneration = 0;
  let currentRoughPlan = null;
  const HOME = { label: "士別市（自宅）", point: [44.1782, 142.4004] };

  function statusClass(status) {
    if (status === "全線走破") return "complete";
    if (status === "一部走破") return "partial";
    if (status === "攻略対象外") return "excluded";
    return "untraveled";
  }

  function lineStyle(route, selected) {
    if (selected) return { color: "#7c3aed", weight: 7, opacity: 1 };
    const status = route.displayStatusPreview;
    if (status === "全線走破") return { color: "#16a34a", weight: 4, opacity: .72 };
    // 一部走破は国道全線を橙にしない。国道全体は灰、実走確定区間だけを別レイヤーで橙表示する。
    if (status === "一部走破") return { color: "#64748b", weight: 4, opacity: .58 };
    return { color: "#64748b", weight: 4, opacity: .78 };
  }

  function activeRoutesForRegion(region) {
    return routes.filter(route => route.challengeTarget !== false && (route.primaryRegion === region || (Array.isArray(route.regions) && route.regions.includes(region))));
  }
  function countByStatus(items, status) { return items.filter(r => r.displayStatusPreview === status).length; }
  function findRoute(number) { return routes.find(r => String(r.number) === String(number)); }

  function initMap() {
    map = L.map("v5Map", { zoomControl: true, preferCanvas: true }).setView([43.45, 142.65], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    map.createPane("actualPathHaloPane");
    map.getPane("actualPathHaloPane").style.zIndex = 445;
    map.createPane("actualPathPane");
    map.getPane("actualPathPane").style.zIndex = 450;
    map.createPane("routeLabelPane");
    map.getPane("routeLabelPane").style.zIndex = 620;
    map.getPane("routeLabelPane").style.pointerEvents = "none";
    map.createPane("routeClickPane");
    map.getPane("routeClickPane").style.zIndex = 650;
    routeLayerGroup = L.layerGroup().addTo(map);
    actualPathLayerGroup = L.layerGroup().addTo(map);
    routeLabelLayerGroup = L.layerGroup().addTo(map);
    routeClickLayerGroup = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
  }

  async function loadGeoJSON(route) {
    const key = String(route.number);
    if (geojsonCache.has(key)) return geojsonCache.get(key);
    const promise = fetch(GEOJSON_PATH(route.number), { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error(`国道${route.number}号 GeoJSON読込失敗`);
        return response.json();
      });
    geojsonCache.set(key, promise);
    return promise;
  }



  function collectGeoJsonLines(node, output = []) {
    if (!node || typeof node !== "object") return output;
    if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
      node.features.forEach(feature => collectGeoJsonLines(feature, output));
      return output;
    }
    if (node.type === "Feature") return collectGeoJsonLines(node.geometry, output);
    if (node.type === "LineString" && Array.isArray(node.coordinates)) {
      output.push(node.coordinates);
      return output;
    }
    if (node.type === "MultiLineString" && Array.isArray(node.coordinates)) {
      node.coordinates.forEach(line => { if (Array.isArray(line)) output.push(line); });
    }
    return output;
  }

  function lineLengthAndMidpoint(coordinates) {
    const points = (Array.isArray(coordinates) ? coordinates : [])
      .filter(point => Array.isArray(point) && point.length >= 2)
      .map(point => L.latLng(Number(point[1]), Number(point[0])))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (!points.length) return null;
    if (points.length === 1) return { length: 0, point: points[0] };
    const lengths = [];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const length = points[i - 1].distanceTo(points[i]);
      lengths.push(length);
      total += length;
    }
    const target = total / 2;
    let travelled = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const next = travelled + lengths[i];
      if (next >= target) {
        const ratio = lengths[i] ? (target - travelled) / lengths[i] : 0;
        return {
          length: total,
          point: L.latLng(
            points[i].lat + (points[i + 1].lat - points[i].lat) * ratio,
            points[i].lng + (points[i + 1].lng - points[i].lng) * ratio
          )
        };
      }
      travelled = next;
    }
    return { length: total, point: points[points.length - 1] };
  }

  function routeLabelPoint(geojson, fallbackBounds) {
    const candidates = collectGeoJsonLines(geojson)
      .map(lineLengthAndMidpoint)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (candidates.length) return candidates[0].point;
    return fallbackBounds && fallbackBounds.isValid() ? fallbackBounds.getCenter() : null;
  }


  function geometryInfoForRoute(route, geojson) {
    const rawLines = collectGeoJsonLines(geojson)
      .filter(line => Array.isArray(line) && line.length > 1);
    const candidates = rawLines.map(line => {
      const info = lineLengthAndMidpoint(line);
      return { line, info };
    }).filter(item => item.info);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.info.length - a.info.length);
    const main = candidates[0].line;
    const first = main[0], last = main[main.length - 1];
    const startPoint = [Number(first[1]), Number(first[0])];
    const endPoint = [Number(last[1]), Number(last[0])];
    const totalMeters = candidates.reduce((sum, item) => sum + item.info.length, 0);
    return { route, startPoint, endPoint, totalMeters };
  }

  function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
  }

  function chooseRoughSequence(items) {
    const remaining = items.slice();
    const sequence = [];
    let currentPoint = HOME.point;
    let connectorMeters = 0;

    while (remaining.length) {
      let best = null;
      remaining.forEach((item, index) => {
        const options = [
          { entry: item.startPoint, exit: item.endPoint, fromLabel: item.route.start, toLabel: item.route.end },
          { entry: item.endPoint, exit: item.startPoint, fromLabel: item.route.end, toLabel: item.route.start }
        ];
        options.forEach(option => {
          const gap = distanceMeters(currentPoint, option.entry);
          if (!best || gap < best.gap) best = { item, index, option, gap };
        });
      });
      connectorMeters += best.gap;
      sequence.push({
        number: String(best.item.route.number),
        name: best.item.route.name,
        fromLabel: best.option.fromLabel,
        toLabel: best.option.toLabel,
        entry: best.option.entry,
        exit: best.option.exit,
        routeMeters: best.item.totalMeters,
        connectorBeforeMeters: best.gap
      });
      currentPoint = best.option.exit;
      remaining.splice(best.index, 1);
    }

    connectorMeters += distanceMeters(currentPoint, HOME.point);
    const routeMeters = sequence.reduce((sum, item) => sum + item.routeMeters, 0);
    // 直線接続距離は実道路より短く出るため、接続区間だけ1.25倍して概算する。
    const estimatedMeters = routeMeters + connectorMeters * 1.25;
    return { sequence, routeMeters, connectorMeters, estimatedMeters };
  }

  function buildRoughPlanSteps(plan) {
    if (!plan || !plan.sequence.length) return [];
    const steps = [`${HOME.label}を出発。`];
    plan.sequence.forEach((item, index) => {
      if (index === 0) {
        steps.push(`接続区間を使い、国道${item.number}号の${item.fromLabel}側へ向かう。`);
      } else {
        const previous = plan.sequence[index - 1];
        const gapKm = item.connectorBeforeMeters / 1000;
        if (gapKm <= 15) {
          steps.push(`${previous.toLabel}付近で国道${item.number}号へ移動。`);
        } else {
          steps.push(`${previous.toLabel}付近から接続区間を使い、国道${item.number}号の${item.fromLabel}側へ移動。`);
        }
      }
      steps.push(`国道${item.number}号を${item.toLabel}方面へ。`);
    });
    const last = plan.sequence[plan.sequence.length - 1];
    steps.push(`${last.toLabel}付近から接続区間を使い、${HOME.label}へ戻る。`);
    return steps;
  }

  async function generateRoughPlan(options = {}) {
    const generation = ++roughPlanGeneration;
    const selected = selectedNumbers.map(findRoute).filter(Boolean);
    currentRoughPlan = null;
    if (!selected.length) {
      if (roughPlanPanel) roughPlanPanel.hidden = true;
      return;
    }
    roughPlanPanel.hidden = false;
    roughPlanStatus.textContent = "選択路線の位置関係から走行予定を組み立てています…";
    roughPlanSteps.innerHTML = "";
    roughPlanDistance.textContent = "";

    const results = await Promise.allSettled(selected.map(async route => {
      const geojson = await loadGeoJSON(route);
      return geometryInfoForRoute(route, geojson);
    }));
    if (generation !== roughPlanGeneration) return;
    const items = results.filter(result => result.status === "fulfilled" && result.value).map(result => result.value);
    const failed = selected.length - items.length;
    if (!items.length) {
      roughPlanStatus.textContent = "路線位置を読み込めず、走行予定を作成できませんでした。";
      return;
    }

    const plan = chooseRoughSequence(items);
    plan.steps = buildRoughPlanSteps(plan);
    plan.generatedAt = new Date().toISOString();
    plan.homeLabel = HOME.label;
    plan.homePoint = HOME.point.slice();
    plan.routeNumbers = plan.sequence.map(item => item.number);
    plan.failedRouteCount = failed;
    currentRoughPlan = plan;

    roughPlanStatus.textContent = failed ? `${items.length}路線で作成。${failed}路線は地図データを読み込めませんでした。` : "選択路線を地理的につなぎやすい順に並べた目安です。";
    roughPlanSteps.innerHTML = plan.steps.map((step, index) => `<li>${index === 0 || index === plan.steps.length - 1 ? escapeHtml(step) : escapeHtml(step).replace(/国道(\d+)号/g, '<strong>国道$1号</strong>')}</li>`).join("");
    roughPlanDistance.textContent = `概算走行距離：約${Math.round(plan.estimatedMeters / 1000)} km（道路ナビではなく地理データからの目安）`;
    if (!options.skipSave) saveDraft({ silent: true });
  }

  function serializeRoughPlan() {
    if (!currentRoughPlan) return null;
    return {
      version: 1,
      generatedAt: currentRoughPlan.generatedAt,
      homeLabel: currentRoughPlan.homeLabel,
      homePoint: currentRoughPlan.homePoint,
      routeNumbers: currentRoughPlan.routeNumbers,
      steps: currentRoughPlan.steps,
      estimatedKm: Math.round(currentRoughPlan.estimatedMeters / 1000)
    };
  }

  function loadStoredTrips() {
    try {
      const raw = localStorage.getItem("hokkaido48Trips");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("既存の旅データを読み込めませんでした", error);
      return [];
    }
  }


  function routeNumbersFromTrip(trip) {
    if (!trip || typeof trip !== "object") return [];
    if (trip.planSnapshot && Array.isArray(trip.planSnapshot.routeNumbers)) {
      return trip.planSnapshot.routeNumbers.map(String).filter(Boolean);
    }
    if (Array.isArray(trip.routeSegments) && trip.routeSegments.length) {
      return [...new Set(trip.routeSegments.map(segment => String(segment && segment.routeNumber || "")).filter(Boolean))];
    }
    if (Array.isArray(trip.routes)) return trip.routes.map(String).filter(Boolean);
    if (typeof trip.routes === "string") {
      return trip.routes.split(/[、,\s→/]+/).map(value => value.replace(/[^0-9]/g, "")).filter(Boolean);
    }
    return [];
  }

  function tripDateLabel(trip) {
    const start = trip && (trip.startDate || trip.date || trip.plannedDate) || "";
    const end = trip && trip.endDate || "";
    if (!start) return "日付未登録";
    if (!end || end === start) return start;
    return `${start} ～ ${end}`;
  }

  function tripMemoText(trip) {
    const candidates = [trip && trip.memo, trip && trip.impressions, trip && trip.actionLog];
    return String(candidates.find(value => typeof value === "string" && value.trim()) || "").trim();
  }

  function renderSavedJourneys() {
    if (!savedJourneyList || !journeyCount) return;
    savedJourneyList.innerHTML = "";
    journeyCount.textContent = `${storedTrips.length}件`;
    if (!storedTrips.length) {
      savedJourneyList.innerHTML = '<div class="empty-box">保存済みの旅はありません。</div>';
      return;
    }

    storedTrips.map((trip, originalIndex) => ({ trip, originalIndex })).sort((a, b) => {
      const da = String(a.trip && (a.trip.startDate || a.trip.date || a.trip.plannedDate) || "");
      const db = String(b.trip && (b.trip.startDate || b.trip.date || b.trip.plannedDate) || "");
      return db.localeCompare(da);
    }).forEach(({ trip, originalIndex }) => {
      const card = document.createElement("article");
      card.className = "saved-journey-card";
      const name = String(trip && (trip.tripName || trip.displayName || trip.name) || "名称未登録");
      const routeNumbers = routeNumbersFromTrip(trip);
      const routeText = routeNumbers.length ? routeNumbers.map(number => `国道${number}号`).join(" → ") : "路線情報なし";
      const memo = tripMemoText(trip);
      const planned = trip && trip.planningStatus === "planned";
      const region = trip && trip.selectedRegion ? String(trip.selectedRegion) : "";
      const savedRoughPlan = trip && trip.planSnapshot && trip.planSnapshot.roughPlan;
      const roughPlanText = savedRoughPlan && Array.isArray(savedRoughPlan.steps) ? savedRoughPlan.steps.join(" ") : "";
      card.innerHTML = `
        <div class="saved-journey-card-head">
          <div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(tripDateLabel(trip))}${region ? ` ／ ${escapeHtml(region)}` : ""}</p></div>
          <span class="journey-kind ${planned ? "planned" : "recorded"}">${planned ? "計画" : "実走記録"}</span>
        </div>
        <div class="saved-journey-routes">${escapeHtml(routeText)}</div>
        ${roughPlanText ? `<div class="saved-journey-plan"><strong>ざっくり走行予定</strong>${escapeHtml(roughPlanText)}${savedRoughPlan.estimatedKm ? `<br>概算：約${escapeHtml(savedRoughPlan.estimatedKm)} km` : ""}</div>` : ""}
        ${memo ? `<p class="saved-journey-memo">${escapeHtml(memo)}</p>` : ""}
        ${planned ? `<div class="saved-journey-actions"><button class="journey-open-button" type="button">この計画を開く</button><a class="journey-gpx-button" href="gpx-import.html?trip=${originalIndex}">この旅にGPXを取り込む</a><button class="journey-delete-button" type="button">この計画を削除</button></div>` : `<div class="saved-journey-actions"><a class="journey-gpx-button" href="route-status.html?trip=${originalIndex}">走破状態を確認</a></div>`}
      `;
      if (planned) {
        const openButton = card.querySelector(".journey-open-button");
        const deleteButton = card.querySelector(".journey-delete-button");
        openButton.addEventListener("click", () => openPlannedJourney(originalIndex));
        deleteButton.addEventListener("click", () => deletePlannedJourney(originalIndex, name));
      }
      savedJourneyList.appendChild(card);
    });
  }

  function openPlannedJourney(originalIndex) {
    const currentTrips = loadStoredTrips();
    const trip = currentTrips[originalIndex];
    if (!trip || trip.planningStatus !== "planned") {
      alert("この旅は計画として開けません。実走記録は保護されています。");
      return;
    }
    const numbers = routeNumbersFromTrip(trip);
    const snap = trip.planSnapshot || {};
    const draft = {
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      displayName: trip.tripName || "",
      journeyName: trip.tripName || "",
      plannedDate: trip.startDate || "",
      memo: trip.memo || "",
      selectedRegion: trip.selectedRegion || "",
      routeNumbers: numbers.slice(),
      routes: numbers.map(number => findRoute(number)).filter(Boolean).map(route => ({
        number: route.number, name: route.name, start: route.start, end: route.end, status: route.displayStatusPreview
      })),
      roughPlan: snap.roughPlan || null,
      editingTripId: trip.id || "",
      source: "v5-open-planned-journey"
    };
    localStorage.setItem(SELECTION_KEY, JSON.stringify(draft));
    window.location.href = "journey-plan.html";
  }

  function deletePlannedJourney(originalIndex, name) {
    const currentTrips = loadStoredTrips();
    const trip = currentTrips[originalIndex];
    if (!trip || trip.planningStatus !== "planned") {
      alert("この旅は削除対象ではありません。実走記録は保護されています。");
      return;
    }
    if (!confirm(`計画「${name}」を削除しますか？\n実走記録は削除されません。`)) return;
    currentTrips.splice(originalIndex, 1);
    localStorage.setItem("hokkaido48Trips", JSON.stringify(currentTrips));
    storedTrips = currentTrips;
    renderSavedJourneys();
    renderMap();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function normalizePath(path) {
    if (!Array.isArray(path)) return [];
    return path.filter(point => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(point => [Number(point[0]), Number(point[1])]);
  }

  function segmentPaths(segment) {
    const paths = [];
    if (Array.isArray(segment.confirmedPaths)) {
      segment.confirmedPaths.forEach(path => { const normalized = normalizePath(path); if (normalized.length > 1) paths.push(normalized); });
    }
    if (!paths.length && Array.isArray(segment.confirmedPath)) {
      const normalized = normalizePath(segment.confirmedPath); if (normalized.length > 1) paths.push(normalized);
    }
    return paths;
  }

  function confirmationPaths(trip, routeNumber) {
    const paths = [];
    const confirmations = Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : [];
    confirmations.forEach(confirmation => {
      const items = Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : [];
      items.forEach(item => {
        if (String(item && (item.routeNumber ?? item.number) || "") !== String(routeNumber)) return;
        const confirmedPaths = Array.isArray(item && item.confirmedPaths) ? item.confirmedPaths : [];
        confirmedPaths.forEach(path => {
          const normalized = normalizePath(path);
          if (normalized.length > 1) paths.push(normalized);
        });
      });
    });
    return paths;
  }

  function confirmedPathsForRoute(routeNumber) {
    const paths = [];
    storedTrips.forEach(trip => {
      const segments = Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : [];
      let foundInSegments = false;
      segments.forEach(segment => {
        if (String(segment && segment.routeNumber || "") !== String(routeNumber)) return;
        const segmentConfirmed = segmentPaths(segment);
        if (segmentConfirmed.length) foundInSegments = true;
        paths.push(...segmentConfirmed);
      });
      // V5のgpxRouteConfirmationsはrouteSegmentsと同じ線を持つため、segment側が無い場合だけ補完する。
      if (!foundInSegments) paths.push(...confirmationPaths(trip, routeNumber));
    });
    return paths;
  }

  function promoteStatusesFromTripEvidence() {
    routes.forEach(route => {
      if (route.challengeTarget === false || route.displayStatusPreview === "全線走破") return;
      if (confirmedPathsForRoute(route.number).length) {
        route.displayStatusPreview = "一部走破";
        route.statusSource = "Trip実走線";
      }
    });
  }

  function routeBelongsToRegion(routeNumber, region) {
    const route = findRoute(routeNumber);
    if (!route) return false;
    if (route.primaryRegion === region) return true;
    return Array.isArray(route.regions) && route.regions.includes(region);
  }

  function tripBelongsToRegion(trip, region) {
    const segments = Array.isArray(trip.routeSegments) ? trip.routeSegments : [];
    return segments.some(segment => routeBelongsToRegion(String(segment.routeNumber || ""), region));
  }


  function judgementPaths(trip, routeNumber) {
    const judgement = trip && trip.autoRouteJudgement;
    if (!judgement) return [];
    // 人間確認前のneedsReviewは「実際に走った国道」として表示しない。
    const candidates = []
      .concat(Array.isArray(judgement.autoAccepted) ? judgement.autoAccepted : []);
    const hit = candidates.find(item => String(item && item.number) === String(routeNumber));
    if (!hit || !Array.isArray(hit.matchedChunks)) return [];
    return hit.matchedChunks
      .map(normalizePath)
      .filter(path => path.length > 1);
  }

  function renderActualPaths() {
    actualPathLayerGroup.clearLayers();
    if (!showActualPaths.checked) return { pathCount: 0, tripCount: 0, fallbackCount: 0 };

    let pathCount = 0;
    let tripCount = 0;
    let fallbackCount = 0;
    let actualBounds = null;

    // 地区選択は攻略候補一覧の絞り込みにだけ使用する。
    // 実走線は全ての保存済み旅を共通表示し、地区切替で欠落させない。
    const tripsToRender = storedTrips;

    tripsToRender.forEach(trip => {
      tripCount += 1;

      const segments = Array.isArray(trip.routeSegments) ? trip.routeSegments : [];
      // 生GPX全体は資料として保持しても、「実際に走った線」には使わない。
      // V4/V5とも routeSegments の confirmedPath(s) を最優先し、国道として確定した区間だけ描画する。
      segments.forEach(segment => {
        const routeNumber = String(segment.routeNumber || "");
        let paths = segmentPaths(segment);
        let sourceLabel = "確定実走線";
        if (!paths.length) {
          paths = judgementPaths(trip, routeNumber);
          if (paths.length) {
            sourceLabel = "判定記録から復元";
            fallbackCount += paths.length;
          }
        }
        paths.forEach(path => {
          const halo = L.polyline(path, { pane:"actualPathHaloPane", color:"#ffffff", weight:9, opacity:.92, interactive:false });
          const line = L.polyline(path, { pane:"actualPathPane", color:"#f97316", weight:5, opacity:1, interactive:false });
          line.bindTooltip(`<span class="actual-path-label">${trip.tripName || "保存済みの旅"}</span><br>国道${routeNumber}号の実走線<br><small>${sourceLabel}</small>`, { sticky:true });
          halo.addTo(actualPathLayerGroup);
          line.addTo(actualPathLayerGroup);
          const bounds = line.getBounds();
          if (bounds.isValid()) actualBounds = actualBounds ? actualBounds.extend(bounds) : bounds;
          pathCount += 1;
        });
      });
    });

    return { pathCount, tripCount, fallbackCount, bounds: actualBounds };
  }

  async function renderMap() {
    if (!map) return;
    routeLayerGroup.clearLayers();
    actualPathLayerGroup.clearLayers();
    routeClickLayerGroup.clearLayers();
    routeLabelLayerGroup.clearLayers();
    routeLayers.clear();
    mapBounds = null;

    const visible = routes.filter(route => route.challengeTarget !== false);
    mapMessage.textContent = "北海道全体の路線状況を読み込んでいます…";

    const results = await Promise.allSettled(visible.map(async route => {
      const geojson = await loadGeoJSON(route);
      const selected = selectedNumbers.includes(String(route.number));
      const layer = L.geoJSON(geojson, {
        style: lineStyle(route, selected),
        interactive: false
      });
      layer.addTo(routeLayerGroup);

      // 見た目とは別に、太い透明線を最前面へ置いてクリック判定を安定させる。
      const clickLayer = L.geoJSON(geojson, {
        pane: "routeClickPane",
        renderer: L.svg({ pane: "routeClickPane" }),
        style: { className: "route-click-target", color: "transparent", weight: 24, opacity: 0, fillOpacity: 0, interactive: true },
        onEachFeature: (_feature, featureLayer) => {
          // 大きな黒枠状ツールチップは表示せず、クリック操作だけを受け付ける。
          featureLayer.on("click", event => {
            if (event && event.originalEvent) L.DomEvent.stop(event.originalEvent);
            toggleRoute(String(route.number));
          });
        }
      });
      clickLayer.addTo(routeClickLayerGroup);

      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        const labelPoint = routeLabelPoint(geojson, bounds);
        const label = L.marker(labelPoint, {
          pane: "routeLabelPane",
          interactive: false,
          icon: L.divIcon({
            className: "route-number-map-icon",
            html: `<span>${route.number}</span>`,
            iconSize: null,
            iconAnchor: [18, 14]
          })
        });
        label.addTo(routeLabelLayerGroup);
        mapBounds = mapBounds ? mapBounds.extend(bounds) : bounds;
      }
      routeLayers.set(String(route.number), { layer, clickLayer, route });
    }));

    const failed = results.filter(r => r.status === "rejected").length;
    const actualResult = renderActualPaths();
    if (actualResult.bounds && actualResult.bounds.isValid()) {
      mapBounds = mapBounds ? mapBounds.extend(actualResult.bounds) : actualResult.bounds;
    }
    if (mapBounds && mapBounds.isValid()) map.fitBounds(mapBounds, { padding: [18, 18], maxZoom: 7 });
    const fallbackText = actualResult.fallbackCount ? `（うち判定記録から復元${actualResult.fallbackCount}区間）` : "";
    const actualText = showActualPaths.checked ? ` 保存済みの旅${actualResult.tripCount}件の確定国道実走線${actualResult.pathCount}区間${fallbackText}を全道共通で重ねています。` : "";
    mapMessage.textContent = failed
      ? `${visible.length - failed}路線を全地区共通で表示。${failed}路線は地図データを読み込めませんでした。${actualText}`
      : `${visible.length}路線を全地区共通で表示しています。${actualText}地図上の路線をクリックして選択・解除できます。`;
    setTimeout(() => map.invalidateSize(), 50);
  }

  function refreshMapStyles() {
    routeLayers.forEach(({ layer, route }, number) => {
      layer.setStyle(lineStyle(route, selectedNumbers.includes(number)));
      if (selectedNumbers.includes(number)) layer.bringToFront();
    });
  }

  function renderRegionButtons() {
    regionButtons.innerHTML = "";
    REGIONS.forEach(region => {
      const items = activeRoutesForRegion(region);
      const remaining = items.filter(r => r.displayStatusPreview !== "全線走破").length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "region-button";
      button.classList.toggle("active", selectedRegion === region);
      button.innerHTML = `<strong>${region}</strong><span>攻略候補 ${remaining}路線</span>`;
      button.addEventListener("click", () => { selectedRegion = region; renderAll(true); scheduleAutoSave("地区選択を自動保存しました"); });
      regionButtons.appendChild(button);
    });
  }

  function renderSummary(items) {
    const values = [["未走破", "untraveled"], ["一部走破", "partial"], ["全線走破", "complete"]];
    statusSummary.innerHTML = values.map(([label, cls]) => `<div class="summary-chip ${cls}"><strong>${countByStatus(items, label)}</strong>${label}</div>`).join("");
  }

  function renderRoutes() {
    routeList.innerHTML = "";
    if (!selectedRegion) {
      routeSectionTitle.textContent = "攻略する路線を選ぶ";
      routeHint.textContent = "最初に地区を選んでください。";
      renderSummary([]);
      return;
    }
    const all = activeRoutesForRegion(selectedRegion);
    const visible = all.filter(r => showComplete.checked || r.displayStatusPreview !== "全線走破");
    routeSectionTitle.textContent = `${selectedRegion}の攻略候補`;
    routeHint.textContent = "一覧または地図上の路線をクリックすると、走行順の目安に追加されます。";
    renderSummary(all);
    visible.forEach(route => {
      const number = String(route.number);
      const card = document.createElement("button");
      card.type = "button"; card.className = "route-card";
      card.classList.toggle("selected", selectedNumbers.includes(number));
      card.innerHTML = `<span class="route-number">${number}</span><span class="route-main"><strong>${route.name}</strong><span>${route.start} → ${route.end}</span></span><span class="status-badge ${statusClass(route.displayStatusPreview)}">${route.displayStatusPreview}</span>`;
      card.addEventListener("click", () => toggleRoute(number));
      routeList.appendChild(card);
    });
  }

  function toggleRoute(number) {
    const index = selectedNumbers.indexOf(number);
    if (index >= 0) selectedNumbers.splice(index, 1); else selectedNumbers.push(number);
    saveMessage.textContent = "";
    renderRoutes(); renderSelection(); refreshMapStyles();
    // 画面遷移が直後でも選択解除・追加を失わないよう、路線選択だけは即時保存する。
    saveDraft({ silent: true });
    generateRoughPlan();
    scheduleAutoSave("路線選択を自動保存しました");
  }

  function renderSelection() {
    selectionList.innerHTML = "";
    const selected = selectedNumbers.map(findRoute).filter(Boolean);
    selectionEmpty.hidden = selected.length > 0;
    selectionActions.hidden = selected.length === 0;
    selected.forEach(route => {
      const item = document.createElement("li"); item.className = "selection-item";
      item.innerHTML = `<strong>国道${route.number}号</strong><span>${route.start} → ${route.end} ／ ${route.displayStatusPreview}</span>`;
      selectionList.appendChild(item);
    });
  }

  function saveDraft(options = {}) {
    const selected = selectedNumbers.map(findRoute).filter(Boolean);
    const name = (journeyName.value || "").trim();
    const date = journeyDate.value || "";
    const memo = (journeyMemo.value || "").trim();
    const draft = {
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      displayName: name || "今回の旅（Version 5.0試作）",
      journeyName: name,
      plannedDate: date,
      memo,
      selectedRegion,
      routeNumbers: selectedNumbers.slice(),
      routes: selected.map(route => ({ number: route.number, name: route.name, start: route.start, end: route.end, status: route.displayStatusPreview })),
      roughPlan: serializeRoughPlan(),
      source: "v5-prototype-map-autosave"
    };
    localStorage.setItem(SELECTION_KEY, JSON.stringify(draft));
    if (options.silent) return;
    const detail = [name, date].filter(Boolean).join(" ／ ");
    saveMessage.textContent = options.message || `保存しました${detail ? `：${detail}` : ""}　${selectedNumbers.map(n => `国道${n}号`).join(" → ")}`;
  }

  function scheduleAutoSave(message = "下書きを自動保存しました") {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => saveDraft({ message }), 180);
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(SELECTION_KEY); if (!raw) return;
      const draft = JSON.parse(raw); if (!draft || !Array.isArray(draft.routeNumbers)) return;
      selectedRegion = REGIONS.includes(draft.selectedRegion) ? draft.selectedRegion : "";
      selectedNumbers = draft.routeNumbers.map(String).filter(number => findRoute(number));
      journeyName.value = draft.journeyName || (draft.displayName && !String(draft.displayName).includes("Version 5.0試作") ? draft.displayName : "");
      journeyDate.value = draft.plannedDate || "";
      journeyMemo.value = draft.memo || "";
    } catch { selectedNumbers = []; }
  }

  function renderAll(redrawMap) {
    renderRegionButtons(); renderRoutes(); renderSelection(); renderSavedJourneys();
    if (redrawMap) renderMap(); else refreshMapStyles();
  }

  showComplete.addEventListener("change", renderRoutes);
  showActualPaths.addEventListener("change", renderMap);
  clearSelection.addEventListener("click", () => {
    selectedNumbers = [];
    renderRoutes();
    renderSelection();
    refreshMapStyles();
    roughPlanGeneration += 1;
    currentRoughPlan = null;
    if (roughPlanPanel) roughPlanPanel.hidden = true;
    // 全解除も即時保存し、別画面側が過去の選択を復元しないようにする。
    saveDraft({ silent: true });
    scheduleAutoSave("選択解除を自動保存しました");
  });
  function buildFormalTrip() {
    const name = (journeyName.value || "").trim();
    const date = journeyDate.value || "";
    const memo = (journeyMemo.value || "").trim();
    const now = new Date().toISOString();
    return {
      id: `trip-v50-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      schemaVersion: 2,
      tripName: name,
      startDate: date,
      endDate: date,
      routes: selectedNumbers.join(","),
      routeSegments: [],
      actionLog: "",
      timeline: "",
      impressions: "",
      improvements: "",
      thumbnail: "",
      ferment: "",
      noteArticle: "",
      memo,
      createdAt: now,
      updatedAt: now,
      source: "Version5.0 planned journey",
      planningStatus: "planned",
      selectedRegion,
      planSnapshot: {
        version: 1,
        savedAt: now,
        planName: name,
        routeNumbers: selectedNumbers.slice(),
        roughPlan: serializeRoughPlan(),
        source: "v5-formal-save"
      }
    };
  }

  function validateFormalTrip() {
    if (!(journeyName.value || "").trim()) return "旅名を入力してください。";
    if (!journeyDate.value) return "実施予定日を入力してください。";
    if (!selectedNumbers.length) return "攻略路線を1本以上選んでください。";
    return "";
  }

  function openFormalSaveDialog() {
    const error = validateFormalTrip();
    if (error) { saveMessage.textContent = error; return; }
    confirmName.textContent = journeyName.value.trim();
    confirmDate.textContent = journeyDate.value;
    confirmRegion.textContent = selectedRegion || "未選択";
    confirmRoutes.textContent = selectedNumbers.map(n => `国道${n}号`).join(" → ");
    confirmRoughPlan.textContent = currentRoughPlan && currentRoughPlan.steps.length
      ? `${currentRoughPlan.steps.join(" ")}\n概算：約${Math.round(currentRoughPlan.estimatedMeters / 1000)} km`
      : "未作成";
    confirmMemo.textContent = journeyMemo.value.trim() || "なし";
    confirmOverlay.hidden = false;
    confirmFormalSave.focus();
  }

  function closeFormalSaveDialog() {
    confirmOverlay.hidden = true;
    saveSelection.focus();
  }

  function saveFormalTrip() {
    const error = validateFormalTrip();
    if (error) { closeFormalSaveDialog(); saveMessage.textContent = error; return; }
    const currentTrips = loadStoredTrips();
    const trip = buildFormalTrip();
    currentTrips.push(trip);
    localStorage.setItem("hokkaido48Trips", JSON.stringify(currentTrips));
    storedTrips = currentTrips;
    saveDraft({ silent: true });
    confirmOverlay.hidden = true;
    saveMessage.textContent = `旅を追加保存しました：${trip.tripName}（${selectedNumbers.map(n => `国道${n}号`).join(" → ")}）`;
    renderSavedJourneys();
    renderMap();
  }

  saveSelection.addEventListener("click", openFormalSaveDialog);
  cancelFormalSave.addEventListener("click", closeFormalSaveDialog);
  confirmFormalSave.addEventListener("click", saveFormalTrip);
  confirmOverlay.addEventListener("click", event => { if (event.target === confirmOverlay) closeFormalSaveDialog(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !confirmOverlay.hidden) closeFormalSaveDialog(); });
  [journeyName, journeyDate, journeyMemo].forEach(input => input.addEventListener("input", () => scheduleAutoSave("入力内容を自動保存しました")));

  // 戻る操作でBFCacheから復元された場合も、localStorageを正として選択状態を同期する。
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    restoreDraft();
    renderAll(false);
    generateRoughPlan();
  });
  if (rebuildRoughPlan) rebuildRoughPlan.addEventListener("click", () => generateRoughPlan());
  fitMapButton.addEventListener("click", () => { if (mapBounds && mapBounds.isValid()) map.fitBounds(mapBounds, { padding: [18, 18], maxZoom: 9 }); });
  if (openPlan) {
    openPlan.addEventListener("click", event => {
      event.preventDefault();
      const target = document.getElementById("savedJourneys");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }


  initMap();
  fetch(ROUTE_DATA_URL, { cache: "no-store" })
    .then(response => { if (!response.ok) throw new Error(`路線データ読込失敗: ${response.status}`); return response.json(); })
    .then(data => {
      routes = Array.isArray(data) ? data : [];
      storedTrips = loadStoredTrips();
      // routes-v50の既存状態より先にTripの確定実走線を拾い、未走破の取りこぼしを「一部走破」へ反映する。
      // その後、V5走破確定・手動状態を正本として上書きする。
      promoteStatusesFromTripEvidence();
      try {
        const confirmed = JSON.parse(localStorage.getItem("hokkaido48V5ConfirmedRouteStatus") || "{}");
        const manual = JSON.parse(localStorage.getItem("hokkaido48V5ManualRouteStatus") || "{}");
        routes.forEach(route => {
          const confirmedEntry = confirmed && confirmed[String(route.number)];
          const confirmedStatus = typeof confirmedEntry === "string" ? confirmedEntry : confirmedEntry && confirmedEntry.status;
          if (["未走破", "一部走破", "全線走破"].includes(confirmedStatus)) {
            route.displayStatusPreview = confirmedStatus;
            route.statusSource = "V5走破確定";
          }
          const override = manual && manual[String(route.number)];
          if (["未走破", "一部走破", "全線走破"].includes(override)) {
            route.displayStatusPreview = override;
            route.statusSource = "手動";
          }
        });
      } catch (error) { console.warn("Route状態を読み込めませんでした", error); }
      restoreDraft();
      renderAll(true);
      generateRoughPlan({ skipSave: true });
    })
    .catch(error => { routeHint.textContent = error.message; routeList.innerHTML = `<div class="empty-box">路線データを読み込めませんでした。</div>`; mapMessage.textContent = error.message; });
})();
