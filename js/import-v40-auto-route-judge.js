(function () {
  "use strict";

  const button = document.getElementById("autoRouteJudgeButton");
  const status = document.getElementById("autoRouteJudgeStatus");
  const summary = document.getElementById("autoRouteJudgeSummary");
  const results = document.getElementById("autoRouteJudgeResults");
  const gpxInput = document.getElementById("gpxFiles");
  const audioInput = document.getElementById("audioFiles");
  const tripSelect = document.getElementById("targetTripSelect");
  const saveButton = document.getElementById("saveAutoRouteJudgeButton");
  const saveStatus = document.getElementById("autoRouteSaveStatus");
  const TripData = window.Hokkaido48TripData;

  if (!button || !status || !summary || !results || !gpxInput || !audioInput || !saveButton || !saveStatus) return;

  const ROUTE_GRID_DEG = 0.002;
  const MATCH_METERS = 150;
  const SOFT_MATCH_METERS = 320;
  const PATH_MATCH_METERS = 350;
  const MAX_GPX_SAMPLES = 900;
  const MAX_PATH_POINTS = 1200;
  const routeCache = new Map();
  let latestJudgement = null;

  function files(input) { return Array.from(input.files || []); }
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function haversine(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad;
    const lat2 = b.lat * rad;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function sampleEvenly(points, maxCount) {
    if (points.length <= maxCount) return points.slice();
    const out = [];
    for (let i = 0; i < maxCount; i += 1) {
      out.push(points[Math.round(i * (points.length - 1) / (maxCount - 1))]);
    }
    return out;
  }

  async function parseGpx(file) {
    const text = await file.text();
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error(`${file.name}: GPX解析エラー`);
    return Array.from(xml.querySelectorAll("trkpt, rtept")).map(node => ({
      lat: Number(node.getAttribute("lat")),
      lng: Number(node.getAttribute("lon")),
      time: node.querySelector("time") ? node.querySelector("time").textContent : null
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  function collectGeojsonCoords(geojson) {
    const out = [];
    function walk(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
        out.push({ lat: value[1], lng: value[0] });
        return;
      }
      value.forEach(walk);
    }
    if (geojson && Array.isArray(geojson.features)) {
      geojson.features.forEach(f => f && f.geometry && walk(f.geometry.coordinates));
    } else if (geojson && geojson.geometry) {
      walk(geojson.geometry.coordinates);
    }
    return out;
  }

  function gridKey(lat, lng) {
    return `${Math.floor(lat / ROUTE_GRID_DEG)}:${Math.floor(lng / ROUTE_GRID_DEG)}`;
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
        const bucket = grid.get(`${latCell + dy}:${lngCell + dx}`) || [];
        for (const candidate of bucket) {
          const d = haversine(point, candidate);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }


  function nearestRouteMatch(point, indexedGrid) {
    const latCell = Math.floor(point.lat / ROUTE_GRID_DEG);
    const lngCell = Math.floor(point.lng / ROUTE_GRID_DEG);
    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const bucket = indexedGrid.get(`${latCell + dy}:${lngCell + dx}`) || [];
        for (const candidate of bucket) {
          const distance = haversine(point, candidate);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = Number(candidate.routeIndex);
          }
        }
      }
    }

    return {
      distance: bestDistance,
      routeIndex: Number.isInteger(bestIndex) ? bestIndex : -1
    };
  }

  function cumulativeDistances(points) {
    const out = [0];
    for (let index = 1; index < points.length; index += 1) {
      out.push(out[index - 1] + haversine(points[index - 1], points[index]));
    }
    return out;
  }

  function percentile(values, ratio) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = Math.max(
      0,
      Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio))
    );
    return sorted[position];
  }

  async function loadRoutes() {
    const response = await fetch("data/routes.json", { cache: "no-store" });
    if (!response.ok) throw new Error("routes.jsonを読み込めませんでした。");
    return response.json();
  }

  async function loadRoute(number) {
    if (routeCache.has(number)) return routeCache.get(number);
    const path = `data/geojson/route_${String(number).padStart(3, "0")}.geojson`;
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) return null;
    const geojson = await response.json();
    const coords = collectGeojsonCoords(geojson);
    const indexedCoords = coords.map((point, routeIndex) => ({
      ...point,
      routeIndex
    }));
    const value = {
      coords,
      grid: buildGrid(coords),
      indexedGrid: buildGrid(indexedCoords)
    };
    routeCache.set(number, value);
    return value;
  }

  async function readTranscriptText() {
    const textFiles = files(audioInput).filter(file => file.name.toLowerCase().endsWith(".txt") || file.type === "text/plain");
    const chunks = [];
    for (const file of textFiles) chunks.push(await file.text());
    return chunks.join("\n");
  }

  function transcriptEvidence(text, route) {
    const number = String(route.number);
    const explicitPatterns = [
      new RegExp(`国道\\s*${number}\\s*号?`, "g"),
      new RegExp(`(?:R|Ｒ|Route|ルート)\\s*${number}(?!\\d)`, "gi")
    ];
    let explicit = 0;
    explicitPatterns.forEach(re => { explicit += (text.match(re) || []).length; });
    const places = [route.start, route.end].filter(Boolean);
    const placeHits = places.filter(place => text.includes(String(place).replace(/[市町村]$/, "")));
    return { explicit, placeHits };
  }

  function longestRun(flags) {
    let best = 0;
    let current = 0;
    flags.forEach(flag => {
      current = flag ? current + 1 : 0;
      if (current > best) best = current;
    });
    return best;
  }

  function buildMatchedChunks(routeData, gpxPoints) {
    const routeCoords = routeData.coords;
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return [];

    const cumulative = cumulativeDistances(routeCoords);
    const observations = [];

    gpxPoints.forEach((gpxPoint, gpxIndex) => {
      const match = nearestRouteMatch(gpxPoint, routeData.indexedGrid);
      if (
        match.routeIndex >= 0 &&
        Number.isFinite(match.distance) &&
        match.distance <= PATH_MATCH_METERS
      ) {
        observations.push({
          gpxIndex,
          routeIndex: match.routeIndex,
          distance: match.distance
        });
      }
    });

    if (observations.length < 3) return [];

    // GPX走行順を基準に「同じ国道を連続して走ったまとまり」へ分割する。
    // 交差点で一瞬近づいただけの別区間や、大きなジャンプをつながない。
    const runs = [];
    let current = [observations[0]];

    for (let index = 1; index < observations.length; index += 1) {
      const previous = current[current.length - 1];
      const next = observations[index];

      const gpxIndexGap = next.gpxIndex - previous.gpxIndex;
      const routeDistanceJump = Math.abs(
        cumulative[next.routeIndex] - cumulative[previous.routeIndex]
      );
      const gpxDirectDistance = haversine(
        gpxPoints[previous.gpxIndex],
        gpxPoints[next.gpxIndex]
      );

      const allowedRouteJump = Math.min(
        15000,
        Math.max(3000, gpxDirectDistance * 4 + 2000)
      );

      if (
        gpxIndexGap <= 10 &&
        routeDistanceJump <= allowedRouteJump
      ) {
        current.push(next);
      } else {
        if (current.length >= 3) runs.push(current);
        current = [next];
      }
    }

    if (current.length >= 3) runs.push(current);
    if (!runs.length) return [];

    // 各走行まとまりを国道GeoJSON上の連続区間へ変換。
    // 端の単発誤一致を避けるため2%だけトリムする。
    const intervals = [];

    runs.forEach(run => {
      const indices = run.map(item => item.routeIndex);
      const low = percentile(indices, 0.02);
      const high = percentile(indices, 0.98);

      if (!Number.isInteger(low) || !Number.isInteger(high)) return;

      const startIndex = Math.min(low, high);
      const endIndex = Math.max(low, high);
      const spanMeters = cumulative[endIndex] - cumulative[startIndex];

      if (run.length >= 3 && spanMeters >= 800) {
        intervals.push({
          startIndex,
          endIndex,
          evidenceCount: run.length
        });
      }
    });

    if (!intervals.length) return [];

    // 同じ国道上で重なる区間、または1.5km以内の短い判定抜けだけを結合。
    // 離れた区間は別々のconfirmedPathsとして保持し、間を水色で結ばない。
    intervals.sort((a, b) => a.startIndex - b.startIndex);
    const merged = [];

    intervals.forEach(interval => {
      const previous = merged[merged.length - 1];

      if (!previous) {
        merged.push({ ...interval });
        return;
      }

      const roadGapMeters = interval.startIndex <= previous.endIndex
        ? 0
        : cumulative[interval.startIndex] - cumulative[previous.endIndex];

      if (
        interval.startIndex <= previous.endIndex ||
        roadGapMeters <= 1500
      ) {
        previous.endIndex = Math.max(previous.endIndex, interval.endIndex);
        previous.evidenceCount += interval.evidenceCount;
      } else {
        merged.push({ ...interval });
      }
    });

    // 極端に弱い単発区間を除外。
    const strongestEvidence = Math.max(
      ...merged.map(interval => interval.evidenceCount)
    );

    const accepted = merged.filter(interval =>
      interval.evidenceCount >= Math.max(3, strongestEvidence * 0.15)
    );

    let paths = accepted.map(interval =>
      routeCoords
        .slice(interval.startIndex, interval.endIndex + 1)
        .map(point => [point.lat, point.lng])
    ).filter(path => path.length >= 2);

    // 保存量を抑える。複数区間全体で最大MAX_PATH_POINTS点。
    const totalPoints = paths.reduce((sum, path) => sum + path.length, 0);

    if (totalPoints > MAX_PATH_POINTS) {
      const ratio = MAX_PATH_POINTS / totalPoints;
      paths = paths.map(path =>
        sampleEvenly(path, Math.max(2, Math.round(path.length * ratio)))
      );
    }

    return paths;
  }

  async function scoreRoute(route, gpxPoints, gpxGrid, transcriptText) {
    const routeData = await loadRoute(route.number);
    if (!routeData || !routeData.coords.length) return null;

    const distances = gpxPoints.map(point => nearbyDistance(point, routeData.grid));
    const hardFlags = distances.map(d => d <= MATCH_METERS);
    const softFlags = distances.map(d => d <= SOFT_MATCH_METERS);
    const hard = hardFlags.filter(Boolean).length;
    const soft = softFlags.filter(Boolean).length;
    const maxRun = longestRun(hardFlags);
    const evidence = transcriptEvidence(transcriptText, route);
    const gpxScore = Math.min(78, hard * 1.5 + soft * 0.3 + maxRun * 2.0);
    const textScore = Math.min(22, evidence.explicit * 11 + evidence.placeHits.length * 2.0);
    const score = Math.round(Math.min(100, gpxScore + textScore));

    // 大まかなルート記録を優先。GPXに連続一致があれば自動採用候補にする。
    let confidence = "除外";
    // 自動採用はGPXの連続一致を必須とする。
    // 地名だけ一致する路線（例: 留萌市→国道239号）は採用しない。
    if ((hard >= 7 && maxRun >= 4) || (hard >= 4 && maxRun >= 3 && evidence.explicit > 0)) {
      confidence = "自動採用候補";
    } else {
      confidence = "除外";
    }

    const matchedChunks = confidence === "除外" ? [] : buildMatchedChunks(routeData, gpxPoints);

    return {
      number: String(route.number), start: route.start, end: route.end,
      hard, soft, maxRun, score, confidence,
      explicitMentions: evidence.explicit, placeHits: evidence.placeHits,
      matchedChunks
    };
  }


  function render(items, gpxCount, textLength) {
    const auto = items
      .filter(item => item.confidence === "自動採用候補")
      .sort((a, b) => b.score - a.score);

    summary.innerHTML = `<p><strong>解析結果：</strong> GPX ${gpxCount.toLocaleString("ja-JP")}点／文字起こし ${textLength.toLocaleString("ja-JP")}文字</p>` +
      `<p><strong>走行国道 ${auto.length}路線を自動判定しました。</strong> 大まかな実走ルートを優先し、低確信候補は通常画面には表示しません。</p>`;

    if (!auto.length) {
      results.innerHTML = "<p>走行国道を自動判定できませんでした。</p>";
      return;
    }

    results.innerHTML = auto.map(item => {
      const badge = "✅ 自動判定";
      const textEvidence = item.explicitMentions
        ? `TXT国道番号 ${item.explicitMentions}回`
        : (item.placeHits.length ? `TXT地名 ${item.placeHits.join("・")}` : "TXT直接根拠なし");
      const pathPoints = item.matchedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      return `<div style="padding:10px 12px;margin:8px 0;border:1px solid #c8d2ea;border-radius:8px;background:#fff;">` +
        `<strong>${badge}　国道${esc(item.number)}号</strong>　${esc(item.start)}－${esc(item.end)}<br>` +
        `<span>スコア ${item.score} ／ GPX近接 ${item.hard}点 ／ 連続一致 ${item.maxRun}点 ／ 連続推定区間 ${pathPoints}点 ／ ${esc(textEvidence)}</span>` +
        `</div>`;
    }).join("");
  }

  function tripSignature(trip) {
    return JSON.stringify({
      tripName: String(trip.tripName || ""),
      startDate: String(trip.startDate || ""),
      endDate: String(trip.endDate || ""),
      routes: String(trip.routes || "")
    });
  }

  function saveJudgementToTrip() {
    saveStatus.textContent = "Tripへの確定処理を開始しました…";

    try {
      if (!latestJudgement || !latestJudgement.length) {
        saveStatus.textContent = "先にGPX＋TXTで走行国道を自動判定してください。";
        return;
      }

      if (!TripData || typeof TripData.readTrips !== "function" || typeof TripData.saveTrips !== "function") {
        saveStatus.textContent = "Tripデータ保存機能を読み込めませんでした。";
        return;
      }

      if (!tripSelect || tripSelect.value === "") {
        saveStatus.textContent = "上の「対象Tripを確認する」で対象Tripを選択してください。";
        return;
      }

      const read = TripData.readTrips();
      if (!read.ok || !Array.isArray(read.trips) || !read.trips.length) {
        saveStatus.textContent = "保存済みTripを読み込めませんでした。";
        return;
      }

      const sorted = [...read.trips].sort((a, b) =>
        String(b.startDate || b.endDate || "").localeCompare(String(a.startDate || a.endDate || ""))
      );
      const selected = sorted[Number(tripSelect.value)];
      if (!selected) {
        saveStatus.textContent = "対象Tripを特定できませんでした。";
        return;
      }

      const selectedId = selected.id ? String(selected.id) : "";
      const selectedSig = tripSignature(selected);
      const index = read.trips.findIndex(trip => selectedId
        ? String(trip.id || "") === selectedId
        : tripSignature(trip) === selectedSig
      );

      if (index < 0) {
        saveStatus.textContent = "対象Tripを特定できませんでした。";
        return;
      }

      const judgementMap = new Map(
        latestJudgement.map(item => [String(Number(item.number)), item])
      );
      const acceptedNumbers = new Set(judgementMap.keys());
      const existingSegments = Array.isArray(read.trips[index].routeSegments)
        ? read.trips[index].routeSegments
        : [];

      function confirmedPathsFor(item) {
        return (Array.isArray(item.matchedChunks) ? item.matchedChunks : [])
          .filter(path => Array.isArray(path) && path.length >= 2)
          .map(path => path.map(point => [Number(point[0]), Number(point[1])]));
      }

      function longestConfirmedPath(item) {
        return confirmedPathsFor(item)
          .sort((a, b) => b.length - a.length)[0] || [];
      }

      // 既存の走行順を優先し、自動判定された6路線だけ正式データとして残す。
      const nextSegments = [];
      const used = new Set();

      existingSegments.forEach(segment => {
        const number = String(Number(segment.routeNumber || ""));
        if (!acceptedNumbers.has(number) || used.has(number)) return;

        const item = judgementMap.get(number);
        const isComplete = segment.status === "complete";

        nextSegments.push({
          ...segment,
          routeNumber: number,
          status: isComplete ? "complete" : "partial",
          confirmedPaths: isComplete ? [] : confirmedPathsFor(item),
          confirmedPath: isComplete ? [] : longestConfirmedPath(item)
        });
        used.add(number);
      });

      // 既存Tripに無かった自動判定路線は末尾へ追加。
      latestJudgement.forEach(item => {
        const number = String(Number(item.number));
        if (used.has(number)) return;

        nextSegments.push({
          id: `segment-auto-${number}-${Date.now()}`,
          routeNumber: number,
          status: "partial",
          startPoint: null,
          endPoint: null,
          confirmedPaths: confirmedPathsFor(item),
          confirmedPath: longestConfirmedPath(item)
        });
        used.add(number);
      });

      const payload = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        source: "GPX＋文字起こし自動走行判定",
        policy: "coarse-route-first",
        autoAccepted: latestJudgement,
        needsReview: []
      };

      read.trips[index] = {
        ...read.trips[index],
        updatedAt: new Date().toISOString(),
        routes: nextSegments.map(segment => segment.routeNumber).join(","),
        routeSegments: nextSegments,
        autoRouteJudgement: payload
      };

      const saved = TripData.saveTrips(read.trips);
      if (!saved.ok) {
        saveStatus.textContent = `Tripへの確定に失敗しました：${saved.error || "不明なエラー"}`;
        return;
      }

      const partialWithPath = nextSegments.filter(
        segment => segment.status === "partial" && (
          (Array.isArray(segment.confirmedPaths) &&
            segment.confirmedPaths.some(path => Array.isArray(path) && path.length >= 2)) ||
          (Array.isArray(segment.confirmedPath) && segment.confirmedPath.length >= 2)
        )
      ).length;

      saveStatus.textContent =
        `「${selected.tripName || "名称未登録"}」へ ${nextSegments.length}路線を正式確定しました。` +
        ` 一部走破区間 ${partialWithPath}路線を保存しました。`;
    } catch (error) {
      console.error("Trip確定保存エラー:", error);
      saveStatus.textContent = `Tripへの確定処理でエラーが発生しました：${error.message || error}`;
    }
  }

  async function run() {
    const gpxFiles = files(gpxInput);
    const textFiles = files(audioInput).filter(file => file.name.toLowerCase().endsWith(".txt") || file.type === "text/plain");
    if (!gpxFiles.length) { status.textContent = "GPXを選択してください。"; return; }
    if (!textFiles.length) { status.textContent = "文字起こしTXTも一緒に選択してください。"; return; }

    button.disabled = true;
    status.textContent = "GPXと文字起こしを照合しています…";
    summary.replaceChildren();
    results.replaceChildren();
    latestJudgement = null;

    try {
      let allPoints = [];
      for (const file of gpxFiles) allPoints = allPoints.concat(await parseGpx(file));
      const sampled = sampleEvenly(allPoints, MAX_GPX_SAMPLES);
      const gpxGrid = buildGrid(sampled);
      const transcriptText = await readTranscriptText();
      const routes = await loadRoutes();
      const scored = [];

      for (let i = 0; i < routes.length; i += 1) {
        status.textContent = `GPX＋TXT照合中… ${i + 1}/${routes.length}路線`;
        const item = await scoreRoute(routes[i], sampled, gpxGrid, transcriptText);
        if (item) scored.push(item);
      }

      latestJudgement = scored.filter(item => item.confidence === "自動採用候補" && item.hard >= 4 && item.maxRun >= 3);
      render(scored, allPoints.length, transcriptText.length);
      status.textContent = `自動判定が完了しました。走行国道 ${latestJudgement.length}路線を表示しています。`;
    } catch (error) {
      console.error("GPX＋TXT自動走行判定エラー:", error);
      status.textContent = `自動判定に失敗しました：${error.message || error}`;
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener("click", run);
  saveButton.addEventListener("click", saveJudgementToTrip);
})();
