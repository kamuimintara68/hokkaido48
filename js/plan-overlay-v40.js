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

    const preview = plan && plan.plannedPreview;
    const hasPreview =
      preview &&
      Array.isArray(preview.points) &&
      preview.points.length >= 2;

    const banner = document.createElement("div");
    banner.style.cssText =
      "margin:0 18px 12px;padding:10px 14px;border:2px solid #7c3aed;" +
      "border-radius:10px;background:#f5f3ff;color:#4c1d95;font-weight:700;";

    const routeText = Array.isArray(plan.routeNumbers) && plan.routeNumbers.length
      ? plan.routeNumbers.map(number => `国道${number}号`).join(" → ")
      : (plan.targetRoutes || "予定路線未登録");

    const isFullTrack = hasPreview && preview.kind === "full-track";

    const distanceText =
      hasPreview && Number.isFinite(Number(preview.distanceKm))
        ? ` ／ 予定Track：約${Number(preview.distanceKm).toFixed(1)}km`
        : "";

    const lineText = isFullTrack
      ? "紫実線＝始点から終点までの予定GPX Track"
      : (
          hasPreview
            ? "紫実線＝予定経路"
            : "紫破線＝対象国道（予定Trackは未生成）"
        );

    const text = document.createElement("span");
    text.textContent =
      `今回の予定：${plan.planName || "名称未登録"} ／ ${routeText}${distanceText} ／ ${lineText}`;
    banner.appendChild(text);

    const links = document.createElement("span");
    links.style.marginLeft = "12px";

    const change = document.createElement("a");
    change.href = "plan.html";
    change.textContent = hasPreview ? "予定経路を作り直す" : "旅行計画へ";
    change.style.cssText = "margin-left:10px;color:#2563eb;";
    links.appendChild(change);

    if (hasPreview) {
      const osmand = document.createElement("a");
      osmand.href = "https://osmand.net/map/";
      osmand.target = "_blank";
      osmand.rel = "noopener";
      osmand.textContent = "OsmAnd Webを開く";
      osmand.style.cssText = "margin-left:10px;color:#2563eb;";
      links.appendChild(osmand);
    }

    if (plan.googleMapsUrl) {
      const google = document.createElement("a");
      google.href = plan.googleMapsUrl;
      google.target = "_blank";
      google.rel = "noopener";
      google.textContent = "Googleマップ参考表示";
      google.style.cssText = "margin-left:10px;color:#2563eb;";
      links.appendChild(google);
    }

    banner.appendChild(links);
    header.insertAdjacentElement("afterend", banner);
  }

  function loadPlannedPreview(plan) {
    if (typeof map === "undefined" || !window.L) return false;

    const preview = plan && plan.plannedPreview;
    if (!preview || !Array.isArray(preview.points) || preview.points.length < 2) {
      return false;
    }

    const latLngs = preview.points
      .map(point => [Number(point[0]), Number(point[1])])
      .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));

    if (latLngs.length < 2) return false;

    if (preview.kind === "route-points") {
      const line = L.polyline(latLngs, {
        color: "#7c3aed",
        weight: 5,
        opacity: 0.75,
        dashArray: "10 10",
        interactive: false
      }).addTo(map);

      const anchors = Array.isArray(preview.anchors) ? preview.anchors : [];
      latLngs.forEach((latLng, index) => {
        const anchor = anchors[index] || {};
        const marker = L.circleMarker(latLng, {
          radius: 7,
          color: "#5b21b6",
          weight: 3,
          fillColor: "#ffffff",
          fillOpacity: 1
        }).addTo(map);

        const label = anchor.label
          ? `${index + 1}. ${anchor.label}／国道${anchor.routeNumber || "?"}号`
          : `${index + 1}. OsmAnd経由点`;
        marker.bindTooltip(label, { direction: "top" });
      });

      const bounds = line.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 10 });
      }
      return true;
    }

    const line = L.polyline(latLngs, {
      color: "#7c3aed",
      weight: 8,
      opacity: 0.88,
      interactive: false
    }).addTo(map);

    const bounds = line.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 10 });
    }
    return true;
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
  const previewLoaded = loadPlannedPreview(plan);
  if (!previewLoaded) {
    loadPlannedRoutes(plan);
  }
})();
