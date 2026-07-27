"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const TripData = window.Hokkaido48TripData;
  const tripSelect = document.getElementById("targetTripSelect");
  const results = document.getElementById("autoRouteJudgeResults");
  const summary = document.getElementById("autoRouteJudgeSummary");
  const status = document.getElementById("autoRouteJudgeStatus");
  const saveButton = document.getElementById("saveAutoRouteJudgeButton");
  const saveStatus = document.getElementById("autoRouteSaveStatus");
  const simpleSaveResult = document.getElementById("simpleSaveResult");
  const savedTripActions = document.getElementById("savedTripActions");
  const savedTripLink = document.getElementById("savedTripLink");

  if (!TripData || !tripSelect || !results || !saveButton) return;

  let lockedSnapshot = null;

  function normalizedNumbers(values) {
    return [...new Set(
      (values || [])
        .map(value => String(Number(value)))
        .filter(value => value && value !== "NaN" && value !== "0")
    )];
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

  function makePlanSnapshot() {
    const plan = readActivePlan();
    if (!plan) return null;

    const routeNumbers = normalizedNumbers(
      Array.isArray(plan.routeNumbers)
        ? plan.routeNumbers
        : String(plan.targetRoutes || "").split(/[,\s、，・→>]+/)
    );

    if (!routeNumbers.length) return null;

    const plannedTrack =
      plan.plannedPreview &&
      Array.isArray(plan.plannedPreview.points)
        ? plan.plannedPreview.points
            .filter(point => Array.isArray(point) && point.length >= 2)
            .map(point => [Number(point[0]), Number(point[1])])
            .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
        : [];

    const guidePoints = Array.isArray(plan.guruGuidePoints)
      ? plan.guruGuidePoints
          .map(point => [Number(point.lat), Number(point.lng)])
          .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      : [];

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      planId: String(plan.id || ""),
      planName: String(plan.planName || ""),
      routeNumbers,
      origin: String(plan.origin || ""),
      destination: String(plan.destination || ""),
      fullRouteSpec: String(plan.fullRouteSpec || plan.guruFullRouteSpec || ""),
      distanceKm: Number(
        (plan.plannedPreview && plan.plannedPreview.distanceKm) ||
        plan.guruRouteDistanceKm ||
        0
      ),
      plannedTrack,
      guidePoints,
      source: "hokkaido48ActivePlan"
    };
  }

  function readSelectedTrip() {
    const value = tripSelect.value;
    if (value === "") return null;

    const read = TripData.readTrips();
    if (!read.ok) return null;

    const sorted = [...read.trips].sort((a, b) =>
      String(b.startDate || b.endDate || "").localeCompare(
        String(a.startDate || a.endDate || "")
      )
    );

    return sorted[Number(value)] || null;
  }

  function expectedNumbers() {
    const snapshot = lockedSnapshot || makePlanSnapshot();
    if (snapshot && snapshot.routeNumbers.length) {
      return new Set(snapshot.routeNumbers);
    }

    const trip = readSelectedTrip();
    return new Set(normalizedNumbers(
      trip && Array.isArray(trip.routeSegments)
        ? trip.routeSegments.map(segment => segment.routeNumber)
        : []
    ));
  }

  function routeNumberFromCard(card) {
    const match = card.textContent.match(/国道\s*(\d+)\s*号/);
    return match ? String(Number(match[1])) : "";
  }

  function filterVisibleResults() {
    const expected = expectedNumbers();
    if (!expected.size) return;

    const cards = [...results.children].filter(
      node => node.nodeType === Node.ELEMENT_NODE
    );

    let visibleCount = 0;

    cards.forEach(card => {
      const number = routeNumberFromCard(card);
      if (number && !expected.has(number)) {
        card.style.display = "none";
      } else if (number) {
        card.style.display = "";
        visibleCount += 1;
      }
    });

    if (visibleCount > 0) {
      const routeText = [...expected].map(number => `国道${number}号`).join("、");

      const ps = summary ? summary.querySelectorAll("p") : [];
      if (ps.length >= 2) {
        ps[1].innerHTML =
          `<strong>予定路線と一致した ${visibleCount}路線を採用します。</strong> ` +
          `今回の予定：${routeText}。重複・近接する別国道は自動除外しました。`;
      }

      if (status) {
        status.textContent =
          `自動判定が完了しました。予定路線と一致した ${visibleCount}路線を表示しています。`;
      }
    }
  }

  function finalizeTripAfterBaseSave() {
    const snapshot = lockedSnapshot || makePlanSnapshot();
    const expected = snapshot
      ? new Set(snapshot.routeNumbers)
      : expectedNumbers();

    if (!expected.size) return;

    const selected = readSelectedTrip();
    if (!selected) return;

    const read = TripData.readTrips();
    if (!read.ok) return;

    const index = read.trips.findIndex(item =>
      String(item.id || "") === String(selected.id || "")
    );
    if (index < 0) return;

    const current = read.trips[index];
    const segments = Array.isArray(current.routeSegments)
      ? current.routeSegments.filter(segment =>
          expected.has(String(Number(segment.routeNumber || "")))
        )
      : [];

    current.routeSegments = segments;
    current.routes = normalizedNumbers(
      segments.map(segment => segment.routeNumber)
    ).join(",");
    current.updatedAt = new Date().toISOString();

    if (snapshot) {
      current.planSnapshot = snapshot;
    }

    if (current.autoRouteJudgement) {
      current.autoRouteJudgement = {
        ...current.autoRouteJudgement,
        filteredByPlan: true,
        plannedRouteNumbers: [...expected],
        autoAccepted: Array.isArray(current.autoRouteJudgement.autoAccepted)
          ? current.autoRouteJudgement.autoAccepted.filter(item =>
              expected.has(String(Number(item.number || "")))
            )
          : []
      };
    }

    const saved = TripData.saveTrips(read.trips);
    if (!saved.ok) return;

    const routeText = [...expected].map(number => `国道${number}号`).join("、");

    if (simpleSaveResult) {
      simpleSaveResult.className = "success-box";
      simpleSaveResult.textContent =
        `保存完了。予定 ${routeText} と実走区間を同じTripへ保存しました。`;
    }

    if (savedTripLink && savedTripActions) {
      savedTripLink.href = `trip.html?trip=${encodeURIComponent(current.id)}`;
      savedTripActions.style.display = "flex";
    }

    if (saveStatus) {
      saveStatus.textContent =
        `予定 ${routeText} と実走区間を正式確定しました。`;
    }

    lockedSnapshot = null;
  }

  const observer = new MutationObserver(() => {
    window.setTimeout(filterVisibleResults, 0);
  });

  observer.observe(results, {
    childList: true,
    subtree: true,
    characterData: true
  });

  tripSelect.addEventListener("change", () => {
    lockedSnapshot = null;
    window.setTimeout(filterVisibleResults, 0);
  });

  saveButton.addEventListener("click", () => {
    // 旧保存ロジックがTripを書き換える前に、Planを固定する。
    lockedSnapshot = makePlanSnapshot();
    window.setTimeout(finalizeTripAfterBaseSave, 100);
  }, true);

  filterVisibleResults();

  console.log("北海道48路線 Version4.0 Plan→Trip Snapshot Ready");
})();
