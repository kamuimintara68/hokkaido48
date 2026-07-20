// 北海道48路線ふらふらlog Version 4.0
// Trip確定走破区間表示版
// GPXは判定材料に限定し、メイン地図はTripに保存されたconfirmedPathだけを水色表示する。
(function () {
  "use strict";

  const STORAGE_KEY = "hokkaido48Trips";

  function readConfirmedPaths() {
    let trips = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      trips = raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error("Trip確定区間読込エラー:", error);
      return [];
    }

    if (!Array.isArray(trips)) {
      return [];
    }

    const paths = [];

    trips.forEach(function (trip) {
      const segments = Array.isArray(trip && trip.routeSegments)
        ? trip.routeSegments
        : [];

      segments.forEach(function (segment) {
        if (!segment || segment.status === "complete") {
          return;
        }

        const sourcePaths =
          Array.isArray(segment.confirmedPaths) && segment.confirmedPaths.length
            ? segment.confirmedPaths
            : [segment.confirmedPath];

        sourcePaths.forEach(function (sourcePath, pathIndex) {
          const path = Array.isArray(sourcePath)
            ? sourcePath
                .map(function (point) {
                  if (!Array.isArray(point) || point.length < 2) {
                    return null;
                  }
                  const lat = Number(point[0]);
                  const lng = Number(point[1]);
                  return Number.isFinite(lat) && Number.isFinite(lng)
                    ? [lat, lng]
                    : null;
                })
                .filter(Boolean)
            : [];

          if (path.length >= 2) {
            paths.push({
              routeNumber: String(segment.routeNumber || ""),
              pathIndex: pathIndex,
              path: path
            });
          }
        });
      });
    });

    return paths;
  }

  function drawConfirmedNationalRoadSections() {
    if (typeof map === "undefined" || typeof L === "undefined") {
      return false;
    }

    const confirmedPaths = readConfirmedPaths();

    confirmedPaths.forEach(function (item) {
      L.polyline(item.path, {
        color: "#38bdf8",
        weight: 7,
        opacity: 0.95,
        interactive: false,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(map);
    });

    window.Hokkaido48ConfirmedPathDebug = {
      confirmedPathCount: confirmedPaths.length,
      routes: confirmedPaths.map(function (item) {
        return item.routeNumber;
      }),
      mode: "trip-confirmed-multipath-only"
    };

    return true;
  }

  let checks = 0;
  const timer = window.setInterval(function () {
    checks += 1;

    const ready =
      typeof routeLayers !== "undefined" &&
      routeLayers &&
      routeLayers.size >= 40;

    if (ready || checks >= 200) {
      drawConfirmedNationalRoadSections();
      window.clearInterval(timer);
    }
  }, 100);
})();
