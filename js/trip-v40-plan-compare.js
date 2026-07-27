"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
  const tripNextStep = document.getElementById("tripNextStep");

  const fullRouteLayer = L.layerGroup().addTo(routeMap);
  const plannedLayer = L.layerGroup().addTo(routeMap);
  const actualLayer = L.layerGroup().addTo(routeMap);

  let comparisonMode = true;
  let drawToken = 0;

  function setTripNextStep(message, done = false) {
    if (!tripNextStep) return;
    tripNextStep.textContent = message;
    tripNextStep.classList.toggle("done", done);
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

  function currentTrip() {
    const id = String(tripId.value || "");
    if (!id) return null;

    const trips = TripData.getTrips();
    return trips.find(trip => String(trip.id || "") === id) || null;
  }

  function normalizeNumbers(values) {
    return [...new Set(
      (values || [])
        .map(value => String(Number(value)))
        .filter(value => value && value !== "NaN" && value !== "0")
    )];
  }

  function snapshotFromActivePlan() {
    const plan = readActivePlan();
    if (!plan) return null;

    const routeNumbers = normalizeNumbers(
      Array.isArray(plan.routeNumbers)
        ? plan.routeNumbers
        : String(plan.targetRoutes || "").split(/[,\s、，・→>]+/)
    );

    const plannedTrack =
      plan.plannedPreview &&
      Array.isArray(plan.plannedPreview.points)
        ? plan.plannedPreview.points
            .filter(point => Array.isArray(point) && point.length >= 2)
            .map(point => [Number(point[0]), Number(point[1])])
            .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
        : [];

    if (!routeNumbers.length || plannedTrack.length < 2) return null;

    return {
      source: "active-plan",
      planName: String(plan.planName || "今回の予定"),
      routeNumbers,
      plannedTrack,
      distanceKm: Number(plan.plannedPreview.distanceKm || 0)
    };
  }

  function snapshotForTrip(trip) {
    if (
      trip &&
      trip.planSnapshot &&
      Array.isArray(trip.planSnapshot.routeNumbers) &&
      trip.planSnapshot.routeNumbers.length
    ) {
      return {
        source: "trip",
        planName: String(trip.planSnapshot.planName || "今回の予定"),
        routeNumbers: normalizeNumbers(trip.planSnapshot.routeNumbers),
        plannedTrack: Array.isArray(trip.planSnapshot.plannedTrack)
          ? trip.planSnapshot.plannedTrack
          : [],
        distanceKm: Number(trip.planSnapshot.distanceKm || 0)
      };
    }

    const active = snapshotFromActivePlan();
    if (!active || !trip) return active;

    const tripNumbers = new Set(
      normalizeNumbers(
        Array.isArray(trip.routeSegments)
          ? trip.routeSegments.map(segment => segment.routeNumber)
          : []
      )
    );

    const overlaps = active.routeNumbers.some(number => tripNumbers.has(number));
    return overlaps ? active : null;
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

    const one = normalizePath(segment.confirmedPath);
    return one.length >= 2 ? [one] : [];
  }

  function ensureLegend() {
    if (document.getElementById("tripCompareLegend")) return;

    const mapElement = document.getElementById("routeMap");
    if (!mapElement) return;

    const legend = document.createElement("div");
    legend.id = "tripCompareLegend";
    legend.style.display = "flex";
    legend.style.flexWrap = "wrap";
    legend.style.gap = "12px";
    legend.style.marginTop = "10px";
    legend.style.padding = "10px 12px";
    legend.style.borderRadius = "8px";
    legend.style.background = "#fff";
    legend.style.fontSize = "13px";
    legend.style.fontWeight = "700";

    [
      ["#94a3b8", "国道全線"],
      ["#7c3aed", "走破予定"],
      ["#0284c7", "実走確定"],
      ["#16a34a", "全線走破"]
    ].forEach(([color, label]) => {
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

  async function drawComparison(shouldFit = true) {
    if (!comparisonMode) return;

    const token = ++drawToken;
    const trip = currentTrip();
    const snapshot = snapshotForTrip(trip);

    routeLayerGroup.clearLayers();
    selectedSectionLayerGroup.clearLayers();
    pointLayerGroup.clearLayers();
    candidateLayerGroup.clearLayers();

    fullRouteLayer.clearLayers();
    plannedLayer.clearLayers();
    actualLayer.clearLayers();

    const routeNumbers = snapshot
      ? snapshot.routeNumbers
      : normalizeNumbers(
          trip && Array.isArray(trip.routeSegments)
            ? trip.routeSegments.map(segment => segment.routeNumber)
            : []
        );

    const bounds = L.latLngBounds();

    // 1. 国道全線
    for (const routeNumber of routeNumbers) {
      try {
        const geojson = await loadRouteGeojson(routeNumber);
        if (token !== drawToken) return;

        const layer = L.geoJSON(geojson, {
          style: {
            color: "#94a3b8",
            weight: 7,
            opacity: 0.70
          },
          interactive: false
        }).addTo(fullRouteLayer);

        bounds.extend(layer.getBounds());
      } catch (error) {
        console.error(`国道${routeNumber}号 全線表示エラー:`, error);
      }
    }

    // 2. 走破予定
    if (snapshot) {
      const planned = normalizePath(snapshot.plannedTrack);
      if (planned.length >= 2) {
        const plannedLine = L.polyline(planned, {
          color: "#7c3aed",
          weight: 8,
          opacity: 0.90
        }).addTo(plannedLayer);
        bounds.extend(plannedLine.getBounds());
      }
    }

    // 3. 実走
    if (trip && Array.isArray(trip.routeSegments)) {
      for (const segment of trip.routeSegments) {
        const routeNumber = String(Number(segment.routeNumber || ""));
        if (routeNumbers.length && !routeNumbers.includes(routeNumber)) continue;

        if (segment.status === "complete") {
          try {
            const geojson = await loadRouteGeojson(routeNumber);
            if (token !== drawToken) return;

            const completeLayer = L.geoJSON(geojson, {
              style: {
                color: "#16a34a",
                weight: 9,
                opacity: 0.92
              },
              interactive: false
            }).addTo(actualLayer);
            bounds.extend(completeLayer.getBounds());
          } catch (error) {
            console.error(`国道${routeNumber}号 全線走破表示エラー:`, error);
          }
        } else {
          actualPaths(segment).forEach(path => {
            const line = L.polyline(path, {
              color: "#0284c7",
              weight: 9,
              opacity: 0.95
            }).addTo(actualLayer);
            bounds.extend(line.getBounds());
          });
        }
      }
    }

    ensureLegend();

    if (snapshot && trip) {
      setTripNextStep("このTripの確認は完了です。予定と実走の違いがないか確認してください。", true);
      mapInstruction.textContent =
        `${snapshot.planName}：灰＝国道全線／紫＝走破予定／青＝実走確定。予定と実走を同じ地図で比較しています。`;
    } else if (snapshot) {
      setTripNextStep("次は：実走Tripを開いて比較");
      mapInstruction.textContent =
        `${snapshot.planName}：灰＝国道全線／紫＝走破予定。実走Tripを開くと青線を重ねます。`;
    } else if (trip) {
      setTripNextStep("次は：走行経路を確認");
      mapInstruction.textContent =
        "灰＝国道全線／青＝実走確定。予定TrackはこのTripにまだ保存されていません。";
    } else {
      setTripNextStep("次は：Tripを開く");
      mapInstruction.textContent =
        "Tripを開くと、国道全線・走破予定・実走確定を重ねて表示します。";
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
    if (!comparisonMode) {
      return baseRefreshRouteMap(shouldFit);
    }
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
          "手動修正モードです。閉じると予定／実走比較へ戻ります。";
      } else {
        drawComparison(true);
      }
    });
  }

  ensureLegend();

  // Trip未選択でも、Active Planだけで予定線を確認できる。
  window.setTimeout(() => {
    if (!tripId.value) drawComparison(true);
  }, 150);

  console.log("北海道48路線 Version4.0 Trip Compare Ready");
})();
