(function () {
  "use strict";

  const allInput = document.getElementById("allMaterialFiles");
  const allStatus = document.getElementById("allMaterialSelection");
  const gpxInput = document.getElementById("gpxFiles");
  const audioInput = document.getElementById("audioFiles");
  const photoInput = document.getElementById("photoFiles");
  const clearButton = document.getElementById("clearButton");
  const analyzeButton = document.getElementById("analyzeButton");
  const targetTripSelect = document.getElementById("targetTripSelect");
  const tripPreview = document.getElementById("tripPreview");
  const resultArea = document.getElementById("resultArea");
  const TripData = window.Hokkaido48TripData;

  if (!allInput || !gpxInput || !audioInput || !photoInput) return;

  const GPX = new Set(["gpx"]);
  const AUDIO_TEXT = new Set(["wma", "m4a", "mp3", "wav", "aac", "txt"]);
  const PHOTO = new Set(["jpg", "jpeg", "png", "heic", "heif"]);
  const ROUTE_EXCLUSIONS = new Set(["279", "338"]);
  const TRIP_STORAGE_KEY = "hokkaido48Trips";
  const RECORD_KEY_PATTERN = /^route\d{3}Record$/;

  let latestRouteCandidates = [];
  let gpxRouteBackupReady = false;

  function extension(name) {
    const parts = String(name || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  }

  function assignFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function classify(files) {
    const groups = { gpx: [], audio: [], photo: [], unknown: [] };

    files.forEach(file => {
      const ext = extension(file.name);
      if (GPX.has(ext)) groups.gpx.push(file);
      else if (
        AUDIO_TEXT.has(ext) ||
        String(file.type || "").startsWith("audio/") ||
        file.type === "text/plain"
      ) groups.audio.push(file);
      else if (
        PHOTO.has(ext) ||
        String(file.type || "").startsWith("image/")
      ) groups.photo.push(file);
      else groups.unknown.push(file);
    });

    return groups;
  }

  allInput.addEventListener("change", function () {
    const files = Array.from(allInput.files || []);
    const groups = classify(files);

    assignFiles(gpxInput, groups.gpx);
    assignFiles(audioInput, groups.audio);
    assignFiles(photoInput, groups.photo);

    const parts = [
      `合計${files.length}件`,
      `GPX ${groups.gpx.length}件`,
      `音声・TXT ${groups.audio.length}件`,
      `写真 ${groups.photo.length}件`
    ];

    if (groups.unknown.length) parts.push(`未分類 ${groups.unknown.length}件`);
    allStatus.textContent = files.length ? parts.join("／") : "未選択";
  });

  if (clearButton) {
    clearButton.addEventListener("click", function () {
      allInput.value = "";
      allStatus.textContent = "未選択";
      latestRouteCandidates = [];
      gpxRouteBackupReady = false;
      hideRouteMatchSection();
    });
  }

  // ============================================================
  // Version 4.0 GPX × 48路線GeoJSON 照合
  // ============================================================

  function createRouteMatchSection() {
    if (document.getElementById("gpxRouteMatchCard")) return;

    const card = document.createElement("section");
    card.id = "gpxRouteMatchCard";
    card.className = "card hidden";
    card.innerHTML = `
      <h2>GPXから走行国道を推定</h2>
      <p>
        GPX軌跡と48路線のGeoJSONを照合し、走行した可能性の高い国道と
        「一部走破／全線走破」の候補を表示します。候補は人間が確認してからTripへ反映します。
      </p>
      <div class="notice safe-notice">
        自動判定は候補です。重複国道・並走道路・GPS誤差があるため、チェックと走破状態を確認してから反映してください。
      </div>
      <p id="gpxRouteMatchStatus" class="selection-status">GPXを読み取ると照合します。</p>
      <div id="gpxRouteMatchResults" class="result-list"></div>
      <div class="action-row">
        <button id="gpxRouteBackupButton" class="primary" type="button" disabled>
          路線反映前バックアップを書き出す
        </button>
        <button id="applyGpxRoutesButton" class="save" type="button" disabled>
          確認した路線候補をTripへ反映
        </button>
      </div>
      <p id="gpxRouteApplyMessage" class="selection-status">
        GPX照合後、対象Tripを確認してください。
      </p>
    `;

    const firstResultCard = resultArea && resultArea.querySelector(".card");
    if (firstResultCard && firstResultCard.parentNode) {
      firstResultCard.parentNode.insertBefore(card, firstResultCard.nextSibling);
    } else if (resultArea) {
      resultArea.prepend(card);
    }

    document.getElementById("gpxRouteBackupButton")
      .addEventListener("click", exportGpxRouteBackup);
    document.getElementById("applyGpxRoutesButton")
      .addEventListener("click", applyGpxRouteCandidates);
  }

  function hideRouteMatchSection() {
    const card = document.getElementById("gpxRouteMatchCard");
    if (card) card.classList.add("hidden");
  }

  function getGeojsonPath(number) {
    return "data/geojson/route_" + String(number).padStart(3, "0") + ".geojson";
  }

  function getXmlElements(xml, localName) {
    const namespaced = Array.from(xml.getElementsByTagNameNS("*", localName));
    return namespaced.length
      ? namespaced
      : Array.from(xml.getElementsByTagName(localName));
  }

  async function parseGpxPoints(file) {
    const source = await file.text();
    const xml = new DOMParser().parseFromString(source, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) {
      throw new Error(`${file.name} を読み込めませんでした。`);
    }

    let elements = getXmlElements(xml, "trkpt");
    if (!elements.length) elements = getXmlElements(xml, "rtept");

    return elements.map(element => {
      const lat = Number(element.getAttribute("lat"));
      const lng = Number(element.getAttribute("lon"));
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    }).filter(Boolean);
  }

  function collectLineCoordinates(item, output) {
    if (!item) return;
    if (item.type === "FeatureCollection") {
      (item.features || []).forEach(value => collectLineCoordinates(value, output));
      return;
    }
    if (item.type === "Feature") {
      collectLineCoordinates(item.geometry, output);
      return;
    }
    if (item.type === "GeometryCollection") {
      (item.geometries || []).forEach(value => collectLineCoordinates(value, output));
      return;
    }
    if (item.type === "LineString") {
      output.push(item.coordinates || []);
      return;
    }
    if (item.type === "MultiLineString") {
      (item.coordinates || []).forEach(line => output.push(line));
    }
  }

  function routeLines(geojson) {
    const lines = [];
    collectLineCoordinates(geojson, lines);
    return lines
      .map(line => line.map(coordinate => ({
        lat: Number(coordinate[1]),
        lng: Number(coordinate[0])
      })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)))
      .filter(line => line.length >= 2);
  }

  function distanceMeters(a, b) {
    const rad = Math.PI / 180;
    const meanLat = (a.lat + b.lat) * 0.5 * rad;
    const x = (b.lng - a.lng) * rad * Math.cos(meanLat);
    const y = (b.lat - a.lat) * rad;
    return Math.sqrt(x * x + y * y) * 6371000;
  }

  // GeoJSONの頂点間隔に左右されないよう、道路線を約100m間隔で補間する。
  function densifyLines(lines, intervalMeters = 100) {
    const points = [];
    lines.forEach(line => {
      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1];
        const end = line[index];
        const distance = distanceMeters(start, end);
        const steps = Math.max(1, Math.ceil(distance / intervalMeters));
        for (let step = 0; step < steps; step += 1) {
          const ratio = step / steps;
          points.push({
            lat: start.lat + (end.lat - start.lat) * ratio,
            lng: start.lng + (end.lng - start.lng) * ratio
          });
        }
      }
      points.push(line[line.length - 1]);
    });
    return points;
  }

  function samplePoints(points, maximum) {
    if (!Array.isArray(points) || points.length <= maximum) return points || [];
    const sampled = [];
    for (let i = 0; i < maximum; i += 1) {
      sampled.push(points[Math.round(i * (points.length - 1) / (maximum - 1))]);
    }
    return sampled;
  }

  function nearestDistance(point, points, stopAt) {
    let best = Infinity;
    for (const candidate of points) {
      const distance = distanceMeters(point, candidate);
      if (distance < best) best = distance;
      if (best <= stopAt) break;
    }
    return best;
  }

  function evaluateRoute(route, routePointCloud, gpxPoints) {
    // 路線側は高密度化後に最大900点、GPX側は最大1200点で比較。
    // 旧版の「GeoJSON頂点だけ比較」による見落としを減らす。
    const sampledRoute = samplePoints(routePointCloud, 900);
    const sampledGpx = samplePoints(gpxPoints, 1200);
    if (!sampledRoute.length || !sampledGpx.length) return null;

    // 一般的なスマホGPS誤差、道路中心線との差、並走路を考慮。
    const routeThreshold = 220;
    const gpxThreshold = 180;

    let coveredRouteCount = 0;
    sampledRoute.forEach(point => {
      if (nearestDistance(point, sampledGpx, routeThreshold) <= routeThreshold) {
        coveredRouteCount += 1;
      }
    });

    let nearGpxCount = 0;
    let firstGpxIndex = Infinity;
    let lastGpxIndex = -1;
    sampledGpx.forEach((point, index) => {
      if (nearestDistance(point, sampledRoute, gpxThreshold) <= gpxThreshold) {
        nearGpxCount += 1;
        if (firstGpxIndex === Infinity) firstGpxIndex = index;
        lastGpxIndex = index;
      }
    });

    const routeCoverage = coveredRouteCount / sampledRoute.length;
    const gpxShare = nearGpxCount / sampledGpx.length;
    const matchedSpan = lastGpxIndex >= 0 && firstGpxIndex !== Infinity
      ? (lastGpxIndex - firstGpxIndex + 1) / sampledGpx.length
      : 0;

    // 短時間だけ交差した道路は除外するが、短い実走区間（例: 国道38号）も拾える閾値にする。
    if (coveredRouteCount < 2 || nearGpxCount < 2) return null;
    if (routeCoverage < 0.006 && gpxShare < 0.003 && matchedSpan < 0.004) return null;

    // 全線走破は路線カバー率を主判定。
    // 高密度補間後85%以上を基本とし、80%以上かつGPX上でまとまった区間なら全線候補。
    // 路線端点付近をGPXが通過しているか確認。
    // routePointCloud は補間済みなので、先頭・末尾を端点近似として利用する。
    const routeStartPoint = sampledRoute[0];
    const routeEndPoint = sampledRoute[sampledRoute.length - 1];

    const startNearDistance = nearestDistance(routeStartPoint, sampledGpx, 600);
    const endNearDistance = nearestDistance(routeEndPoint, sampledGpx, 600);

    const startReached = startNearDistance <= 600;
    const endReached = endNearDistance <= 600;
    const endpointsReached = startReached && endReached;

    // 全線走破判定:
    // 1) 従来どおり高い路線カバー率
    // 2) 端点両方を通過し、かつ路線カバー率が一定以上
    // 3) 端点両方を通過し、GPX上でもまとまった走行区間を形成
    const complete =
      routeCoverage >= 0.85 ||
      (endpointsReached && routeCoverage >= 0.68) ||
      (endpointsReached && routeCoverage >= 0.60 && matchedSpan >= 0.10);

    const confidence = Math.min(100, Math.round(
      routeCoverage * 70 +
      Math.min(gpxShare * 3, 0.18) * 100 +
      Math.min(matchedSpan, 0.07) * 100 +
      (endpointsReached ? 12 : 0)
    ));

    return {
      routeNumber: String(route.number),
      routeName: route.name || `一般国道${route.number}号`,
      start: route.start || "",
      end: route.end || "",
      routeCoverage,
      gpxShare,
      matchedSpan,
      startReached,
      endReached,
      endpointsReached,
      status: complete ? "complete" : "partial",
      confidence,
      firstGpxIndex
    };
  }

  async function analyzeGpxRouteCandidates() {
    createRouteMatchSection();
    const card = document.getElementById("gpxRouteMatchCard");
    const status = document.getElementById("gpxRouteMatchStatus");
    const results = document.getElementById("gpxRouteMatchResults");
    const backupButton = document.getElementById("gpxRouteBackupButton");
    const applyButton = document.getElementById("applyGpxRoutesButton");
    const message = document.getElementById("gpxRouteApplyMessage");

    const files = Array.from(gpxInput.files || []);
    if (!files.length) {
      card.classList.add("hidden");
      return;
    }

    card.classList.remove("hidden");
    results.replaceChildren();
    status.textContent = "GPXと48路線データを照合しています。";
    message.textContent = "照合中です。";
    backupButton.disabled = true;
    applyButton.disabled = true;
    gpxRouteBackupReady = false;

    try {
      const gpxArrays = await Promise.all(files.map(parseGpxPoints));
      const gpxPoints = gpxArrays.flat();
      if (!gpxPoints.length) throw new Error("GPXに経路地点がありません。");

      const routesResponse = await fetch("data/routes.json");
      if (!routesResponse.ok) throw new Error("routes.jsonを読み込めません。");
      const routes = await routesResponse.json();

      const candidates = [];
      let completed = 0;

      await Promise.all(routes.map(async route => {
        const routeNumber = String(route.number);
        if (ROUTE_EXCLUSIONS.has(routeNumber)) return;

        try {
          const response = await fetch(getGeojsonPath(route.number));
          if (!response.ok) return;
          const geojson = await response.json();
          const lines = routeLines(geojson);
          const routePointCloud = densifyLines(lines, 100);
          const candidate = evaluateRoute(route, routePointCloud, gpxPoints);
          if (candidate) candidates.push(candidate);
        } catch (error) {
          console.warn("路線照合スキップ:", route.number, error);
        } finally {
          completed += 1;
          status.textContent = `GPXと48路線データを照合しています（${completed}/${routes.length}）`;
        }
      }));

      candidates.sort((a, b) =>
        a.firstGpxIndex - b.firstGpxIndex ||
        b.routeCoverage - a.routeCoverage
      );

      latestRouteCandidates = candidates;
      renderRouteCandidates(candidates);

      status.textContent = candidates.length
        ? `${candidates.length}路線を走行候補として抽出しました。チェックと走破状態を確認してください。`
        : "走行国道候補を抽出できませんでした。GPXまたは路線データを確認してください。";

      backupButton.disabled = candidates.length === 0;
      message.textContent = candidates.length
        ? "対象Tripを確認した後、路線反映前バックアップを書き出してください。"
        : "反映できる候補はありません。";
    } catch (error) {
      console.error("GPX路線照合エラー:", error);
      status.textContent = `GPX路線照合に失敗しました：${error.message}`;
      message.textContent = "Tripデータは変更していません。";
    }
  }

  function renderRouteCandidates(candidates) {
    const results = document.getElementById("gpxRouteMatchResults");
    results.replaceChildren();

    candidates.forEach(candidate => {
      const item = document.createElement("div");
      item.className = "result-item";
      item.dataset.routeNumber = candidate.routeNumber;

      const coveragePercent = Math.round(candidate.routeCoverage * 100);
      const gpxPercent = Math.round(candidate.gpxShare * 100);
      const spanPercent = Math.round((candidate.matchedSpan || 0) * 100);
      const endpointText = candidate.endpointsReached
        ? "起終点とも通過"
        : candidate.startReached || candidate.endReached
          ? "片側端点のみ通過"
          : "起終点未確認";

      item.innerHTML = `
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;">
          <input
            class="gpx-route-candidate-check"
            type="checkbox"
            checked
            aria-label="国道${candidate.routeNumber}号を反映"
            style="width:22px;height:22px;"
          >
          <div>
            <strong>国道${candidate.routeNumber}号　${candidate.start}－${candidate.end}</strong>
            <div style="font-size:13px;color:#53677a;margin-top:4px;">
              路線カバー推定 ${coveragePercent}% ／ GPX全体に占める区間 ${gpxPercent}% ／ 連続走行範囲 ${spanPercent}% ／ ${endpointText} ／ 判定信頼度 ${candidate.confidence}%
            </div>
          </div>
          <select class="gpx-route-status" style="min-height:42px;padding:7px 10px;">
            <option value="partial"${candidate.status === "partial" ? " selected" : ""}>一部走破</option>
            <option value="complete"${candidate.status === "complete" ? " selected" : ""}>全線走破</option>
          </select>
        </div>
      `;

      results.appendChild(item);
    });
  }

  function getConfirmedTargetTrip() {
    if (!TripData || typeof TripData.readTrips !== "function") return null;
    if (!targetTripSelect || targetTripSelect.value === "") return null;
    if (!tripPreview || tripPreview.classList.contains("hidden")) return null;

    const result = TripData.readTrips();
    if (!result.ok) return null;

    const sortedTrips = [...result.trips].sort((a, b) =>
      String(b.startDate || b.endDate || "").localeCompare(
        String(a.startDate || a.endDate || "")
      )
    );

    const index = Number(targetTripSelect.value);
    const selected = Number.isInteger(index) ? sortedTrips[index] : null;
    if (!selected) return null;

    return {
      selected,
      allTrips: result.trips
    };
  }

  function collectManagedStorage() {
    const storage = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && (key === TRIP_STORAGE_KEY || RECORD_KEY_PATTERN.test(key))) {
        const value = localStorage.getItem(key);
        if (value !== null) storage[key] = value;
      }
    }
    return storage;
  }

  function timestamp() {
    const d = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function downloadJson(value, fileName) {
    const blob = new Blob(
      [JSON.stringify(value, null, 2)],
      { type: "application/json;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportGpxRouteBackup() {
    const target = getConfirmedTargetTrip();
    const message = document.getElementById("gpxRouteApplyMessage");
    const applyButton = document.getElementById("applyGpxRoutesButton");

    if (!target) {
      message.textContent =
        "先に「関連付けるTrip」を選択し、「対象Tripを確認」を押してください。";
      return;
    }

    const selectedCandidates = readCandidateSelections();
    if (!selectedCandidates.length) {
      message.textContent = "反映する路線候補を1件以上選択してください。";
      return;
    }

    const fileName = `hokkaido48_before_gpx_route_apply_${timestamp()}.json`;
    downloadJson({
      format: "hokkaido48-backup",
      backupVersion: 1,
      appVersion: "4.0",
      exportedAt: new Date().toISOString(),
      purpose: "before-gpx-route-apply",
      targetTripId: target.selected.id || null,
      targetTripName: target.selected.tripName || "",
      routeCandidates: selectedCandidates,
      storage: collectManagedStorage()
    }, fileName);

    gpxRouteBackupReady = true;
    applyButton.disabled = false;
    message.textContent =
      `路線反映前バックアップを書き出しました（${fileName}）。確認した路線候補をTripへ反映できます。`;
  }

  function readCandidateSelections() {
    const selected = [];
    document.querySelectorAll("#gpxRouteMatchResults .result-item").forEach(item => {
      const checkbox = item.querySelector(".gpx-route-candidate-check");
      const status = item.querySelector(".gpx-route-status");
      if (checkbox && checkbox.checked && status) {
        const original = latestRouteCandidates.find(
          candidate => candidate.routeNumber === item.dataset.routeNumber
        );
        selected.push({
          ...(original || {}),
          routeNumber: item.dataset.routeNumber,
          status: status.value === "complete" ? "complete" : "partial"
        });
      }
    });
    return selected;
  }

  function applyGpxRouteCandidates() {
    const message = document.getElementById("gpxRouteApplyMessage");
    const applyButton = document.getElementById("applyGpxRoutesButton");

    if (!gpxRouteBackupReady) {
      message.textContent = "先に路線反映前バックアップを書き出してください。";
      return;
    }

    const target = getConfirmedTargetTrip();
    if (!target) {
      message.textContent =
        "対象Tripの確認状態を取得できません。もう一度「対象Tripを確認」を押してください。";
      return;
    }

    const selectedCandidates = readCandidateSelections();
    if (!selectedCandidates.length) {
      message.textContent = "反映する路線候補を1件以上選択してください。";
      return;
    }

    const confirmed = window.confirm(
      `「${target.selected.tripName || "名称未登録"}」へ、確認した${selectedCandidates.length}路線を反映します。\n` +
      "既に登録済みの同一路線は走破状態を更新し、未登録路線は追加します。\n\n反映しますか？"
    );
    if (!confirmed) return;

    const readResult = TripData.readTrips();
    if (!readResult.ok) {
      message.textContent = "Tripデータを読み込めません。反映を中止しました。";
      return;
    }

    const targetId = String(target.selected.id || "");
    let targetIndex = -1;

    if (targetId) {
      targetIndex = readResult.trips.findIndex(
        trip => String(trip.id || "") === targetId
      );
    }

    if (targetIndex < 0) {
      targetIndex = readResult.trips.findIndex(trip =>
        String(trip.tripName || "") === String(target.selected.tripName || "") &&
        String(trip.startDate || "") === String(target.selected.startDate || "") &&
        String(trip.endDate || "") === String(target.selected.endDate || "")
      );
    }

    if (targetIndex < 0) {
      message.textContent = "対象Tripを特定できません。反映を中止しました。";
      return;
    }

    const trip = readResult.trips[targetIndex];
    const existingSegments = Array.isArray(trip.routeSegments)
      ? trip.routeSegments.map(segment => ({ ...segment }))
      : [];

    const candidateMap = new Map(
      selectedCandidates.map(candidate => [candidate.routeNumber, candidate])
    );

    // 既存の走行順は維持し、同一路線の走破状態だけ更新。
    existingSegments.forEach(segment => {
      const routeNumber = String(segment.routeNumber || "");
      const candidate = candidateMap.get(routeNumber);
      if (candidate) {
        segment.status = candidate.status;
        candidateMap.delete(routeNumber);
      }
    });

    // 未登録候補はGPX上の初出順で追加。
    [...candidateMap.values()]
      .sort((a, b) => a.firstGpxIndex - b.firstGpxIndex)
      .forEach(candidate => {
        existingSegments.push({
          id: `gpx-${Date.now()}-${candidate.routeNumber}-${Math.random().toString(36).slice(2, 7)}`,
          routeNumber: candidate.routeNumber,
          status: candidate.status,
          startPoint: null,
          endPoint: null
        });
      });

    readResult.trips[targetIndex] = {
      ...trip,
      routeSegments: existingSegments,
      updatedAt: new Date().toISOString()
    };

    const saveResult = TripData.saveTrips(readResult.trips);
    if (!saveResult.ok) {
      message.textContent =
        `Tripへの反映に失敗しました：${saveResult.error || "保存エラー"}`;
      return;
    }

    gpxRouteBackupReady = false;
    applyButton.disabled = true;
    message.textContent =
      `GPX走行路線候補 ${selectedCandidates.length}件を「${trip.tripName || "対象Trip"}」へ反映しました。Tripを開いて走行順と走破状態を確認してください。`;
  }

  if (analyzeButton) {
    analyzeButton.addEventListener("click", function () {
      // 既存の素材読取処理と並行し、GPX路線照合を独立実行。
      window.setTimeout(analyzeGpxRouteCandidates, 0);
    });
  }

  createRouteMatchSection();
})();