// 北海道48路線ふらふらlog Version 4.0
// メイン地図の走破中（一部走破）表示補正
(function () {
  "use strict";

  // app-v34.js が使う色判定関数そのものを上書きする。
  // これにより初期描画だけでなく、Trip保存後・フォーカス復帰後・
  // refreshSavedRecordStatus() による再描画でも走破中がオレンジへ戻らない。
  if (typeof getStatusColor === "function") {
    getStatusColor = function (status) {
      if (status === "走破済") {
        return "#16a34a";
      }
      return "#6b7280";
    };
  }

  // スマートフォンでは、全路線読込後の初期表示を北海道へ戻します。
  if (window.innerWidth > 600) {
    return;
  }

  if (new URL(window.location.href).searchParams.has("route")) {
    return;
  }

  let checks = 0;

  const waitForRoutes = window.setInterval(function () {
    checks += 1;

    const layerCount = allLayers.getLayers().length;

    const allRoutesLoaded =
      routesData.length > 0 && layerCount >= routesData.length;

    if (allRoutesLoaded || checks >= 100) {
      window.clearInterval(waitForRoutes);

      if (layerCount > 0) {
        map.setView([43.35, 142.45], 6);
      }
    }
  }, 100);
})();
