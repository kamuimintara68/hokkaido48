"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const GEOCODE_CACHE_KEY = "hokkaido48GeocodeCandidatesV2";
  const GSI_GEOCODER_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";

  const areaButtons = document.getElementById("homeAreaButtons");
  const planList = document.getElementById("homePlanList");
  const selectedBox = document.getElementById("homeSelectedPlan");
  const selectedContent = document.getElementById("homeSelectedPlanContent");

  if (!areaButtons || !planList || !selectedBox || !selectedContent) return;

  // 以前の「route=242」等がトップ画面へ残っていると、
  // app.js がその単一路線を選択表示するため、プラン画面では削除する。
  const cleanUrl = new URL(window.location.href);
  if (cleanUrl.searchParams.has("route")) {
    cleanUrl.searchParams.delete("route");
    window.history.replaceState(null, "", cleanUrl);
  }

  const plans = [
    {
      area:"道北", planName:"R40北上2時間 実走総合テスト",
      targetRoutes:"40", routeNumbers:["40"], origin:"士別市", destination:"士別市",
      distance:"約120km", stay:"日帰り", waypoints:["名寄市","美深町","名寄市"],
      fullRouteSpec:"40:美深町→40:士別市", sample:false
    },
    {
      area:"道北", planName:"7/12実走再現テスト",
      targetRoutes:"40→12→233→275→451→231",
      routeNumbers:["40","12","233","275","451","231"], origin:"士別市", destination:"士別市",
      distance:"約385.9km", stay:"日帰り",
      waypoints:["深川市","沼田町","雨竜町","滝川市","留萌市","増毛町"],
      fullRouteSpec:"40:旭川市→12:深川市→233:沼田町→275:滝川市→451:石狩市浜益区→231:留萌市→233:深川市→12:旭川市→40:士別市",
      sample:false
    }
  ];

  const routeGeometryCache = new Map();
  let selectedArea = "";
  let selectedTrackLayer = null;

  function identity(plan) {
    return [plan.planName, plan.targetRoutes, plan.origin, plan.destination].join("|");
  }

  function toActivePlan(plan, track) {
    const active = {
      schemaVersion:1,
      selectedAt:new Date().toISOString(),
      id:identity(plan),
      planName:plan.planName,
      targetRoutes:plan.targetRoutes,
      routeNumbers:plan.routeNumbers,
      origin:plan.origin,
      destination:plan.destination,
      waypoints:plan.waypoints,
      fullRouteSpec:plan.fullRouteSpec,
      source:plan.sample ? "home-plan-selector-sample" : "home-plan-selector-v40"
    };

    if (track && Array.isArray(track.points) && track.points.length >= 2) {
      active.fullRouteLegs = track.fullRouteLegs;
      active.plannedPreview = {
        version: 7,
        kind: "full-track",
        name: track.name,
        generatedAt: new Date().toISOString(),
        distanceKm: Number(track.distanceKm.toFixed(1)),
        points: track.points.map(point => [point.lat, point.lng])
      };
    }

    return active;
  }

  function readActivePlan() {
    try {
      const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function planFromActive(active) {
    return active ? (plans.find(plan => identity(plan) === active.id) || null) : null;
  }

  function setArea(area) {
    selectedArea = area;
    [...areaButtons.querySelectorAll("button")].forEach(button => {
      button.classList.toggle("active", button.dataset.area === area);
    });
    renderPlans();
  }

  function renderPlans() {
    planList.innerHTML = "";
    const active = readActivePlan();

    plans.filter(plan => plan.area === selectedArea).forEach(plan => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "home-plan-card";
      if (active && active.id === identity(plan)) card.classList.add("active");

      const name = document.createElement("strong");
      name.textContent = plan.planName;

      const route = document.createElement("span");
      route.textContent = `士別発着 ／ 国道：${plan.routeNumbers.join(" → ")}`;

      const summary = document.createElement("span");
      summary.textContent = [plan.stay, plan.distance, plan.sample ? "表示確認用" : ""]
        .filter(Boolean).join(" ／ ");

      card.append(name, route, summary);
      card.addEventListener("click", () => selectPlan(plan, card));
      planList.appendChild(card);
    });
  }

  function renderSelected(plan, track, message) {
    selectedContent.innerHTML = "";

    const summary = document.createElement("p");
    summary.textContent =
      `${plan.planName} ／ 士別発着 ／ ${plan.routeNumbers.map(n => `国道${n}号`).join(" → ")}`;
    selectedContent.append(summary);

    const detail = document.createElement("p");
    if (message) {
      detail.textContent = message;
    } else if (track) {
      detail.textContent = `予定Track：約${track.distanceKm.toFixed(1)}km`;
    }
    if (detail.textContent) selectedContent.append(detail);

    const navButton = selectedBox.querySelector(".home-nav-button");
    if (navButton) {
      if (plan.sample) {
        navButton.textContent = "表示確認用サンプル（ナビ準備はしない）";
        navButton.removeAttribute("href");
        navButton.setAttribute("aria-disabled","true");
        navButton.style.opacity = ".55";
        navButton.style.pointerEvents = "none";
      } else {
        navButton.textContent = "このプランでナビ準備へ";
        navButton.href = "plan.html";
        navButton.removeAttribute("aria-disabled");
        navButton.style.opacity = "";
        navButton.style.pointerEvents = "";
      }
    }

    selectedBox.hidden = false;
  }

  function parseFullRouteSpec(value) {
    return String(value || "")
      .normalize("NFKC")
      .split(/[→>\n\r]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .map((item, index) => {
        const match = item.match(/^(?:国道)?\s*(\d+)\s*号?\s*[:：]\s*(.+)$/);
        if (!match) throw new Error(`全行程ルートの${index + 1}区間を読めません。`);
        return {routeNumber:String(Number(match[1])), endPlace:String(match[2]).trim()};
      });
  }

  function collectLineStrings(geojson) {
    const lines = [];
    function walkGeometry(geometry) {
      if (!geometry || !geometry.type) return;
      if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
        lines.push(geometry.coordinates);
      } else if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
        geometry.coordinates.forEach(line => lines.push(line));
      } else if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
        geometry.geometries.forEach(walkGeometry);
      }
    }
    if (geojson && Array.isArray(geojson.features)) {
      geojson.features.forEach(feature => walkGeometry(feature && feature.geometry));
    } else if (geojson && geojson.geometry) {
      walkGeometry(geojson.geometry);
    }
    return lines;
  }

  async function loadRouteGeometry(routeNumber) {
    const number = String(Number(routeNumber));
    if (routeGeometryCache.has(number)) return routeGeometryCache.get(number);

    const response = await fetch(
      `data/geojson/route_${number.padStart(3,"0")}.geojson`,
      {cache:"no-store"}
    );
    if (!response.ok) throw new Error(`国道${number}号の路線データを読み込めません。`);

    const geojson = await response.json();
    const lines = collectLineStrings(geojson)
      .map(line => line.map(point => ({lng:Number(point[0]),lat:Number(point[1])}))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)))
      .filter(line => line.length >= 2);

    if (!lines.length) throw new Error(`国道${number}号の座標データがありません。`);

    const coords = lines.sort((a,b)=>b.length-a.length)[0];
    routeGeometryCache.set(number, coords);
    return coords;
  }

  function distanceMeters(a,b) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad;
    const lat2 = b.lat * rad;
    const dLat = (b.lat-a.lat)*rad;
    const dLng = (b.lng-a.lng)*rad;
    const h = Math.sin(dLat/2)**2 +
      Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  }

  function readGeocodeCache() {
    try {
      const value = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch { return {}; }
  }

  function writeGeocodeCache(cache) {
    try { localStorage.setItem(GEOCODE_CACHE_KEY,JSON.stringify(cache)); } catch {}
  }

  async function geocodePlaceCandidates(place) {
    const original = String(place || "").trim();
    const cache = readGeocodeCache();
    if (Array.isArray(cache[original]) && cache[original].length) return cache[original];

    const variants = [...new Set([
      /^北海道/.test(original) ? original : `北海道${original}`,
      original
    ])];
    const candidates = [];

    for (const query of variants) {
      try {
        const response = await fetch(
          `${GSI_GEOCODER_URL}${encodeURIComponent(query)}`,
          {cache:"no-store"}
        );
        if (!response.ok) continue;
        const results = await response.json();
        if (!Array.isArray(results)) continue;

        results.forEach(item => {
          const coordinates = item?.geometry?.coordinates;
          if (!Array.isArray(coordinates) || coordinates.length < 2) return;
          const lat = Number(coordinates[1]);
          const lng = Number(coordinates[0]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
          if (!candidates.some(candidate => candidate.key === key)) {
            candidates.push({key,lat,lng});
          }
        });
      } catch {}
    }

    if (!candidates.length) throw new Error(`「${original}」の位置が見つかりません。`);
    cache[original] = candidates;
    writeGeocodeCache(cache);
    return candidates;
  }

  async function geocodeOnePlace(place) {
    const candidates = await geocodePlaceCandidates(place);
    return candidates[0];
  }

  function nearestRoutePointWithIndex(route,target) {
    let best = null;
    route.forEach((point,index) => {
      const distance = distanceMeters(point,target);
      if (!best || distance < best.distanceMeters) {
        best = {index,lat:point.lat,lng:point.lng,distanceMeters:distance};
      }
    });
    return best;
  }

  function routeCandidatesNearContext(route,contextPoint,maximum=180) {
    return route.map((point,index)=>({
      index,lat:point.lat,lng:point.lng,
      contextDistance:distanceMeters(point,contextPoint)
    }))
    .sort((a,b)=>a.contextDistance-b.contextDistance)
    .slice(0,maximum);
  }

  function findTransitionNearContext(routeA,routeB,contextPoint) {
    const candidatesA = routeCandidatesNearContext(routeA,contextPoint);
    const candidatesB = routeCandidatesNearContext(routeB,contextPoint);
    let best = null;

    candidatesA.forEach(a => {
      candidatesB.forEach(b => {
        const pairDistance = distanceMeters(a,b);
        const contextDistance = (a.contextDistance+b.contextDistance)/2;
        const score = pairDistance*8 + contextDistance;
        if (!best || score < best.score) {
          best = {
            aIndex:a.index,bIndex:b.index,
            aPoint:{lat:a.lat,lng:a.lng},
            bPoint:{lat:b.lat,lng:b.lng},
            pairDistance,contextDistance,score
          };
        }
      });
    });
    return best;
  }

  function routeSection(route,startIndex,endIndex) {
    return startIndex <= endIndex
      ? route.slice(startIndex,endIndex+1)
      : route.slice(endIndex,startIndex+1).reverse();
  }

  function appendTrackPoints(target,points) {
    points.forEach(point => {
      const normalized = {lat:Number(point.lat),lng:Number(point.lng)};
      const previous = target[target.length-1];
      if (previous && distanceMeters(previous,normalized) < 3) return;
      target.push(normalized);
    });
  }

  function trackDistanceKm(points) {
    let total = 0;
    for (let i=1;i<points.length;i+=1) total += distanceMeters(points[i-1],points[i]);
    return total/1000;
  }

  async function buildFullTrack(plan) {
    const legs = parseFullRouteSpec(plan.fullRouteSpec);
    const uniqueRoutes = [...new Set(legs.map(leg=>leg.routeNumber))];
    const routeMap = new Map();

    for (const number of uniqueRoutes) {
      routeMap.set(number,await loadRouteGeometry(number));
    }

    const originPoint = await geocodeOnePlace(plan.origin);
    const destinationPoint = await geocodeOnePlace(plan.destination);
    const transitions = [];

    for (let index=0; index<legs.length-1; index+=1) {
      const currentLeg = legs[index];
      const nextLeg = legs[index+1];
      const contextPoint = await geocodeOnePlace(currentLeg.endPlace);
      const transition = findTransitionNearContext(
        routeMap.get(currentLeg.routeNumber),
        routeMap.get(nextLeg.routeNumber),
        contextPoint
      );

      if (!transition || transition.pairDistance > 5000) {
        throw new Error(
          `国道${currentLeg.routeNumber}号→国道${nextLeg.routeNumber}号を` +
          `${currentLeg.endPlace}付近で接続できません。`
        );
      }
      transitions.push(transition);
    }

    const firstRoute = routeMap.get(legs[0].routeNumber);
    const lastRoute = routeMap.get(legs[legs.length-1].routeNumber);
    const startSnap = nearestRoutePointWithIndex(firstRoute,originPoint);
    const finishSnap = nearestRoutePointWithIndex(lastRoute,destinationPoint);

    const rawTrack = [];
    const legSummaries = [];

    for (let index=0; index<legs.length; index+=1) {
      const leg = legs[index];
      const route = routeMap.get(leg.routeNumber);
      const startIndex = index===0 ? startSnap.index : transitions[index-1].bIndex;
      const endIndex = index===legs.length-1 ? finishSnap.index : transitions[index].aIndex;
      const section = routeSection(route,startIndex,endIndex);

      appendTrackPoints(rawTrack,section);
      if (index < transitions.length) appendTrackPoints(rawTrack,[transitions[index].bPoint]);

      legSummaries.push({
        routeNumber:leg.routeNumber,
        endPlace:leg.endPlace,
        pointCount:section.length
      });
    }

    if (rawTrack.length < 2) throw new Error("予定Trackを作成できませんでした。");

    return {
      name:plan.planName,
      fullRouteLegs:legs,
      points:rawTrack,
      distanceKm:trackDistanceKm(rawTrack),
      legSummaries
    };
  }

  function dimBaseRoutes() {
    try {
      if (typeof allLayers !== "undefined") {
        allLayers.eachLayer(group => {
          if (!group || typeof group.eachLayer !== "function") return;
          group.eachLayer(layer => {
            if (layer && typeof layer.setStyle === "function") {
              layer.setStyle({color:"#94a3b8",weight:2,opacity:0.08});
            }
          });
        });
      }
      if (typeof routeLabelLayer !== "undefined" && map.hasLayer(routeLabelLayer)) {
        map.removeLayer(routeLabelLayer);
      }
      if (typeof seaRouteLayer !== "undefined" && map.hasLayer(seaRouteLayer)) {
        map.removeLayer(seaRouteLayer);
      }
    } catch {}
  }

  function drawTrack(track) {
    if (selectedTrackLayer) map.removeLayer(selectedTrackLayer);

    selectedTrackLayer = L.polyline(
      track.points.map(point=>[point.lat,point.lng]),
      {color:"#7c3aed",weight:8,opacity:0.94,interactive:false}
    ).addTo(map);

    const bounds = selectedTrackLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds,{padding:[24,24],maxZoom:9});

    dimBaseRoutes();
    setTimeout(dimBaseRoutes,500);
    setTimeout(dimBaseRoutes,1200);
    setTimeout(dimBaseRoutes,2500);
  }

  async function selectPlan(plan,card) {
    [...planList.querySelectorAll(".home-plan-card")].forEach(item=>item.disabled=true);
    renderSelected(plan,null,"予定区間を作成しています…");

    try {
      const track = await buildFullTrack(plan);
      localStorage.setItem(ACTIVE_PLAN_KEY,JSON.stringify(toActivePlan(plan,track)));
      drawTrack(track);
      renderPlans();
      renderSelected(plan,track,"");
    } catch(error) {
      console.error("トップ画面 予定Track作成エラー:",error);
      renderSelected(plan,null,`予定区間を作成できませんでした：${error.message || error}`);
    } finally {
      [...planList.querySelectorAll(".home-plan-card")].forEach(item=>item.disabled=false);
    }
  }

  areaButtons.addEventListener("click",event => {
    const button = event.target.closest("button[data-area]");
    if (button) setArea(button.dataset.area);
  });

  const active = readActivePlan();
  const activePlan = planFromActive(active);

  if (activePlan) {
    setArea(activePlan.area);
    if (active.plannedPreview?.points?.length >= 2) {
      const track = {
        name:active.planName,
        points:active.plannedPreview.points.map(point=>({lat:Number(point[0]),lng:Number(point[1])})),
        distanceKm:Number(active.plannedPreview.distanceKm)||0,
        fullRouteLegs:active.fullRouteLegs||[]
      };
      renderSelected(activePlan,track,"");
      drawTrack(track);
    } else {
      renderSelected(activePlan,null,"プランを選び直すと予定区間を正確に作成します。");
    }
  } else {
    setArea("道北");
  }

  // ---------- 48路線走破状況 ----------
  const homePlanTab = document.getElementById("homePlanTab");
  const homeStatusTab = document.getElementById("homeStatusTab");
  const homePlanMode = document.getElementById("homePlanMode");
  const homeStatusMode = document.getElementById("homeStatusMode");
  const routeStatusSummary = document.getElementById("routeStatusSummary");
  const routeStatusList = document.getElementById("routeStatusList");
  const statusFilterButtons = [...document.querySelectorAll("[data-status-filter]")];

  let routeStatusRows = [];

  function applyConfirmedRouteCorrections() {
    // ユーザー確認済みの事実：
    // 国道233号は全線走破済み。
    // Tripの日付形式やsegment構造に依存せず、既存app.jsが正式に参照している
    // route233Recordへ全線走破の正本を保存する。
    const recordKey = "route233Record";
    let current = null;

    try {
      const raw = localStorage.getItem(recordKey);
      current = raw ? JSON.parse(raw) : null;
    } catch {
      current = null;
    }

    const nextRecord = {
      ...(current && typeof current === "object" ? current : {}),
      routeNumber: "233",
      status: "complete",
      completionStatus: "complete",
      completed: true,
      completedAt: (current && current.completedAt) || "2026-07-12",
      source: "user-confirmed-full-traversal",
      note: (current && current.note) || "2026/07/12実走で全線走破確認済み"
    };

    const serialized = JSON.stringify(nextRecord);
    if (localStorage.getItem(recordKey) !== serialized) {
      localStorage.setItem(recordKey, serialized);
      console.info("国道233号：全線走破の正式記録を保存しました。");
    }

    // Trip側にも233 segmentがあれば complete へ統一する。
    if (!window.Hokkaido48TripData) return;
    const read = window.Hokkaido48TripData.readTrips();
    if (!read || !read.ok || !Array.isArray(read.trips)) return;

    let changed = false;
    read.trips.forEach(trip => {
      const segments = Array.isArray(trip.routeSegments) ? trip.routeSegments : [];
      segments.forEach(segment => {
        if (String(Number(segment.routeNumber)) === "233" && segment.status !== "complete") {
          segment.status = "complete";
          changed = true;
        }
      });
    });

    if (changed) {
      window.Hokkaido48TripData.saveTrips(read.trips);
    }
  }

  let statusFilter = "all";
  let statusMapLayer = null;

  function switchHomeMode(mode) {
    const isStatus = mode === "status";
    homePlanMode.hidden = isStatus;
    homeStatusMode.hidden = !isStatus;
    homePlanTab.classList.toggle("active", !isStatus);
    homeStatusTab.classList.toggle("active", isStatus);
    homePlanTab.setAttribute("aria-selected", String(!isStatus));
    homeStatusTab.setAttribute("aria-selected", String(isStatus));

    if (isStatus) {
      routeStatusRows = [];
      loadRouteStatusRows();
    } else {
      if (statusMapLayer && typeof map !== "undefined") {
        map.removeLayer(statusMapLayer);
        statusMapLayer = null;
      }
      const active = readActivePlan();
      const activePlan = planFromActive(active);
      if (activePlan && active?.plannedPreview?.points?.length >= 2) {
        drawTrack({
          name: active.planName,
          points: active.plannedPreview.points.map(point => ({
            lat: Number(point[0]), lng: Number(point[1])
          })),
          distanceKm: Number(active.plannedPreview.distanceKm) || 0,
          fullRouteLegs: active.fullRouteLegs || []
        });
      }
    }
  }


  function getEffectiveRouteStatusForHome(routeNumber) {
    const number = String(Number(routeNumber));
    const tripStatus = window.Hokkaido48TripData
      ? window.Hokkaido48TripData.getRouteStatus(number)
      : "未走破";

    if (tripStatus === "走破済") return "走破済";

    const recordKey = `route${number.padStart(3, "0")}Record`;
    const savedRecord = localStorage.getItem(recordKey);

    // 既存の路線記録がある場合は、メイン地図(app.js)と同じ扱いで全線走破。
    if (savedRecord) {
      try {
        const parsed = JSON.parse(savedRecord);
        if (parsed && typeof parsed === "object") {
          return "走破済";
        }
      } catch {
        // 古い保存形式でも値が存在する場合は既存仕様に合わせて走破済扱い。
        return "走破済";
      }
    }

    return tripStatus;
  }

  function routeStatusKey(status) {
    if (status === "走破済") return "complete";
    if (status === "走破中") return "partial";
    return "untraveled";
  }

  function statusLabel(status) {
    if (status === "走破済") return "全線走破";
    if (status === "走破中") return "一部走破";
    return "未走破";
  }

  function polylineDistanceKm(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += distanceMeters(points[i - 1], points[i]);
    }
    return total / 1000;
  }

  function extractConfirmedPathsForRoute(routeNumber) {
    if (!window.Hokkaido48TripData) return [];
    const trips = window.Hokkaido48TripData.getRelatedTrips(routeNumber);
    const paths = [];

    trips.forEach(trip => {
      window.Hokkaido48TripData.getSegmentsForRoute(trip, routeNumber).forEach(segment => {
        const candidates = Array.isArray(segment.confirmedPaths) && segment.confirmedPaths.length
          ? segment.confirmedPaths
          : (Array.isArray(segment.confirmedPath) ? [segment.confirmedPath] : []);

        candidates.forEach(path => {
          const normalized = path
            .map(point => Array.isArray(point)
              ? {lat:Number(point[0]), lng:Number(point[1])}
              : {lat:Number(point.lat), lng:Number(point.lng)})
            .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
          if (normalized.length >= 2) paths.push(normalized);
        });
      });
    });

    return paths;
  }

  function pointDistanceToPathApprox(point, path) {
    let best = Infinity;
    const stride = Math.max(1, Math.floor(path.length / 220));
    for (let i = 0; i < path.length; i += stride) {
      const d = distanceMeters(point, path[i]);
      if (d < best) best = d;
      if (best < 80) break;
    }
    return best;
  }

  async function estimateRemainingKm(routeNumber) {
    const route = await loadRouteGeometry(routeNumber);
    const totalKm = polylineDistanceKm(route);
    const paths = extractConfirmedPathsForRoute(routeNumber);

    if (!paths.length) return { totalKm, remainingKm: totalKm, coveredKm: 0 };

    let coveredMeters = 0;
    for (let i = 1; i < route.length; i += 1) {
      const a = route[i - 1];
      const b = route[i];
      const segmentMeters = distanceMeters(a, b);
      if (!Number.isFinite(segmentMeters) || segmentMeters <= 0) continue;

      const midpoint = {
        lat: (a.lat + b.lat) / 2,
        lng: (a.lng + b.lng) / 2
      };

      let covered = false;
      for (const path of paths) {
        if (pointDistanceToPathApprox(midpoint, path) <= 450) {
          covered = true;
          break;
        }
      }
      if (covered) coveredMeters += segmentMeters;
    }

    const coveredKm = Math.min(totalKm, coveredMeters / 1000);
    return {
      totalKm,
      coveredKm,
      remainingKm: Math.max(0, totalKm - coveredKm)
    };
  }

  async function loadRouteStatusRows() {
    applyConfirmedRouteCorrections();
    if (routeStatusRows.length) {
      renderRouteStatusRows();
      return;
    }

    routeStatusList.innerHTML = '<p class="home-plan-empty">48路線の状態を集計しています。</p>';

    try {
      const response = await fetch("data/routes.json", {cache:"no-store"});
      if (!response.ok) throw new Error("routes.jsonを読み込めません。");
      const routes = await response.json();

      routeStatusRows = routes.map(route => {
        const status = getEffectiveRouteStatusForHome(route.number);
        return {
          number: String(route.number),
          name: route.name || "",
          start: route.start || "",
          end: route.end || "",
          status,
          key: routeStatusKey(status),
          remainingKm: null,
          totalKm: null
        };
      });

      renderRouteStatusRows();

      // 残り距離の計算は一部走破路線だけ。画面表示後に順次更新する。
      for (const row of routeStatusRows.filter(item => item.key === "partial")) {
        try {
          const estimate = await estimateRemainingKm(row.number);
          row.remainingKm = estimate.remainingKm;
          row.totalKm = estimate.totalKm;
          renderRouteStatusRows();
        } catch (error) {
          console.warn(`国道${row.number}号の残り距離を計算できませんでした。`, error);
        }
      }
    } catch (error) {
      routeStatusList.innerHTML =
        `<p class="home-plan-empty">走破状況を読み込めませんでした：${String(error.message || error)}</p>`;
    }
  }

  function renderRouteStatusRows() {
    const complete = routeStatusRows.filter(row => row.key === "complete").length;
    const partial = routeStatusRows.filter(row => row.key === "partial").length;
    const untraveled = routeStatusRows.filter(row => row.key === "untraveled").length;

    routeStatusSummary.innerHTML = `
      <div class="route-summary-chip complete"><strong>${complete}</strong>全線走破</div>
      <div class="route-summary-chip partial"><strong>${partial}</strong>一部走破</div>
      <div class="route-summary-chip untraveled"><strong>${untraveled}</strong>未走破</div>
    `;

    const visible = routeStatusRows
      .filter(row => statusFilter === "all" || row.key === statusFilter)
      .sort((a, b) => Number(a.number) - Number(b.number));

    routeStatusList.innerHTML = "";

    visible.forEach(row => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-status-card";

      const title = document.createElement("div");
      title.className = "route-status-card-title";

      const routeTitle = document.createElement("span");
      routeTitle.textContent = `国道${row.number}号`;

      const badge = document.createElement("span");
      badge.className = `status-badge ${row.key}`;
      badge.textContent = statusLabel(row.status);

      title.append(routeTitle, badge);

      const detail = document.createElement("div");
      detail.className = "route-status-card-detail";

      if (row.key === "partial") {
        detail.textContent = Number.isFinite(row.remainingKm)
          ? `残り 約${Math.round(row.remainingKm)}km`
          : "残り距離を計算中…";
      } else if (row.key === "complete") {
        detail.textContent = "北海道内対象区間を全線走破";
      } else {
        detail.textContent = `${row.start} → ${row.end}`;
      }

      button.append(title, detail);
      button.addEventListener("click", () => showRouteStatusOnMap(row));
      routeStatusList.appendChild(button);
    });
  }


  function midpointByDistance(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let total = 0;
    const lengths = [];
    for (let i = 1; i < points.length; i += 1) {
      const d = distanceMeters(points[i - 1], points[i]);
      lengths.push(d);
      total += d;
    }
    if (!Number.isFinite(total) || total <= 0) return points[Math.floor(points.length / 2)];

    const target = total / 2;
    let travelled = 0;
    for (let i = 1; i < points.length; i += 1) {
      const d = lengths[i - 1];
      if (travelled + d >= target) {
        const ratio = d > 0 ? (target - travelled) / d : 0;
        return {
          lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * ratio,
          lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * ratio
        };
      }
      travelled += d;
    }
    return points[points.length - 1];
  }

  function addRouteNumberOnLine(layerGroup, routeNumber, routePoints) {
    const center = midpointByDistance(routePoints);
    if (!center) return;

    const icon = L.divIcon({
      className: "status-route-number-icon",
      html: `<span class="status-route-number-label">${routeNumber}</span>`,
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    });

    L.marker([center.lat, center.lng], {
      icon,
      interactive: false,
      keyboard: false,
      zIndexOffset: 4000
    }).addTo(layerGroup);
  }

  function connectNearbyConfirmedPaths(paths, routeNumber, layerGroup) {
    // Trip保存時に1本の走行が複数 confirmedPaths に分かれた場合、
    // 端点同士が近ければ表示上だけ連結する。特に233号の分断表示対策。
    if (!Array.isArray(paths) || paths.length < 2) return;

    const remaining = paths.map(path => path.slice()).filter(path => path.length >= 2);
    const used = new Set();

    for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        const aStart = remaining[i][0];
        const aEnd = remaining[i][remaining[i].length - 1];
        const bStart = remaining[j][0];
        const bEnd = remaining[j][remaining[j].length - 1];

        const candidates = [
          [aEnd, bStart],
          [aEnd, bEnd],
          [aStart, bStart],
          [aStart, bEnd]
        ];

        let best = null;
        candidates.forEach(pair => {
          const d = distanceMeters(pair[0], pair[1]);
          if (!best || d < best.distance) best = {a: pair[0], b: pair[1], distance: d};
        });

        // 国道上で近接している分割だけを連結。大きな未走破区間は結ばない。
        if (best && best.distance <= 2500) {
          L.polyline(
            [[best.a.lat, best.a.lng], [best.b.lat, best.b.lng]],
            {
              color:"#16a34a",
              weight:9,
              opacity:0.95,
              interactive:false
            }
          ).addTo(layerGroup);
        }
      }
    }
  }


  async function showRouteStatusOnMap(row) {
    if (typeof map === "undefined" || !window.L) return;

    dimBaseRoutes();
    if (selectedTrackLayer) {
      map.removeLayer(selectedTrackLayer);
      selectedTrackLayer = null;
    }
    if (statusMapLayer) map.removeLayer(statusMapLayer);

    statusMapLayer = L.featureGroup().addTo(map);

    try {
      const route = await loadRouteGeometry(row.number);

      // 全線の土台：未走破部分として橙色
      L.polyline(
        route.map(point => [point.lat, point.lng]),
        {
          color: row.key === "complete" ? "#16a34a" : "#f97316",
          weight: 7,
          opacity: 0.82,
          interactive: false
        }
      ).addTo(statusMapLayer);

      // 実走確認済み区間：緑
      if (row.key === "partial") {
        const paths = extractConfirmedPathsForRoute(row.number);
        paths.forEach(path => {
          L.polyline(
            path.map(point => [point.lat, point.lng]),
            {
              color:"#16a34a",
              weight:9,
              opacity:0.95,
              interactive:false
            }
          ).addTo(statusMapLayer);
        });

        connectNearbyConfirmedPaths(paths, row.number, statusMapLayer);
      }

      // 選択中の路線番号を、その路線の線上へ直接表示する。
      addRouteNumberOnLine(statusMapLayer, row.number, route);

      const bounds = statusMapLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, {padding:[24,24], maxZoom:9});
      }
    } catch (error) {
      console.error(`国道${row.number}号の走破状況地図表示エラー:`, error);
    }
  }

  homePlanTab.addEventListener("click", () => switchHomeMode("plan"));
  homeStatusTab.addEventListener("click", () => switchHomeMode("status"));

  statusFilterButtons.forEach(button => {
    button.addEventListener("click", () => {
      statusFilter = button.dataset.statusFilter;
      statusFilterButtons.forEach(item => {
        item.classList.toggle("active", item === button);
      });
      renderRouteStatusRows();
    });
  });


  window.addEventListener("storage", event => {
    if (
      event.key === "hokkaido48Trips" ||
      (event.key && /^route\d{3}Record$/.test(event.key))
    ) {
      routeStatusRows = [];
      if (homeStatusMode && !homeStatusMode.hidden) {
        loadRouteStatusRows();
      }
    }
  });

})();
