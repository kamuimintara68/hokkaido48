"use strict";

(function () {
  const TripData = window.Hokkaido48TripData;
  const tripSelect = document.getElementById("targetTripSelect");
  const results = document.getElementById("autoRouteJudgeResults");
  const summary = document.getElementById("autoRouteJudgeSummary");
  const status = document.getElementById("autoRouteJudgeStatus");
  const saveButton = document.getElementById("saveAutoRouteJudgeButton");
  const saveStatus = document.getElementById("autoRouteSaveStatus");
  const simpleSaveResult = document.getElementById("simpleSaveResult");

  if (!TripData || !tripSelect || !results || !saveButton) return;

  function normalizedNumbers(values) {
    return new Set(
      (values || [])
        .map(value => String(Number(value)))
        .filter(value => value && value !== "NaN" && value !== "0")
    );
  }

  function selectedTrip() {
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

  function tripExpectedNumbers() {
    const trip = selectedTrip();
    if (!trip) return new Set();

    return normalizedNumbers(
      Array.isArray(trip.routeSegments)
        ? trip.routeSegments.map(segment => segment.routeNumber)
        : String(trip.routes || "").split(",")
    );
  }

  function activePlanExpectedNumbers() {
    try {
      const raw = localStorage.getItem("hokkaido48ActivePlan");
      if (!raw) return new Set();

      const plan = JSON.parse(raw);
      const routeNumbers = Array.isArray(plan.routeNumbers)
        ? plan.routeNumbers
        : String(plan.routes || "").split(/[,\s、，・→>]+/);

      return normalizedNumbers(routeNumbers);
    } catch {
      return new Set();
    }
  }

  function expectedNumbers() {
    const fromTrip = tripExpectedNumbers();
    if (fromTrip.size) return fromTrip;

    const fromPlan = activePlanExpectedNumbers();
    if (fromPlan.size) return fromPlan;

    return new Set();
  }

  function routeNumberFromCard(card) {
    const match = card.textContent.match(/国道\s*(\d+)\s*号/);
    return match ? String(Number(match[1])) : "";
  }

  function filterVisibleResults() {
    const expected = expectedNumbers();
    if (!expected.size) return;

    const cards = [...results.children].filter(node =>
      node.nodeType === Node.ELEMENT_NODE
    );

    let visibleCount = 0;

    cards.forEach(card => {
      const number = routeNumberFromCard(card);

      if (number && !expected.has(number)) {
        card.style.display = "none";
        card.dataset.filteredByPlan = "1";
      } else if (number) {
        card.style.display = "";
        delete card.dataset.filteredByPlan;
        visibleCount += 1;
      }
    });

    if (visibleCount > 0) {
      const routeText = [...expected]
        .map(number => `国道${number}号`)
        .join("、");

      if (summary) {
        const paragraphs = summary.querySelectorAll("p");
        if (paragraphs.length >= 2) {
          paragraphs[1].innerHTML =
            `<strong>予定路線と一致した ${visibleCount}路線を採用します。</strong> ` +
            `今回の予定：${routeText}。重複・近接する別国道は自動除外しました。`;
        }
      }

      if (status) {
        status.textContent =
          `自動判定が完了しました。予定路線と一致した ${visibleCount}路線を表示しています。`;
      }
    }
  }

  function cleanupSavedTrip() {
    const expected = expectedNumbers();
    if (!expected.size) return;

    const trip = selectedTrip();
    if (!trip) return;

    const read = TripData.readTrips();
    if (!read.ok) return;

    const index = read.trips.findIndex(item =>
      String(item.id || "") === String(trip.id || "")
    );
    if (index < 0) return;

    const current = read.trips[index];
    const segments = Array.isArray(current.routeSegments)
      ? current.routeSegments.filter(segment =>
          expected.has(String(Number(segment.routeNumber || "")))
        )
      : [];

    current.routeSegments = segments;
    current.routes = [...new Set(
      segments.map(segment => String(Number(segment.routeNumber || ""))).filter(Boolean)
    )].join(",");
    current.updatedAt = new Date().toISOString();

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

    const routeText = [...expected]
      .map(number => `国道${number}号`)
      .join("、");

    if (simpleSaveResult) {
      simpleSaveResult.className = "success-box";
      simpleSaveResult.textContent =
        `保存完了。予定路線 ${routeText} のみTripへ反映しました。`;
    }

    if (saveStatus) {
      saveStatus.textContent =
        `予定路線 ${routeText} のみ正式確定しました。`;
    }
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
    window.setTimeout(filterVisibleResults, 0);
  });

  saveButton.addEventListener("click", () => {
    // 既存保存処理が終了した直後に、予定路線以外を除外する。
    window.setTimeout(cleanupSavedTrip, 0);
  });

  filterVisibleResults();

  console.log("北海道48路線 Version4.0 予定路線フィルタ Ready");
})();
