"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";

  const fullRouteLayer = L.layerGroup().addTo(routeMap);
  const plannedLayer = L.layerGroup().addTo(routeMap);
  const actualLayer = L.layerGroup().addTo(routeMap);

  let comparisonMode = true;
  let drawToken = 0;

  function currentTrip() {
    const id = String(tripId.value || "");
    if (!id) return null;
    return TripData.getTrips().find(trip => String(trip.id || "") === id) || null;
  }

  function readActivePlanFallback() {
    try {
      const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
      if (!raw) return null;
      const plan = JSON.parse(raw);
      if (!plan || typeof plan !== "object") return null;

      const routeNumbers = Array.isArray(plan.routeNumbers)
        ? [...new Set(plan.routeNumbers.map(value => String(Number(value))).filter(Boolean))]
        : [];

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

      return routeNumbers.length ? {
        version: 0,
        planName: String(plan.planName || ""),
        routeNumbers,
        origin: String(plan.origin || ""),
        destination: String(plan.destination || ""),
        fullRouteSpec: String(plan.fullRouteSpec || ""),
        distanceKm: Number(
          (plan.plannedPreview && plan.plannedPreview.distanceKm) ||
          plan.guruRouteDistanceKm ||
          0
        ),
        plannedTrack,
        guidePoints,
        source: "active-plan-fallback"
      } : null;
    } catch {
      return null;
    }
  }

  function snapshotForTrip(trip) {
    if (
      trip &&
      trip.planSnapshot &&
      Array.isArray(trip.planSnapshot.routeNumbers) &&
      trip.planSnapshot.routeNumbers.length
    ) {
      return trip.planSnapshot;
    }

    // 旧Tripの補完は、現在のActive Planの予定路線とTrip路線に共通項がある場合のみ。
    const fallback = readActivePlanFallback();
    if (!fallback || !trip) return null;

    const tripNumbers = new Set(
      (trip.routeSegments || [])
        .map(segment => String(Number(segment.routeNumber || "")))
        .filter(Boolean)
    );

    const overlaps = fallback.routeNumbers.some(number => tripNumbers.has(String(number)));
    return overlaps ? fallback : null;
  }

  function insertLegend() {
    if (document.getElementById("tripCompareLegend")) return;

    const mapElement = document.getElementById("routeMap");
    if (!mapElement) return;

    const legend = document.createElement("div");
    legend.id = "tripCompareLegend";
    legend.style.display = "flex";
    legend.style.flexWrap = "wrap";
    legend.style.gap = "12px";
    legend.style.margin = "10px 0 0";
    legend.style.padding = "10px 12px";
    legend.style.borderRadius = "8px";
    legend.style.background = "#ffffff";
    legend.style.fontSize = "13px";
    legend.style.fontWeight = "700";

    const items = [
      ["#94a3b8", "国道全線"],
      ["#7c3aed", "走破予定"],
      ["#0284c7", "実走確定"],
      ["#16a34a", "全線走破"]
    ];

    items.forEach(([color, label]) => {
      const item = document.createElement("span");
      item.style.display = "inline-flex";
      item.style.alignItems = "center";
      item.style.gap = "6px";

      const line = document.createElement("span");
      line.style.display = "inline-block";
      line.style.width = "28px";
      line.style.height = "5px";
      line.style.borderRadius = "999px";
      line.style.background = color;

      item.append(line, document.createTextNode(label));
      legend.appendChild(item);
    });

    mapElement.insertAdjacentElement("afterend", legend);
  }

  function normalizePath(path) {
    return Array.isArray(path)
      ? path
          .filter(point => Array.isArray(point) && point.length >= 2)
          .map(point => [Number(point[0]), Number(point[1])])
          .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      : [];
  }

  function actualPaths(segment) {
    if (
      Array.isArray(segment.confirmedPaths) &&
      segment.confirmedPaths.some(path => Array.isArray(path) && path.length >= 2)
    ) {
      return segment.confirmedPaths
        .map(normalizePath)
        .filter(path => path.length >= 2);
    }

    const fallback = normalizePath(segment.confirmedPath);
    return fallback.length >= 2 ? [fallback] : [];
  }

  async function drawComparison(shouldFit = true) {
    if (!comparisonMode) return;

    const token = ++drawToken;
    const trip = currentTrip();
    if (!trip) return;

    const snapshot = snapshotForTrip(trip);
    const plannedNumbers = snapshot && Array.isArray(snapshot.routeNumbers)
      ? [...new Set(snapshot.routeNumbers.map(value => String(Number(value))).filter(Boolean))]
      : [...new Set(
          (trip.routeSegments || [])
            .map(segment => String(Number(segment.routeNumber || "")))
            .filter(Boolean)
        )];

    routeLayerGroup.clearLayers();
    selectedSectionLayerGroup.clearLayers();
    pointLayerGroup.clearLayers();
    candidateLayerGroup.clearLayers();

    fullRouteLayer.clearLayers();
    plannedLayer.clearLayers();
    actualLayer.clearLayers();

    const bounds = L.latLngBounds();

    for (const routeNumber of plannedNumbers) {
      try {
        const geojson = await loadRouteGeojson(routeNumber);
        if (token !== drawToken) return;

        const layer = L.geoJSON(geojson, {
          style: {
            color: "#94a3b8",
            weight: 6,
            opacity: 0.72
          },
          interactive: false
        }).addTo(fullRouteLayer);

        bounds.extend(layer.getBounds());
      } catch (error) {
        console.error(`国道${routeNumber}号 全線表示エラー:`, error);
      }
    }

    if (snapshot) {
      const plannedTrack = normalizePath(snapshot.plannedTrack);

      if (plannedTrack.length >= 2) {
        L.polyline(plannedTrack, {
          color: "#7c3aed",
          weight: 8,
          opacity: 0.88
        }).addTo(plannedLayer);
      } else {
        const guides = normalizePath(snapshot.guidePoints);
        if (guides.length >= 2) {
          // 旧データの暫定表示。今後はGuru起動時にplannedTrackが必ず保存される。
          L.polyline(guides, {
            color: "#7c3aed",
            weight: 7,
            opacity: 0.8,
            dashArray: "10 8"
          }).addTo(plannedLayer);
        }
      }
    }

    (trip.routeSegments || []).forEach(segment => {
      const number = String(Number(segment.routeNumber || ""));
      if (plannedNumbers.length && !plannedNumbers.includes(number)) return;

      if (segment.status === "complete") {
        loadRouteGeojson(number)
          .then(geojson => {
            if (token !== drawToken) return;
            L.geoJSON(geojson, {
              style: {
                color: "#16a34a",
                weight: 8,
                opacity: 0.92
              },
              interactive: false
            }).addTo(actualLayer);
          })
          .catch(error => {
            console.error(`国道${number}号 全線走破表示エラー:`, error);
          });
        return;
      }

      actualPaths(segment).forEach(path => {
        L.polyline(path, {
          color: "#0284c7",
          weight: 8,
          opacity: 0.95
        }).addTo(actualLayer);
      });
    });

    insertLegend();

    if (snapshot) {
      const planName = snapshot.planName || "今回の予定";
      mapInstruction.textContent =
        `${planName}：国道全線の上に、走破予定（紫）と実走確定（青）を重ねています。`;
    } else {
      mapInstruction.textContent =
        "国道全線と実走確定区間を表示しています。予定TrackはこのTripに未保存です。";
    }

    if (shouldFit && bounds.isValid()) {
      routeMap.fitBounds(bounds, {
        padding: [24, 24],
        maxZoom: 10
      });
    }
  }

  const baseRefreshRouteMap = refreshRouteMap;
  refreshRouteMap = async function (shouldFit) {
    if (!comparisonMode || !tripId.value) {
      return baseRefreshRouteMap(shouldFit);
    }

    // 旧レイヤーを一度作らせず、比較地図を正本として表示する。
    await drawComparison(shouldFit);
  };

  const baseLoadTrip = loadTrip;
  loadTrip = function (id) {
    baseLoadTrip(id);
    window.setTimeout(() => drawComparison(true), 80);
  };

  const manualDetails = [...document.querySelectorAll("details")]
    .find(details => {
      const summary = details.querySelector("summary");
      return summary && summary.textContent.includes("手動で路線・区間を修正する");
    });

  if (manualDetails) {
    manualDetails.addEventListener("toggle", () => {
      comparisonMode = !manualDetails.open;

      if (manualDetails.open) {
        fullRouteLayer.clearLayers();
        plannedLayer.clearLayers();
        actualLayer.clearLayers();
        baseRefreshRouteMap(true);
        mapInstruction.textContent =
          "手動修正モードです。修正を終えて閉じると予定／実走比較へ戻ります。";
      } else {
        drawComparison(true);
      }
    });
  }

  insertLegend();

  console.log("北海道48路線 Version4.0 Trip Plan/Actual Compare Map Ready");
})();
