// 北海道48路線ふらふらlog Version 4.0
// メイン地図表示補正
// 1. スマートフォンでは、全路線読込後の初期表示を北海道へ戻す。
// 2. 「走破中（一部走破）」は路線全体をオレンジ表示しない。
//    実走区間データがない状態で路線全体をオレンジにすると誤解を招くため、
//    メイン地図では未走破と同じグレー表示にする。
// 3. 「走破済（全線走破）」だけを緑表示する。

(function () {
  "use strict";

  const COLORS = {
    complete: "#16a34a",
    base: "#6b7280"
  };

  function applyMainMapStatusStyle() {
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

      const status = getEffectiveStatus(route);

      layer.setStyle({
        color: status === "走破済" ? COLORS.complete : COLORS.base,
        weight: 7,
        opacity: 0.9
      });
    });

    return true;
  }

  let checks = 0;

  const waitForRoutes = window.setInterval(function () {
    checks += 1;

    const layerCount =
      typeof allLayers !== "undefined" &&
      allLayers &&
      typeof allLayers.getLayers === "function"
        ? allLayers.getLayers().length
        : 0;

    const allRoutesLoaded =
      typeof routesData !== "undefined" &&
      Array.isArray(routesData) &&
      routesData.length > 0 &&
      layerCount >= routesData.length;

    if (allRoutesLoaded) {
      applyMainMapStatusStyle();

      window.clearInterval(waitForRoutes);

      if (
        window.innerWidth <= 600 &&
        !new URL(window.location.href).searchParams.has("route") &&
        layerCount > 0
      ) {
        map.setView([43.35, 142.45], 6);
      }

      return;
    }

    if (checks >= 100) {
      window.clearInterval(waitForRoutes);

      // 読込が遅い場合も、取得済みの路線には補正を試みる。
      applyMainMapStatusStyle();

      if (
        window.innerWidth <= 600 &&
        !new URL(window.location.href).searchParams.has("route") &&
        layerCount > 0
      ) {
        map.setView([43.35, 142.45], 6);
      }
    }
  }, 100);

  // Trip画面から戻った場合など、同一タブ内で保存状態が変わった際の再描画用。
  window.addEventListener("pageshow", function () {
    window.setTimeout(applyMainMapStatusStyle, 0);
  });
})();
