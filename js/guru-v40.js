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

    const track = await buildFullTrackPlan(plan);

    if (!track || !Array.isArray(track.points) || track.points.length < 2) {
      throw new Error("予定TrackからGuru Maps経路を作成できませんでした。");
    }

    const guidePoints = sampleTrackPoints(track.points, GUIDE_SPACING_METERS);

    return {
      url: buildGuruUrl(guidePoints),
      guidePoints,
      plannedTrackPoints: track.points,
      fullRouteLegs: Array.isArray(track.fullRouteLegs) ? track.fullRouteLegs : [],
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
            fullRouteSpec: result.fullRouteSpec,
            fullRouteLegs: result.fullRouteLegs,
            plannedNavigation: {
              version: 4,
              mode: "guru-direct",
              generatedAt: new Date().toISOString(),
              spacingMeters: 250,
              rawPointCount: result.trackPointCount
            },
            plannedPreview: {
              version: 4,
              kind: "full-track",
              name: current.planName || "北海道48路線 予定Track",
              generatedAt: new Date().toISOString(),
              distanceKm: Number(result.distanceKm.toFixed(1)),
              points: result.plannedTrackPoints.map(point => [
                Number(point.lat),
                Number(point.lng)
              ])
            },
            guruMapsUrl: result.url,
            guruGuidePoints: result.guidePoints,
            guruGuidePointCount: result.guidePoints.length,
            guruGuideSpacingMeters: result.spacingMeters,
            guruRouteDistanceKm: Number(result.distanceKm.toFixed(1)),
            guruTrackPointCount: result.trackPointCount,
            guruFullRouteSpec: result.fullRouteSpec,
            guruGuidanceVersion: 4,
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

  function removeObsoleteOsmAndButton() {
    [...activePlanActions.querySelectorAll("button")].forEach(button => {
      if (button.textContent.trim() === "OsmAnd Webを開く") button.remove();
    });
  }

  function markGpxAsOptional() {
    [...activePlanActions.querySelectorAll("button")].forEach(button => {
      if (button.textContent.trim() === "予定Track GPXを書き出す") {
        button.textContent = "予定Track GPXを書き出す（予備）";
      }
    });
  }

  function updateOldR40Memo() {
    document.querySelectorAll(".plan-card").forEach(card => {
      const title = card.querySelector("h3");
      if (!title || !title.textContent.includes("R40北上2時間 実走総合テスト")) return;

      card.querySelectorAll("dd").forEach(dd => {
        if (dd.textContent.includes("OsmAndナビ＋実走GPX記録")) {
          dd.textContent =
            "Guru Mapsナビ＋実走GPS記録＋帰宅後の予定／実走比較を確認する総合テスト。時間に応じて折返し地点は前倒し可。";
        }
      });
    });
  }

  function installGuruButton() {
    const active = readActivePlan();

    removeObsoleteOsmAndButton();
    markGpxAsOptional();
    updateOldR40Memo();

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
  observer.observe(planList, { childList: true, subtree: true });

  installGuruButton();

  console.log("北海道48路線 Version4.0 Guru Maps + Planned Track Snapshot Ready");
})();
