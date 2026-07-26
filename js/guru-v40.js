"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const GUIDE_SPACING_METERS = 10000;

  function canUseGuru(plan) {
    return !!(
      plan &&
      typeof plan === "object" &&
      String(plan.planName || "").trim() &&
      String(plan.fullRouteSpec || "").trim()
    );
  }

  function sampleTrackPoints(points, spacingMeters = GUIDE_SPACING_METERS) {
    if (!Array.isArray(points) || points.length < 2) {
      return Array.isArray(points) ? points.slice() : [];
    }

    const sampled = [{
      lat: Number(points[0].lat),
      lng: Number(points[0].lng)
    }];

    let accumulated = 0;
    let nextTarget = spacingMeters;

    for (let index = 1; index < points.length; index += 1) {
      accumulated += distanceMeters(points[index - 1], points[index]);

      if (accumulated >= nextTarget) {
        sampled.push({
          lat: Number(points[index].lat),
          lng: Number(points[index].lng)
        });
        nextTarget += spacingMeters;
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
      throw new Error("Guru Mapsへ渡す固定通過点が不足しています。");
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

  async function buildGuruNavigation(plan) {
    if (!canUseGuru(plan)) {
      throw new Error("Guru Maps用の全行程ルートが登録されていません。");
    }

    // Version4.0既存の予定Track生成をそのまま正本として利用。
    // 複数国道・同一路線の再登場・往復も buildFullTrackPlan() の走行順を保持する。
    const track = await buildFullTrackPlan(plan);

    if (!track || !Array.isArray(track.points) || track.points.length < 2) {
      throw new Error("予定TrackからGuru Maps経路を作成できませんでした。");
    }

    const guidePoints = sampleTrackPoints(
      track.points,
      GUIDE_SPACING_METERS
    );

    return {
      url: buildGuruUrl(guidePoints),
      guidePoints,
      trackPointCount: track.points.length,
      distanceKm: Number(track.distanceKm) || trackDistanceKm(track.points),
      spacingMeters: GUIDE_SPACING_METERS,
      fullRouteSpec: track.fullRouteSpec
    };
  }

  async function openGuruMaps(plan, button) {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "国道上の通過点を作成中…";

    try {
      const result = await buildGuruNavigation(plan);
      const current = readActivePlan();
      const normalized = normalizePlanForGuidance(plan);

      if (current && current.id === normalized.id) {
        localStorage.setItem(
          ACTIVE_PLAN_KEY,
          JSON.stringify({
            ...current,
            guruMapsUrl: result.url,
            guruGuidePoints: result.guidePoints,
            guruGuidePointCount: result.guidePoints.length,
            guruGuideSpacingMeters: result.spacingMeters,
            guruRouteDistanceKm: Number(result.distanceKm.toFixed(1)),
            guruTrackPointCount: result.trackPointCount,
            guruFullRouteSpec: result.fullRouteSpec,
            guruGuidanceVersion: 2,
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

    const existing = activePlanActions.querySelector(".guru-v40-button");
    if (existing) {
      if (!canUseGuru(active)) existing.remove();
      return;
    }

    if (!canUseGuru(active)) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-plan-button guru-v40-button";
    button.textContent = "Guru Mapsでナビ";
    button.addEventListener("click", () => openGuruMaps(active, button));

    activePlanActions.prepend(button);
  }

  const observer = new MutationObserver(() => installGuruButton());
  observer.observe(activePlanActions, { childList: true });

  installGuruButton();

  console.log("北海道48路線 Version4.0 Guru Maps multi-route test Ready");
})();
