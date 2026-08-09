(function () {
  "use strict";

  const analyzeButton = document.getElementById("analyzeButton");
  const rerunButton = document.getElementById("autoRouteJudgeButton");
  const saveButton = document.getElementById("saveAutoRouteJudgeButton");
  const addManualButton = document.getElementById("addManualRouteButton");
  const status = document.getElementById("autoRouteJudgeStatus");
  const summary = document.getElementById("autoRouteJudgeSummary");
  const results = document.getElementById("autoRouteJudgeResults");
  const saveStatus = document.getElementById("autoRouteSaveStatus");
  const gpxInput = document.getElementById("gpxFiles");
  const tripSelect = document.getElementById("targetTripSelect");
  const nextStep = document.getElementById("importNextStep");
  const screenshotInput = document.getElementById("routeScreenshot");
  const screenshotPreview = document.getElementById("routeScreenshotPreview");
  const mapGuide = document.getElementById("semiMapGuide");
  const saveModeNew = document.getElementById("saveModeNew");
  const saveModeExisting = document.getElementById("saveModeExisting");
  const newTripFields = document.getElementById("newTripFields");
  const existingTripFields = document.getElementById("existingTripFields");
  const newTripName = document.getElementById("newTripName");
  const newTripStartDate = document.getElementById("newTripStartDate");
  const newTripEndDate = document.getElementById("newTripEndDate");
  const existingTripSelect = document.getElementById("existingTripSelect");
  const existingTripConfirm = document.getElementById("existingTripConfirm");
  const saveTargetSummary = document.getElementById("saveTargetSummary");
  const TripData = window.Hokkaido48TripData;

  if (
    !analyzeButton || !rerunButton || !saveButton || !addManualButton ||
    !status || !summary || !results || !saveStatus || !gpxInput ||
    !tripSelect || !saveModeNew || !saveModeExisting || !newTripFields ||
    !existingTripFields || !newTripName || !newTripStartDate ||
    !newTripEndDate || !existingTripSelect || !existingTripConfirm ||
    !saveTargetSummary || !window.L
  ) {
    return;
  }

  const MAX_GPX_SAMPLES = 800;
  const ROUTE_GRID_DEG = 0.003;
  const MATCH_METERS = 420;
  const STRONG_DISTANCE_KM = 5;
  const MIN_RUN_POINTS = 3;
  const MAX_ROUTE_PATH_POINTS = 500;

  let map = null;
  let baseLayer = null;
  let selectedLayer = null;
  let latestGpxPoints = [];
  let latestSampledPoints = [];
  let candidates = [];
  let allRoutes = [];
  let busy = false;
  let screenshotUrl = null;
  const routeCache = new Map();

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function files(input) {
    return Array.from(input.files || []);
  }

  function haversine(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad;
    const lat2 = b.lat * rad;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function pathDistance(points) {
    let meters = 0;
    for (let index = 1; index < points.length; index += 1) {
      meters += haversine(points[index - 1], points[index]);
    }
    return meters;
  }

  function sampleEvenly(points, maxCount) {
    if (points.length <= maxCount) return points.slice();
    const out = [];
    for (let index = 0; index < maxCount; index += 1) {
      out.push(
        points[Math.round(index * (points.length - 1) / (maxCount - 1))]
      );
    }
    return out;
  }

  function reducePath(points, maxCount) {
    return sampleEvenly(points, Math.max(2, maxCount))
      .map(point => [Number(point.lat), Number(point.lng)]);
  }

  async function parseGpx(file) {
    const text = await file.text();
    const xml = new DOMParser().parseFromString(text, "application/xml");

    if (xml.querySelector("parsererror")) {
      throw new Error(`${file.name}: GPX解析エラー`);
    }

    return Array.from(xml.querySelectorAll("trkpt, rtept"))
      .map(node => ({
        lat: Number(node.getAttribute("lat")),
        lng: Number(node.getAttribute("lon")),
        time: node.querySelector("time")
          ? node.querySelector("time").textContent
          : null
      }))
      .filter(point =>
        Number.isFinite(point.lat) && Number.isFinite(point.lng)
      );
  }

  async function readGpxFiles() {
    const selected = files(gpxInput);
    if (!selected.length) {
      throw new Error("GPXを選択してください。");
    }

    const all = [];
    for (const file of selected) {
      all.push(...await parseGpx(file));
    }

    if (all.length < 2) {
      throw new Error("GPX点を読み取れませんでした。");
    }

    return {
      points: all,
      files: selected
    };
  }

  function isoDateFromPoint(point) {
    if (!point || !point.time) return "";
    const date = new Date(point.time);
    if (Number.isNaN(date.getTime())) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function dateFromFilename(name) {
    const match = String(name || "").match(/(20\d{2})[^\d]?(\d{2})[^\d]?(\d{2})/);
    if (!match) return "";
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function cleanTripLabelFromFilename(name) {
    return String(name || "")
      .replace(/\.[^.]+$/, "")
      .replace(/^\s*(20\d{2})[^\d]?(\d{2})[^\d]?(\d{2})\s*/, "")
      .replace(/[∸₋ー−‐–—]/g, "－")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatDateSlash(value) {
    return String(value || "").replace(/-/g, "/");
  }

  function proposeNewTrip(gpxBundle) {
    const selectedFiles = gpxBundle.files || [];
    const firstFile = selectedFiles[0];
    const points = gpxBundle.points || [];

    const startDate =
      dateFromFilename(firstFile && firstFile.name) ||
      isoDateFromPoint(points[0]);

    const endDate =
      isoDateFromPoint(points[points.length - 1]) ||
      startDate;

    const label = cleanTripLabelFromFilename(firstFile && firstFile.name);
    const dateLabel = formatDateSlash(startDate);

    newTripStartDate.value = startDate;
    newTripEndDate.value = endDate || startDate;
    newTripName.value = [dateLabel, label].filter(Boolean).join(" ");

    resetSaveTargetToNew();
  }

  function collectGeojsonCoords(geojson) {
    const out = [];

    function walk(value) {
      if (!Array.isArray(value)) return;

      if (
        value.length >= 2 &&
        typeof value[0] === "number" &&
        typeof value[1] === "number"
      ) {
        out.push({ lat: value[1], lng: value[0] });
        return;
      }

      value.forEach(walk);
    }

    if (geojson && Array.isArray(geojson.features)) {
      geojson.features.forEach(feature => {
        if (feature && feature.geometry) {
          walk(feature.geometry.coordinates);
        }
      });
    } else if (geojson && geojson.geometry) {
      walk(geojson.geometry.coordinates);
    }

    return out;
  }

  function gridKey(lat, lng) {
    return (
      Math.floor(lat / ROUTE_GRID_DEG) +
      ":" +
      Math.floor(lng / ROUTE_GRID_DEG)
    );
  }

  function buildGrid(points) {
    const grid = new Map();

    points.forEach(point => {
      const key = gridKey(point.lat, point.lng);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(point);
    });

    return grid;
  }

  function nearbyDistance(point, grid) {
    const latCell = Math.floor(point.lat / ROUTE_GRID_DEG);
    const lngCell = Math.floor(point.lng / ROUTE_GRID_DEG);
    let best = Infinity;

    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const bucket =
          grid.get(`${latCell + dy}:${lngCell + dx}`) || [];

        for (const candidate of bucket) {
          const distance = haversine(point, candidate);
          if (distance < best) best = distance;
        }
      }
    }

    return best;
  }

  async function loadRoutes() {
    const response = await fetch("data/routes.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("routes.jsonを読み込めませんでした。");
    }
    return response.json();
  }

  async function loadRoute(number) {
    const key = String(number);
    if (routeCache.has(key)) return routeCache.get(key);

    const path =
      `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
    const response = await fetch(path, { cache: "no-store" });

    if (!response.ok) {
      routeCache.set(key, null);
      return null;
    }

    const geojson = await response.json();
    const coords = collectGeojsonCoords(geojson);
    const value = coords.length
      ? { coords, grid: buildGrid(coords) }
      : null;

    routeCache.set(key, value);
    return value;
  }

  function buildRuns(flags) {
    const runs = [];
    let start = null;
    let gap = 0;

    for (let index = 0; index < flags.length; index += 1) {
      if (flags[index]) {
        if (start == null) start = index;
        gap = 0;
      } else if (start != null && gap < 2) {
        gap += 1;
      } else if (start != null) {
        const end = index - gap - 1;
        if (end - start + 1 >= MIN_RUN_POINTS) {
          runs.push({ start, end });
        }
        start = null;
        gap = 0;
      }
    }

    if (start != null) {
      const end = flags.length - gap - 1;
      if (end - start + 1 >= MIN_RUN_POINTS) {
        runs.push({ start, end });
      }
    }

    return runs;
  }

  function runDistance(run, points) {
    return pathDistance(points.slice(run.start, run.end + 1));
  }

  function candidatePaths(runs, points) {
    return runs
      .map(run => points.slice(run.start, run.end + 1))
      .filter(path => path.length >= 2)
      .map(path => reducePath(path, MAX_ROUTE_PATH_POINTS));
  }

  async function scoreOneRoute(route, sampledPoints) {
    const routeData = await loadRoute(route.number);
    if (!routeData) return null;

    const flags = sampledPoints.map(point =>
      nearbyDistance(point, routeData.grid) <= MATCH_METERS
    );

    const runs = buildRuns(flags);
    if (!runs.length) return null;

    const distances = runs.map(run => runDistance(run, sampledPoints));
    const totalMeters = distances.reduce((sum, value) => sum + value, 0);

    if (totalMeters < 800) return null;

    const strongestMeters = Math.max(...distances);
    const acceptedRuns = runs.filter((run, index) =>
      distances[index] >= Math.max(800, strongestMeters * 0.18)
    );

    if (!acceptedRuns.length) return null;

    const acceptedMeters = acceptedRuns.reduce(
      (sum, run) => sum + runDistance(run, sampledPoints),
      0
    );

    const firstIndex = Math.min(...acceptedRuns.map(run => run.start));
    const lastIndex = Math.max(...acceptedRuns.map(run => run.end));
    const defaultChecked = acceptedMeters / 1000 >= STRONG_DISTANCE_KM;

    return {
      id: `candidate-${route.number}-${Date.now()}-${Math.random()
        .toString(36).slice(2, 7)}`,
      routeNumber: String(route.number),
      originalRouteNumber: String(route.number),
      start: route.start || "",
      end: route.end || "",
      firstIndex,
      lastIndex,
      estimatedKm: acceptedMeters / 1000,
      checked: defaultChecked,
      manual: false,
      warning: defaultChecked
        ? ""
        : "短い一致です。重複・交差・近接候補として未選択にしています。",
      confirmedPaths: candidatePaths(acceptedRuns, sampledPoints)
    };
  }

  function ensureMap() {
    if (map) return;

    map = L.map("semiRouteMap").setView([43.2, 142.4], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
  }

  function drawBaseGpx() {
    ensureMap();

    if (baseLayer) {
      map.removeLayer(baseLayer);
      baseLayer = null;
    }

    if (!latestGpxPoints.length) return;

    baseLayer = L.polyline(
      latestGpxPoints.map(point => [point.lat, point.lng]),
      {
        color: "#64748b",
        weight: 4,
        opacity: 0.78
      }
    ).addTo(map);

    const bounds = baseLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [18, 18] });
    }

    setTimeout(() => map.invalidateSize(), 0);
  }

  function clearSelectedLayer() {
    if (selectedLayer) {
      map.removeLayer(selectedLayer);
      selectedLayer = null;
    }
  }

  function showCandidate(candidateId) {
    const candidate = candidates.find(item => item.id === candidateId);
    if (!candidate) return;

    ensureMap();
    clearSelectedLayer();

    const group = L.featureGroup();

    (candidate.confirmedPaths || []).forEach(path => {
      if (!Array.isArray(path) || path.length < 2) return;
      L.polyline(path, {
        color: "#dc2626",
        weight: 9,
        opacity: 0.92
      }).addTo(group);
    });

    if (group.getLayers().length) {
      selectedLayer = group.addTo(map);
      const bounds = group.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    } else if (baseLayer) {
      map.fitBounds(baseLayer.getBounds(), { padding: [18, 18] });
    }

    document
      .querySelectorAll(".semi-route-card")
      .forEach(card => card.classList.remove("active"));

    const card = document.querySelector(
      `.semi-route-card[data-candidate-id="${CSS.escape(candidateId)}"]`
    );
    if (card) card.classList.add("active");

    mapGuide.textContent =
      `赤線：国道${candidate.routeNumber}号として拾った区間。` +
      `灰色：GPX全体。`;
  }

  function routeOptions(selectedNumber) {
    return allRoutes
      .map(route => {
        const number = String(route.number);
        const selected =
          number === String(selectedNumber) ? " selected" : "";
        return (
          `<option value="${esc(number)}"${selected}>` +
          `国道${esc(number)}号</option>`
        );
      })
      .join("");
  }

  function renderCandidates() {
    results.replaceChildren();

    if (!candidates.length) {
      results.innerHTML =
        '<div class="semi-empty">候補がありません。国道を手動追加してください。</div>';
      return;
    }

    candidates
      .sort((a, b) => {
        if (a.firstIndex !== b.firstIndex) {
          return a.firstIndex - b.firstIndex;
        }
        return Number(a.routeNumber) - Number(b.routeNumber);
      })
      .forEach((candidate, index) => {
        const card = document.createElement("div");
        card.className = "semi-route-card";
        card.dataset.candidateId = candidate.id;

        card.innerHTML =
          `<div class="semi-route-head">` +
            `<span class="semi-order">${index + 1}</span>` +
            `<input class="semi-route-check" type="checkbox" ` +
              `${candidate.checked ? "checked" : ""} ` +
              `aria-label="この国道を保存">` +
            `<select class="semi-route-select" aria-label="国道番号を修正">` +
              routeOptions(candidate.routeNumber) +
            `</select>` +
          `</div>` +
          `<p class="semi-route-meta">` +
            `推定走行 約${candidate.estimatedKm.toFixed(1)}km` +
            (candidate.start || candidate.end
              ? ` ／ ${esc(candidate.start)}－${esc(candidate.end)}`
              : "") +
          `</p>` +
          (candidate.warning
            ? `<div class="semi-warning">${esc(candidate.warning)}</div>`
            : "") +
          `<div class="semi-route-actions">` +
            `<button class="semi-show-button" type="button">地図で表示</button>` +
            `<button class="semi-delete-button" type="button">候補から削除</button>` +
          `</div>`;

        const check = card.querySelector(".semi-route-check");
        const select = card.querySelector(".semi-route-select");
        const showButton = card.querySelector(".semi-show-button");
        const deleteButton = card.querySelector(".semi-delete-button");

        check.addEventListener("change", () => {
          candidate.checked = check.checked;
          updateSummary();
        });

        select.addEventListener("change", () => {
          candidate.routeNumber = select.value;
          candidate.checked = true;
          check.checked = true;
          updateSummary();
        });

        showButton.addEventListener("click", () => {
          showCandidate(candidate.id);
        });

        deleteButton.addEventListener("click", () => {
          candidates = candidates.filter(item => item.id !== candidate.id);
          clearSelectedLayer();
          renderCandidates();
          updateSummary();
        });

        results.appendChild(card);
      });
  }

  function updateSummary() {
    const checkedCount = candidates.filter(item => item.checked).length;
    const uncertainCount = candidates.filter(item => !item.checked).length;

    summary.innerHTML =
      `<strong>候補 ${candidates.length}路線</strong> ／ ` +
      `保存予定 ${checkedCount}路線 ／ ` +
      `未選択 ${uncertainCount}路線`;

    nextStep.textContent = candidates.length
      ? "次は：不要な候補を外し、足りない国道だけ追加して保存"
      : "次は：国道を手動追加";
  }

  async function judgeRoutes() {
    if (busy) return;
    busy = true;

    status.textContent = "GPXを読み込んでいます…";
    summary.textContent = "";
    results.replaceChildren();
    saveStatus.textContent = "";
    candidates = [];
    clearSelectedLayer();

    try {
      const gpxBundle = await readGpxFiles();
      latestGpxPoints = gpxBundle.points;
      proposeNewTrip(gpxBundle);
      populateExistingTrips();
      latestSampledPoints = sampleEvenly(
        latestGpxPoints,
        MAX_GPX_SAMPLES
      );

      drawBaseGpx();
      mapGuide.textContent =
        `GPX ${latestGpxPoints.length.toLocaleString()}点を表示。` +
        `${latestSampledPoints.length}点へ間引いて候補を作ります。`;

      allRoutes = await loadRoutes();

      for (let index = 0; index < allRoutes.length; index += 1) {
        const route = allRoutes[index];
        status.textContent =
          `候補判定中… ${index + 1}/${allRoutes.length} ` +
          `（国道${route.number}号）`;

        const candidate = await scoreOneRoute(
          route,
          latestSampledPoints
        );

        if (candidate) candidates.push(candidate);

        // 長い同期処理を避け、画面を更新する。
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      renderCandidates();
      updateSummary();

      status.textContent =
        `簡易判定が完了しました。` +
        `${candidates.length}路線を時系列順に表示しています。`;

      saveButton.disabled = false;
    } catch (error) {
      console.error(error);
      status.textContent =
        `判定を完了できませんでした：${error.message || error}`;
      results.innerHTML =
        '<div class="semi-empty">GPXやローカルサーバーの状態を確認してください。</div>';
      saveButton.disabled = true;
    } finally {
      busy = false;
    }
  }

  function addManualRoute() {
    if (!allRoutes.length) {
      status.textContent =
        "先にGPXを読み込んで候補を作成してください。";
      return;
    }

    const existingNumbers = new Set(
      candidates.map(item => String(item.routeNumber))
    );

    const firstAvailable =
      allRoutes.find(route =>
        !existingNumbers.has(String(route.number))
      ) || allRoutes[0];

    candidates.push({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      routeNumber: String(firstAvailable.number),
      originalRouteNumber: "",
      start: firstAvailable.start || "",
      end: firstAvailable.end || "",
      firstIndex: candidates.length
        ? Math.max(...candidates.map(item => item.lastIndex || 0)) + 1
        : 0,
      lastIndex: candidates.length
        ? Math.max(...candidates.map(item => item.lastIndex || 0)) + 1
        : 0,
      estimatedKm: 0,
      checked: true,
      manual: true,
      warning: "手動追加した国道です。",
      confirmedPaths: []
    });

    renderCandidates();
    updateSummary();
  }

  function tripSignature(trip) {
    return JSON.stringify({
      id: String(trip.id || ""),
      tripName: String(trip.tripName || ""),
      startDate: String(trip.startDate || ""),
      endDate: String(trip.endDate || "")
    });
  }

  function createTripId() {
    return (
      "trip-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 9)
    );
  }

  function sortedTripsWithOriginalIndex(trips) {
    return trips
      .map((trip, originalIndex) => ({ trip, originalIndex }))
      .sort((a, b) =>
        String(
          b.trip.startDate ||
          b.trip.endDate ||
          ""
        ).localeCompare(
          String(
            a.trip.startDate ||
            a.trip.endDate ||
            ""
          )
        )
      );
  }

  function populateExistingTrips() {
    if (!TripData || typeof TripData.readTrips !== "function") return;

    const read = TripData.readTrips();
    existingTripSelect.innerHTML =
      '<option value="">既存Tripを選択</option>';

    if (!read.ok) return;

    sortedTripsWithOriginalIndex(read.trips).forEach(item => {
      const option = document.createElement("option");
      option.value = String(item.originalIndex);
      option.textContent =
        `${item.trip.startDate || "日付未登録"}　` +
        `${item.trip.tripName || "名称未登録"}`;
      existingTripSelect.appendChild(option);
    });
  }

  function currentSaveMode() {
    return saveModeExisting.checked ? "existing" : "new";
  }

  function resetSaveTargetToNew() {
    saveModeNew.checked = true;
    saveModeExisting.checked = false;
    existingTripConfirm.checked = false;
    existingTripSelect.value = "";
    updateSaveTargetUi();
  }

  function updateSaveTargetUi() {
    const existing = currentSaveMode() === "existing";
    newTripFields.hidden = existing;
    existingTripFields.hidden = !existing;

    if (existing) {
      const option =
        existingTripSelect.options[existingTripSelect.selectedIndex];
      const label =
        option && option.value
          ? option.textContent
          : "既存Tripが未選択";

      saveTargetSummary.textContent =
        `保存先：既存Tripへ追記 ／ ${label}`;

      saveButton.textContent =
        "確認した既存Tripへ追記";
    } else {
      const name =
        newTripName.value.trim() || "Trip名未入力";
      const date =
        newTripStartDate.value || "日付未入力";

      saveTargetSummary.textContent =
        `保存先：新しいTrip ／ ${date} ／ ${name}`;

      saveButton.textContent =
        "新しいTripとして保存";
    }
  }

  function validateNewTrip(read) {
    const name = newTripName.value.trim();
    const startDate = newTripStartDate.value;
    const endDate = newTripEndDate.value || startDate;

    if (!name) {
      return { ok: false, error: "新しいTrip名を入力してください。" };
    }

    if (!startDate) {
      return { ok: false, error: "新しいTripの出発日を入力してください。" };
    }

    const duplicate = read.trips.find(trip =>
      String(trip.tripName || "").trim() === name &&
      String(trip.startDate || "") === startDate
    );

    if (duplicate) {
      return {
        ok: false,
        error:
          "同じTrip名・出発日のTripがすでにあります。上書き防止のため保存を中止しました。既存Tripへ追記する場合は「既存Tripへ追記」を明示的に選んでください。"
      };
    }

    return {
      ok: true,
      trip: {
        id: createTripId(),
        schemaVersion: 2,
        tripName: name,
        startDate,
        endDate,
        routes: "",
        routeSegments: [],
        actionLog: "",
        impressions: "",
        articleIdeas: "",
        noteUrl: "",
        memo:
          "帰宅後まとめで新規作成。走行国道はGPX簡易判定で確定。"
      }
    };
  }

  function validateExistingTrip(read) {
    if (!existingTripSelect.value) {
      return {
        ok: false,
        error: "追記する既存Tripを選択してください。"
      };
    }

    if (!existingTripConfirm.checked) {
      return {
        ok: false,
        error:
          "既存Tripへの追記確認にチェックを入れてください。"
      };
    }

    const index = Number(existingTripSelect.value);
    if (!Number.isInteger(index) || !read.trips[index]) {
      return {
        ok: false,
        error: "追記先Tripを特定できませんでした。"
      };
    }

    return {
      ok: true,
      tripIndex: index,
      trip: read.trips[index]
    };
  }

  function checkedCandidates() {
    const mapByNumber = new Map();

    candidates
      .filter(item => item.checked)
      .forEach(item => {
        const number = String(Number(item.routeNumber));
        if (!number || number === "NaN") return;

        if (!mapByNumber.has(number)) {
          mapByNumber.set(number, {
            ...item,
            routeNumber: number,
            confirmedPaths: []
          });
        }

        const target = mapByNumber.get(number);
        target.confirmedPaths.push(
          ...(Array.isArray(item.confirmedPaths)
            ? item.confirmedPaths
            : [])
        );

        target.firstIndex = Math.min(
          target.firstIndex,
          item.firstIndex
        );
      });

    return [...mapByNumber.values()].sort(
      (a, b) => a.firstIndex - b.firstIndex
    );
  }

  function buildSegmentsForAccepted(accepted) {
    return accepted.map(item => {
      const longestPath = [...item.confirmedPaths]
        .filter(path => Array.isArray(path) && path.length >= 2)
        .sort((a, b) => b.length - a.length)[0] || [];

      return {
        id:
          typeof TripData.createSegmentId === "function"
            ? TripData.createSegmentId()
            : `segment-${Date.now()}-${item.routeNumber}`,
        routeNumber: item.routeNumber,
        status: "partial",
        startPoint: null,
        endPoint: null,
        confirmedPaths: item.confirmedPaths,
        confirmedPath: longestPath
      };
    });
  }

  function mergeSegmentsWithoutOverwrite(existingSegments, newSegments) {
    const merged = Array.isArray(existingSegments)
      ? existingSegments.slice()
      : [];

    newSegments.forEach(newSegment => {
      const sameRouteIndexes = [];

      merged.forEach((segment, index) => {
        if (
          String(Number(segment.routeNumber)) ===
          String(Number(newSegment.routeNumber))
        ) {
          sameRouteIndexes.push(index);
        }
      });

      if (!sameRouteIndexes.length) {
        merged.push(newSegment);
        return;
      }

      // 同一路線でも既存記録を削除せず、新しい実走区間を別セグメントとして追加する。
      merged.push(newSegment);
    });

    return merged;
  }

  function saveToTrip() {
    saveStatus.textContent = "";

    if (!TripData || typeof TripData.readTrips !== "function") {
      saveStatus.textContent = "Tripデータ機能を読み込めません。";
      return;
    }

    const read = TripData.readTrips();
    if (!read.ok) {
      saveStatus.textContent =
        "保存済みTripを読み込めないため、保存を中止しました。";
      return;
    }

    const accepted = checkedCandidates();
    if (!accepted.length) {
      saveStatus.textContent =
        "保存する国道にチェックを入れてください。";
      return;
    }

    const newSegments = buildSegmentsForAccepted(accepted);
    const mode = currentSaveMode();
    let nextTrips;
    let savedTripName;

    if (mode === "new") {
      const validated = validateNewTrip(read);
      if (!validated.ok) {
        saveStatus.textContent = validated.error;
        return;
      }

      const newTrip = {
        ...validated.trip,
        routeSegments: newSegments
      };

      nextTrips = [...read.trips, newTrip];
      savedTripName = newTrip.tripName;
    } else {
      const validated = validateExistingTrip(read);
      if (!validated.ok) {
        saveStatus.textContent = validated.error;
        return;
      }

      const nextSegments = mergeSegmentsWithoutOverwrite(
        validated.trip.routeSegments,
        newSegments
      );

      nextTrips = read.trips.map((trip, index) =>
        index === validated.tripIndex
          ? {
              ...trip,
              routeSegments: nextSegments
            }
          : trip
      );

      savedTripName =
        validated.trip.tripName || "既存Trip";
    }

    const saved = TripData.saveTrips(nextTrips);
    if (!saved.ok) {
      saveStatus.textContent =
        saved.error || "Tripを保存できませんでした。";
      return;
    }

    saveStatus.textContent =
      mode === "new"
        ? `新しいTrip「${savedTripName}」を作成し、${accepted.length}路線を保存しました。`
        : `既存Trip「${savedTripName}」へ、既存記録を残したまま${accepted.length}路線を追記しました。`;

    const savedActions = document.getElementById("savedTripActions");
    if (savedActions) savedActions.style.display = "flex";

    nextStep.textContent =
      "保存完了：Trip確認・修正で内容を確認";
    nextStep.classList.add("done");

    populateExistingTrips();
    existingTripConfirm.checked = false;
  }

  analyzeButton.addEventListener("click", () => {
    window.setTimeout(judgeRoutes, 50);
  });

  rerunButton.addEventListener("click", judgeRoutes);
  addManualButton.addEventListener("click", addManualRoute);
  saveButton.addEventListener("click", saveToTrip);

  saveModeNew.addEventListener("change", updateSaveTargetUi);
  saveModeExisting.addEventListener("change", updateSaveTargetUi);
  newTripName.addEventListener("input", updateSaveTargetUi);
  newTripStartDate.addEventListener("change", updateSaveTargetUi);
  newTripEndDate.addEventListener("change", updateSaveTargetUi);
  existingTripSelect.addEventListener("change", () => {
    existingTripConfirm.checked = false;
    updateSaveTargetUi();
  });
  existingTripConfirm.addEventListener("change", updateSaveTargetUi);

  gpxInput.addEventListener("change", () => {
    // 別GPXを選んだ時点で、既存Trip追記モードを解除する。
    resetSaveTargetToNew();
    saveStatus.textContent = "";
  });

  populateExistingTrips();
  updateSaveTargetUi();

  screenshotInput.addEventListener("change", () => {
    if (screenshotUrl) {
      URL.revokeObjectURL(screenshotUrl);
      screenshotUrl = null;
    }

    const file = files(screenshotInput)[0];
    if (!file) {
      screenshotPreview.hidden = true;
      screenshotPreview.removeAttribute("src");
      return;
    }

    screenshotUrl = URL.createObjectURL(file);
    screenshotPreview.src = screenshotUrl;
    screenshotPreview.hidden = false;
  });

  saveButton.disabled = true;
})();
