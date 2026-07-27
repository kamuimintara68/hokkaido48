"use strict";

/*
 * 北海道48路線ふらふらlog Version 4.0
 * Build 20260727-33 Inline Nav
 *
 * 元データ:
 *   北海道48路線_道南制覇3泊4日_Plan.xlsx
 *
 * 方針:
 * - Excelの旅程部分だけを正式プラン候補として取り込む。
 * - 走破状態はExcelから持ち込まず、Version 4.0本体の最新データを正本とする。
 * - Day1〜Day4を正式プランとして扱う。
 * - Day4は通行規制がある場合、規制区間だけ迂回して実走し、
 *   帰宅後GPXで走行できた229・230号区間だけをpartialとして保存する。
 * - トップ画面では各日の予定走行Trackを紫線で表示する。
 */

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";

  const DONAN_PLANS = [
    {
      area: "道南",
      planName: "道南制覇3泊4日 Day1 / Trip1",
      targetRoutes: "5",
      routeNumbers: ["5"],
      origin: "士別市",
      destination: "森町",
      distance: "約400～430km",
      distanceValue: "400～430",
      stay: "1泊目：道の駅 YOU・遊・もり",
      priority: "正式プラン",
      season: "夏～秋",
      goal: "国道5号の道南側を回収",
      waypoints: ["旭川市", "札幌市", "長万部町", "八雲町"],
      fullRouteSpec: "40:旭川市→12:札幌市→5:森町",
      warning: "国道5号は2026年8月上旬～2027年3月下旬に新幹線工事による規制予定。夜間走行日は最新情報を確認。",
      blocked: false
    },
    {
      area: "道南",
      planName: "道南制覇3泊4日 Day2 / Trip2",
      targetRoutes: "277→227→278",
      routeNumbers: ["277", "227", "278"],
      origin: "森町",
      destination: "函館市日ノ浜町",
      distance: "約350～400km",
      distanceValue: "350～400",
      stay: "2泊目：道の駅 なとわ・えさん",
      priority: "正式プラン",
      season: "夏～秋",
      goal: "277・227全線／278前半",
      waypoints: ["八雲町", "江差町", "函館市"],
      fullRouteSpec: "5:八雲町→277:江差町→227:函館市→278:函館市日ノ浜町",
      warning: "",
      blocked: false
    },
    {
      area: "道南",
      planName: "道南制覇3泊4日 Day3 / Trip3",
      targetRoutes: "278→279→228",
      routeNumbers: ["278", "279", "228"],
      origin: "函館市日ノ浜町",
      destination: "江差町",
      distance: "約350～420km",
      distanceValue: "350～420",
      stay: "3泊目：道の駅 江差",
      priority: "正式プラン",
      season: "夏～秋",
      goal: "278全線／279北海道側／228大部分",
      waypoints: ["森町", "函館市", "函館市港町", "木古内町", "松前町"],
      fullRouteSpec: "278:森町→5:函館市→228:江差町",
      specialGuruVia: {
        lat: 41.7657818,
        lng: 140.7138947,
        label: "国道279号 北海道側起点"
      },
      warning: "国道279号はGeoJSONが北海道側起点のPointデータのみ。予定Track本線は278→5→228で作成し、Guru Mapsには279号北海道側起点を特別通過点として追加する。",
      blocked: false
    },
    {
      area: "道南",
      planName: "道南制覇3泊4日 Day4 / Trip4",
      targetRoutes: "228→229→230→5",
      routeNumbers: ["228", "229", "230", "5"],
      origin: "江差町",
      destination: "士別市",
      distance: "約400～450km",
      distanceValue: "400～450",
      stay: "帰宅",
      priority: "正式プラン（規制時迂回）",
      season: "夏～秋",
      goal: "228残区間（ある場合）／229・230南側／5号回収。規制区間は迂回し、走れた国道区間を暫定走破として保存。",
      waypoints: ["せたな町", "長万部町", "札幌市", "旭川市"],
      fullRouteSpec: "229:せたな町→230:長万部町→5:札幌市→12:旭川市→40:士別市",
      detourMode: true,
      detourGuruPlaces: ["江差町", "せたな町", "長万部町", "札幌市", "旭川市", "士別市"],
      warning: "国道229号・230号に通行規制がある場合は規制区間だけ迂回する。トップ地図は本来の国道走行予定を表示し、Guru Mapsは大きな通過点で迂回可能な経路を作る。帰宅後は実走GPXから走行できた229・230号区間だけをpartialとして保存する。",
      blocked: false
    }
  ];

  function identity(plan) {
    return [plan.planName, plan.targetRoutes, plan.origin, plan.destination].join("|");
  }

  function toActivePlan(plan) {
    return {
      schemaVersion: 1,
      selectedAt: new Date().toISOString(),
      id: identity(plan),
      planName: plan.planName,
      targetRoutes: plan.targetRoutes,
      routeNumbers: [...plan.routeNumbers],
      origin: plan.origin,
      destination: plan.destination,
      waypoints: [...plan.waypoints],
      fullRouteSpec: plan.fullRouteSpec,
      source: "donan-plans-v40",
      warning: plan.warning || "",
      donanDetourMode: !!plan.detourMode,
      donanDetourGuruPlaces: Array.isArray(plan.detourGuruPlaces) ? [...plan.detourGuruPlaces] : []
    };
  }

  function toEmbeddedPlan(plan) {
    return {
      "計画名": plan.planName,
      "対象路線": plan.targetRoutes,
      "始点": plan.origin,
      "終点": plan.destination,
      "距離(km)": plan.distanceValue,
      "所要時間": "",
      "宿泊": plan.stay,
      "優先度": plan.priority,
      "季節": plan.season,
      "メモ": [
        `走破目標：${plan.goal}`,
        plan.warning
      ].filter(Boolean).join("／"),
      "経由地": plan.waypoints.join("→"),
      "全行程ルート": plan.fullRouteSpec,
      "GoogleマップURL": ""
    };
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

  function findDonanPlanFromActive(active) {
    if (!active) return null;
    return DONAN_PLANS.find(plan => identity(plan) === active.id) || null;
  }


  // ---------- トップ画面用：予定走行Trackをその日の走行順で作る ----------
  const HOME_GSI_GEOCODER_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";
  const homeRouteGeometryCache = new Map();
  let homePlannedTrackLayer = null;
  let homeSpecialViaLayer = null;

  function collectHomeLineStrings(geojson) {
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

  async function loadHomeRouteGeometry(routeNumber) {
    const number = String(Number(routeNumber));
    if (homeRouteGeometryCache.has(number)) return homeRouteGeometryCache.get(number);

    const response = await fetch(
      `data/geojson/route_${number.padStart(3, "0")}.geojson`,
      { cache: "no-store" }
    );
    if (!response.ok) throw new Error(`国道${number}号の路線データを読み込めません。`);

    const geojson = await response.json();
    const lines = collectHomeLineStrings(geojson)
      .map(line => line.map(point => ({ lng: Number(point[0]), lat: Number(point[1]) }))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)))
      .filter(line => line.length >= 2);

    if (!lines.length) throw new Error(`国道${number}号の線データがありません。`);
    const coords = lines.sort((a, b) => b.length - a.length)[0];
    homeRouteGeometryCache.set(number, coords);
    return coords;
  }

  async function geocodeHomePlace(place) {
    const original = String(place || "").trim();
    const variants = [...new Set([
      /^北海道/.test(original) ? original : `北海道${original}`,
      original
    ])];

    for (const query of variants) {
      try {
        const response = await fetch(
          `${HOME_GSI_GEOCODER_URL}${encodeURIComponent(query)}`,
          { cache: "no-store" }
        );
        if (!response.ok) continue;
        const results = await response.json();
        if (!Array.isArray(results)) continue;

        for (const item of results) {
          const coordinates = item?.geometry?.coordinates;
          if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
          const lat = Number(coordinates[1]);
          const lng = Number(coordinates[0]);
          if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
        }
      } catch {}
    }

    throw new Error(`「${original}」の位置が見つかりません。`);
  }

  function parseHomeFullRouteSpec(value) {
    return String(value || "")
      .normalize("NFKC")
      .split(/[→>\n\r]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .map((item, index) => {
        const match = item.match(/^(?:国道)?\s*(\d+)\s*号?\s*[:：]\s*(.+)$/);
        if (!match) throw new Error(`予定ルートの${index + 1}区間を読めません。`);
        return { routeNumber: String(Number(match[1])), endPlace: String(match[2]).trim() };
      });
  }

  function nearestHomeRoutePoint(route, target) {
    let best = null;
    route.forEach((point, index) => {
      const distance = metersBetween(point, target);
      if (!best || distance < best.distance) {
        best = { index, distance, point };
      }
    });
    return best;
  }

  function homeContextCandidates(route, contextPoint, maximum = 180) {
    return route.map((point, index) => ({
      index,
      point,
      contextDistance: metersBetween(point, contextPoint)
    }))
      .sort((a, b) => a.contextDistance - b.contextDistance)
      .slice(0, maximum);
  }

  function findHomeTransition(routeA, routeB, contextPoint) {
    const candidatesA = homeContextCandidates(routeA, contextPoint);
    const candidatesB = homeContextCandidates(routeB, contextPoint);
    let best = null;

    candidatesA.forEach(a => {
      candidatesB.forEach(b => {
        const pairDistance = metersBetween(a.point, b.point);
        const score = pairDistance * 8 + (a.contextDistance + b.contextDistance) / 2;
        if (!best || score < best.score) {
          best = {
            aIndex: a.index,
            bIndex: b.index,
            aPoint: a.point,
            bPoint: b.point,
            pairDistance,
            score
          };
        }
      });
    });

    return best;
  }

  function homeRouteSection(route, startIndex, endIndex) {
    return startIndex <= endIndex
      ? route.slice(startIndex, endIndex + 1)
      : route.slice(endIndex, startIndex + 1).reverse();
  }

  function appendHomePoints(target, points) {
    points.forEach(point => {
      const normalized = { lat: Number(point.lat), lng: Number(point.lng) };
      const previous = target[target.length - 1];
      if (previous && metersBetween(previous, normalized) < 3) return;
      target.push(normalized);
    });
  }

  function homeTrackDistanceKm(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += metersBetween(points[index - 1], points[index]);
    }
    return total / 1000;
  }

  async function buildHomePlanTrack(plan) {
    const legs = parseHomeFullRouteSpec(plan.fullRouteSpec);
    const uniqueRoutes = [...new Set(legs.map(leg => leg.routeNumber))];
    const routeMap = new Map();

    for (const number of uniqueRoutes) {
      routeMap.set(number, await loadHomeRouteGeometry(number));
    }

    const originPoint = await geocodeHomePlace(plan.origin);
    const destinationPoint = await geocodeHomePlace(plan.destination);
    const transitions = [];

    for (let index = 0; index < legs.length - 1; index += 1) {
      const currentLeg = legs[index];
      const nextLeg = legs[index + 1];
      const contextPoint = await geocodeHomePlace(currentLeg.endPlace);
      const transition = findHomeTransition(
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
    const lastRoute = routeMap.get(legs[legs.length - 1].routeNumber);
    const startSnap = nearestHomeRoutePoint(firstRoute, originPoint);
    const finishSnap = nearestHomeRoutePoint(lastRoute, destinationPoint);
    const points = [];

    for (let index = 0; index < legs.length; index += 1) {
      const leg = legs[index];
      const route = routeMap.get(leg.routeNumber);
      const startIndex = index === 0 ? startSnap.index : transitions[index - 1].bIndex;
      const endIndex = index === legs.length - 1 ? finishSnap.index : transitions[index].aIndex;
      appendHomePoints(points, homeRouteSection(route, startIndex, endIndex));
      if (index < transitions.length) appendHomePoints(points, [transitions[index].bPoint]);
    }

    if (points.length < 2) throw new Error("トップ画面の予定Trackを作成できませんでした.");

    return {
      name: plan.planName,
      points,
      distanceKm: homeTrackDistanceKm(points),
      fullRouteLegs: legs
    };
  }

  function dimHomeBaseRoutes() {
    try {
      if (typeof allLayers !== "undefined") {
        allLayers.eachLayer(group => {
          if (!group || typeof group.eachLayer !== "function") return;
          group.eachLayer(layer => {
            if (layer && typeof layer.setStyle === "function") {
              layer.setStyle({ color: "#94a3b8", weight: 2, opacity: 0.08 });
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

  function drawHomePlanTrack(plan, track) {
    if (typeof map === "undefined" || typeof L === "undefined") return;

    if (homePlannedTrackLayer) map.removeLayer(homePlannedTrackLayer);
    if (homeSpecialViaLayer) {
      map.removeLayer(homeSpecialViaLayer);
      homeSpecialViaLayer = null;
    }

    homePlannedTrackLayer = L.polyline(
      track.points.map(point => [point.lat, point.lng]),
      { color: "#7c3aed", weight: 8, opacity: 0.94, interactive: false }
    ).addTo(map);

    if (plan.specialGuruVia) {
      homeSpecialViaLayer = L.circleMarker(
        [plan.specialGuruVia.lat, plan.specialGuruVia.lng],
        {
          radius: 7,
          color: "#7c3aed",
          weight: 3,
          fillColor: "#ffffff",
          fillOpacity: 1
        }
      ).addTo(map);
      homeSpecialViaLayer.bindTooltip(plan.specialGuruVia.label, { permanent: false });
    }

    const bounds = homePlannedTrackLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 9 });

    dimHomeBaseRoutes();
    setTimeout(dimHomeBaseRoutes, 500);
    setTimeout(dimHomeBaseRoutes, 1200);
  }

  async function selectAndDrawHomePlan(plan) {
    const selectedBox = document.getElementById("homeSelectedPlan");

    try {
      // 道南プランでは下の別欄を使わず、選択カード内に操作を集約する。
      if (selectedBox) selectedBox.hidden = true;

      const preparing = toActivePlan(plan);
      preparing.homePreparingTrack = true;
      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(preparing));
      renderHomeDonanPlans();

      const active = toActivePlan(plan);
      const track = await buildHomePlanTrack(plan);

      active.fullRouteLegs = track.fullRouteLegs;
      active.plannedPreview = {
        version: 7,
        kind: "full-track",
        name: track.name,
        generatedAt: new Date().toISOString(),
        distanceKm: Number(track.distanceKm.toFixed(1)),
        points: track.points.map(point => [point.lat, point.lng])
      };

      active.homePreparingTrack = false;
      active.homeTrackError = "";
      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(active));
      drawHomePlanTrack(plan, track);
      renderHomeDonanPlans();
      if (selectedBox) selectedBox.hidden = true;
    } catch (error) {
      console.error("道南プラン トップ地図Track作成エラー:", error);

      const failed = toActivePlan(plan);
      failed.homePreparingTrack = false;
      failed.homeTrackError = String(error.message || error);
      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(failed));
      renderHomeDonanPlans();
      if (selectedBox) selectedBox.hidden = true;
    }
  }

  function restoreHomePlanTrackFromActive(plan, active) {
    if (!plan || !active?.plannedPreview?.points || active.plannedPreview.points.length < 2) return false;
    const points = active.plannedPreview.points
      .map(point => ({ lat: Number(point[0]), lng: Number(point[1]) }))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (points.length < 2) return false;

    drawHomePlanTrack(plan, {
      name: active.planName,
      points,
      distanceKm: Number(active.plannedPreview.distanceKm) || homeTrackDistanceKm(points),
      fullRouteLegs: active.fullRouteLegs || []
    });
    return true;
  }


  function metersBetween(a, b) {
    const rad = Math.PI / 180;
    const lat1 = Number(a.lat) * rad;
    const lat2 = Number(b.lat) * rad;
    const dLat = (Number(b.lat) - Number(a.lat)) * rad;
    const dLng = (Number(b.lng) - Number(a.lng)) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function buildGuruUrlFromPoints(points) {
    if (!Array.isArray(points) || points.length < 2) return "";
    const coordinate = point =>
      `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
    const parts = [
      `start=${coordinate(points[0])}`,
      ...points.slice(1, -1).map(point => `via=${coordinate(point)}`),
      `finish=${coordinate(points[points.length - 1])}`,
      "mode=auto",
      "start_navigation=false"
    ];
    return `guru://nav?${parts.join("&")}`;
  }

  function insertSpecialVia(points, special) {
    if (!Array.isArray(points) || points.length < 2 || !special) return points || [];
    const specialPoint = {
      lat: Number(special.lat),
      lng: Number(special.lng),
      label: String(special.label || "特別通過点"),
      kind: "special-via"
    };

    if (points.some(point => metersBetween(point, specialPoint) < 30)) {
      return points;
    }

    let bestIndex = 1;
    let bestPenalty = Infinity;
    for (let index = 1; index < points.length; index += 1) {
      const before = points[index - 1];
      const after = points[index];
      const penalty =
        metersBetween(before, specialPoint) +
        metersBetween(specialPoint, after) -
        metersBetween(before, after);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIndex = index;
      }
    }

    return [
      ...points.slice(0, bestIndex),
      specialPoint,
      ...points.slice(bestIndex)
    ];
  }

  function ensureSpecialGuruVia() {
    const active = readActivePlan();
    const plan = findDonanPlanFromActive(active);
    if (!active || !plan || !plan.specialGuruVia) return;
    if (!Array.isArray(active.guruGuidePoints) || active.guruGuidePoints.length < 2) return;

    const alreadyApplied = active.guruGuidePoints.some(point =>
      metersBetween(point, plan.specialGuruVia) < 30
    );
    if (alreadyApplied && active.donanSpecialViaApplied) return;

    const guidePoints = insertSpecialVia(active.guruGuidePoints, plan.specialGuruVia);
    const guruMapsUrl = buildGuruUrlFromPoints(guidePoints);
    if (!guruMapsUrl) return;

    localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify({
      ...active,
      guruGuidePoints: guidePoints,
      guruGuidePointCount: guidePoints.length,
      guruMapsUrl,
      donanSpecialViaApplied: true,
      donanSpecialVia: { ...plan.specialGuruVia }
    }));

    const navStatus = document.getElementById("guruNavStatus");
    if (navStatus) {
      navStatus.textContent += `／${plan.specialGuruVia.label}を特別通過点に追加済み`;
    }
  }


  async function geocodeDonanGuidePlace(place) {
    const original = String(place || "").trim();
    const variants = [...new Set([
      /^北海道/.test(original) ? original : `北海道${original}`,
      original
    ])];

    for (const query of variants) {
      try {
        const response = await fetch(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`,
          { cache: "no-store" }
        );
        if (!response.ok) continue;
        const results = await response.json();
        if (!Array.isArray(results)) continue;

        for (const item of results) {
          const coordinates = item?.geometry?.coordinates;
          if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
          const lat = Number(coordinates[1]);
          const lng = Number(coordinates[0]);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng, label: original, kind: "detour-anchor" };
          }
        }
      } catch {}
    }
    throw new Error(`迂回用通過点「${original}」を取得できません。`);
  }

  async function ensureDetourGuruGuide() {
    const active = readActivePlan();
    const plan = findDonanPlanFromActive(active);
    if (!active || !plan || !plan.detourMode) return;
    if (active.donanDetourGuideApplied && active.guruMapsUrl) return;

    const places = Array.isArray(plan.detourGuruPlaces)
      ? plan.detourGuruPlaces
      : [];
    if (places.length < 2) return;

    try {
      const guidePoints = [];
      for (const place of places) {
        guidePoints.push(await geocodeDonanGuidePlace(place));
      }

      const guruMapsUrl = buildGuruUrlFromPoints(guidePoints);
      if (!guruMapsUrl) return;

      const latest = readActivePlan();
      if (!latest || latest.id !== active.id) return;

      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify({
        ...latest,
        guruGuidePoints: guidePoints,
        guruGuidePointCount: guidePoints.length,
        guruMapsUrl,
        donanDetourGuideApplied: true,
        donanDetourGuidePlaces: [...places]
      }));

      const navStatus = document.getElementById("guruNavStatus");
      if (navStatus) {
        navStatus.textContent =
          `迂回前提ナビ準備済み：${places.join(" → ")} ／ 規制区間はGuru Mapsの道路判断で迂回`;
        navStatus.style.background = "#fff7ed";
        navStatus.style.color = "#9a3412";
      }
    } catch (error) {
      console.error("道南Day4 迂回通過点作成エラー:", error);
    }
  }

  function setHomeAreaButtonState(areaButtons) {
    [...areaButtons.querySelectorAll("button[data-area]")].forEach(button => {
      button.classList.toggle("active", button.dataset.area === "道南");
    });
  }

  function renderHomeSelected(plan) {
    // Build 33: 道南プランはカード内にナビ操作を表示する。
    const selectedBox = document.getElementById("homeSelectedPlan");
    if (selectedBox) selectedBox.hidden = true;
  }

  function renderHomeDonanPlans() {
    const areaButtons = document.getElementById("homeAreaButtons");
    const planList = document.getElementById("homePlanList");
    const selectedBox = document.getElementById("homeSelectedPlan");
    if (!areaButtons || !planList) return;

    setHomeAreaButtonState(areaButtons);
    if (selectedBox) selectedBox.hidden = true;
    planList.innerHTML = "";

    const active = readActivePlan();

    DONAN_PLANS.forEach(plan => {
      const isActive = !!(active && active.id === identity(plan));
      const card = document.createElement("div");
      card.className = "home-plan-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive) card.classList.add("active");

      const name = document.createElement("strong");
      name.textContent = plan.planName;

      const route = document.createElement("span");
      route.textContent =
        `${plan.origin} → ${plan.destination} ／ 主対象：` +
        plan.routeNumbers.map(number => `国道${number}号`).join(" → ");

      const summary = document.createElement("span");
      summary.textContent = [
        plan.stay,
        plan.distance,
        plan.detourMode ? "⚠ 規制時は迂回" : ""
      ].filter(Boolean).join(" ／ ");

      card.append(name, route, summary);

      if (isActive) {
        const action = document.createElement("div");
        action.className = "home-plan-inline-action";

        const status = document.createElement("span");
        status.className = "home-plan-inline-status";

        const nav = document.createElement("a");
        nav.className = "home-plan-inline-nav";

        if (active.homePreparingTrack) {
          status.textContent = "予定走行ルートを作成しています…";
          nav.textContent = "ナビ準備まで少し待ってください";
          nav.removeAttribute("href");
          nav.setAttribute("aria-disabled", "true");
        } else if (active.homeTrackError) {
          status.textContent = `予定ルート作成エラー：${active.homeTrackError}`;
          status.style.color = "#b91c1c";
          nav.textContent = "もう一度このプランを選択";
          nav.href = "#";
          nav.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            selectAndDrawHomePlan(plan);
          });
        } else if (
          active.plannedPreview &&
          Array.isArray(active.plannedPreview.points) &&
          active.plannedPreview.points.length >= 2
        ) {
          const km = Number(active.plannedPreview.distanceKm);
          status.textContent = Number.isFinite(km)
            ? `選択中 ／ 予定Track 約${km.toFixed(1)}km`
            : "選択中 ／ 予定Track作成済み";

          nav.textContent = plan.detourMode
            ? "このプランで迂回前提のナビ準備へ"
            : "このプランでナビ準備へ";
          nav.href = "plan.html";
          nav.addEventListener("click", event => event.stopPropagation());
        } else {
          status.textContent = "このプランを選択中";
          nav.textContent = "予定走行ルートを作成";
          nav.href = "#";
          nav.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            selectAndDrawHomePlan(plan);
          });
        }

        action.append(status, nav);
        card.appendChild(action);
      }

      const choose = () => {
        if (!isActive || active?.homeTrackError) {
          selectAndDrawHomePlan(plan);
        }
      };

      card.addEventListener("click", choose);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });

      planList.appendChild(card);
    });
  }

  function setupHomePage() {
    const areaButtons = document.getElementById("homeAreaButtons");
    const planList = document.getElementById("homePlanList");
    if (!areaButtons || !planList) return;

    // 元のhome-plan-selector-v40.jsが先に動いたあと、道南だけ追加データで描き直す。
    areaButtons.addEventListener("click", event => {
      const button = event.target.closest("button[data-area]");
      if (!button) return;

      if (button.dataset.area === "道南") {
        setTimeout(renderHomeDonanPlans, 0);
      }
    });

    const active = readActivePlan();
    const activePlan = findDonanPlanFromActive(active);
    if (activePlan) {
      renderHomeDonanPlans();
      if (document.getElementById("homeSelectedPlan")) {
        document.getElementById("homeSelectedPlan").hidden = true;
      }
      if (!restoreHomePlanTrackFromActive(activePlan, active)) {
        window.setTimeout(() => selectAndDrawHomePlan(activePlan), 0);
      }
    }
  }

  function disableBlockedPlanCards() {
    const planList = document.getElementById("planList");
    if (!planList) return;

    const blockedNames = new Set(
      DONAN_PLANS.filter(plan => plan.blocked).map(plan => plan.planName)
    );

    [...planList.querySelectorAll(".plan-card")].forEach(card => {
      const title = card.querySelector("h3");
      if (!title || !blockedNames.has(title.textContent.trim())) return;

      card.dataset.donanBlocked = "true";
      const actions = card.querySelector(".plan-actions");
      if (actions) {
        actions.style.pointerEvents = "none";
        actions.style.opacity = ".45";
        [...actions.querySelectorAll("button,a")].forEach(control => {
          if (control.tagName === "BUTTON") control.disabled = true;
          control.removeAttribute("href");
          control.setAttribute("aria-disabled", "true");
        });
      }

      if (!card.querySelector(".donan-restriction-warning")) {
        const warning = document.createElement("p");
        warning.className = "donan-restriction-warning";
        warning.textContent =
          "現在の通行止めを含むため、迂回ルート確定までナビ準備は保留します。";
        warning.style.margin = "12px 0 0";
        warning.style.padding = "10px 12px";
        warning.style.borderRadius = "8px";
        warning.style.background = "#fef2f2";
        warning.style.color = "#991b1b";
        warning.style.fontWeight = "800";
        card.appendChild(warning);
      }
    });
  }

  async function setupPlanPage() {
    if (
      typeof EMBEDDED_TRAVEL_PLANS === "undefined" ||
      typeof initializePlanViewer !== "function"
    ) {
      return;
    }

    const currentActive = readActivePlan();
    const currentDonan = findDonanPlanFromActive(currentActive);
    if (currentDonan && currentDonan.blocked) {
      localStorage.removeItem(ACTIVE_PLAN_KEY);
    }

    const planListElement = document.getElementById("planList");
    if (planListElement) {
      planListElement.addEventListener("click", event => {
        const blockedCard = event.target.closest('.plan-card[data-donan-blocked="true"]');
        if (!blockedCard) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);

      const blockedObserver = new MutationObserver(() => {
        window.setTimeout(disableBlockedPlanCards, 0);
      });
      blockedObserver.observe(planListElement, { childList: true, subtree: true });
    }

    const guruStatus = document.getElementById("guruNavStatus");
    if (guruStatus) {
      const guruObserver = new MutationObserver(() => {
        window.setTimeout(ensureSpecialGuruVia, 0);
        window.setTimeout(ensureDetourGuruGuide, 0);
      });
      guruObserver.observe(guruStatus, { childList: true, characterData: true, subtree: true });
    }

    const existingIds = new Set(
      EMBEDDED_TRAVEL_PLANS.map(plan => [
        String(plan["計画名"] || "").trim(),
        String(plan["対象路線"] || "").trim(),
        String(plan["始点"] || "").trim(),
        String(plan["終点"] || "").trim()
      ].join("|"))
    );

    DONAN_PLANS.forEach(plan => {
      const embedded = toEmbeddedPlan(plan);
      const embeddedId = [
        embedded["計画名"],
        embedded["対象路線"],
        embedded["始点"],
        embedded["終点"]
      ].join("|");

      if (!existingIds.has(embeddedId)) {
        EMBEDDED_TRAVEL_PLANS.push(embedded);
      }
    });

    await initializePlanViewer();
    disableBlockedPlanCards();
    ensureSpecialGuruVia();
    ensureDetourGuruGuide();
  }

  setupHomePage();
  setupPlanPage().catch(error => {
    console.error("道南3泊4日プラン追加エラー:", error);
  });
})();
