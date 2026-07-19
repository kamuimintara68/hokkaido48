(function () {
  "use strict";

  const gpxInput = document.getElementById("gpxFiles");
  const audioInput = document.getElementById("audioFiles");
  const photoInput = document.getElementById("photoFiles");
  const analyzeButton = document.getElementById("analyzeButton");
  const clearButton = document.getElementById("clearButton");
  const message = document.getElementById("mainMessage");
  const resultArea = document.getElementById("resultArea");

  const gpxSelection = document.getElementById("gpxSelection");
  const audioSelection = document.getElementById("audioSelection");
  const photoSelection = document.getElementById("photoSelection");

  const gpxResultsElement = document.getElementById("gpxResults");
  const audioResultsElement = document.getElementById("audioResults");
  const photoResultsElement = document.getElementById("photoResults");
  const TripData = window.Hokkaido48TripData;
  const targetTripSelect = document.getElementById("targetTripSelect");
  const confirmTripButton = document.getElementById("confirmTripButton");
  const tripSuggestion = document.getElementById("tripSuggestion");
  const tripPreview = document.getElementById("tripPreview");
  const newTripLink = document.getElementById("newTripLink");
  const reloadTripsButton = document.getElementById("reloadTripsButton");
  const materialBackupButton = document.getElementById("materialBackupButton");
  const saveMaterialsButton = document.getElementById("saveMaterialsButton");
  const materialSaveMessage = document.getElementById("materialSaveMessage");
  const saveCompletion = document.getElementById("saveCompletion");
  const savedTripName = document.getElementById("savedTripName");
  const savedMaterialCounts = document.getElementById("savedMaterialCounts");
  const savedBackupName = document.getElementById("savedBackupName");
  const openSavedTripLink = document.getElementById("openSavedTripLink");
  const TRIP_STORAGE_KEY = "hokkaido48Trips";
  const RECORD_KEY_PATTERN = /^route\d{3}Record$/;

  const map = L.map("materialMap").setView([43.35, 142.45], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const routeLayer = L.featureGroup().addTo(map);
  const photoLayer = L.featureGroup().addTo(map);
  const routeColors = [
    "#1261a0",
    "#e05b21",
    "#5b45b0",
    "#16855b",
    "#b13973",
    "#74631a"
  ];

  let photoObjectUrls = [];
  let latestAnalysis = null;
  let savedTrips = [];
  let selectedTripReference = null;
  let backupStorageFingerprint = null;
  let lastBackupFileName = "";
  let awaitingNewTrip = false;
  let tripsBeforeNewEntry = new Set();

  function fileArray(input) {
    return Array.from(input.files || []);
  }

  function updateSelections() {
    const gpxCount = fileArray(gpxInput).length;
    const audioCount = fileArray(audioInput).length;
    const photoCount = fileArray(photoInput).length;

    gpxSelection.textContent = gpxCount ? `${gpxCount}ファイル選択` : "未選択";
    audioSelection.textContent = audioCount ? `${audioCount}ファイル選択` : "未選択";
    photoSelection.textContent = photoCount ? `${photoCount}ファイル選択` : "未選択";

    const total = gpxCount + audioCount + photoCount;
    message.textContent = total
      ? `合計${total}ファイルを選択しています。`
      : "素材はまだ選ばれていません。";
  }

  function formatDate(value) {
    if (!value) {
      return "日時なし";
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "日時なし";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "長さ未取得";
    }

    const totalSeconds = Math.round(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainSeconds = totalSeconds % 60;

    return [hours, minutes, remainSeconds]
      .map(value => String(value).padStart(2, "0"))
      .join(":");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
      return "容量不明";
    }

    if (bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function validDate(value) {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dayKey(value) {
    const date = validDate(value);

    if (!date) {
      return "";
    }

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function formatDay(value) {
    const date = validDate(value);

    if (!date) {
      return "日付未登録";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function formatStoredDay(value) {
    if (!value) {
      return "日付未登録";
    }

    const parts = String(value).split("-");

    if (parts.length === 3) {
      return `${parts[0]}/${parts[1]}/${parts[2]}`;
    }

    return String(value);
  }

  function getTripDateRange(trip) {
    const start = String(trip.startDate || trip.endDate || "");
    const end = String(trip.endDate || trip.startDate || "");

    return start && end ? { start, end } : null;
  }

  function formatTripDates(trip) {
    const start = trip.startDate ? formatStoredDay(trip.startDate) : "日付未登録";
    const end = trip.endDate ? formatStoredDay(trip.endDate) : "日付未登録";

    if (!trip.startDate && !trip.endDate) {
      return "日付未登録";
    }

    if (trip.startDate && trip.endDate && trip.startDate === trip.endDate) {
      return start;
    }

    return `${start} ～ ${end}`;
  }

  function formatTripRoutes(trip) {
    const routeNumbers = Array.isArray(trip.routeSegments)
      ? trip.routeSegments
        .map(segment => String(segment.routeNumber || ""))
        .filter(Boolean)
      : [];
    const unique = [...new Set(routeNumbers)];

    return unique.length
      ? unique.map(routeNumber => `国道${routeNumber}号`).join("、")
      : "国道未登録";
  }

  function getMaterialDateRange(analysis) {
    if (!analysis) {
      return null;
    }

    const dates = [];

    analysis.gpxResults.forEach(result => {
      [result.startTime, result.endTime].forEach(value => {
        const date = validDate(value);
        if (date) {
          dates.push(date);
        }
      });
    });

    analysis.audioResults.forEach(result => {
      const date = validDate(result.modifiedAt);
      if (date) {
        dates.push(date);
      }
    });

    analysis.photoResults.forEach(result => {
      const date = validDate(result.date);
      if (date) {
        dates.push(date);
      }
    });

    if (!dates.length) {
      return null;
    }

    dates.sort((a, b) => a.getTime() - b.getTime());

    return {
      start: dates[0],
      end: dates[dates.length - 1],
      startKey: dayKey(dates[0]),
      endKey: dayKey(dates[dates.length - 1])
    };
  }

  function formatMaterialDates(range) {
    if (!range) {
      return "日時なし";
    }

    const start = formatDay(range.start);
    const end = formatDay(range.end);
    return start === end ? start : `${start} ～ ${end}`;
  }

  function tripMatchesMaterialDates(trip, materialRange) {
    const tripRange = getTripDateRange(trip);

    if (!tripRange || !materialRange) {
      return null;
    }

    return (
      materialRange.endKey >= tripRange.start &&
      materialRange.startKey <= tripRange.end
    );
  }

  function materialCountText(analysis) {
    if (!analysis) {
      return "0件";
    }

    const audioCount = analysis.audioResults.filter(result => result.kind === "audio").length;
    const textCount = analysis.audioResults.filter(result => result.kind === "text").length;

    return [
      `GPX ${analysis.gpxResults.filter(result => !result.error).length}件`,
      `音声 ${audioCount}件`,
      `文字起こし ${textCount}件`,
      `写真 ${analysis.photoResults.length}件`
    ].join("、");
  }

  function resetTripPreview() {
    tripPreview.classList.add("hidden");
  }

  function tripSignature(trip) {
    return JSON.stringify({
      tripName: String(trip.tripName || ""),
      startDate: String(trip.startDate || ""),
      endDate: String(trip.endDate || ""),
      routes: String(trip.routes || ""),
      routeSegments: Array.isArray(trip.routeSegments)
        ? trip.routeSegments.map(segment => ({
          routeNumber: String(segment.routeNumber || ""),
          status: String(segment.status || ""),
          startPoint: segment.startPoint || null,
          endPoint: segment.endPoint || null
        }))
        : []
    });
  }

  function tripIdentity(trip) {
    const id = String(trip && trip.id || "");
    return id
      ? "id:" + id
      : "signature:" + tripSignature(trip || {});
  }

  function hideSaveCompletion() {
    saveCompletion.classList.add("hidden");
    savedTripName.textContent = "未登録";
    savedMaterialCounts.textContent = "0件";
    savedBackupName.textContent = "未作成";
    openSavedTripLink.href = "trip.html";
  }

  function resetSavePreparation(messageText) {
    backupStorageFingerprint = null;
    lastBackupFileName = "";
    saveMaterialsButton.disabled = true;
    materialBackupButton.disabled = !selectedTripReference;
    hideSaveCompletion();
    materialSaveMessage.textContent = messageText || (
      selectedTripReference
        ? "保存前バックアップを書き出してください。"
        : "対象Tripを確認するとバックアップへ進めます。"
    );
  }

  function updateNewTripActions(materialRange, matchingTripExists) {
    reloadTripsButton.disabled = !latestAnalysis;
    newTripLink.removeAttribute("href");
    newTripLink.setAttribute("aria-disabled", "true");

    if (!materialRange || matchingTripExists) {
      return;
    }

    const tripUrl = new URL("trip.html", window.location.href);
    tripUrl.searchParams.set("materialStart", materialRange.startKey);
    tripUrl.searchParams.set("materialEnd", materialRange.endKey);
    tripUrl.searchParams.set("fromImport", "1");
    newTripLink.href = tripUrl.toString();
    newTripLink.setAttribute("aria-disabled", "false");
  }

  function loadTripCandidates(options = {}) {
    targetTripSelect.replaceChildren();
    savedTrips = [];
    selectedTripReference = null;
    confirmTripButton.disabled = true;
    resetTripPreview();
    resetSavePreparation();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "関連付けるTripを選択";
    targetTripSelect.append(placeholder);
    const materialRange = getMaterialDateRange(latestAnalysis);
    updateNewTripActions(materialRange, false);

    if (!TripData || typeof TripData.readTrips !== "function") {
      placeholder.textContent = "Tripデータを読み込めません";
      tripSuggestion.textContent = "Trip入力画面またはデータ管理画面を確認してください。";
      return;
    }

    const result = TripData.readTrips();

    if (!result.ok) {
      placeholder.textContent = "Tripデータを読み込めません";
      tripSuggestion.textContent = "保存済みTripを変更せず、読込みを中止しました。データ管理画面を確認してください。";
      return;
    }

    savedTrips = [...result.trips].sort((a, b) =>
      String(b.startDate || b.endDate || "").localeCompare(
        String(a.startDate || a.endDate || "")
      )
    );

    if (!savedTrips.length) {
      placeholder.textContent = "保存済みTripはありません";
      tripSuggestion.textContent = materialRange
        ? "保存済みTripはありません。「素材の日付で新しいTripを入力」から準備できます。"
        : "Trip入力画面で対象Tripを作成してから確認します。";
      return;
    }

    savedTrips.forEach((trip, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${trip.tripName || "名称未登録"}（${formatTripDates(trip)}）`;
      targetTripSelect.append(option);
    });

    const matches = savedTrips
      .map((trip, index) => ({ trip, index }))
      .filter(item => tripMatchesMaterialDates(item.trip, materialRange) === true);

    const newMatchingTrips = awaitingNewTrip
      ? matches.filter(item => !tripsBeforeNewEntry.has(tripIdentity(item.trip)))
      : [];

    updateNewTripActions(materialRange, matches.length > 0);

    if (newMatchingTrips.length === 1) {
      targetTripSelect.value = String(newMatchingTrips[0].index);
      confirmTripButton.disabled = false;
      tripSuggestion.textContent =
        "新しく保存されたTripを読み込みました：" +
        (newMatchingTrips[0].trip.tripName || "名称未登録") +
        "。「対象Tripを確認」を押してください。";
      awaitingNewTrip = false;
      tripsBeforeNewEntry = new Set(savedTrips.map(tripIdentity));
    } else if (newMatchingTrips.length > 1) {
      tripSuggestion.textContent =
        "新しく保存されたTripが複数あります。一覧から今回の対象Tripを選んでください。";
      awaitingNewTrip = false;
      tripsBeforeNewEntry = new Set(savedTrips.map(tripIdentity));
    } else if (matches.length === 1) {
      targetTripSelect.value = String(matches[0].index);
      confirmTripButton.disabled = false;
      tripSuggestion.textContent = `素材の日付と一致する候補：${matches[0].trip.tripName || "名称未登録"}`;
    } else if (matches.length > 1) {
      tripSuggestion.textContent = "素材の日付と一致するTripが複数あります。一覧から対象を選んでください。";
    } else if (materialRange) {
      tripSuggestion.textContent =
        "素材の日付と一致するTripはありません。既存Tripを選ぶか、新しいTripの入力準備へ進んでください。";
    } else {
      tripSuggestion.textContent = "素材に日時がないため、一覧から対象Tripを選んでください。";
    }
  }

  function confirmTargetTrip() {
    const index = targetTripSelect.value === ""
      ? Number.NaN
      : Number(targetTripSelect.value);
    const trip = Number.isInteger(index) ? savedTrips[index] : null;

    if (!trip || !latestAnalysis) {
      tripSuggestion.textContent = "対象Tripを選んでから確認してください。";
      return;
    }

    const materialRange = getMaterialDateRange(latestAnalysis);
    const dateMatch = tripMatchesMaterialDates(trip, materialRange);

    document.getElementById("previewTripName").textContent = trip.tripName || "名称未登録";
    document.getElementById("previewTripDates").textContent = formatTripDates(trip);
    document.getElementById("previewTripRoutes").textContent = formatTripRoutes(trip);
    document.getElementById("previewMaterialDates").textContent = formatMaterialDates(materialRange);
    document.getElementById("previewMaterialCounts").textContent = materialCountText(latestAnalysis);
    document.getElementById("previewDateMatch").textContent = dateMatch === true
      ? "素材の日付とTripの日付が一致しています"
      : dateMatch === false
        ? "日付が一致していません。対象Tripを確認してください"
        : "日付未登録のため比較できません";

    tripPreview.classList.remove("hidden");
    tripSuggestion.textContent = "対象Tripを確認しました。保存済みデータは変更していません。";
    selectedTripReference = {
      id: trip.id ? String(trip.id) : "",
      signature: tripSignature(trip),
      tripName: trip.tripName || "名称未登録"
    };
    materialBackupButton.disabled = false;
    resetSavePreparation("対象Tripを確認しました。保存前バックアップを書き出してください。");
  }

  function isManagedKey(key) {
    return key === TRIP_STORAGE_KEY || RECORD_KEY_PATTERN.test(key);
  }

  function collectManagedStorage() {
    const storage = {};
    const keys = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);

      if (key && isManagedKey(key)) {
        keys.push(key);
      }
    }

    keys.sort().forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null) {
        storage[key] = value;
      }
    });

    return storage;
  }

  function collectRecordStorage() {
    return Object.fromEntries(
      Object.entries(collectManagedStorage())
        .filter(([key]) => RECORD_KEY_PATTERN.test(key))
    );
  }

  function storageFingerprint() {
    return JSON.stringify(collectManagedStorage());
  }

  function restoreManagedStorage(snapshot) {
    const currentKeys = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);

      if (key && isManagedKey(key)) {
        currentKeys.push(key);
      }
    }

    currentKeys.forEach(key => localStorage.removeItem(key));
    Object.entries(snapshot).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function createTimestamp() {
    const date = new Date();

    return (
      date.getFullYear() +
      pad(date.getMonth() + 1) +
      pad(date.getDate()) +
      "_" +
      pad(date.getHours()) +
      pad(date.getMinutes()) +
      pad(date.getSeconds())
    );
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPreSaveBackup() {
    if (!selectedTripReference || !latestAnalysis) {
      resetSavePreparation("対象Tripと素材を確認してからバックアップしてください。");
      return;
    }

    try {
      const snapshot = {
        format: "hokkaido48-backup",
        backupVersion: 1,
        appVersion: "4.0",
        exportedAt: new Date().toISOString(),
        sourcePage: window.location.href,
        purpose: "before-material-save",
        storage: collectManagedStorage()
      };
      const blob = new Blob(
        [JSON.stringify(snapshot, null, 2)],
        { type: "application/json;charset=utf-8" }
      );

      lastBackupFileName =
        `hokkaido48_before_material_save_${createTimestamp()}.json`;
      downloadBlob(blob, lastBackupFileName);

      backupStorageFingerprint = JSON.stringify(snapshot.storage);
      saveMaterialsButton.disabled = false;
      materialSaveMessage.textContent =
        "保存前バックアップを書き出しました。素材情報をTripへ保存できます。";
    } catch (error) {
      console.error("素材保存前バックアップエラー:", error);
      resetSavePreparation(
        "保存前バックアップを書き出せないため、Tripへの保存は行いません。"
      );
    }
  }

  function isoText(value) {
    const date = validDate(value);
    return date ? date.toISOString() : null;
  }

  function roundedCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(6)) : null;
  }

  function createPreviewTrack(points, maximumPoints = 200) {
    if (!Array.isArray(points) || !points.length) {
      return [];
    }

    const indexes = new Set();
    const count = Math.min(points.length, maximumPoints);

    if (count === 1) {
      indexes.add(0);
    } else {
      for (let index = 0; index < count; index += 1) {
        indexes.add(Math.round(index * (points.length - 1) / (count - 1)));
      }
    }

    return [...indexes].sort((a, b) => a - b).map(index => ({
      lat: roundedCoordinate(points[index].lat),
      lng: roundedCoordinate(points[index].lng),
      time: isoText(points[index].time)
    }));
  }

  function hashText(text) {
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function buildMaterialImport() {
    const range = getMaterialDateRange(latestAnalysis);
    const gpx = latestAnalysis.gpxResults
      .filter(result => !result.error)
      .map(result => ({
        fileName: result.fileName,
        pointCount: result.points.length,
        distanceKm: Number(result.distance.toFixed(1)),
        startTime: isoText(result.startTime),
        endTime: isoText(result.endTime),
        previewTrack: createPreviewTrack(result.points)
      }));
    const audio = latestAnalysis.audioResults
      .filter(result => result.kind === "audio")
      .map(result => ({
        fileName: result.fileName,
        sizeBytes: result.size,
        modifiedAt: isoText(result.modifiedAt),
        durationSeconds: Number.isFinite(result.duration)
          ? Math.round(result.duration)
          : null
      }));
    const transcripts = latestAnalysis.audioResults
      .filter(result => result.kind === "text")
      .map(result => ({
        fileName: result.fileName,
        sizeBytes: result.size,
        modifiedAt: isoText(result.modifiedAt),
        characters: result.characters,
        text: result.content || ""
      }));
    const photos = latestAnalysis.photoResults.map(result => {
      const nativePosition =
        result.latitude !== null && result.longitude !== null
          ? { lat: result.latitude, lng: result.longitude }
          : null;
      const position = nativePosition || result.matchedPoint;

      return {
        fileName: result.fileName,
        sizeBytes: result.size,
        capturedAt: isoText(result.date),
        dateSource: result.dateSource,
        position: position
          ? {
            lat: roundedCoordinate(position.lat),
            lng: roundedCoordinate(position.lng),
            source: result.locationSource,
            matchedMinutes: result.matchedMinutes !== null
              ? Number(result.matchedMinutes.toFixed(1))
              : null
          }
          : null
      };
    });
    const details = {
      dateRange: range
        ? { start: isoText(range.start), end: isoText(range.end) }
        : null,
      gpx,
      audio,
      transcripts,
      photos,
      fileBodiesStored: false
    };

    return {
      id: `material-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      schemaVersion: 1,
      importedAt: new Date().toISOString(),
      source: "旅素材取込 Version 4.0",
      fingerprint: `material-v1-${hashText(JSON.stringify(details))}`,
      ...details
    };
  }

  function findSelectedTripIndex(trips) {
    if (!selectedTripReference) {
      return -1;
    }

    const matches = trips
      .map((trip, index) => ({ trip, index }))
      .filter(item => selectedTripReference.id
        ? String(item.trip.id || "") === selectedTripReference.id
        : tripSignature(item.trip) === selectedTripReference.signature
      );

    return matches.length === 1 ? matches[0].index : -1;
  }

  function showSaveCompletion(tripId) {
    savedTripName.textContent = selectedTripReference.tripName;
    savedMaterialCounts.textContent = materialCountText(latestAnalysis);
    savedBackupName.textContent = lastBackupFileName || "作成済み";
    openSavedTripLink.href = tripId
      ? `trip.html?trip=${encodeURIComponent(tripId)}`
      : "trip.html";
    saveCompletion.classList.remove("hidden");
  }

  function saveMaterialInformation() {
    if (!selectedTripReference || !latestAnalysis || !backupStorageFingerprint) {
      resetSavePreparation("保存前バックアップを書き出してから保存してください。");
      return;
    }

    if (storageFingerprint() !== backupStorageFingerprint) {
      resetSavePreparation(
        "バックアップ後に保存データが変わりました。保存前バックアップを再作成してください。"
      );
      return;
    }

    const confirmed = window.confirm(
      `「${selectedTripReference.tripName}」へ素材情報を保存します。\n` +
      "写真・音声本体とRouteごとのRecordは変更しません。\n\n保存しますか？"
    );

    if (!confirmed) {
      materialSaveMessage.textContent = "保存を中止しました。保存済みデータは変更していません。";
      return;
    }

    const originalManagedStorage = collectManagedStorage();
    const originalRecords = JSON.stringify(collectRecordStorage());

    try {
      const readResult = TripData.readTrips();

      if (!readResult.ok) {
        throw new Error("保存済みTripを読み込めません。保存を中止しました。");
      }

      const tripIndex = findSelectedTripIndex(readResult.trips);

      if (tripIndex < 0) {
        throw new Error("対象Tripを特定できません。保存を中止しました。");
      }

      const materialImport = buildMaterialImport();
      const targetTrip = readResult.trips[tripIndex];
      const targetTripId = String(targetTrip.id || "");
      const existingImports = Array.isArray(targetTrip.materialImports)
        ? targetTrip.materialImports
        : [];

      if (existingImports.some(item => item && item.fingerprint === materialImport.fingerprint)) {
        backupStorageFingerprint = null;
        saveMaterialsButton.disabled = true;
        materialBackupButton.disabled = true;
        materialSaveMessage.textContent =
          "同じ素材情報はすでに対象Tripへ保存されています。重複保存は行いません。";
        showSaveCompletion(targetTripId);
        return;
      }

      readResult.trips[tripIndex] = {
        ...targetTrip,
        updatedAt: new Date().toISOString(),
        materialImports: [...existingImports, materialImport]
      };

      const saveResult = TripData.saveTrips(readResult.trips);

      if (!saveResult.ok) {
        throw new Error(saveResult.error || "Tripへ保存できませんでした。");
      }

      const verification = TripData.readTrips();
      const verifyIndex = verification.ok
        ? findSelectedTripIndex(verification.trips)
        : -1;
      const verifiedTrip = verifyIndex >= 0 ? verification.trips[verifyIndex] : null;
      const verifiedImports = verifiedTrip && Array.isArray(verifiedTrip.materialImports)
        ? verifiedTrip.materialImports
        : [];

      if (!verifiedImports.some(item => item && item.fingerprint === materialImport.fingerprint)) {
        throw new Error("保存後の確認ができませんでした。");
      }

      if (JSON.stringify(collectRecordStorage()) !== originalRecords) {
        throw new Error("Recordが変更されたため保存を取り消します。");
      }

      backupStorageFingerprint = null;
      saveMaterialsButton.disabled = true;
      materialBackupButton.disabled = true;
      materialSaveMessage.textContent =
        `素材情報を「${selectedTripReference.tripName}」へ保存しました。写真・音声本体は保存していません。`;
      showSaveCompletion(targetTripId);
    } catch (error) {
      console.error("旅素材保存エラー:", error);

      try {
        restoreManagedStorage(originalManagedStorage);
        resetSavePreparation(
          `${error.message} 元のTrip・Recordデータへ戻しました。`
        );
      } catch (rollbackError) {
        console.error("旅素材保存巻き戻しエラー:", rollbackError);
        resetSavePreparation(
          "保存と元データへの戻し処理に失敗しました。保存前バックアップを保管し、データ管理画面から復元してください。"
        );
      }
    }
  }

  function haversineDistance(a, b) {
    const radius = 6371;
    const toRadians = value => value * Math.PI / 180;
    const latitudeDifference = toRadians(b.lat - a.lat);
    const longitudeDifference = toRadians(b.lng - a.lng);
    const latitude1 = toRadians(a.lat);
    const latitude2 = toRadians(b.lat);

    const value =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(latitude1) * Math.cos(latitude2) *
      Math.sin(longitudeDifference / 2) ** 2;

    return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function getXmlElements(xml, localName) {
    const namespaced = Array.from(xml.getElementsByTagNameNS("*", localName));
    return namespaced.length
      ? namespaced
      : Array.from(xml.getElementsByTagName(localName));
  }

  function childText(element, localName) {
    const namespaced = Array.from(element.getElementsByTagNameNS("*", localName));
    const candidates = namespaced.length
      ? namespaced
      : Array.from(element.getElementsByTagName(localName));

    return candidates[0] ? candidates[0].textContent.trim() : "";
  }

  async function parseGpxFile(file) {
    const source = await file.text();
    const xml = new DOMParser().parseFromString(source, "application/xml");

    if (xml.getElementsByTagName("parsererror").length) {
      throw new Error("GPXを読み込めませんでした。");
    }

    let pointElements = getXmlElements(xml, "trkpt");

    if (!pointElements.length) {
      pointElements = getXmlElements(xml, "rtept");
    }

    const points = pointElements
      .map(element => {
        const lat = Number(element.getAttribute("lat"));
        const lng = Number(element.getAttribute("lon"));
        const timeText = childText(element, "time");
        const time = timeText ? new Date(timeText) : null;

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }

        return {
          lat,
          lng,
          time: time && !Number.isNaN(time.getTime()) ? time : null
        };
      })
      .filter(Boolean);

    if (!points.length) {
      throw new Error("経路地点がありません。");
    }

    let distance = 0;

    for (let index = 1; index < points.length; index += 1) {
      distance += haversineDistance(points[index - 1], points[index]);
    }

    const timedPoints = points.filter(point => point.time);

    return {
      fileName: file.name,
      points,
      distance,
      startTime: timedPoints.length ? timedPoints[0].time : null,
      endTime: timedPoints.length ? timedPoints[timedPoints.length - 1].time : null,
      error: null
    };
  }

  async function getWmaDuration(file) {
    const filePropertiesGuid = [
      0xa1, 0xdc, 0xab, 0x8c,
      0x47, 0xa9, 0xcf, 0x11,
      0x8e, 0xe4, 0x00, 0xc0,
      0x0c, 0x20, 0x53, 0x65
    ];
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    for (let offset = 0; offset <= bytes.length - 88; offset += 1) {
      const matches = filePropertiesGuid.every(
        (value, index) => bytes[offset + index] === value
      );

      if (!matches) {
        continue;
      }

      const playDuration = Number(view.getBigUint64(offset + 64, true));
      const preroll = Number(view.getBigUint64(offset + 80, true));
      const duration = playDuration / 10000000 - preroll / 1000;

      return Number.isFinite(duration) && duration > 0
        ? duration
        : null;
    }

    return null;
  }

  function getBrowserAudioDuration(file) {
    return new Promise(resolve => {
      const objectUrl = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      let settled = false;

      function finish(value) {
        if (settled) {
          return;
        }

        settled = true;
        URL.revokeObjectURL(objectUrl);
        resolve(value);
      }

      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => finish(audio.duration), { once: true });
      audio.addEventListener("error", () => finish(null), { once: true });
      audio.src = objectUrl;

      window.setTimeout(() => finish(null), 5000);
    });
  }

  async function getAudioDuration(file) {
    if (file.name.toLowerCase().endsWith(".wma")) {
      try {
        const duration = await getWmaDuration(file);

        if (duration) {
          return duration;
        }
      } catch (error) {
        console.warn("WMAの長さを読み取れませんでした:", file.name, error);
      }
    }

    return getBrowserAudioDuration(file);
  }

  async function parseAudioFile(file) {
    const isText = file.name.toLowerCase().endsWith(".txt") || file.type === "text/plain";

    if (isText) {
      const text = await file.text();

      return {
        kind: "text",
        fileName: file.name,
        size: file.size,
        modifiedAt: file.lastModified ? new Date(file.lastModified) : null,
        preview: text.replace(/\s+/g, " ").trim().slice(0, 240),
        characters: text.length,
        content: text
      };
    }

    return {
      kind: "audio",
      fileName: file.name,
      size: file.size,
      modifiedAt: file.lastModified ? new Date(file.lastModified) : null,
      duration: await getAudioDuration(file)
    };
  }

  function validCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  async function parsePhotoFile(file) {
    let metadata = null;

    if (window.exifr && typeof window.exifr.parse === "function") {
      try {
        metadata = await window.exifr.parse(file, {
          tiff: true,
          exif: true,
          gps: true,
          ifd0: true
        });
      } catch (error) {
        console.warn("写真情報を一部読み取れませんでした:", file.name, error);
      }
    }

    const dateCandidate = metadata && (
      metadata.DateTimeOriginal ||
      metadata.CreateDate ||
      metadata.ModifyDate
    );
    const photoDate = dateCandidate
      ? new Date(dateCandidate)
      : (file.lastModified ? new Date(file.lastModified) : null);
    const latitude = validCoordinate(metadata && metadata.latitude);
    const longitude = validCoordinate(metadata && metadata.longitude);
    const objectUrl = URL.createObjectURL(file);

    photoObjectUrls.push(objectUrl);

    return {
      fileName: file.name,
      size: file.size,
      objectUrl,
      date: photoDate && !Number.isNaN(photoDate.getTime()) ? photoDate : null,
      dateSource: dateCandidate ? "写真の撮影日時" : "ファイル更新日時",
      latitude,
      longitude,
      locationSource:
        latitude !== null && longitude !== null
          ? "写真のGPS位置"
          : "位置情報なし",
      matchedPoint: null,
      matchedMinutes: null
    };
  }

  function matchPhotosToGpx(photos, gpxResults) {
    const timedPoints = gpxResults
      .flatMap(result => result.points || [])
      .filter(point => point.time);

    photos.forEach(photo => {
      if (!photo.date || !timedPoints.length) {
        return;
      }

      let nearestPoint = null;
      let nearestDifference = Infinity;

      timedPoints.forEach(point => {
        const difference = Math.abs(point.time.getTime() - photo.date.getTime());

        if (difference < nearestDifference) {
          nearestDifference = difference;
          nearestPoint = point;
        }
      });

      const differenceMinutes = nearestDifference / 60000;

      if (nearestPoint && differenceMinutes <= 30) {
        photo.matchedPoint = nearestPoint;
        photo.matchedMinutes = differenceMinutes;

        if (photo.latitude === null || photo.longitude === null) {
          photo.locationSource = "GPXの時刻から位置を照合";
        }
      }
    });
  }

  function addDefinition(list, label, value) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  }

  function emptyResult(text) {
    const element = document.createElement("div");
    element.className = "empty";
    element.textContent = text;
    return element;
  }

  function renderGpxResults(results) {
    gpxResultsElement.replaceChildren();
    routeLayer.clearLayers();

    if (!results.length) {
      gpxResultsElement.append(emptyResult("GPXデータは選ばれていません。"));
      return;
    }

    results.forEach((result, index) => {
      const item = document.createElement("article");
      item.className = "result-item";
      const title = document.createElement("h3");
      title.textContent = result.fileName;
      item.append(title);

      if (result.error) {
        const error = document.createElement("p");
        error.className = "error";
        error.textContent = result.error;
        item.append(error);
      } else {
        const list = document.createElement("dl");
        addDefinition(list, "地点数", `${result.points.length}地点`);
        addDefinition(list, "推定距離", `${result.distance.toFixed(1)} km`);
        addDefinition(list, "開始日時", formatDate(result.startTime));
        addDefinition(list, "終了日時", formatDate(result.endTime));
        item.append(list);

        L.polyline(
          result.points.map(point => [point.lat, point.lng]),
          {
            color: routeColors[index % routeColors.length],
            weight: 5,
            opacity: 0.9
          }
        ).bindTooltip(result.fileName).addTo(routeLayer);
      }

      gpxResultsElement.append(item);
    });
  }

  function renderAudioResults(results) {
    audioResultsElement.replaceChildren();

    if (!results.length) {
      audioResultsElement.append(emptyResult("音声・文字起こしは選ばれていません。"));
      return;
    }

    results.forEach(result => {
      const item = document.createElement("article");
      item.className = "result-item";
      const title = document.createElement("h3");
      title.textContent = result.fileName;
      const list = document.createElement("dl");

      addDefinition(list, "種類", result.kind === "text" ? "文字起こし" : "音声本体");
      addDefinition(list, "ファイル容量", formatBytes(result.size));
      addDefinition(list, "ファイル日時", formatDate(result.modifiedAt));

      if (result.kind === "text") {
        addDefinition(list, "文字数", `${result.characters}文字`);
        addDefinition(list, "内容の先頭", result.preview || "文字なし");
      } else {
        addDefinition(list, "音声の長さ", formatDuration(result.duration));
        addDefinition(list, "文字起こし", "未実行（音声本体を確認した段階）");
      }

      item.append(title, list);
      audioResultsElement.append(item);
    });
  }

  function renderPhotoResults(photos) {
    photoResultsElement.replaceChildren();
    photoLayer.clearLayers();

    if (!photos.length) {
      photoResultsElement.append(emptyResult("写真は選ばれていません。"));
      return;
    }

    photos.forEach(photo => {
      const card = document.createElement("article");
      card.className = "photo-card";
      const image = document.createElement("img");
      const content = document.createElement("div");
      const title = document.createElement("strong");
      const date = document.createElement("span");
      const location = document.createElement("span");

      image.src = photo.objectUrl;
      image.alt = photo.fileName;
      title.textContent = photo.fileName;
      date.textContent = `${photo.dateSource}：${formatDate(photo.date)}`;

      const displayPoint =
        photo.latitude !== null && photo.longitude !== null
          ? { lat: photo.latitude, lng: photo.longitude }
          : photo.matchedPoint;

      if (displayPoint) {
        const matchText = photo.matchedMinutes !== null
          ? `（GPXとの差${photo.matchedMinutes.toFixed(1)}分）`
          : "";
        location.textContent = `${photo.locationSource}${matchText}`;

        L.marker([displayPoint.lat, displayPoint.lng])
          .bindPopup(photo.fileName)
          .addTo(photoLayer);
      } else {
        location.textContent = photo.locationSource;
      }

      content.append(title, date, location);
      card.append(image, content);
      photoResultsElement.append(card);
    });
  }

  function updateMapView() {
    const combined = L.featureGroup([
      ...routeLayer.getLayers(),
      ...photoLayer.getLayers()
    ]);

    if (combined.getLayers().length) {
      map.fitBounds(combined.getBounds(), {
        padding: [30, 30],
        maxZoom: 13
      });
    } else {
      map.setView([43.35, 142.45], 5);
    }
  }

  async function analyzeMaterials() {
    const gpxFiles = fileArray(gpxInput);
    const audioFiles = fileArray(audioInput);
    const photoFiles = fileArray(photoInput);

    if (!gpxFiles.length && !audioFiles.length && !photoFiles.length) {
      message.textContent = "GPX・音声・写真のいずれかを選んでください。";
      return;
    }

    analyzeButton.disabled = true;
    clearButton.disabled = true;
    message.textContent = "選んだ素材を読み取っています。";

    photoObjectUrls.forEach(url => URL.revokeObjectURL(url));
    photoObjectUrls = [];

    try {
      const gpxResults = [];

      for (const file of gpxFiles) {
        try {
          gpxResults.push(await parseGpxFile(file));
        } catch (error) {
          gpxResults.push({
            fileName: file.name,
            points: [],
            error: error.message || "GPXを読み込めませんでした。"
          });
        }
      }

      const audioResults = [];

      for (const file of audioFiles) {
        audioResults.push(await parseAudioFile(file));
      }

      const photoResults = [];

      for (const file of photoFiles) {
        photoResults.push(await parsePhotoFile(file));
      }

      matchPhotosToGpx(photoResults, gpxResults.filter(result => !result.error));

      latestAnalysis = {
        gpxResults,
        audioResults,
        photoResults
      };

      renderGpxResults(gpxResults);
      renderAudioResults(audioResults);
      renderPhotoResults(photoResults);
      loadTripCandidates();

      document.getElementById("gpxCount").textContent = String(
        gpxResults.filter(result => !result.error).length
      );
      document.getElementById("audioCount").textContent = String(
        audioResults.filter(result => result.kind === "audio").length
      );
      document.getElementById("textCount").textContent = String(
        audioResults.filter(result => result.kind === "text").length
      );
      document.getElementById("photoCount").textContent = String(photoResults.length);

      resultArea.classList.remove("hidden");
      window.setTimeout(() => {
        map.invalidateSize();
        updateMapView();
      }, 0);

      const errorCount = gpxResults.filter(result => result.error).length;
      message.textContent = errorCount
        ? `素材を読み取りました。GPX ${errorCount}ファイルは内容を確認できませんでした。`
        : "素材を読み取りました。下の読取結果を確認してください。";
    } catch (error) {
      console.error("素材読取エラー:", error);
      message.textContent = "素材を読み取れませんでした。選択したファイルは変更していません。";
    } finally {
      analyzeButton.disabled = false;
      clearButton.disabled = false;
    }
  }

  function clearSelections() {
    gpxInput.value = "";
    audioInput.value = "";
    photoInput.value = "";
    photoObjectUrls.forEach(url => URL.revokeObjectURL(url));
    photoObjectUrls = [];
    latestAnalysis = null;
    selectedTripReference = null;
    awaitingNewTrip = false;
    tripsBeforeNewEntry = new Set();
    routeLayer.clearLayers();
    photoLayer.clearLayers();
    resultArea.classList.add("hidden");
    targetTripSelect.value = "";
    confirmTripButton.disabled = true;
    resetTripPreview();
    resetSavePreparation("対象Tripを確認するとバックアップへ進めます。");
    tripSuggestion.textContent = "素材を読み取ると候補を確認できます。";
    updateNewTripActions(null, false);
    updateSelections();
  }

  [gpxInput, audioInput, photoInput].forEach(input => {
    input.addEventListener("change", () => {
      updateSelections();
      latestAnalysis = null;
      selectedTripReference = null;
      backupStorageFingerprint = null;
      resultArea.classList.add("hidden");
      targetTripSelect.value = "";
      confirmTripButton.disabled = true;
      resetTripPreview();
      resetSavePreparation("素材を読み取り、対象Tripを確認してください。");
      tripSuggestion.textContent = "素材を読み取ると候補を確認できます。";
      updateNewTripActions(null, false);
    });
  });

  analyzeButton.addEventListener("click", analyzeMaterials);
  clearButton.addEventListener("click", clearSelections);
  newTripLink.addEventListener("click", event => {
    if (newTripLink.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      return;
    }

    awaitingNewTrip = true;
    tripsBeforeNewEntry = new Set(savedTrips.map(tripIdentity));
    tripSuggestion.textContent =
      "別タブで新しいTripを保存してください。保存後、この画面へ戻ると候補を自動で読み込みます。";
    materialSaveMessage.textContent =
      "新しいTripの保存を待っています。現在の素材と保存済みデータは変更していません。";
  });
  targetTripSelect.addEventListener("change", () => {
    selectedTripReference = null;
    confirmTripButton.disabled = targetTripSelect.value === "";
    resetTripPreview();
    resetSavePreparation("選んだ対象Tripを確認してください。");

    if (targetTripSelect.value !== "") {
      tripSuggestion.textContent = "選んだTripを「対象Tripを確認」で確認してください。";
    }
  });
  confirmTripButton.addEventListener("click", confirmTargetTrip);
  reloadTripsButton.addEventListener("click", () => {
    if (!latestAnalysis) {
      tripSuggestion.textContent = "先に素材を読み取ってください。";
      return;
    }

    loadTripCandidates({ afterTripReload: true });
    materialSaveMessage.textContent = targetTripSelect.value === ""
      ? "保存済みTripを再読み込みしました。対象Tripを選んで確認してください。"
      : "保存済みTripを再読み込みしました。選ばれた対象Tripを確認してください。";
  });
  materialBackupButton.addEventListener("click", exportPreSaveBackup);
  saveMaterialsButton.addEventListener("click", saveMaterialInformation);
  window.addEventListener("storage", event => {
    if (event.key && isManagedKey(event.key)) {
      if (event.key === TRIP_STORAGE_KEY && latestAnalysis) {
        loadTripCandidates({ afterTripReload: true });
        materialSaveMessage.textContent = targetTripSelect.value === ""
          ? "別のタブで保存されたTripを読み込みました。対象Tripを選んで確認してください。"
          : "別のタブで保存されたTripを読み込みました。選ばれた対象Tripを確認してください。";
        return;
      }

      selectedTripReference = null;
      resetTripPreview();
      resetSavePreparation(
        "別の画面で保存データが変わりました。素材を読み取り直し、対象Tripを再確認してください。"
      );
    }
  });
  window.addEventListener("beforeunload", () => {
    photoObjectUrls.forEach(url => URL.revokeObjectURL(url));
  });

  updateSelections();
  loadTripCandidates();
})();
