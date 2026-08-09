"use strict";

(function () {
  const ROUTE_DATA_URL = "data/routes-v50.json";
  const SELECTION_KEY = "hokkaido48V50JourneyDraft";
  const TRIPS_KEY = "hokkaido48Trips";
  const GEOJSON_PATH = number => `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
  const HOME = { label: "士別市（自宅）", point: [44.1782, 142.4004] };
  const el = id => document.getElementById(id);

  const nameInput = el("journeyPlanName");
  const dateInput = el("journeyPlanDate");
  const memoInput = el("journeyPlanMemo");
  const routeList = el("journeyPlanRoutes");
  const status = el("journeyPlanStatus");
  const stepsEl = el("journeyPlanSteps");
  const distanceEl = el("journeyPlanDistance");
  const rebuildButton = el("journeyPlanRebuild");
  const reverseButton = el("journeyPlanReverse");
  const saveButton = el("journeyPlanSave");
  const messageEl = el("journeyPlanMessage");
  const fitButton = el("journeyPlanFit");
  const confirmOverlay = el("journeyPlanConfirm");
  const confirmName = el("journeyConfirmName");
  const confirmDate = el("journeyConfirmDate");
  const confirmRoutes = el("journeyConfirmRoutes");
  const confirmDistance = el("journeyConfirmDistance");
  const cancelSave = el("journeyCancelSave");
  const confirmSave = el("journeyConfirmSave");

  let routes = [];
  let draft = null;
  let map;
  let routeGroup;
  let connectorGroup;
  let markerGroup;
  let currentPlan = null;
  let currentBounds = null;
  const geojsonCache = new Map();

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(SELECTION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.routeNumbers) ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveDraft() {
    if (!draft) return;
    draft.journeyName = nameInput.value.trim();
    draft.displayName = draft.journeyName || "今回の旅（Version 5.0試作）";
    draft.plannedDate = dateInput.value || "";
    draft.memo = memoInput.value.trim();
    draft.savedAt = new Date().toISOString();
    draft.roughPlan = serializePlan();
    localStorage.setItem(SELECTION_KEY, JSON.stringify(draft));
  }

  function findRoute(number) {
    return routes.find(route => String(route.number) === String(number));
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

  function lineInfo(coordinates) {
    const points = (Array.isArray(coordinates) ? coordinates : [])
      .filter(point => Array.isArray(point) && point.length >= 2)
      .map(point => L.latLng(Number(point[1]), Number(point[0])))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (points.length < 2) return null;
    let total = 0;
    const lengths = [];
    for (let i = 1; i < points.length; i += 1) {
      const length = points[i - 1].distanceTo(points[i]);
      lengths.push(length);
      total += length;
    }
    let travelled = 0;
    const target = total / 2;
    let midpoint = points[Math.floor(points.length / 2)];
    for (let i = 0; i < lengths.length; i += 1) {
      const next = travelled + lengths[i];
      if (next >= target) {
        const ratio = lengths[i] ? (target - travelled) / lengths[i] : 0;
        midpoint = L.latLng(
          points[i].lat + (points[i + 1].lat - points[i].lat) * ratio,
          points[i].lng + (points[i + 1].lng - points[i].lng) * ratio
        );
        break;
      }
      travelled = next;
    }
    return { points, length: total, midpoint };
  }

  async function loadGeoJSON(number) {
    const key = String(number);
    if (!geojsonCache.has(key)) {
      geojsonCache.set(key, fetch(GEOJSON_PATH(number), { cache: "no-store" }).then(response => {
        if (!response.ok) throw new Error(`国道${number}号 GeoJSON読込失敗`);
        return response.json();
      }));
    }
    return geojsonCache.get(key);
  }

  async function geometryInfo(route) {
    const geojson = await loadGeoJSON(route.number);
    const candidates = collectGeoJsonLines(geojson)
      .map(line => ({ line, info: lineInfo(line) }))
      .filter(item => item.info)
      .sort((a, b) => b.info.length - a.info.length);
    if (!candidates.length) return null;
    const main = candidates[0];
    const first = main.info.points[0];
    const last = main.info.points[main.info.points.length - 1];
    return {
      route,
      geojson,
      mainPoints: main.info.points.map(point => [point.lat, point.lng]),
      startPoint: [first.lat, first.lng],
      endPoint: [last.lat, last.lng],
      totalMeters: main.info.length,
      labelPoint: [main.info.midpoint.lat, main.info.midpoint.lng]
    };
  }

  function distanceMeters(a, b) {
    return L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
  }

  function nearestPointIndex(points, target) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    points.forEach((point, index) => {
      const d = distanceMeters(point, target);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    });
    return { index: bestIndex, distance: bestDistance, point: points[bestIndex] };
  }

  function nearestPair(pointsA, pointsB) {
    const strideA = Math.max(1, Math.ceil(pointsA.length / 260));
    const strideB = Math.max(1, Math.ceil(pointsB.length / 260));
    let best = { indexA: 0, indexB: 0, distance: Infinity };
    for (let i = 0; i < pointsA.length; i += strideA) {
      for (let j = 0; j < pointsB.length; j += strideB) {
        const d = distanceMeters(pointsA[i], pointsB[j]);
        if (d < best.distance) best = { indexA: i, indexB: j, distance: d };
      }
    }
    const a0 = Math.max(0, best.indexA - strideA * 2);
    const a1 = Math.min(pointsA.length - 1, best.indexA + strideA * 2);
    const b0 = Math.max(0, best.indexB - strideB * 2);
    const b1 = Math.min(pointsB.length - 1, best.indexB + strideB * 2);
    for (let i = a0; i <= a1; i += 1) {
      for (let j = b0; j <= b1; j += 1) {
        const d = distanceMeters(pointsA[i], pointsB[j]);
        if (d < best.distance) best = { indexA: i, indexB: j, distance: d };
      }
    }
    return {
      ...best,
      pointA: pointsA[best.indexA],
      pointB: pointsB[best.indexB]
    };
  }

  function polylineMeters(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1], points[i]);
    return total;
  }

  function segmentBetween(points, entryIndex, exitIndex) {
    if (entryIndex <= exitIndex) return points.slice(entryIndex, exitIndex + 1);
    return points.slice(exitIndex, entryIndex + 1).reverse();
  }

  function segmentMidpoint(points) {
    if (!points.length) return HOME.point;
    if (points.length === 1) return points[0];
    const total = polylineMeters(points);
    let travelled = 0;
    for (let i = 1; i < points.length; i += 1) {
      const leg = distanceMeters(points[i - 1], points[i]);
      if (travelled + leg >= total / 2) {
        const ratio = leg ? (total / 2 - travelled) / leg : 0;
        return [
          points[i - 1][0] + (points[i][0] - points[i - 1][0]) * ratio,
          points[i - 1][1] + (points[i][1] - points[i - 1][1]) * ratio
        ];
      }
      travelled += leg;
    }
    return points[Math.floor(points.length / 2)];
  }

  function pointAlongSegment(points, fraction = 0.35) {
    if (!points.length) return HOME.point;
    if (points.length === 1) return points[0];
    const total = polylineMeters(points);
    if (!total) return points[Math.floor(points.length / 2)];
    const target = total * Math.max(0, Math.min(1, fraction));
    let travelled = 0;
    for (let i = 1; i < points.length; i += 1) {
      const leg = distanceMeters(points[i - 1], points[i]);
      if (travelled + leg >= target) {
        const ratio = leg ? (target - travelled) / leg : 0;
        return [
          points[i - 1][0] + (points[i][0] - points[i - 1][0]) * ratio,
          points[i - 1][1] + (points[i][1] - points[i - 1][1]) * ratio
        ];
      }
      travelled += leg;
    }
    return points[points.length - 1];
  }

  function chooseSequence(items) {
    if (!items.length) return { sequence: [], routeMeters: 0, connectorMeters: 0, finalConnectorMeters: 0, estimatedMeters: 0 };

    // Build27: 国道の起点・終点ではなく、路線同士の接続点（最接近点）を使って
    // 「今回使う区間」だけを切り出す。自宅→各路線→自宅の総移動が少ない順を選ぶ。
    const n = items.length;
    const homeNearest = items.map(item => nearestPointIndex(item.mainPoints, HOME.point));
    const pairCache = new Map();
    const pairKey = (a, b) => `${Math.min(a,b)}:${Math.max(a,b)}`;

    function getPair(a, b) {
      const key = pairKey(a, b);
      if (!pairCache.has(key)) {
        const low = Math.min(a,b), high = Math.max(a,b);
        pairCache.set(key, nearestPair(items[low].mainPoints, items[high].mainPoints));
      }
      const raw = pairCache.get(key);
      if (a < b) return raw;
      return {
        indexA: raw.indexB,
        indexB: raw.indexA,
        distance: raw.distance,
        pointA: raw.pointB,
        pointB: raw.pointA
      };
    }

    function evaluateOrder(order) {
      const links = [];
      for (let i = 0; i < order.length - 1; i += 1) links.push(getPair(order[i], order[i+1]));

      const sequence = order.map((itemIndex, pos) => {
        const item = items[itemIndex];
        const entryIndex = pos === 0 ? homeNearest[itemIndex].index : links[pos - 1].indexB;
        const exitIndex = pos === order.length - 1 ? homeNearest[itemIndex].index : links[pos].indexA;
        let plannedPoints = segmentBetween(item.mainPoints, entryIndex, exitIndex);
        // 1点だけになると地図表示できないため、ごく近傍を1点追加する。
        if (plannedPoints.length === 1 && item.mainPoints.length > 1) {
          const neighbor = Math.min(item.mainPoints.length - 1, entryIndex + 1);
          const other = neighbor === entryIndex ? Math.max(0, entryIndex - 1) : neighbor;
          plannedPoints = segmentBetween(item.mainPoints, entryIndex, other);
        }
        const routeMeters = polylineMeters(plannedPoints);
        const nextNumber = pos < order.length - 1 ? String(items[order[pos + 1]].route.number) : null;
        const prevNumber = pos > 0 ? String(items[order[pos - 1]].route.number) : null;
        const forward = exitIndex >= entryIndex;
        const directionLabel = forward ? item.route.end : item.route.start;
        return {
          number: String(item.route.number),
          route: item.route,
          geojson: item.geojson,
          mainPoints: item.mainPoints,
          plannedPoints,
          labelPoint: segmentMidpoint(plannedPoints),
          entryIndex,
          exitIndex,
          entry: item.mainPoints[entryIndex],
          exit: item.mainPoints[exitIndex],
          routeMeters,
          directionLabel,
          fromLabel: forward ? item.route.start : item.route.end,
          toLabel: forward ? item.route.end : item.route.start,
          nextNumber,
          prevNumber,
          connectorBeforeMeters: pos === 0 ? homeNearest[itemIndex].distance : links[pos - 1].distance
        };
      });

      const finalConnectorMeters = distanceMeters(sequence[sequence.length - 1].exit, HOME.point);
      const connectorMeters = sequence.reduce((sum, item) => sum + item.connectorBeforeMeters, 0) + finalConnectorMeters;
      const routeMeters = sequence.reduce((sum, item) => sum + item.routeMeters, 0);

      // 接続区間を強く嫌い、選択路線を数km触るだけの案にもペナルティを加える。
      const shortPenalty = sequence.reduce((sum, item) => {
        const minUseful = 8000;
        return sum + Math.max(0, minUseful - item.routeMeters) * 4;
      }, 0);
      const score = routeMeters + connectorMeters * 5 + shortPenalty;
      return { sequence, routeMeters, connectorMeters, finalConnectorMeters, estimatedMeters: routeMeters + connectorMeters * 1.25, score };
    }

    function permutations(array) {
      const result = [];
      const used = Array(array.length).fill(false);
      const cur = [];
      function walk() {
        if (cur.length === array.length) { result.push(cur.slice()); return; }
        for (let i = 0; i < array.length; i += 1) {
          if (used[i]) continue;
          used[i] = true; cur.push(array[i]); walk(); cur.pop(); used[i] = false;
        }
      }
      walk();
      return result;
    }

    let orders;
    if (n <= 8) {
      orders = permutations(Array.from({length:n}, (_,i)=>i));
    } else {
      // 多数選択時は計算量を抑えるため、自宅に近い路線から接続距離最小で貪欲に並べる。
      const remaining = new Set(Array.from({length:n}, (_,i)=>i));
      let current = Array.from(remaining).sort((a,b)=>homeNearest[a].distance-homeNearest[b].distance)[0];
      const order = [current]; remaining.delete(current);
      while (remaining.size) {
        let best = null;
        for (const next of remaining) {
          const d = getPair(current, next).distance;
          if (!best || d < best.d) best = { next, d };
        }
        current = best.next; order.push(current); remaining.delete(current);
      }
      orders = [order];
    }

    let bestPlan = null;
    for (const order of orders) {
      const candidate = evaluateOrder(order);
      if (!bestPlan || candidate.score < bestPlan.score) bestPlan = candidate;
    }
    return bestPlan;
  }

  function buildSteps(plan) {
    if (!plan || !plan.sequence.length) return [];
    const result = [`${HOME.label}を出発。`];

    plan.sequence.forEach((item, index) => {
      const gapKm = item.connectorBeforeMeters / 1000;
      if (index === 0) {
        result.push(gapKm <= 5
          ? `国道${item.number}号へ入る。`
          : `接続区間を使って国道${item.number}号へ向かう。`);
      } else {
        const previous = plan.sequence[index - 1];
        if (gapKm <= 2) {
          result.push(`国道${previous.number}号との接続付近で国道${item.number}号へ移る。`);
        } else if (gapKm <= 15) {
          result.push(`国道${previous.number}号から接続区間を使い、国道${item.number}号へ移る。`);
        } else {
          result.push(`国道${previous.number}号から約${Math.round(gapKm)}kmの接続区間を使い、国道${item.number}号へ移る。`);
        }
      }

      if (item.nextNumber) {
        result.push(`国道${item.number}号を${item.directionLabel}方面へ進み、国道${item.nextNumber}号との接続付近まで走る。`);
      } else {
        result.push(`国道${item.number}号を${item.directionLabel}方面へ進み、自宅へ戻りやすい地点まで走る。`);
      }
    });

    const last = plan.sequence[plan.sequence.length - 1];
    const homeGapKm = plan.finalConnectorMeters / 1000;
    result.push(homeGapKm <= 5
      ? `${last.number}号から${HOME.label}へ戻る。`
      : `国道${last.number}号から接続区間を使い、${HOME.label}へ戻る。`);
    return result;
  }

  function initMap() {
    map = L.map("journeyPlanMap", { preferCanvas: true }).setView([43.8, 142.6], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    connectorGroup = L.layerGroup().addTo(map);
    routeGroup = L.layerGroup().addTo(map);
    markerGroup = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 100);
  }

  function addConnector(a, b) {
    if (!a || !b) return;
    L.polyline([a, b], { color: "#64748b", weight: 4, opacity: .75, dashArray: "10 10", interactive: false }).addTo(connectorGroup);
  }

  function renderMap(plan) {
    routeGroup.clearLayers();
    connectorGroup.clearLayers();
    markerGroup.clearLayers();
    currentBounds = L.latLngBounds([]);

    const homeIcon = L.divIcon({ className: "journey-home-icon", html: "<span>自宅</span>", iconSize: [48, 30], iconAnchor: [24, 15] });
    L.marker(HOME.point, { icon: homeIcon, interactive: false }).addTo(markerGroup);
    currentBounds.extend(HOME.point);

    let previous = HOME.point;
    plan.sequence.forEach((item, index) => {
      addConnector(previous, item.entry);
      const plannedPoints = Array.isArray(item.plannedPoints) ? item.plannedPoints : [];
      if (plannedPoints.length >= 2) {
        const halo = L.polyline(plannedPoints, { color: "#ffffff", weight: 9, opacity: .95, interactive: false }).addTo(routeGroup);
        L.polyline(plannedPoints, { color: "#7c3aed", weight: 6, opacity: .95, interactive: false }).addTo(routeGroup);
        const bounds = halo.getBounds();
        if (bounds.isValid()) currentBounds.extend(bounds);
      }

      const icon = L.divIcon({ className: "journey-order-icon", html: `<span>${index + 1}</span>`, iconSize: [30,30], iconAnchor: [15,15] });
      L.marker(item.labelPoint, { icon, interactive: false }).addTo(markerGroup);

      const routeLabelPoint = pointAlongSegment(plannedPoints, index % 2 === 0 ? 0.32 : 0.68);
      const routeLabelIcon = L.divIcon({
        className: "journey-route-label-icon",
        html: `<span>${escapeHtml(item.number)}号</span>`,
        iconSize: [58, 28],
        iconAnchor: [29, 14]
      });
      L.marker(routeLabelPoint, { icon: routeLabelIcon, interactive: false }).addTo(markerGroup);
      previous = item.exit;
    });
    addConnector(previous, HOME.point);

    if (currentBounds.isValid()) map.fitBounds(currentBounds, { padding: [28, 28], maxZoom: 8 });
  }

  function renderRoutes(plan) {
    routeList.innerHTML = plan.sequence.map((item, index) =>
      `<li><strong>${index + 1}. 国道${escapeHtml(item.number)}号</strong>　${escapeHtml(item.fromLabel)} → ${escapeHtml(item.toLabel)}</li>`
    ).join("");
  }

  function renderPlan(plan, failedCount) {
    currentPlan = plan;
    plan.steps = buildSteps(plan);
    plan.generatedAt = new Date().toISOString();
    plan.homeLabel = HOME.label;
    plan.homePoint = HOME.point.slice();
    plan.routeNumbers = plan.sequence.map(item => item.number);
    status.textContent = failedCount
      ? `${plan.sequence.length}路線で作成。${failedCount}路線は地図データを読み込めませんでした。`
      : "選択国道同士の接続点を基準に、今回使う区間だけを切り出して自宅発着の順番を組んでいます。灰色線は接続区間の目安です。";
    stepsEl.innerHTML = plan.steps.map((step, index) => `<li>${index === 0 || index === plan.steps.length - 1 ? escapeHtml(step) : escapeHtml(step).replace(/国道(\d+)号/g, '<strong>国道$1号</strong>')}</li>`).join("");
    distanceEl.textContent = `概算走行距離：約${Math.round(plan.estimatedMeters / 1000)} km`;
    renderRoutes(plan);
    renderMap(plan);
    saveDraft();
  }

  async function rebuildPlan() {
    geojsonCache.clear();
    rebuildButton.disabled = true;
    rebuildButton.textContent = "再計算中…";
    routeGroup.clearLayers();
    connectorGroup.clearLayers();
    markerGroup.clearLayers();
    let selectedNumbers = normalizeRouteNumbers(draft && draft.routeNumbers);
    // schemaVersion 3以降の空配列は「ユーザーが解除した」という明示状態。
    // その場合は保存済み計画から古い路線を復元しない。
    const selectionIsAuthoritative = Boolean(draft && Number(draft.schemaVersion || 0) >= 3 && Array.isArray(draft.routeNumbers));
    if (!selectedNumbers.length && !selectionIsAuthoritative) selectedNumbers = recoverRouteNumbersFromTrips();
    if (!selectedNumbers.length) {
      status.textContent = "攻略路線が見つかりません。路線選択画面で路線を選ぶか、保存済み計画を確認してください。";
      routeList.innerHTML = "";
      stepsEl.innerHTML = "";
      distanceEl.textContent = "";
      saveButton.disabled = true;
      rebuildButton.disabled = false;
      rebuildButton.textContent = "ルート再計算";
      return;
    }
    draft.routeNumbers = selectedNumbers.slice();
    status.textContent = "選択路線の位置関係から走行予定を組み立てています…";
    saveButton.disabled = true;
    const selected = selectedNumbers.map(findRoute).filter(Boolean);
    const results = await Promise.allSettled(selected.map(geometryInfo));
    const items = results.filter(result => result.status === "fulfilled" && result.value).map(result => result.value);
    const failed = selected.length - items.length;
    if (!items.length) {
      status.textContent = "路線位置を読み込めず、走行予定を作成できませんでした。";
      rebuildButton.disabled = false;
      rebuildButton.textContent = "ルート再計算";
      return;
    }
    renderPlan(chooseSequence(items), failed);
    const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    status.textContent += `　再計算完了 ${time}`;
    saveButton.disabled = false;
    rebuildButton.disabled = false;
    rebuildButton.textContent = "ルート再計算";
  }


  function reverseCurrentPlan() {
    if (!currentPlan || !currentPlan.sequence || !currentPlan.sequence.length) {
      messageEl.textContent = "先にルート再計算で走行予定を作成してください。";
      return;
    }

    const original = currentPlan.sequence;
    const reversed = original.slice().reverse().map((item, index, array) => {
      const sourceIndex = original.length - 1 - index;
      const previousOriginal = sourceIndex + 1 < original.length ? original[sourceIndex + 1] : null;
      const directionLabel = item.directionLabel === item.route.end ? item.route.start : item.route.end;
      return {
        ...item,
        plannedPoints: Array.isArray(item.plannedPoints) ? item.plannedPoints.slice().reverse() : [],
        entryIndex: item.exitIndex,
        exitIndex: item.entryIndex,
        entry: item.exit,
        exit: item.entry,
        labelPoint: item.labelPoint,
        directionLabel,
        fromLabel: item.toLabel || item.route.end,
        toLabel: item.fromLabel || item.route.start,
        connectorBeforeMeters: index === 0 ? currentPlan.finalConnectorMeters : (previousOriginal ? previousOriginal.connectorBeforeMeters : 0),
        prevNumber: index > 0 ? String(array[index - 1].number) : null,
        nextNumber: index < array.length - 1 ? String(array[index + 1].number) : null
      };
    });

    // map() の中では array の各要素は変換前なので、前後番号を変換後の順序で確定する。
    reversed.forEach((item, index) => {
      item.prevNumber = index > 0 ? reversed[index - 1].number : null;
      item.nextNumber = index < reversed.length - 1 ? reversed[index + 1].number : null;
    });

    const routeMeters = reversed.reduce((sum, item) => sum + item.routeMeters, 0);
    const finalConnectorMeters = original[0].connectorBeforeMeters;
    const connectorMeters = reversed.reduce((sum, item) => sum + item.connectorBeforeMeters, 0) + finalConnectorMeters;
    const reversedPlan = {
      sequence: reversed,
      routeMeters,
      connectorMeters,
      finalConnectorMeters,
      estimatedMeters: routeMeters + connectorMeters * 1.25,
      score: currentPlan.score,
      reversed: !currentPlan.reversed
    };

    renderPlan(reversedPlan, 0);
    const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    status.textContent += `　逆ルート再計算完了 ${time}`;
    messageEl.textContent = "走行順を逆回りに切り替えました。";
  }

  function serializePlan() {
    if (!currentPlan) return null;
    return {
      version: 3,
      generatedAt: currentPlan.generatedAt,
      homeLabel: HOME.label,
      homePoint: HOME.point.slice(),
      routeNumbers: currentPlan.routeNumbers.slice(),
      steps: currentPlan.steps.slice(),
      estimatedKm: Math.round(currentPlan.estimatedMeters / 1000),
      routeSegments: currentPlan.sequence.map(item => ({ number: item.number, entryIndex: item.entryIndex, exitIndex: item.exitIndex }))
    };
  }

  function loadTrips() {
    try {
      const raw = localStorage.getItem(TRIPS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function normalizeRouteNumbers(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") return value.split(",").map(v => v.trim()).filter(Boolean);
    return [];
  }

  function recoverRouteNumbersFromTrips() {
    const trips = loadTrips();
    if (!trips.length) return [];
    const planned = trips.filter(trip => trip && (trip.planningStatus === "planned" || String(trip.source || "").includes("planned")));
    const name = (draft && (draft.journeyName || draft.displayName) || "").trim();
    const date = draft && draft.plannedDate || "";
    const candidates = planned.slice().reverse();
    let match = candidates.find(trip => name && String(trip.tripName || "").trim() === name && (!date || trip.startDate === date));
    if (!match) match = candidates.find(trip => date && trip.startDate === date);
    if (!match) match = candidates[0];
    if (!match) return [];
    const snap = match.planSnapshot || {};
    const nums = normalizeRouteNumbers(snap.routeNumbers && snap.routeNumbers.length ? snap.routeNumbers : match.routes);
    if (nums.length && draft) {
      draft.routeNumbers = nums.slice();
      if (!draft.selectedRegion && match.selectedRegion) draft.selectedRegion = match.selectedRegion;
      localStorage.setItem(SELECTION_KEY, JSON.stringify(draft));
    }
    return nums;
  }

  function validate() {
    if (!nameInput.value.trim()) return "旅名を入力してください。";
    if (!dateInput.value) return "実施予定日を入力してください。";
    if (!currentPlan || !currentPlan.sequence.length) return "ざっくり走行予定を作成してください。";
    return "";
  }

  function openConfirm() {
    const error = validate();
    if (error) { messageEl.textContent = error; return; }
    confirmName.textContent = nameInput.value.trim();
    confirmDate.textContent = dateInput.value;
    confirmRoutes.textContent = currentPlan.sequence.map(item => `国道${item.number}号`).join(" → ");
    confirmDistance.textContent = `約${Math.round(currentPlan.estimatedMeters / 1000)} km`;
    confirmOverlay.hidden = false;
  }

  function saveFormalTrip() {
    const error = validate();
    if (error) { messageEl.textContent = error; confirmOverlay.hidden = true; return; }
    const now = new Date().toISOString();
    const trips = loadTrips();
    const editingId = draft && draft.editingTripId ? String(draft.editingTripId) : "";
    const editingIndex = editingId ? trips.findIndex(item => item && String(item.id || "") === editingId) : -1;
    const existing = editingIndex >= 0 ? trips[editingIndex] : null;
    if (existing && existing.planningStatus !== "planned") {
      confirmOverlay.hidden = true;
      messageEl.textContent = "実走記録は上書きできません。";
      return;
    }
    const trip = {
      ...(existing || {}),
      id: existing && existing.id ? existing.id : `trip-v50-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      schemaVersion: 2,
      tripName: nameInput.value.trim(),
      startDate: dateInput.value,
      endDate: dateInput.value,
      routes: currentPlan.routeNumbers.join(","),
      routeSegments: existing && Array.isArray(existing.routeSegments) ? existing.routeSegments : [],
      actionLog: existing && existing.actionLog || "", timeline: existing && existing.timeline || "",
      impressions: existing && existing.impressions || "", improvements: existing && existing.improvements || "",
      thumbnail: existing && existing.thumbnail || "", ferment: existing && existing.ferment || "", noteArticle: existing && existing.noteArticle || "",
      memo: memoInput.value.trim(),
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now,
      source: "Version5.0 planned journey",
      planningStatus: "planned",
      selectedRegion: draft.selectedRegion || "",
      planSnapshot: {
        version: 4,
        savedAt: now,
        planName: nameInput.value.trim(),
        routeNumbers: currentPlan.routeNumbers.slice(),
        roughPlan: serializePlan(),
        source: "v5-journey-plan-screen"
      }
    };
    if (editingIndex >= 0) trips[editingIndex] = trip;
    else trips.push(trip);
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
    draft.editingTripId = trip.id;
    saveDraft();
    confirmOverlay.hidden = true;
    messageEl.textContent = editingIndex >= 0 ? `計画を上書き保存しました：${trip.tripName}` : `旅を追加保存しました：${trip.tripName}`;
  }

  function restoreInputs() {
    nameInput.value = draft.journeyName || "";
    dateInput.value = draft.plannedDate || "";
    memoInput.value = draft.memo || "";
  }

  [nameInput, dateInput, memoInput].forEach(input => input.addEventListener("input", saveDraft));
  rebuildButton.disabled = false;
  rebuildButton.addEventListener("click", rebuildPlan);
  reverseButton.addEventListener("click", reverseCurrentPlan);
  saveButton.addEventListener("click", openConfirm);
  cancelSave.addEventListener("click", () => { confirmOverlay.hidden = true; });
  confirmSave.addEventListener("click", saveFormalTrip);
  confirmOverlay.addEventListener("click", event => { if (event.target === confirmOverlay) confirmOverlay.hidden = true; });
  fitButton.addEventListener("click", () => { if (currentBounds && currentBounds.isValid()) map.fitBounds(currentBounds, { padding: [28,28], maxZoom: 8 }); });

  draft = loadDraft();
  initMap();
  if (!draft) {
    status.textContent = "今回の旅の下書きがありません。路線選択画面で攻略路線を選んでください。";
    saveButton.disabled = true;
    return;
  }
  restoreInputs();
  if (draft.editingTripId) {
    saveButton.textContent = "この計画を上書き保存";
    if (confirmSave) confirmSave.textContent = "計画を上書き保存";
    const title = document.getElementById("journeyConfirmTitle");
    if (title) title.textContent = "この内容で計画を上書きしますか？";
  }
  fetch(ROUTE_DATA_URL, { cache: "no-store" })
    .then(response => { if (!response.ok) throw new Error(`路線データ読込失敗: ${response.status}`); return response.json(); })
    .then(data => {
      routes = Array.isArray(data) ? data : [];
      return rebuildPlan();
    })
    .catch(error => {
      status.textContent = error.message;
      saveButton.disabled = true;
    });
})();
