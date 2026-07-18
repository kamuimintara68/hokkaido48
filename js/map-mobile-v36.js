// 北海道48路線ふらふらlog Version 3.6
// スマートフォンでは、全路線読込後の初期表示を北海道へ戻します。
(function () {
  "use strict";

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
