// 北海道48路線ふらふらlog Version 4.0
// メイン地図 走破状態表示 完成版補正
// 未走破=グレー / 一部走破=水色 / 全線走破=緑 / 選択中=青
(function () {
  "use strict";

  const STATUS_COLORS = {
    untraveled: "#6b7280",
    partial: "#38bdf8",
    complete: "#16a34a"
  };

  // app.js側の色判定が参照可能な場合は、元の判定自体も補正する。
  if (typeof getStatusColor === "function") {
    getStatusColor = function (status) {
      if (status === "走破済") {
        return STATUS_COLORS.complete;
      }
      if (status === "走破中") {
        return STATUS_COLORS.partial;
      }
      return STATUS_COLORS.untraveled;
    };
  }

  function getCorrectColor(status) {
    if (status === "走破済") {
      return STATUS_COLORS.complete;
    }
    if (status === "走破中") {
      return STATUS_COLORS.partial;
    }
    return STATUS_COLORS.untraveled;
  }

  // 実際にLeaflet上へ描画済みの全路線を直接塗り直す。
  // getStatusColorの上書きだけに依存しないため、キャッシュや描画順の影響を受けにくい。
  function applyRouteStatusColors() {
    if (
      typeof routesData === "undefined" ||
      typeof routeLayers === "undefined" ||
      typeof getEffectiveStatus !== "function"
    ) {
      return false;
    }

    if (!Array.isArray(routesData) || routesData.length === 0) {
      return false;
    }

    routesData.forEach(function (route) {
      const layer = routeLayers.get(String(route.number));

      if (!layer || typeof layer.setStyle !== "function") {
        return;
      }

      // 選択中の路線はapp.js本来の青い強調表示を維持する。
      if (
        typeof selectedLayer !== "undefined" &&
        selectedLayer === layer
      ) {
        return;
      }

      const status = getEffectiveStatus(route);

      layer.setStyle({
        color: getCorrectColor(status),
        weight: 7,
        opacity: 0.9
      });
    });

    return true;
  }

  // app.jsの非同期GeoJSON読込が終わるまで待ってから確実に適用。
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
      applyRouteStatusColors();

      // URL ?route=... の選択処理など、初期表示後の再描画も吸収する。
      window.setTimeout(applyRouteStatusColors, 300);
      window.setTimeout(applyRouteStatusColors, 1000);

      window.clearInterval(timer);
      return;
    }

    if (checks >= 150) {
      window.clearInterval(timer);
    }
  }, 100);

  // Trip保存後に地図へ戻った場合なども再適用。
  window.addEventListener("pageshow", function () {
    window.setTimeout(applyRouteStatusColors, 50);
    window.setTimeout(applyRouteStatusColors, 500);
  });

  window.addEventListener("focus", function () {
    window.setTimeout(applyRouteStatusColors, 100);
  });

  // localStorageが別タブで変更された場合。
  window.addEventListener("storage", function () {
    window.setTimeout(applyRouteStatusColors, 100);
  });

  // 既存の走破状態更新関数がある場合、その処理後にも必ず再適用する。
  if (typeof refreshSavedRecordStatus === "function") {
    const originalRefreshSavedRecordStatus = refreshSavedRecordStatus;

    refreshSavedRecordStatus = function () {
      const result = originalRefreshSavedRecordStatus.apply(this, arguments);
      window.setTimeout(applyRouteStatusColors, 0);
      return result;
    };
  }
})();
