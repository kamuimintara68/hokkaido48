"use strict";

(function () {
  const TripData = window.Hokkaido48TripData;
  const gpxInput = document.getElementById("gpxFiles");
  const audioInput = document.getElementById("audioFiles");
  const analyzeButton = document.getElementById("analyzeButton");
  const targetTripSelect = document.getElementById("targetTripSelect");
  const confirmTripButton = document.getElementById("confirmTripButton");
  const reloadTripsButton = document.getElementById("reloadTripsButton");
  const newTripLink = document.getElementById("newTripLink");
  const tripSuggestion = document.getElementById("tripSuggestion");
  const tripPreview = document.getElementById("tripPreview");
  const autoRouteJudgeButton = document.getElementById("autoRouteJudgeButton");
  const autoRouteJudgeStatus = document.getElementById("autoRouteJudgeStatus");
  const autoRouteJudgeResults = document.getElementById("autoRouteJudgeResults");
  const saveAutoRouteJudgeButton = document.getElementById("saveAutoRouteJudgeButton");
  const autoRouteSaveStatus = document.getElementById("autoRouteSaveStatus");
  const mainMessage = document.getElementById("mainMessage");

  if (!TripData || !gpxInput || !audioInput || !analyzeButton) return;

  let autoRunning = false;
  let autoTripKey = "";
  let judgeStarted = false;

  function createTripId() {
    return `trip-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureOptionalTxt() {
    const files = Array.from(audioInput.files || []);
    const hasTxt = files.some(file =>
      file.name.toLowerCase().endsWith(".txt") || file.type === "text/plain"
    );
    if (hasTxt) return;

    try {
      const transfer = new DataTransfer();
      files.forEach(file => transfer.items.add(file));
      transfer.items.add(new File(
        [""],
        "optional-empty-transcript.txt",
        { type: "text/plain", lastModified: Date.now() }
      ));
      audioInput.files = transfer.files;
    } catch (error) {
      console.warn("任意TXTの自動補完に失敗しました:", error);
    }
  }

  function parseMaterialRangeFromNewTripLink() {
    if (!newTripLink || !newTripLink.href) return null;
    try {
      const url = new URL(newTripLink.href);
      const start = url.searchParams.get("materialStart") || "";
      const end = url.searchParams.get("materialEnd") || start;
      return start ? { start, end } : null;
    } catch {
      return null;
    }
  }

  function tripOverlapsRange(trip, range) {
    const start = String(trip.startDate || trip.endDate || "");
    const end = String(trip.endDate || trip.startDate || "");
    return !!(start && end && range.end >= start && range.start <= end);
  }

  function formatTripName(day) {
    const parts = String(day || "").split("-");
    if (parts.length === 3) {
      return `${parts[0]}/${parts[1]}/${parts[2]} 実走`;
    }
    return `${day || "日付未登録"} 実走`;
  }

  function createAutoTrip(range) {
    if (!range) return false;

    const key = `${range.start}|${range.end}`;
    if (key === autoTripKey) return false;

    const read = TripData.readTrips();
    if (!read.ok) {
      tripSuggestion.textContent = "Tripデータを読み込めないため自動作成できませんでした。";
      return false;
    }

    if (read.trips.some(trip => tripOverlapsRange(trip, range))) {
      return false;
    }

    const trip = TripData.normalizeTrip({
      id: createTripId(),
      tripName: formatTripName(range.start),
      startDate: range.start,
      endDate: range.end,
      routes: "",
      routeSegments: [],
      actionLog: "",
      timeline: "",
      impressions: "",
      improvements: "",
      thumbnail: "",
      ferment: "",
      noteArticle: "",
      memo: "旅素材まとめて投入から自動作成。走行国道はGPX判定で確定。",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "Version4.0 auto-trip"
    });

    const saved = TripData.saveTrips([...read.trips, trip]);
    if (!saved.ok) {
      tripSuggestion.textContent = "今回の日付のTripを自動作成できませんでした。";
      return false;
    }

    autoTripKey = key;
    tripSuggestion.textContent =
      `「${trip.tripName}」を自動作成しました。国道判定へ進みます。`;
    reloadTripsButton.click();
    return true;
  }

  function updateSimpleTripStatus() {
    const statusBox = document.getElementById("simpleTripStatus");
    if (!statusBox) return;

    const selectedText =
      targetTripSelect &&
      targetTripSelect.value !== "" &&
      targetTripSelect.options[targetTripSelect.selectedIndex]
        ? targetTripSelect.options[targetTripSelect.selectedIndex].textContent
        : "";

    if (selectedText) {
      statusBox.innerHTML =
        `<strong>今回のTrip：</strong>${selectedText}<br>` +
        `<span>日付から自動選択しました。</span>`;
    } else {
      statusBox.innerHTML =
        `<strong>今回のTrip：</strong>準備中<br>` +
        `<span>${tripSuggestion.textContent || "GPXを読み取ると自動準備します。"}</span>`;
    }
  }

  function advance() {
    if (autoRunning) return;
    autoRunning = true;

    try {
      updateSimpleTripStatus();

      const suggestion = tripSuggestion.textContent || "";
      if (
        suggestion.includes("一致するTripはありません") ||
        suggestion.includes("保存済みTripはありません")
      ) {
        const range = parseMaterialRangeFromNewTripLink();
        if (createAutoTrip(range)) return;
      }

      if (
        targetTripSelect.value !== "" &&
        !confirmTripButton.disabled &&
        tripPreview.classList.contains("hidden")
      ) {
        confirmTripButton.click();
        return;
      }

      if (
        !judgeStarted &&
        targetTripSelect.value !== "" &&
        !tripPreview.classList.contains("hidden") &&
        (gpxInput.files || []).length
      ) {
        ensureOptionalTxt();
        judgeStarted = true;
        autoRouteJudgeButton.click();
      }
    } finally {
      autoRunning = false;
    }
  }

  analyzeButton.addEventListener("click", () => {
    judgeStarted = false;
    autoTripKey = "";
    ensureOptionalTxt();
    if (mainMessage) mainMessage.textContent = "GPXを読み取っています…";
  });

  saveAutoRouteJudgeButton.addEventListener("click", () => {
    window.setTimeout(() => {
      const text = autoRouteSaveStatus.textContent || "";
      const result = document.getElementById("simpleSaveResult");
      if (!result) return;

      if (text.includes("正式確定しました")) {
        result.className = "success-box";
        result.textContent = "保存完了。この実走データをTripへ反映しました。";
      } else if (text) {
        result.className = "notice-box";
        result.textContent = text;
      }
    }, 50);
  });

  const observer = new MutationObserver(() => {
    window.setTimeout(advance, 0);
  });

  [
    tripSuggestion,
    targetTripSelect,
    tripPreview,
    autoRouteJudgeStatus,
    autoRouteJudgeResults,
    autoRouteSaveStatus
  ].filter(Boolean).forEach(node => {
    observer.observe(node, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "value", "href"]
    });
  });

  advance();
  console.log("北海道48路線 Version4.0 帰宅後入力シンプルUI Ready");
})();
