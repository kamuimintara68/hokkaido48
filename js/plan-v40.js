"use strict";

const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
const planList = document.getElementById("planList");
const planCount = document.getElementById("planCount");
const activePlanContent = document.getElementById("activePlanContent");
const activePlanActions = document.getElementById("activePlanActions");

const requiredFields = [
  "計画名","対象路線","始点","終点","距離(km)",
  "所要時間","宿泊","優先度","季節","メモ"
];

function text(value) {
  return String(value ?? "").trim();
}

function textOrDefault(value) {
  return text(value) || "未登録";
}

function parseRouteNumbers(value) {
  return [...new Set(
    text(value)
      .normalize("NFKC")
      .split(/[,\s、，・→>\/]+/)
      .map(part => part.replace(/[^0-9]/g, ""))
      .filter(Boolean)
      .map(number => String(Number(number)))
  )];
}

function parseWaypoints(value) {
  return text(value)
    .split(/[\n\r、，|→>]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 9);
}

const routeGeometryCache = new Map();

function normalizePlanForGuidance(plan) {
  if (plan && Array.isArray(plan.routeNumbers)) {
    return {
      id: text(plan.id),
      planName: text(plan.planName),
      routeNumbers: plan.routeNumbers.map(value => String(Number(value))).filter(Boolean),
      origin: text(plan.origin),
      destination: text(plan.destination),
      waypoints: Array.isArray(plan.waypoints) ? plan.waypoints.map(text).filter(Boolean) : []
    };
  }

  return {
    id: planIdentity(plan),
    planName: text(plan["計画名"]),
    routeNumbers: parseRouteNumbers(plan["対象路線"]),
    origin: text(plan["始点"]),
    destination: text(plan["終点"]),
    waypoints: parseWaypoints(plan["経由地"])
  };
}

function collectLineStrings(geojson) {
  const lines = [];

  function walkGeometry(geometry) {
    if (!geometry || !geometry.type) return;

    if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
      lines.push(geometry.coordinates);
      return;
    }

    if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach(line => lines.push(line));
      return;
    }

    if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
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

  const path = `data/geojson/route_${number.padStart(3, "0")}.geojson`;
  const response = await fetch(path, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`国道${number}号の路線データを読み込めませんでした。`);
  }

  const geojson = await response.json();
  const lines = collectLineStrings(geojson)
    .map(line => line
      .map(point => ({
        lng: Number(point[0]),
        lat: Number(point[1])
      }))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    )
    .filter(line => line.length >= 2);

  if (!lines.length) {
    throw new Error(`国道${number}号の座標データがありません。`);
  }

  // 現在の北海道48路線データでは本線が最長ラインとして保持されるため、
  // Googleマップ経路作成には最長ラインを使用する。
  const coords = lines.sort((a, b) => b.length - a.length)[0];
  routeGeometryCache.set(number, coords);
  return coords;
}

function sampleIndexedRoute(coords, maxCount = 420) {
  if (coords.length <= maxCount) {
    return coords.map((point, index) => ({ ...point, routeIndex: index }));
  }

  const sampled = [];
  for (let index = 0; index < maxCount; index += 1) {
    const routeIndex = Math.round(index * (coords.length - 1) / (maxCount - 1));
    sampled.push({ ...coords[routeIndex], routeIndex });
  }
  return sampled;
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function closestRoutePair(routeA, routeB) {
  const sampleA = sampleIndexedRoute(routeA);
  const sampleB = sampleIndexedRoute(routeB);

  let best = null;

  sampleA.forEach(a => {
    sampleB.forEach(b => {
      const distance = distanceMeters(a, b);
      if (!best || distance < best.distance) {
        best = {
          distance,
          aIndex: a.routeIndex,
          bIndex: b.routeIndex,
          aPoint: { lat: a.lat, lng: a.lng },
          bPoint: { lat: b.lat, lng: b.lng }
        };
      }
    });
  });

  return best;
}

function pointAtMiddle(route, startIndex, endIndex) {
  const low = Math.max(0, Math.min(startIndex, endIndex));
  const high = Math.min(route.length - 1, Math.max(startIndex, endIndex));
  return route[Math.round((low + high) / 2)];
}

function coordinateText(point) {
  return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
}

async function buildGuidedDirections(plan) {
  const normalized = normalizePlanForGuidance(plan);
  const { routeNumbers, origin, destination, waypoints } = normalized;

  if (!origin || !destination) {
    throw new Error("始点または終点が未登録です。");
  }

  if (routeNumbers.length < 2) {
    const params = new URLSearchParams({
      api: "1",
      origin,
      destination,
      travelmode: "driving",
      avoid: "highways"
    });
    if (waypoints.length) params.set("waypoints", waypoints.slice(0, 9).join("|"));
    return { url: `https://www.google.com/maps/dir/?${params.toString()}`, controlPoints: [] };
  }

  const routes = [];
  for (const number of routeNumbers) {
    routes.push(await loadRouteGeometry(number));
  }

  const transitions = [];
  for (let index = 0; index < routes.length - 1; index += 1) {
    const pair = closestRoutePair(routes[index], routes[index + 1]);
    if (!pair) {
      throw new Error(`国道${routeNumbers[index]}号と国道${routeNumbers[index + 1]}号の接続点を作れませんでした。`);
    }
    transitions.push(pair);
  }

  const controlPoints = [];

  // 最初の国道から2本目へ移る地点を明示。
  controlPoints.push({
    kind: "transition",
    routeNumber: routeNumbers[0],
    nextRouteNumber: routeNumbers[1],
    ...transitions[0].aPoint
  });

  // 各中間国道について、前後の接続点の中間にある「その国道上の点」を通過させる。
  // これによりGoogleマップが近道の道道などへ逃げにくくする。
  for (let index = 1; index < routes.length - 1; index += 1) {
    const incomingIndex = transitions[index - 1].bIndex;
    const outgoingIndex = transitions[index].aIndex;
    const middle = pointAtMiddle(routes[index], incomingIndex, outgoingIndex);

    controlPoints.push({
      kind: "route-midpoint",
      routeNumber: routeNumbers[index],
      lat: middle.lat,
      lng: middle.lng
    });
  }

  // 最終国道は、ユーザーが入力した最後の経由地を優先して方向を決める。
  // 経由地が無い場合は、最後の接続点から本線上を少し進んだ点を使う。
  const lastPlace = waypoints.length ? waypoints[waypoints.length - 1] : "";
  const lastRouteNumber = routeNumbers[routeNumbers.length - 1];

  let finalWaypoint = "";
  if (lastPlace) {
    finalWaypoint = lastPlace;
  } else {
    const lastRoute = routes[routes.length - 1];
    const incoming = transitions[transitions.length - 1].bIndex;
    const step = Math.max(1, Math.round(lastRoute.length * 0.08));
    const candidateA = lastRoute[Math.min(lastRoute.length - 1, incoming + step)];
    const candidateB = lastRoute[Math.max(0, incoming - step)];
    const candidate = candidateA || candidateB;
    finalWaypoint = coordinateText(candidate);
    controlPoints.push({
      kind: "last-route",
      routeNumber: lastRouteNumber,
      lat: candidate.lat,
      lng: candidate.lng
    });
  }

  const waypointValues = controlPoints.map(coordinateText);
  if (finalWaypoint) waypointValues.push(finalWaypoint);

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
    avoid: "highways"
  });

  params.set("waypoints", waypointValues.slice(0, 9).join("|"));

  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    controlPoints
  };
}

async function openGuidedGoogleMaps(plan, button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "国道上の経由点を作成中…";

  // ユーザー操作の直後に空タブを作り、非同期処理後でもポップアップ扱いされにくくする。
  const targetTab = window.open("about:blank", "_blank");

  try {
    const normalized = normalizePlanForGuidance(plan);
    const result = await buildGuidedDirections(normalized);

    const current = readActivePlan();
    if (current && current.id === normalized.id) {
      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify({
        ...current,
        googleMapsUrl: result.url,
        plannedControlPoints: result.controlPoints,
        guidanceVersion: 2,
        guidanceGeneratedAt: new Date().toISOString()
      }));
      renderActivePlan();
    }

    if (targetTab) {
      targetTab.location.href = result.url;
    } else {
      window.location.href = result.url;
    }
  } catch (error) {
    if (targetTab) targetTab.close();
    console.error("Googleマップ経路作成エラー:", error);
    alert(`Googleマップ経路を作成できませんでした：${error.message || error}`);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

const GEOCODE_CACHE_KEY = "hokkaido48GeocodeCandidatesV2";
const GSI_GEOCODER_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";

function readGeocodeCache() {
  try {
    const value = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    return {};
  }
}

function writeGeocodeCache(cache) {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("地名座標キャッシュを保存できませんでした。", error);
  }
}

async function geocodePlaceCandidates(place) {
  const original = text(place);
  if (!original) throw new Error("地名が空です。");

  const cache = readGeocodeCache();
  if (Array.isArray(cache[original]) && cache[original].length) {
    return cache[original];
  }

  const queryVariants = [...new Set([
    /^北海道/.test(original) ? original : `北海道${original}`,
    original
  ])];

  const candidates = [];

  for (const query of queryVariants) {
    try {
      const response = await fetch(
        `${GSI_GEOCODER_URL}${encodeURIComponent(query)}`,
        { cache: "no-store" }
      );

      if (!response.ok) continue;

      const results = await response.json();
      if (!Array.isArray(results)) continue;

      results.forEach(item => {
        const coordinates =
          item &&
          item.geometry &&
          Array.isArray(item.geometry.coordinates)
            ? item.geometry.coordinates
            : null;

        if (!coordinates || coordinates.length < 2) return;

        const lat = Number(coordinates[1]);
        const lng = Number(coordinates[0]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const title = text(item.properties && item.properties.title) || original;
        const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;

        if (!candidates.some(candidate => candidate.key === key)) {
          candidates.push({
            key,
            query: original,
            searchedAs: query,
            title,
            lat,
            lng
          });
        }
      });
    } catch (error) {
      console.warn(`「${query}」の地名検索に失敗しました。`, error);
    }
  }

  if (!candidates.length) {
    throw new Error(`「${original}」の位置が見つかりませんでした。`);
  }

  cache[original] = candidates;
  writeGeocodeCache(cache);
  return candidates;
}

function chooseCandidateForRoute(candidates, route) {
  let best = null;

  candidates.forEach(candidate => {
    const snapped = nearestRoutePoint(route, candidate);
    if (!snapped) return;

    if (!best || snapped.distanceMeters < best.snapDistanceMeters) {
      best = {
        placePoint: candidate,
        snapped,
        snapDistanceMeters: snapped.distanceMeters
      };
    }
  });

  return best;
}

async function resolvePlaceOnRoute(place, routeNumber, routeMap) {
  const route = routeMap.get(routeNumber);
  if (!route) {
    throw new Error(`国道${routeNumber}号の座標データがありません。`);
  }

  const candidates = await geocodePlaceCandidates(place);
  const best = chooseCandidateForRoute(candidates, route);

  if (!best) {
    throw new Error(`「${place}」を国道${routeNumber}号へ合わせられませんでした。`);
  }

  return {
    label: place,
    routeNumber,
    geocodedTitle: best.placePoint.title,
    searchedAs: best.placePoint.searchedAs,
    lat: Number(best.snapped.lat.toFixed(7)),
    lng: Number(best.snapped.lng.toFixed(7)),
    snapDistanceKm: Number((best.snapDistanceMeters / 1000).toFixed(2))
  };
}

function nearestRoutePoint(route, target) {
  let best = null;

  route.forEach((point, index) => {
    const distance = distanceMeters(point, target);
    if (!best || distance < best.distanceMeters) {
      best = {
        index,
        lat: point.lat,
        lng: point.lng,
        distanceMeters: distance
      };
    }
  });

  return best;
}

async function resolveDestinationAnchor(normalized, routeMap) {
  if (
    normalized.origin &&
    normalized.destination &&
    normalized.origin.trim() === normalized.destination.trim()
  ) {
    return resolvePlaceOnRoute(
      normalized.destination,
      normalized.routeNumbers[0],
      routeMap
    );
  }

  const candidates = await geocodePlaceCandidates(normalized.destination);
  let best = null;

  for (const routeNumber of normalized.routeNumbers) {
    const route = routeMap.get(routeNumber);
    const selected = chooseCandidateForRoute(candidates, route);
    if (!selected) continue;

    if (!best || selected.snapDistanceMeters < best.snapDistanceMeters) {
      best = {
        routeNumber,
        ...selected
      };
    }
  }

  if (!best) {
    throw new Error(`「${normalized.destination}」の到着国道を決定できませんでした。`);
  }

  return {
    label: normalized.destination,
    routeNumber: best.routeNumber,
    geocodedTitle: best.placePoint.title,
    searchedAs: best.placePoint.searchedAs,
    lat: Number(best.snapped.lat.toFixed(7)),
    lng: Number(best.snapped.lng.toFixed(7)),
    snapDistanceKm: Number((best.snapDistanceMeters / 1000).toFixed(2))
  };
}

async function buildNavigationAnchors(plan) {
  const normalized = normalizePlanForGuidance(plan);
  const { routeNumbers, origin, destination, waypoints } = normalized;

  if (!origin || !destination) {
    throw new Error("始点または終点が未登録です。");
  }
  if (!routeNumbers.length) {
    throw new Error("対象路線が登録されていません。");
  }

  const routeMap = new Map();
  for (const routeNumber of routeNumbers) {
    routeMap.set(routeNumber, await loadRouteGeometry(routeNumber));
  }

  const anchors = [];

  const startAnchor = await resolvePlaceOnRoute(
    origin,
    routeNumbers[0],
    routeMap
  );
  anchors.push({
    kind: "start",
    ...startAnchor
  });

  // 経由地は「次に走る対象国道」へ合わせる。
  // 深川→12、沼田→233、雨竜→275、滝川→451、留萌/増毛→231。
  for (let index = 0; index < waypoints.length; index += 1) {
    const waypoint = waypoints[index];
    const routeIndex = Math.min(index + 1, routeNumbers.length - 1);
    const routeNumber = routeNumbers[routeIndex];

    const viaAnchor = await resolvePlaceOnRoute(
      waypoint,
      routeNumber,
      routeMap
    );

    anchors.push({
      kind: "via",
      ...viaAnchor
    });
  }

  const destinationAnchor = await resolveDestinationAnchor(
    normalized,
    routeMap
  );
  anchors.push({
    kind: "finish",
    ...destinationAnchor
  });

  const cleaned = [];
  anchors.forEach(anchor => {
    const previous = cleaned[cleaned.length - 1];

    if (
      previous &&
      distanceMeters(previous, anchor) < 50 &&
      anchor.kind !== "finish"
    ) {
      return;
    }

    cleaned.push(anchor);
  });

  if (cleaned.length < 2) {
    throw new Error("OsmAndへ渡す経由点を作成できませんでした。");
  }

  return {
    name: normalized.planName || "北海道48路線 予定経路",
    routeNumbers,
    anchors: cleaned
  };
}

function formatOsmAndCoordinate(point) {
  return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
}

function buildOsmAndWebUrl(anchorPlan) {
  const anchors = anchorPlan.anchors;
  const start = anchors[0];
  const finish = anchors[anchors.length - 1];
  const vias = anchors.slice(1, -1);

  const params = new URLSearchParams();
  params.set("start", formatOsmAndCoordinate(start));
  params.set("end", formatOsmAndCoordinate(finish));

  // OsmAnd Web公式実装は複数の中間点を
  // via=lat,lng;lat,lng;... の1パラメータで扱う。
  if (vias.length) {
    params.set(
      "via",
      vias.map(formatOsmAndCoordinate).join(";")
    );
  }

  params.set("profile", "car");

  const centerLat = anchors.reduce((sum, point) => sum + Number(point.lat), 0) / anchors.length;
  const centerLng = anchors.reduce((sum, point) => sum + Number(point.lng), 0) / anchors.length;

  return `https://osmand.net/map/navigate/?${params.toString()}#8/${centerLat.toFixed(5)}/${centerLng.toFixed(5)}`;
}

function buildRoutePointGpx(anchorPlan) {
  const name = escapeXml(anchorPlan.name);
  const routeText = escapeXml(
    anchorPlan.routeNumbers.map(number => `国道${number}号`).join(" → ")
  );

  const rtepts = anchorPlan.anchors.map((point, index) => {
    const role = point.kind === "start"
      ? "出発"
      : point.kind === "finish"
        ? "到着"
        : `経由${index}`;

    return [
      `    <rtept lat="${Number(point.lat).toFixed(7)}" lon="${Number(point.lng).toFixed(7)}">`,
      `      <name>${escapeXml(`${role} ${point.label}`)}</name>`,
      `      <desc>${escapeXml(`国道${point.routeNumber}号上／${point.geocodedTitle}`)}</desc>`,
      "    </rtept>"
    ].join("\n");
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"
  creator="北海道48路線ふらふらlog"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <desc>${routeText}／OsmAnd用Routeポイント</desc>
  </metadata>
  <rte>
    <name>${name}</name>
    <desc>${routeText}</desc>
${rtepts}
  </rte>
</gpx>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function routeSegmentBetween(route, startIndex, endIndex) {
  const start = Math.max(0, Math.min(route.length - 1, Number(startIndex)));
  const end = Math.max(0, Math.min(route.length - 1, Number(endIndex)));

  if (start <= end) {
    return route.slice(start, end + 1);
  }

  return route.slice(end, start + 1).reverse();
}

function nearestPointIndex(route, point) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  route.forEach((candidate, index) => {
    const distance = distanceMeters(candidate, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function dedupeAdjacent(points) {
  const output = [];

  points.forEach(point => {
    const previous = output[output.length - 1];
    if (
      previous &&
      Math.abs(previous.lat - point.lat) < 1e-7 &&
      Math.abs(previous.lng - point.lng) < 1e-7
    ) {
      return;
    }
    output.push(point);
  });

  return output;
}

async function buildPlannedTrack(plan) {
  const normalized = normalizePlanForGuidance(plan);
  const { routeNumbers } = normalized;

  if (!routeNumbers.length) {
    throw new Error("対象路線が登録されていません。");
  }

  const routes = [];
  for (const number of routeNumbers) {
    routes.push(await loadRouteGeometry(number));
  }

  if (routes.length === 1) {
    return {
      name: normalized.planName || `国道${routeNumbers[0]}号予定経路`,
      routeNumbers,
      points: routes[0]
    };
  }

  const transitions = [];
  for (let index = 0; index < routes.length - 1; index += 1) {
    const pair = closestRoutePair(routes[index], routes[index + 1]);
    if (!pair) {
      throw new Error(`国道${routeNumbers[index]}号と国道${routeNumbers[index + 1]}号の接続点を作れませんでした。`);
    }
    transitions.push(pair);
  }

  const stitched = [];

  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];

    let startIndex = 0;
    let endIndex = route.length - 1;

    if (index > 0) {
      startIndex = transitions[index - 1].bIndex;
    }

    if (index < routes.length - 1) {
      endIndex = transitions[index].aIndex;
    }

    // 最初と最後の路線は全線ではなく、隣接路線との接続側から
    // おおむね今回の走行方向へ寄せる。
    // 正確な始終点座標が未登録の計画では、過剰な全線出力を避けるため
    // 路線長の25%を上限に端側を切る。
    if (index === 0 && routes.length > 1) {
      const transitionIndex = transitions[0].aIndex;
      const quarter = Math.max(1, Math.round(route.length * 0.25));
      const candidateA = Math.max(0, transitionIndex - quarter);
      const candidateB = Math.min(route.length - 1, transitionIndex + quarter);

      // 先頭路線は、接続点から離れる方向のうち短い方を採用。
      if (transitionIndex - candidateA <= candidateB - transitionIndex) {
        startIndex = candidateA;
        endIndex = transitionIndex;
      } else {
        startIndex = candidateB;
        endIndex = transitionIndex;
      }
    }

    if (index === routes.length - 1 && routes.length > 1) {
      const transitionIndex = transitions[transitions.length - 1].bIndex;
      const quarter = Math.max(1, Math.round(route.length * 0.25));
      const candidateA = Math.max(0, transitionIndex - quarter);
      const candidateB = Math.min(route.length - 1, transitionIndex + quarter);

      // 最終路線は接続点から離れる方向へ短い側を採用。
      if (transitionIndex - candidateA <= candidateB - transitionIndex) {
        startIndex = transitionIndex;
        endIndex = candidateA;
      } else {
        startIndex = transitionIndex;
        endIndex = candidateB;
      }
    }

    stitched.push(...routeSegmentBetween(route, startIndex, endIndex));
  }

  return {
    name: normalized.planName || "北海道48路線 予定経路",
    routeNumbers,
    points: dedupeAdjacent(stitched)
  };
}

function buildGpxText(track) {
  const name = escapeXml(track.name);
  const routeText = escapeXml(
    track.routeNumbers.map(number => `国道${number}号`).join(" → ")
  );

  const trkpts = track.points
    .map(point =>
      `      <trkpt lat="${Number(point.lat).toFixed(7)}" lon="${Number(point.lng).toFixed(7)}"></trkpt>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1"
  creator="北海道48路線ふらふらlog"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <desc>${routeText}</desc>
  </metadata>
  <trk>
    <name>${name}</name>
    <desc>${routeText}</desc>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function safeFileName(value) {
  return String(value || "予定経路")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

async function downloadPlannedGpx(plan, button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "OsmAnd用GPXを作成中…";

  try {
    let current = readActivePlan();
    let anchorPlan = null;

    if (
      current &&
      current.plannedNavigation &&
      Array.isArray(current.plannedNavigation.anchors) &&
      current.plannedNavigation.anchors.length >= 2
    ) {
      anchorPlan = {
        name: current.planName || "北海道48路線 予定経路",
        routeNumbers: current.routeNumbers || [],
        anchors: current.plannedNavigation.anchors
      };
    } else {
      anchorPlan = await buildNavigationAnchors(plan);
    }

    const gpx = buildRoutePointGpx(anchorPlan);
    const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(anchorPlan.name)}_OsmAnd.gpx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    const normalized = normalizePlanForGuidance(plan);
    current = readActivePlan();
    if (current && current.id === normalized.id) {
      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify({
        ...current,
        plannedGpxGeneratedAt: new Date().toISOString(),
        plannedGpxPointCount: anchorPlan.anchors.length,
        plannedRouteNumbers: anchorPlan.routeNumbers,
        plannedGpxType: "osmand-route-points"
      }));
      renderActivePlan();
    }
  } catch (error) {
    console.error("OsmAnd用GPX作成エラー:", error);
    alert(`OsmAnd用GPXを作成できませんでした：${error.message || error}`);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function previewPlannedTrack(plan, button) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "地名と国道を照合中…";

  const osmandTab = window.open("about:blank", "_blank");

  try {
    const anchorPlan = await buildNavigationAnchors(plan);
    const normalized = normalizePlanForGuidance(plan);
    const current = readActivePlan();

    const basePlan = current && current.id === normalized.id
      ? current
      : {
          schemaVersion: 1,
          selectedAt: new Date().toISOString(),
          id: normalized.id,
          planName: normalized.planName,
          targetRoutes: normalized.routeNumbers.map(number => `国道${number}号`).join(" → "),
          routeNumbers: normalized.routeNumbers,
          origin: normalized.origin,
          destination: normalized.destination,
          waypoints: normalized.waypoints,
          source: "data/travel_plans.xlsx"
        };

    const osmandWebUrl = buildOsmAndWebUrl(anchorPlan);

    const updated = {
      ...basePlan,
      plannedNavigation: {
        version: 2,
        mode: "geocoded-route-anchors",
        generatedAt: new Date().toISOString(),
        anchors: anchorPlan.anchors
      },
      plannedPreview: {
        version: 2,
        kind: "route-points",
        name: anchorPlan.name,
        routeNumbers: anchorPlan.routeNumbers,
        generatedAt: new Date().toISOString(),
        points: anchorPlan.anchors.map(point => [point.lat, point.lng]),
        anchors: anchorPlan.anchors
      },
      osmandWebUrl
    };

    localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(updated));

    if (osmandTab) {
      osmandTab.location.href = osmandWebUrl;
    }

    window.location.href = "index.html?planned=1";
  } catch (error) {
    if (osmandTab) osmandTab.close();
    console.error("予定経路作成エラー:", error);
    alert(`予定経路を作成できませんでした：${error.message || error}`);
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function createPreviewButton(plan, label = "予定経路を作成・確認") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "select-plan-button";
  button.textContent = label;
  button.addEventListener("click", () => previewPlannedTrack(plan, button));
  return button;
}

function createGpxButton(plan, label = "OsmAnd用予定GPXを書き出す") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-link";
  button.textContent = label;
  button.addEventListener("click", () => downloadPlannedGpx(plan, button));
  return button;
}

function planIdentity(plan) {
  return [
    text(plan["計画名"]),
    text(plan["対象路線"]),
    text(plan["始点"]),
    text(plan["終点"])
  ].join("|");
}

function toActivePlan(plan) {
  return {
    schemaVersion: 1,
    selectedAt: new Date().toISOString(),
    id: planIdentity(plan),
    planName: text(plan["計画名"]),
    targetRoutes: text(plan["対象路線"]),
    routeNumbers: parseRouteNumbers(plan["対象路線"]),
    origin: text(plan["始点"]),
    destination: text(plan["終点"]),
    waypoints: parseWaypoints(plan["経由地"]),
    googleMapsUrl: buildGoogleMapsUrl(plan),
    source: "data/travel_plans.xlsx"
  };
}

function readActivePlan() {
  const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error("今回のプラン読込エラー:", error);
    return null;
  }
}

function saveActivePlan(plan) {
  localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(toActivePlan(plan)));
  renderActivePlan();
  renderPlans(window.__hokkaido48Plans || []);
}

function clearActivePlan() {
  localStorage.removeItem(ACTIVE_PLAN_KEY);
  renderActivePlan();
  renderPlans(window.__hokkaido48Plans || []);
}

function createDetail(label, value, className) {
  const container = document.createElement("div");
  if (className) container.className = className;

  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = textOrDefault(value);

  container.append(term, description);
  return container;
}

function createButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function createGoogleMapButton(plan, label = "Googleマップ経路を作成して開く") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-link google-map-link";
  button.textContent = label;
  button.addEventListener("click", () => openGuidedGoogleMaps(plan, button));
  return button;
}

function renderActivePlan() {
  const active = readActivePlan();
  activePlanActions.innerHTML = "";

  if (!active) {
    activePlanContent.textContent = "まだ選択されていません。下の計画から今回走るプランを選んでください。";
    return;
  }

  const routeText = Array.isArray(active.routeNumbers) && active.routeNumbers.length
    ? active.routeNumbers.map(number => `国道${number}号`).join(" → ")
    : (active.targetRoutes || "対象路線未登録");

  activePlanContent.innerHTML = "";
  const name = document.createElement("p");
  name.innerHTML = `<strong>${active.planName || "名称未登録"}</strong>`;
  const routes = document.createElement("p");
  routes.textContent = `予定路線：${routeText}`;
  const section = document.createElement("p");
  section.textContent = `予定区間：${active.origin || "未登録"} → ${active.destination || "未登録"}`;
  activePlanContent.append(name, routes, section);

  activePlanActions.appendChild(
    createPreviewButton(active, "AI経路を作成・OsmAndで確認")
  );

  activePlanActions.appendChild(
    createGpxButton(active, "OsmAnd用予定GPXを書き出す")
  );

  activePlanActions.appendChild(
    createGoogleMapButton(active, "Googleマップで参考表示")
  );

  activePlanActions.appendChild(
    createButton("今回のプラン選択を解除", "clear-plan-button", clearActivePlan)
  );
}

function createPlanCard(plan) {
  const active = readActivePlan();
  const activeId = active ? active.id : "";

  const card = document.createElement("article");
  card.className = "plan-card";
  if (activeId && activeId === planIdentity(plan)) card.classList.add("active");

  const title = document.createElement("h3");
  title.textContent = textOrDefault(plan["計画名"]);

  const route = document.createElement("p");
  route.className = "plan-route";
  route.textContent = "対象路線：" + textOrDefault(plan["対象路線"]);

  const details = document.createElement("dl");
  details.className = "plan-details";
  details.appendChild(createDetail("始点", plan["始点"]));
  details.appendChild(createDetail("終点", plan["終点"]));
  details.appendChild(createDetail("距離", text(plan["距離(km)"]) ? `${plan["距離(km)"]} km` : ""));
  details.appendChild(createDetail("所要時間", plan["所要時間"]));
  details.appendChild(createDetail("宿泊", plan["宿泊"]));
  details.appendChild(createDetail("優先度", plan["優先度"]));
  details.appendChild(createDetail("季節", plan["季節"]));
  if (text(plan["経由地"])) details.appendChild(createDetail("経由地", plan["経由地"], "plan-memo"));
  details.appendChild(createDetail("メモ", plan["メモ"], "plan-memo"));

  const actions = document.createElement("div");
  actions.className = "plan-actions";

  actions.appendChild(
    createPreviewButton(toActivePlan(plan), "AI経路を作成・OsmAndで確認")
  );

  actions.appendChild(
    createGpxButton(toActivePlan(plan), "OsmAnd用予定GPXを書き出す")
  );

  actions.appendChild(
    createGoogleMapButton(toActivePlan(plan), "Googleマップで参考表示")
  );

  const selectLabel = activeId && activeId === planIdentity(plan)
    ? "今回のプランに選択中"
    : "このプランを今回の予定にする";

  const selectButton = createButton(selectLabel, "select-plan-button", () => saveActivePlan(plan));
  actions.appendChild(selectButton);

  card.append(title, route, details, actions);
  return card;
}

function renderPlans(plans) {
  window.__hokkaido48Plans = plans;
  planList.innerHTML = "";
  planCount.textContent = `${plans.length}件`;

  if (!plans.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "Excelに旅行計画はまだ登録されていません。";
    planList.appendChild(empty);
    return;
  }

  plans.forEach(plan => planList.appendChild(createPlanCard(plan)));
}

function showLoadError(error) {
  console.error("旅行計画読込エラー:", error);
  planCount.textContent = "読込失敗";
  planList.innerHTML = '<p class="error-message">旅行計画Excelを読み込めませんでした。</p>';
}

async function initializePlanViewer() {
  renderActivePlan();

  try {
    if (!window.XLSX) throw new Error("Excel読込機能を読み込めませんでした。");

    const response = await fetch("data/travel_plans.xlsx", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const workbook = window.XLSX.read(await response.arrayBuffer(), { type: "array" });
    const worksheet = workbook.Sheets["旅行計画"];
    if (!worksheet) throw new Error("旅行計画シートがありません。");

    const rows = window.XLSX.utils.sheet_to_json(worksheet, {
      header: 1, defval: "", raw: false
    });

    const headers = rows[3] || [];
    const missing = requiredFields.filter(field => headers.indexOf(field) < 0);
    if (missing.length) throw new Error(`旅行計画の必須項目がありません: ${missing.join(",")}`);

    const fields = [...requiredFields];
    ["経由地", "GoogleマップURL"].forEach(field => {
      if (headers.includes(field)) fields.push(field);
    });

    const indexes = Object.fromEntries(fields.map(field => [field, headers.indexOf(field)]));

    const plans = rows
      .slice(4)
      .filter(row => row.some(value => text(value)))
      .map(row => {
        const plan = {};
        fields.forEach(field => {
          plan[field] = row[indexes[field]] ?? "";
        });
        return plan;
      });

    renderPlans(plans);
  } catch (error) {
    showLoadError(error);
  }
}

initializePlanViewer();
