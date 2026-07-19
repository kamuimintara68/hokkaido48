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

  function loadTripCandidates() {
    targetTripSelect.replaceChildren();
    savedTrips = [];
    confirmTripButton.disabled = true;
    resetTripPreview();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "関連付けるTripを選択";
    targetTripSelect.append(placeholder);

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
      tripSuggestion.textContent = "Trip入力画面で対象Tripを作成してから確認します。";
      return;
    }

    savedTrips.forEach((trip, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${trip.tripName || "名称未登録"}（${formatTripDates(trip)}）`;
      targetTripSelect.append(option);
    });

    const materialRange = getMaterialDateRange(latestAnalysis);
    const matches = savedTrips
      .map((trip, index) => ({ trip, index }))
      .filter(item => tripMatchesMaterialDates(item.trip, materialRange) === true);

    if (matches.length === 1) {
      targetTripSelect.value = String(matches[0].index);
      confirmTripButton.disabled = false;
      tripSuggestion.textContent = `素材の日付と一致する候補：${matches[0].trip.tripName || "名称未登録"}`;
    } else if (matches.length > 1) {
      tripSuggestion.textContent = "素材の日付と一致するTripが複数あります。一覧から対象を選んでください。";
    } else if (materialRange) {
      tripSuggestion.textContent = "素材の日付と一致するTripはありません。一覧から対象を確認してください。";
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
        characters: text.length
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
    routeLayer.clearLayers();
    photoLayer.clearLayers();
    resultArea.classList.add("hidden");
    targetTripSelect.value = "";
    confirmTripButton.disabled = true;
    resetTripPreview();
    tripSuggestion.textContent = "素材を読み取ると候補を確認できます。";
    updateSelections();
  }

  [gpxInput, audioInput, photoInput].forEach(input => {
    input.addEventListener("change", updateSelections);
  });

  analyzeButton.addEventListener("click", analyzeMaterials);
  clearButton.addEventListener("click", clearSelections);
  targetTripSelect.addEventListener("change", () => {
    confirmTripButton.disabled = targetTripSelect.value === "";
    resetTripPreview();

    if (targetTripSelect.value !== "") {
      tripSuggestion.textContent = "選んだTripを「対象Tripを確認」で確認してください。";
    }
  });
  confirmTripButton.addEventListener("click", confirmTargetTrip);
  window.addEventListener("beforeunload", () => {
    photoObjectUrls.forEach(url => URL.revokeObjectURL(url));
  });

  updateSelections();
  loadTripCandidates();
})();
