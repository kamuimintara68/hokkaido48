"use strict";

(function () {
  const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";

  function readActivePlan() {
    const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      console.error("予定プラン読込エラー:", error);
      return null;
    }
  }

  function addBanner(plan) {
    const header = document.querySelector(".header");
    if (!header || !header.parentNode) return;

    const banner = document.createElement("div");
    banner.style.cssText =
      "margin:0 18px 12px;padding:10px 14px;border:2px solid #7c3aed;" +
      "border-radius:10px;background:#f5f3ff;color:#4c1d95;font-weight:700;";

    const routeText = Array.isArray(plan.routeNumbers) && plan.routeNumbers.length
      ? plan.routeNumbers.map(number => `国道${number}号`).join(" → ")
      : (plan.targetRoutes || "予定路線未登録");

    const text = document.createElement("span");
    text.textContent = `今回の予定：${plan.planName || "名称未登録"} ／ ${routeText} ／ 紫破線＝予定路線`;
    banner.appendChild(text);

    const links = document.createElement("span");
    links.style.marginLeft = "12px";

    const change = document.createElement("a");
    change.href = "plan.html";
    change.textContent = "プラン変更";
    change.style.cssText = "margin-left:10px;color:#2563eb;";
    links.appendChild(change);

    if (plan.googleMapsUrl) {
      const google = document.createElement("a");
      google.href = plan.googleMapsUrl;
      google.target = "_blank";
      google.rel = "noopener";
      google.textContent = "Googleマップ";
      google.style.cssText = "margin-left:10px;color:#2563eb;";
      links.appendChild(google);
    }

    banner.appendChild(links);
    header.insertAdjacentElement("afterend", banner);
  }

  async function loadPlannedRoutes(plan) {
    if (typeof map === "undefined" || !window.L) return;

    const routeNumbers = Array.isArray(plan.routeNumbers)
      ? plan.routeNumbers.filter(Boolean)
      : [];

    if (!routeNumbers.length) return;

    const layerGroup = L.featureGroup().addTo(map);

    for (const routeNumber of routeNumbers) {
      try {
        const path = `data/geojson/route_${String(routeNumber).padStart(3, "0")}.geojson`;
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) continue;
        const geojson = await response.json();

        L.geoJSON(geojson, {
          style: {
            color: "#7c3aed",
            weight: 8,
            opacity: 0.62,
            dashArray: "12 10"
          },
          interactive: false
        }).addTo(layerGroup);
      } catch (error) {
        console.error(`予定路線 国道${routeNumber}号の表示エラー:`, error);
      }
    }

    const bounds = layerGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 9 });
    }
  }

  const plan = readActivePlan();
  if (!plan) return;

  addBanner(plan);
  loadPlannedRoutes(plan);
})();
