// 北海道48路線ふらふらlog Version 4.0
// メイン地図 走破状態表示 完成版 v2
// Trip保存データをlocalStorageから直接読み、路線状態を確定する。
// 未走破=グレー / 一部走破=水色 / 全線走破=緑 / 選択中=青
(function () {
  "use strict";

  const STORAGE_KEY = "hokkaido48Trips";

  const COLORS = {
    untraveled: "#6b7280",
    partial: "#38bdf8",
    complete: "#16a34a"
  };

  function normalizeRouteNumber(value) {
    const digits = String(value ?? "").replace(/[^0-9]/g, "");
    return digits ? String(Number(digits)) : "";
  }

  function readTripRouteStatuses() {
    const statuses = new Map();

    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("Trip保存データ取得エラー:", error);
      return statuses;
    }

    if (!raw) {
      return statuses;
    }

    let trips;
    try {
      trips = JSON.parse(raw);
    } catch (error) {
      console.error("Trip保存データ解析エラー:", error);
      return statuses;
    }

    if (!Array.isArray(trips)) {
      return statuses;
    }

    trips.forEach(function (trip) {
      let segments = [];

      // 現行形式
      if (Array.isArray(trip && trip.routeSegments)) {
        segments = trip.routeSegments;
      }
      // 旧形式 routes しかないTripも一部走破として拾う
      else if (trip && trip.routes) {
        const source = Array.isArray(trip.routes)
          ? trip.routes.join(",")
          : String(trip.routes);

        segments = source
          .split(/[,\s、，・→>]+/)
          .filter(Boolean)
          .map(function (routeNumber) {
            return {
              routeNumber: routeNumber,
              status: "partial"
            };
          });
      }

      segments.forEach(function (segment) {
        const routeNumber = normalizeRouteNumber(
          segment && (
            segment.routeNumber ??
            segment.number ??
            segment.route
          )
        );

        if (!routeNumber) {
          return;
        }

        const isComplete =
          segment &&
          (
            segment.status === "complete" ||
            segment.status === "全線走破" ||
            segment.status === "走破済"
          );

        const current = statuses.get(routeNumber);

        if (isComplete) {
          statuses.set(routeNumber, "走破済");
        } else if (current !== "走破済") {
          statuses.set(routeNumber, "走破中");
        }
      });
    });

    return statuses;
  }

  function getDirectStatus(routeNumber, savedRecordExists) {
    const statuses = readTripRouteStatuses();
    const routeKey = normalizeRouteNumber(routeNumber);

    if (statuses.get(routeKey) === "走破済") {
      return "走破済";
    }

    if (savedRecordExists) {
      return "走破済";
    }

    if (statuses.get(routeKey) === "走破中") {
      return "走破中";
    }

    return "未走破";
  }

  // 本体側の色関数も同じ仕様へ統一
  if (typeof getStatusColor === "function") {
    getStatusColor = function (status) {
      if (status === "走破済") {
        return COLORS.complete;
      }
      if (status === "走破中") {
        return COLORS.partial;
      }
      return COLORS.untraveled;
    };
  }

  function applyRouteStatusColors() {
    if (
      typeof routesData === "undefined" ||
      typeof routeLayers === "undefined" ||
      !Array.isArray(routesData)
    ) {
      return false;
    }

    const statuses = readTripRouteStatuses();

    routesData.forEach(function (route) {
      const routeKey = normalizeRouteNumber(route.number);
      const layer =
        routeLayers.get(routeKey) ||
        routeLayers.get(route.number);

      if (!layer || typeof layer.setStyle !== "function") {
        return;
      }

      // URLで選択中の路線だけは青い強調表示を維持
      if (
        typeof selectedLayer !== "undefined" &&
        selectedLayer === layer
      ) {
        return;
      }

      let status = statuses.get(routeKey) || "未走破";

      // RouteごとのRecordがあれば全線走破扱いを維持
      try {
        if (
          typeof getSavedRecord === "function" &&
          getSavedRecord(route.number)
        ) {
          status = "走破済";
        }
      } catch (error) {
        // Record確認失敗時はTrip判定をそのまま使う
      }

      const color =
        status === "走破済"
          ? COLORS.complete
          : status === "走破中"
            ? COLORS.partial
            : COLORS.untraveled;

      layer.setStyle({
        color: color,
        weight: 7,
        opacity: 0.9
      });
    });

    return true;
  }

  // GeoJSON非同期読込後に複数回適用し、描画順による上書きを防ぐ。
  const delays = [0, 200, 600, 1200, 2500];

  let checks = 0;
  const timer = window.setInterval(function () {
    checks += 1;

    const ready =
      typeof routesData !== "undefined" &&
      Array.isArray(routesData) &&
      routesData.length > 0 &&
      typeof routeLayers !== "undefined" &&
      routeLayers.size > 0;

    if (ready) {
      delays.forEach(function (delay) {
        window.setTimeout(applyRouteStatusColors, delay);
      });
      window.clearInterval(timer);
      return;
    }

    if (checks >= 150) {
      window.clearInterval(timer);
    }
  }, 100);

  window.addEventListener("pageshow", function () {
    delays.forEach(function (delay) {
      window.setTimeout(applyRouteStatusColors, delay);
    });
  });

  window.addEventListener("focus", function () {
    window.setTimeout(applyRouteStatusColors, 100);
  });

  window.addEventListener("storage", function (event) {
    if (!event || event.key === STORAGE_KEY) {
      window.setTimeout(applyRouteStatusColors, 100);
    }
  });

  // デバッグ用: ブラウザConsoleから確認可能
  window.Hokkaido48RouteStatusDisplay = {
    readTripRouteStatuses: readTripRouteStatuses,
    applyRouteStatusColors: applyRouteStatusColors
  };
})();
