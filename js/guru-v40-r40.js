"use strict";

(function () {
  const GURU_ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const TARGET_PLAN_NAME = "R40北上2時間 実走総合テスト";
  const TARGET_ROUTE_NUMBER = "40";
  const GUIDE_SPACING_METERS = 10000;

  function isTargetPlan(plan) {
    if (!plan || typeof plan !== "object") return false;

    const routeNumbers = Array.isArray(plan.routeNumbers)
      ? plan.routeNumbers.map(value => String(Number(value))).filter(Boolean)
      : [];

    return (
      String(plan.planName || "").trim() === TARGET_PLAN_NAME &&
      routeNumbers.length === 1 &&
      routeNumbers[0] === TARGET_ROUTE_NUMBER
    );
  }

  function appendDistinctVertices(target, points) {
    points.forEach(point => {
      const normalized = {
        lat: Number(point.lat),
        lng: Number(point.lng)
      };

      const previous = target[target.length - 1];
      if (
        previous &&
        Math.abs(previous.lat - normalized.lat) < 1e-10 &&
        Math.abs(previous.lng - normalized.lng) < 1e-10
      ) {
        return;
      }

      target.push(normalized);
    });
  }

  function sampleGeoJsonVertices(points, spacingMeters = GUIDE_SPACING_METERS) {
    if (!Array.isArray(points) || points.length < 2) {
      return Array.isArray(points) ? points.slice() : [];
    }

    const sampled = [{
      lat: Number(points[0].lat),
      lng: Number(points[0].lng)
    }];

    let cumulativeMeters = 0;
    let nextTargetMeters = spacingMeters;

    for (let index = 1; index < points.length; index += 1) {
      cumulativeMeters += distanceMeters(points[index - 1], points[index]);

      if (cumulativeMeters >= nextTargetMeters) {
        sampled.push({
          lat: Number(points[index].lat),
          lng: Number(points[index].lng)
        });
        nextTargetMeters += spacingMeters;
      }
    }

    const last = {
      lat: Number(points[points.length - 1].lat),
      lng: Number(points[points.length - 1].lng)
    };
    const previous = sampled[sampled.length - 1];

    if (
      Math.abs(previous.lat - last.lat) >= 1e-10 ||
      Math.abs(previous.lng - last.lng) >= 1e-10
    ) {
      sampled.push(last);
    }

    return sampled;
  }

  function guruCoordinate(point) {
    return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
  }

  function buildGuruUrl(points) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error("Guru Mapsへ渡す国道上の固定通過点が不足しています。");
    }

    const start = points[0];
    const finish = points[points.length - 1];
    const vias = points.slice(1, -1);

    const parts = [
      `start=${guruCoordinate(start)}`,
      ...vias.map(point => `via=${guruCoordinate(point)}`),
      `finish=${guruCoordinate(finish)}`,
      "mode=auto",
      "start_navigation=false"
    ];

    return `guru://nav?${parts.join("&")}`;
  }

  async function resolveExactRouteVertex(place, route, routeMap) {
    const snapped = await resolvePlaceOnRoute(
      place,
      TARGET_ROUTE_NUMBER,
      routeMap
    );

    const exact = nearestRoutePointWithIndex(route, snapped);

    if (!exact) {
      throw new Error(`「${place}」を国道40号上へ配置できませんでした。`);
    }

    return exact;
  }

  async function buildGuruR40Navigation(plan) {
    const normalized = normalizePlanForGuidance(plan);
    const legs = parseFullRouteSpec(normalized.fullRouteSpec);

    if (!isTargetPlan(normalized)) {
      throw new Error("現在はR40北上2時間 実走総合テスト専用です。");
    }

    if (!legs.length || legs.some(leg => leg.routeNumber !== TARGET_ROUTE_NUMBER)) {
      throw new Error("R40テストの全行程ルートを確認してください。");
    }

    const route = await loadRouteGeometry(TARGET_ROUTE_NUMBER);
    const routeMap = new Map([[TARGET_ROUTE_NUMBER, route]]);

    let current = await resolveExactRouteVertex(
      normalized.origin,
      route,
      routeMap
    );

    const orderedVertices = [];

    for (const leg of legs) {
      const next = await resolveExactRouteVertex(
        leg.endPlace,
        route,
        routeMap
      );

      appendDistinctVertices(
        orderedVertices,
        routeSection(route, current.index, next.index)
      );

      current = next;
    }

    if (orderedVertices.length < 2) {
      throw new Error("R40の走行順序を作成できませんでした。");
    }

    const guidePoints = sampleGeoJsonVertices(
      orderedVertices,
      GUIDE_SPACING_METERS
    );

    return {
      url: buildGuruUrl(guidePoints),
      guidePoints,
      rawPointCount: orderedVertices.length,
      distanceKm: trackDistanceKm(orderedVertices),
      spacingMeters: GUIDE_SPACING_METERS
    };
  }

  async function openGuruMaps(plan, button) {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "国道40号上の通過点を作成中…";

    try {
      const result = await buildGuruR40Navigation(plan);
      const current = readActivePlan();

      if (current && isTargetPlan(current)) {
        localStorage.setItem(
          GURU_ACTIVE_PLAN_KEY,
          JSON.stringify({
            ...current,
            guruMapsUrl: result.url,
            guruGuidePoints: result.guidePoints,
            guruGuideSpacingMeters: result.spacingMeters,
            guruRouteDistanceKm: Number(result.distanceKm.toFixed(1)),
            guruRawPointCount: result.rawPointCount,
            guruGuidanceVersion: 1,
            guruGuidanceGeneratedAt: new Date().toISOString()
          })
        );
      }

      window.location.href = result.url;
    } catch (error) {
      console.error("Guru Maps経路作成エラー:", error);
      alert(`Guru Maps経路を作成できませんでした：${error.message || error}`);
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function installGuruButton() {
    const active = readActivePlan();

    const existing = activePlanActions.querySelector(".guru-r40-button");
    if (existing) {
      if (!isTargetPlan(active)) existing.remove();
      return;
    }

    if (!isTargetPlan(active)) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-plan-button guru-r40-button";
    button.textContent = "Guru Mapsでナビ";
    button.addEventListener("click", () => openGuruMaps(active, button));

    activePlanActions.prepend(button);
  }

  const observer = new MutationObserver(() => installGuruButton());
  observer.observe(activePlanActions, { childList: true });

  installGuruButton();

  console.log("北海道48路線 Version4.0 Guru Maps R40 test Ready");
})();
