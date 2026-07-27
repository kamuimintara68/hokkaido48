"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const GUIDE_SPACING_METERS = 10000;
  const navStatus = document.getElementById("guruNavStatus");
  const planNextStep = document.getElementById("planNextStep");

  let prepareGeneration = 0;
  let preparingPromise = null;

  function setStatus(message, kind = "info") {
    if (!navStatus) return;

    navStatus.textContent = message;

    if (kind === "success") {
      navStatus.style.background = "#ecfdf5";
      navStatus.style.color = "#166534";
    } else if (kind === "error") {
      navStatus.style.background = "#fef2f2";
      navStatus.style.color = "#991b1b";
    } else if (kind === "working") {
      navStatus.style.background = "#eff6ff";
      navStatus.style.color = "#1d4ed8";
    } else {
      navStatus.style.background = "#f8fafc";
      navStatus.style.color = "#475569";
    }
  }

  function setNextStep(message, done = false) {
    if (!planNextStep) return;
    planNextStep.textContent = message;
    planNextStep.classList.toggle("done", done);
  }

  function readActive() {
    try {
      const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.error("Active Plan読込エラー:", error);
      return null;
    }
  }

  function writeActive(plan) {
    localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(plan));
  }

  function canPrepare(plan) {
    return !!(
      plan &&
      String(plan.id || "").trim() &&
      String(plan.planName || "").trim() &&
      String(plan.fullRouteSpec || "").trim()
    );
  }

  function validTrackSnapshot(plan) {
    return !!(
      plan &&
      plan.plannedPreview &&
      plan.plannedPreview.kind === "full-track" &&
      Array.isArray(plan.plannedPreview.points) &&
      plan.plannedPreview.points.length >= 2 &&
      Number(plan.plannedPreview.distanceKm) > 0
    );
  }

  function pointsFromSnapshot(plan) {
    return plan.plannedPreview.points
      .map(point => ({
        lat: Number(point[0]),
        lng: Number(point[1])
      }))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
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

      while (accumulated >= nextTarget) {
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
      Math.abs(previous.lat - last.lat) > 1e-10 ||
      Math.abs(previous.lng - last.lng) > 1e-10
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
      throw new Error("Guru Maps用の通過点が不足しています。");
    }

    const parts = [
      `start=${guruCoordinate(points[0])}`,
      ...points.slice(1, -1).map(point => `via=${guruCoordinate(point)}`),
      `finish=${guruCoordinate(points[points.length - 1])}`,
      "mode=auto",
      "start_navigation=false"
    ];

    return `guru://nav?${parts.join("&")}`;
  }

  function isLocalDevelopment() {
    return (
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.protocol === "file:"
    );
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  function cleanUtilityActions(container) {
    if (!container) return;

    [...container.querySelectorAll("button, a")].forEach(element => {
      const label = element.textContent.trim();
      if (
        label.includes("AI予定Track") ||
        label.includes("予定Track GPX") ||
        label.includes("OsmAnd Web") ||
        label.includes("Googleマップ")
      ) {
        element.remove();
      }
    });
  }

  function updatePlanCardButtons() {
    document.querySelectorAll(".plan-card").forEach(card => {
      const actions = card.querySelector(".plan-actions");
      if (!actions) return;

      cleanUtilityActions(actions);

      const button = actions.querySelector(".select-plan-button");
      if (!button) return;

      if (card.classList.contains("active")) {
        button.textContent = "✓ 今回のプランに選択中";
        button.disabled = true;
      } else {
        button.textContent = "このプランを今回の予定にする";
        button.disabled = false;
      }
    });
  }

  async function prepareActivePlan(force = false) {
    const active = readActive();

    if (!canPrepare(active)) {
      setStatus("今回のプランを選択してください。");
      setNextStep("次は：今回のプランを選択");
      return null;
    }

    if (!force && validTrackSnapshot(active)) {
      const guidePoints = Array.isArray(active.guruGuidePoints) &&
        active.guruGuidePoints.length >= 2
          ? active.guruGuidePoints
          : sampleTrackPoints(pointsFromSnapshot(active));

      const url = active.guruMapsUrl || buildGuruUrl(guidePoints);

      if (!active.guruMapsUrl || !Array.isArray(active.guruGuidePoints)) {
        writeActive({
          ...active,
          guruMapsUrl: url,
          guruGuidePoints: guidePoints,
          guruGuidePointCount: guidePoints.length,
          guruGuideSpacingMeters: GUIDE_SPACING_METERS
        });
      }

      setStatus(
        `ナビ準備済み：予定Track ${Number(active.plannedPreview.distanceKm).toFixed(1)}km／Guru通過点 ${guidePoints.length}点`,
        "success"
      );
      setNextStep("次は：Guru Mapsでナビ");
      return readActive();
    }

    if (preparingPromise) return preparingPromise;

    const generation = ++prepareGeneration;

    preparingPromise = (async () => {
      try {
        setStatus("ナビ準備中：予定Trackを作成しています…", "working");

        // UIを描画してから重い処理へ進む。
        await new Promise(resolve => requestAnimationFrame(() => resolve()));

        const planBefore = readActive();
        if (!canPrepare(planBefore)) {
          throw new Error("今回のプラン情報が不足しています。");
        }

        const track = await buildFullTrackPlan(planBefore);

        if (generation !== prepareGeneration) return null;

        if (!track || !Array.isArray(track.points) || track.points.length < 2) {
          throw new Error("予定Trackを作成できませんでした。");
        }

        const cleanPoints = track.points
          .map(point => ({
            lat: Number(point.lat),
            lng: Number(point.lng)
          }))
          .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));

        if (cleanPoints.length < 2) {
          throw new Error("予定Trackの座標が不足しています。");
        }

        setStatus("ナビ準備中：Guru Maps用の通過点を作成しています…", "working");
        await new Promise(resolve => requestAnimationFrame(() => resolve()));

        const guidePoints = sampleTrackPoints(cleanPoints);
        const guruUrl = buildGuruUrl(guidePoints);

        const current = readActive();
        if (!current || current.id !== planBefore.id) {
          throw new Error("準備中に今回のプランが変更されました。");
        }

        const distanceKm = Number(track.distanceKm) || trackDistanceKm(cleanPoints);

        writeActive({
          ...current,
          fullRouteSpec: track.fullRouteSpec || current.fullRouteSpec,
          fullRouteLegs: Array.isArray(track.fullRouteLegs)
            ? track.fullRouteLegs
            : (current.fullRouteLegs || []),
          plannedPreview: {
            version: 7,
            kind: "full-track",
            name: track.name || current.planName || "北海道48路線 予定Track",
            generatedAt: new Date().toISOString(),
            distanceKm: Number(distanceKm.toFixed(1)),
            points: cleanPoints.map(point => [point.lat, point.lng])
          },
          guruMapsUrl: guruUrl,
          guruGuidePoints: guidePoints,
          guruGuidePointCount: guidePoints.length,
          guruGuideSpacingMeters: GUIDE_SPACING_METERS,
          guruRouteDistanceKm: Number(distanceKm.toFixed(1)),
          guruGuidanceVersion: 7,
          guruGuidanceGeneratedAt: new Date().toISOString()
        });

        setStatus(
          `ナビ準備済み：予定Track ${distanceKm.toFixed(1)}km／Guru通過点 ${guidePoints.length}点`,
          "success"
        );
        setNextStep("次は：Guru Mapsでナビ");

        return readActive();
      } catch (error) {
        console.error("ナビ準備エラー:", error);
        setStatus(`ナビ準備エラー：${error.message || error}`, "error");
      setNextStep("次は：表示されたエラー内容を確認");
        return null;
      } finally {
        preparingPromise = null;
        refreshPrimaryAction();
      }
    })();

    return preparingPromise;
  }

  async function handleGuruAction(button) {
    button.disabled = true;

    try {
      let active = readActive();

      if (!validTrackSnapshot(active) || !active.guruMapsUrl) {
        active = await prepareActivePlan(false);
      }

      if (!active || !active.guruMapsUrl) {
        throw new Error("Guru URLを生成できませんでした。");
      }

      if (isLocalDevelopment()) {
        setStatus(
          `ローカル確認成功：Guru URL生成済み／予定Track ${Number(active.plannedPreview.distanceKm).toFixed(1)}km／通過点 ${active.guruGuidePointCount || 0}点。iPhone公開版ではこのURLでGuru Mapsを起動します。`,
          "success"
        );
        setNextStep("ナビ準備は完了です。iPhoneでナビ、帰宅後「旅素材をまとめて投入」してください。", true);
        return;
      }

      if (!isIOS()) {
        setStatus(
          "Guru URL生成成功。Guru Mapsの実起動確認はiPhoneで行います。",
          "success"
        );
        return;
      }

      setStatus("Guru Mapsを起動します。", "success");
      setNextStep("ナビ準備は完了です。iPhoneでナビ、帰宅後「旅素材をまとめて投入」してください。", true);
      window.location.href = active.guruMapsUrl;
    } catch (error) {
      console.error("Guru Maps起動エラー:", error);
      setStatus(`Guru Maps起動エラー：${error.message || error}`, "error");
      setNextStep("次は：表示されたエラー内容を確認");
    } finally {
      button.disabled = false;
      button.textContent = "Guru Mapsでナビ";
    }
  }

  function refreshPrimaryAction() {
    cleanUtilityActions(activePlanActions);

    const active = readActive();

    let guruButton = activePlanActions.querySelector(".guru-v40-button");

    if (!canPrepare(active)) {
      if (guruButton) guruButton.remove();
      setStatus("今回のプランを選択してください。");
      setNextStep("次は：今回のプランを選択");
      updatePlanCardButtons();
      return;
    }

    if (!guruButton) {
      guruButton = document.createElement("button");
      guruButton.type = "button";
      guruButton.className = "select-plan-button guru-v40-button";
      guruButton.textContent = "Guru Mapsでナビ";
      guruButton.addEventListener("click", () => handleGuruAction(guruButton));
      activePlanActions.prepend(guruButton);
    }

    updatePlanCardButtons();

    if (validTrackSnapshot(active)) {
      const points = Array.isArray(active.guruGuidePoints)
        ? active.guruGuidePoints.length
        : 0;
      setStatus(
        `ナビ準備済み：予定Track ${Number(active.plannedPreview.distanceKm).toFixed(1)}km／Guru通過点 ${points}点`,
        "success"
      );
      setNextStep("次は：Guru Mapsでナビ");
    } else if (!preparingPromise) {
      setStatus("今回のプランを選択済み。ナビ準備を開始します。", "working");
      setNextStep("次は：ナビ準備の完了を待つ");
      window.setTimeout(() => prepareActivePlan(false), 0);
    }
  }

  // plan-v40.js の選択ボタン処理が完了した後で、選択済みPlanを準備する。
  planList.addEventListener("click", event => {
    const button = event.target.closest(".select-plan-button");
    if (!button || button.classList.contains("guru-v40-button")) return;

    window.setTimeout(() => {
      prepareGeneration += 1;
      preparingPromise = null;
      refreshPrimaryAction();
    }, 0);
  });

  // 「今回のプラン選択を解除」にも追従。
  activePlanActions.addEventListener("click", event => {
    const label = event.target && event.target.textContent
      ? event.target.textContent.trim()
      : "";

    if (label.includes("今回のプラン選択を解除")) {
      window.setTimeout(() => {
        prepareGeneration += 1;
        preparingPromise = null;
        refreshPrimaryAction();
      }, 0);
    }
  });

  // 初期描画完了を待って一度だけ反映。
  window.setTimeout(refreshPrimaryAction, 0);
  window.setTimeout(refreshPrimaryAction, 300);

  console.log("北海道48路線 Version4.0 Navigation Pipeline Ready");
})();
