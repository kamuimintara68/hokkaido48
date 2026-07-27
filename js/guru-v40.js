"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const GUIDE_SPACING_METERS = 10000;
  const BUILD_TIMEOUT_MS = 20000;

  function canUseGuru(plan) {
    return !!(
      plan &&
      typeof plan === "object" &&
      String(plan.planName || "").trim() &&
      String(plan.fullRouteSpec || "").trim()
    );
  }

  function readStoredPlan() {
    try {
      const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function validPreview(plan) {
    return !!(
      plan &&
      plan.plannedPreview &&
      plan.plannedPreview.kind === "full-track" &&
      Array.isArray(plan.plannedPreview.points) &&
      plan.plannedPreview.points.length >= 2
    );
  }

  function previewToTrack(plan) {
    return {
      name: plan.plannedPreview.name || plan.planName || "北海道48路線 予定Track",
      fullRouteSpec: plan.fullRouteSpec || plan.guruFullRouteSpec || "",
      fullRouteLegs: Array.isArray(plan.fullRouteLegs) ? plan.fullRouteLegs : [],
      points: plan.plannedPreview.points.map(point => ({
        lat: Number(point[0]),
        lng: Number(point[1])
      })),
      distanceKm: Number(plan.plannedPreview.distanceKm) || 0,
      spacingMeters: 250
    };
  }

  function withTimeout(promise, milliseconds) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(
          () => reject(new Error("予定ルート作成が時間内に完了しませんでした。もう一度押してください。")),
          milliseconds
        );
      })
    ]);
  }

  function sampleTrackPoints(points, spacingMeters = GUIDE_SPACING_METERS) {
    if (!Array.isArray(points) || points.length < 2) return [];

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
    const start = points[0];
    const finish = points[points.length - 1];
    const vias = points.slice(1, -1);

    return `guru://nav?${[
      `start=${guruCoordinate(start)}`,
      ...vias.map(point => `via=${guruCoordinate(point)}`),
      `finish=${guruCoordinate(finish)}`,
      "mode=auto",
      "start_navigation=false"
    ].join("&")}`;
  }

  async function getTrack(plan) {
    const stored = readStoredPlan();

    if (
      stored &&
      stored.id === plan.id &&
      validPreview(stored)
    ) {
      return previewToTrack(stored);
    }

    return withTimeout(buildFullTrackPlan(plan), BUILD_TIMEOUT_MS);
  }

  async function openGuruMaps(plan, button) {
    const originalLabel = "Guru Mapsでナビ";
    button.disabled = true;
    button.textContent = "予定ルートを準備中…";

    try {
      const track = await getTrack(plan);

      if (!track || !Array.isArray(track.points) || track.points.length < 2) {
        throw new Error("予定ルートを作成できませんでした。");
      }

      const guidePoints = sampleTrackPoints(track.points);
      if (guidePoints.length < 2) {
        throw new Error("Guru Mapsへ渡す通過点を作成できませんでした。");
      }

      const url = buildGuruUrl(guidePoints);
      const current = readStoredPlan();
      const normalized = normalizePlanForGuidance(plan);

      if (current && current.id === normalized.id) {
        localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify({
          ...current,
          fullRouteSpec: track.fullRouteSpec || current.fullRouteSpec,
          fullRouteLegs: Array.isArray(track.fullRouteLegs)
            ? track.fullRouteLegs
            : (current.fullRouteLegs || []),
          plannedPreview: {
            version: 5,
            kind: "full-track",
            name: track.name || current.planName || "北海道48路線 予定Track",
            generatedAt: new Date().toISOString(),
            distanceKm: Number(Number(track.distanceKm || 0).toFixed(1)),
            points: track.points.map(point => [
              Number(point.lat),
              Number(point.lng)
            ])
          },
          guruMapsUrl: url,
          guruGuidePoints: guidePoints,
          guruGuidePointCount: guidePoints.length,
          guruGuideSpacingMeters: GUIDE_SPACING_METERS,
          guruRouteDistanceKm: Number(Number(track.distanceKm || 0).toFixed(1)),
          guruGuidanceVersion: 5,
          guruGuidanceGeneratedAt: new Date().toISOString()
        }));
      }

      window.location.href = url;
    } catch (error) {
      console.error("Guru Maps経路作成エラー:", error);
      alert(error.message || "Guru Maps経路を作成できませんでした。");
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function isUtilityButton(button) {
    const label = button.textContent.trim();
    return (
      label.includes("AI予定Track") ||
      label.includes("予定Track GPX") ||
      label.includes("OsmAnd Web") ||
      label.includes("Googleマップ")
    );
  }

  function simplifyActions(container, activePlanOnly) {
    [...container.querySelectorAll("button, a")].forEach(element => {
      if (isUtilityButton(element)) element.remove();
    });

    if (activePlanOnly) {
      [...container.querySelectorAll(".guru-v40-button")].forEach((button, index) => {
        if (index > 0) button.remove();
      });
    }
  }

  function updatePlanCards() {
    const active = readStoredPlan();

    document.querySelectorAll(".plan-card").forEach(card => {
      const isActive = card.classList.contains("active");
      const actions = card.querySelector(".plan-actions");
      if (!actions) return;

      simplifyActions(actions, false);

      const selectButton = actions.querySelector(".select-plan-button");
      if (selectButton) {
        if (isActive) {
          selectButton.textContent = "✓ 今回のプランに選択中";
          selectButton.disabled = true;
          selectButton.setAttribute("aria-disabled", "true");
        } else {
          selectButton.textContent = "このプランを今回の予定にする";
          selectButton.disabled = false;
          selectButton.removeAttribute("aria-disabled");
        }
      }
    });
  }

  function installGuruButton() {
    const active = readStoredPlan();

    simplifyActions(activePlanActions, true);

    let button = activePlanActions.querySelector(".guru-v40-button");

    if (!canUseGuru(active)) {
      if (button) button.remove();
      updatePlanCards();
      return;
    }

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "select-plan-button guru-v40-button";
      button.textContent = "Guru Mapsでナビ";
      button.addEventListener("click", () => openGuruMaps(readStoredPlan(), button));
      activePlanActions.prepend(button);
    }

    updatePlanCards();
  }

  const observer = new MutationObserver(() => {
    window.setTimeout(installGuruButton, 0);
  });

  observer.observe(activePlanActions, { childList: true, subtree: true });
  observer.observe(planList, { childList: true, subtree: true });

  installGuruButton();

  console.log("北海道48路線 Version4.0 Simple Guru UI Ready");
})();
