// =====================================================
// 北海道48路線ふらふらlog
// Version 3.4
// app.js
// Route・Trip・Record連携版
// =====================================================


// ---------- 地図作成 ----------

const map = L.map("map").setView([43.8, 142.8], 6);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors"
    }
).addTo(map);


// ---------- 情報パネル ----------

const emptyPanel =
    document.getElementById("emptyPanel");

const panelContent =
    document.getElementById("panelContent");

const routeNumber =
    document.getElementById("routeNumber");

const routeName =
    document.getElementById("routeName");

const routeStart =
    document.getElementById("routeStart");

const routeEnd =
    document.getElementById("routeEnd");

const routeStatus =
    document.getElementById("routeStatus");

const photoValue =
    document.getElementById("photoValue");

const routePhoto =
    document.getElementById("routePhoto");

const publicRecordValue =
    document.getElementById("publicRecordValue");
const relatedTripsValue =
    document.getElementById("relatedTripsValue");

const openRouteFinderButton =
    document.getElementById("openRouteFinderButton");

const closeRouteFinderButton =
    document.getElementById("closeRouteFinderButton");

const routeFinderOverlay =
    document.getElementById("routeFinderOverlay");

const routeSearchInput =
    document.getElementById("routeSearchInput");

const routeFinderList =
    document.getElementById("routeFinderList");

const routeFinderResultCount =
    document.getElementById("routeFinderResultCount");

const clearRouteFiltersButton =
    document.getElementById("clearRouteFiltersButton");

// ---------- 走破率表示 ----------

function findElementByIds(idList) {

    for (const id of idList) {

        const element =
            document.getElementById(id);

        if (element) {
            return element;
        }
    }

    return null;
}


const progressDonut =
    findElementByIds([
        "progressDonut",
        "routeProgressDonut",
        "completionDonut",
        "donutChart"
    ]);

const progressPercent =
    findElementByIds([
        "progressPercent",
        "routeProgressPercent",
        "completionRate",
        "donutPercent"
    ]);

const completedRouteCount =
    findElementByIds([
        "completedRouteCount",
        "completedCount",
        "routeCompletedCount"
    ]);

const totalRouteCount =
    findElementByIds([
        "totalRouteCount",
        "routeTotalCount"
    ]);


// ---------- 初期表示 ----------

emptyPanel.hidden = false;
panelContent.hidden = true;

let routesData = [];

let selectedLayer = null;

const routeLayers =
    new Map();

const allLayers =
    L.featureGroup().addTo(map);

const routeLabelLayer =
    L.layerGroup().addTo(map);

const routeLabelMarkers =
    new Map();

const seaRouteLayer =
    L.layerGroup().addTo(map);

const nonSelectableRouteNumbers =
    new Set([
        "279",
        "338"
    ]);

const routeRegions =
    new Map([
        ["5", ["道南", "道央"]],
        ["12", ["道央", "道北"]],
        ["36", ["道央"]],
        ["37", ["道南", "道央"]],
        ["38", ["道央", "道北", "十勝", "釧路・根室"]],
        ["39", ["道北", "オホーツク"]],
        ["40", ["道北"]],
        ["44", ["釧路・根室"]],
        ["227", ["道南"]],
        ["228", ["道南"]],
        ["229", ["道央", "道南"]],
        ["230", ["道央", "道南"]],
        ["231", ["道央", "道北"]],
        ["232", ["道北"]],
        ["233", ["道北"]],
        ["234", ["道央"]],
        ["235", ["道央"]],
        ["236", ["十勝", "道央"]],
        ["237", ["道北", "道央"]],
        ["238", ["オホーツク", "道北"]],
        ["239", ["オホーツク", "道北"]],
        ["240", ["釧路・根室", "オホーツク"]],
        ["241", ["釧路・根室", "十勝"]],
        ["242", ["オホーツク", "十勝"]],
        ["243", ["オホーツク", "釧路・根室"]],
        ["244", ["オホーツク", "釧路・根室"]],
        ["272", ["釧路・根室"]],
        ["273", ["十勝", "道北", "オホーツク"]],
        ["274", ["道央", "十勝", "釧路・根室"]],
        ["275", ["道央", "道北"]],
        ["276", ["道南", "道央"]],
        ["277", ["道南"]],
        ["278", ["道南"]],
        ["279", ["道南"]],
        ["280", ["道南"]],
        ["333", ["道北", "オホーツク"]],
        ["334", ["釧路・根室", "オホーツク"]],
        ["335", ["釧路・根室"]],
        ["336", ["道央", "十勝", "釧路・根室"]],
        ["337", ["道央"]],
        ["338", ["道南"]],
        ["391", ["釧路・根室", "オホーツク"]],
        ["392", ["釧路・根室", "十勝"]],
        ["393", ["道央"]],
        ["450", ["道北", "オホーツク"]],
        ["451", ["道北", "道央"]],
        ["452", ["道央", "道北"]],
        ["453", ["道央"]]
    ]);

let selectedRegionFilter = "all";
let selectedStatusFilter = "all";

const seaRouteDisplays = [
    {
        label: "279・338",
        coordinates: [
            [41.7430737, 140.6912345],
            [41.5307731, 140.8991789]
        ]
    },
    {
        label: "280",
        coordinates: [
            [41.4727205, 140.2594896],
            [41.200545, 140.432891]
        ]
    }
];

const routeLabelPositionRatios =
    new Map([
        ["5", 0.6],
        ["39", 0.25],
        ["229", 0.55],
        ["231", 0.35],
        ["232", 0.4],
        ["236", 0.3],
        ["238", 0.55],
        ["239", 0.55],
        ["240", 0.35],
        ["241", 0.2],
        ["242", 0.6],
        ["243", 0.55],
        ["244", 0.4],
        ["273", 0.55],
        ["274", 0.45],
        ["275", 0.45],
        ["276", 0.85],
        ["280", 0.55],
        ["333", 0.45],
        ["337", 0.7],
        ["391", 0.4],
        ["392", 0.7],
        ["393", 0.6],
        ["450", 0.25],
        ["451", 0.45],
        ["453", 0.45]
    ]);


// ---------- 路線番号ラベルの見た目 ----------

function addRouteLabelStyles() {

    const style =
        document.createElement("style");

    style.textContent = `
        :root {
            --route-label-scale: 0.4;
        }

        .route-number-div-icon {
            background: transparent;
            border: 0;
            pointer-events: none !important;
        }

        .route-number-label {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 82px;
            height: 48px;
            color: #1d4ed8;
            background: rgba(255, 255, 255, 0.96);
            border: 3px solid #2563eb;
            border-radius: 10px;
            box-shadow: 0 2px 7px rgba(15, 23, 42, 0.28);
            font-family: Arial, sans-serif;
            font-size: 30px;
            font-weight: 800;
            line-height: 1;
            cursor: pointer;
            pointer-events: auto;
            user-select: none;
            touch-action: manipulation;
            transform: scale(var(--route-label-scale));
            transform-origin: center;
        }

        .route-number-div-icon:focus .route-number-label,
        .route-number-div-icon:hover .route-number-label {
            background: #eff6ff;
            box-shadow: 0 3px 10px rgba(15, 23, 42, 0.38);
        }

        .sea-route-number-div-icon {
            background: transparent;
            border: 0;
            pointer-events: none !important;
        }

        .sea-route-number-label {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 98px;
            height: 42px;
            color: #1d4ed8;
            background: rgba(255, 255, 255, 0.92);
            border: 3px dashed #2563eb;
            border-radius: 10px;
            box-shadow: 0 2px 7px rgba(15, 23, 42, 0.22);
            font-family: Arial, sans-serif;
            font-size: 24px;
            font-weight: 800;
            line-height: 1;
            pointer-events: none;
            user-select: none;
            transform: scale(var(--route-label-scale));
            transform-origin: center;
        }
    `;

    document.head.appendChild(style);
}


function updateRouteLabelScale() {

    const zoom =
        map.getZoom();

    let scale = 1;

    if (zoom <= 9) {
        scale = 0.4;
    } else if (zoom === 10) {
        scale = 0.75;
    }

    document.documentElement.style.setProperty(
        "--route-label-scale",
        scale
    );
}


addRouteLabelStyles();

map.on(
    "zoomend",
    updateRouteLabelScale
);

updateRouteLabelScale();


// ---------- 海上国道表示 ----------

function createSeaRouteDisplays() {

    seaRouteDisplays.forEach(
        function (seaRoute) {

            L.polyline(
                seaRoute.coordinates,
                {
                    color: "#2563eb",
                    weight: 5,
                    opacity: 0.85,
                    dashArray: "12 10",
                    lineCap: "round",
                    interactive: false
                }
            ).addTo(seaRouteLayer);


            seaRoute.coordinates.forEach(
                function (coordinate) {

                    L.circleMarker(
                        coordinate,
                        {
                            radius: 5,
                            color: "#2563eb",
                            weight: 3,
                            fillColor: "#ffffff",
                            fillOpacity: 1,
                            interactive: false
                        }
                    ).addTo(seaRouteLayer);
                }
            );


            const start =
                seaRoute.coordinates[0];

            const end =
                seaRoute.coordinates[1];

            const center =
                [
                    (start[0] + end[0]) / 2,
                    (start[1] + end[1]) / 2
                ];

            const icon =
                L.divIcon({
                    className:
                        "sea-route-number-div-icon",
                    html:
                        `<span class="sea-route-number-label">${seaRoute.label}</span>`,
                    iconSize:
                        [98, 42],
                    iconAnchor:
                        [49, 21]
                });

            L.marker(
                center,
                {
                    icon,
                    interactive: false,
                    keyboard: false,
                    zIndexOffset: 500
                }
            ).addTo(seaRouteLayer);
        }
    );
}


createSeaRouteDisplays();


// ---------- GeoJSONパス作成 ----------

function getGeojsonPath(number) {

    return (
        "data/geojson/route_" +
        String(number).padStart(3, "0") +
        ".geojson"
    );
}


// ---------- 走破記録保存キー ----------

function getRecordStorageKey(number) {

    const paddedNumber =
        String(number).padStart(3, "0");

    return `route${paddedNumber}Record`;
}


// ---------- 保存済み走破記録 ----------

function getSavedRecord(number) {

    const savedData =
        localStorage.getItem(
            getRecordStorageKey(number)
        );

    if (!savedData) {
        return null;
    }

    try {

        return JSON.parse(savedData);

    } catch (error) {

        console.error(
            "走破記録読込エラー:",
            number,
            error
        );

        return null;
    }
}


// ---------- 実際の走破状態 ----------

function getEffectiveStatus(route) {

    const tripStatus =
        window.Hokkaido48TripData
            ? window.Hokkaido48TripData.getRouteStatus(
                route.number
            )
            : "未走破";


    if (tripStatus === "走破済") {
        return "走破済";
    }


    const savedRecord =
        getSavedRecord(route.number);

    if (savedRecord) {
        return "走破済";
    }


    if (tripStatus === "走破中") {
        return "走破中";
    }

    return route.status ?? "未走破";
}


// ---------- 路線検索 ----------

function normalizeSearchText(value) {

    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, "");
}


function getFinderStatusClass(status) {

    if (status === "走破済") {
        return "status-complete";
    }

    if (status === "走破中") {
        return "status-progress";
    }

    return "status-untraveled";
}


function createRouteResultButton(route) {

    const routeKey =
        String(route.number);

    const status =
        getEffectiveStatus(route);

    const regions =
        routeRegions.get(routeKey) || [];

    const button =
        document.createElement("button");

    button.type = "button";
    button.className =
        "route-result-button";


    const number =
        document.createElement("span");

    number.className =
        "route-result-number";

    number.textContent =
        `国道${route.number}号`;


    const detail =
        document.createElement("span");

    detail.className =
        "route-result-detail";


    const endpoints =
        document.createElement("span");

    endpoints.className =
        "route-result-endpoints";

    endpoints.textContent =
        `${route.start} → ${route.end}`;


    const regionContainer =
        document.createElement("span");

    regionContainer.className =
        "route-result-regions";


    regions.forEach(
        function (region) {

            const regionLabel =
                document.createElement("span");

            regionLabel.className =
                "route-result-region";

            regionLabel.textContent =
                region;

            regionContainer.appendChild(
                regionLabel
            );
        }
    );


    if (
        nonSelectableRouteNumbers.has(
            routeKey
        )
    ) {

        const seaLabel =
            document.createElement("span");

        seaLabel.className =
            "route-result-region";

        seaLabel.textContent =
            "海上区間・選択対象外";

        regionContainer.appendChild(
            seaLabel
        );

        button.disabled = true;
    }


    detail.appendChild(endpoints);
    detail.appendChild(regionContainer);


    const statusLabel =
        document.createElement("span");

    statusLabel.className =
        "route-result-status " +
        getFinderStatusClass(status);

    statusLabel.textContent =
        status;


    button.appendChild(number);
    button.appendChild(detail);
    button.appendChild(statusLabel);


    if (!button.disabled) {

        button.addEventListener(
            "click",
            function () {

                const layer =
                    routeLayers.get(
                        routeKey
                    );

                if (!layer) {
                    return;
                }

                selectRouteLayer(
                    layer,
                    route,
                    true
                );

                closeRouteFinder();
            }
        );
    }


    return button;
}


function renderRouteFinder() {

    if (!routeFinderList) {
        return;
    }

    const query =
        normalizeSearchText(
            routeSearchInput.value
        );


    const filteredRoutes =
        routesData.filter(
            function (route) {

                const routeKey =
                    String(route.number);

                const regions =
                    routeRegions.get(
                        routeKey
                    ) || [];

                const status =
                    getEffectiveStatus(route);

                const searchableText =
                    normalizeSearchText(
                        [
                            route.number,
                            route.name,
                            route.start,
                            route.end
                        ].join(" ")
                    );

                const matchesQuery =
                    !query ||
                    searchableText.includes(
                        query
                    );

                const matchesRegion =
                    selectedRegionFilter ===
                        "all" ||
                    regions.includes(
                        selectedRegionFilter
                    );

                const matchesStatus =
                    selectedStatusFilter ===
                        "all" ||
                    status ===
                        selectedStatusFilter;

                return (
                    matchesQuery &&
                    matchesRegion &&
                    matchesStatus
                );
            }
        );


    routeFinderResultCount.textContent =
        `${filteredRoutes.length}路線 / ${routesData.length || 48}路線`;

    routeFinderList.innerHTML = "";


    if (filteredRoutes.length === 0) {

        const empty =
            document.createElement("p");

        empty.className =
            "route-result-empty";

        empty.textContent =
            "条件に一致する路線はありません。";

        routeFinderList.appendChild(empty);
        return;
    }


    filteredRoutes.forEach(
        function (route) {

            routeFinderList.appendChild(
                createRouteResultButton(route)
            );
        }
    );
}


function setActiveFilterButton(
    containerId,
    dataName,
    selectedValue
) {

    document
        .querySelectorAll(
            `#${containerId} [data-${dataName}]`
        )
        .forEach(
            function (button) {

                button.classList.toggle(
                    "active",
                    button.dataset[dataName] ===
                        selectedValue
                );
            }
        );
}


function clearRouteFilters() {

    selectedRegionFilter = "all";
    selectedStatusFilter = "all";
    routeSearchInput.value = "";

    setActiveFilterButton(
        "regionFilterButtons",
        "region",
        selectedRegionFilter
    );

    setActiveFilterButton(
        "statusFilterButtons",
        "status",
        selectedStatusFilter
    );

    renderRouteFinder();
}


function openRouteFinder() {

    renderRouteFinder();
    routeFinderOverlay.hidden = false;

    window.setTimeout(
        function () {
            routeSearchInput.focus();
        },
        0
    );
}


function closeRouteFinder() {

    routeFinderOverlay.hidden = true;
    openRouteFinderButton.focus();
}


openRouteFinderButton.addEventListener(
    "click",
    openRouteFinder
);


closeRouteFinderButton.addEventListener(
    "click",
    closeRouteFinder
);


routeSearchInput.addEventListener(
    "input",
    renderRouteFinder
);


clearRouteFiltersButton.addEventListener(
    "click",
    clearRouteFilters
);


document
    .getElementById(
        "regionFilterButtons"
    )
    .addEventListener(
        "click",
        function (event) {

            const button =
                event.target.closest(
                    "[data-region]"
                );

            if (!button) {
                return;
            }

            selectedRegionFilter =
                button.dataset.region;

            setActiveFilterButton(
                "regionFilterButtons",
                "region",
                selectedRegionFilter
            );

            renderRouteFinder();
        }
    );


document
    .getElementById(
        "statusFilterButtons"
    )
    .addEventListener(
        "click",
        function (event) {

            const button =
                event.target.closest(
                    "[data-status]"
                );

            if (!button) {
                return;
            }

            selectedStatusFilter =
                button.dataset.status;

            setActiveFilterButton(
                "statusFilterButtons",
                "status",
                selectedStatusFilter
            );

            renderRouteFinder();
        }
    );


routeFinderOverlay.addEventListener(
    "click",
    function (event) {

        if (event.target === routeFinderOverlay) {
            closeRouteFinder();
        }
    }
);


document.addEventListener(
    "keydown",
    function (event) {

        if (
            event.key === "Escape" &&
            !routeFinderOverlay.hidden
        ) {
            closeRouteFinder();
        }
    }
);


// ---------- 色設定 ----------

function getStatusColor(status) {

    switch (status) {

        case "走破済":
            return "#16a34a";

        case "走破中":
            return "#ea580c";

        default:
            return "#6b7280";
    }
}


// ---------- 通常時の路線スタイル ----------

function getRouteStyle(route) {

    const status =
        getEffectiveStatus(route);

    return {
        color: getStatusColor(status),
        weight: 7,
        opacity: 0.9
    };
}


// ---------- 路線中央座標の取得 ----------

function getRouteCenter(
    geojson,
    positionRatio
) {

    const coordinateLines = [];


    function collectCoordinates(item) {

        if (!item) {
            return;
        }


        if (item.type === "FeatureCollection") {

            (item.features || []).forEach(
                collectCoordinates
            );

            return;
        }


        if (item.type === "Feature") {

            collectCoordinates(
                item.geometry
            );

            return;
        }


        if (item.type === "GeometryCollection") {

            (item.geometries || []).forEach(
                collectCoordinates
            );

            return;
        }


        if (item.type === "LineString") {

            coordinateLines.push(
                item.coordinates || []
            );

            return;
        }


        if (item.type === "MultiLineString") {

            (item.coordinates || []).forEach(
                function (coordinates) {

                    coordinateLines.push(
                        coordinates
                    );
                }
            );
        }
    }


    collectCoordinates(geojson);


    const segments = [];
    let totalDistance = 0;


    coordinateLines.forEach(
        function (coordinates) {

            for (
                let index = 1;
                index < coordinates.length;
                index += 1
            ) {

                const startCoordinate =
                    coordinates[index - 1];

                const endCoordinate =
                    coordinates[index];


                if (
                    !Array.isArray(startCoordinate) ||
                    !Array.isArray(endCoordinate) ||
                    startCoordinate.length < 2 ||
                    endCoordinate.length < 2
                ) {
                    continue;
                }


                const start =
                    L.latLng(
                        startCoordinate[1],
                        startCoordinate[0]
                    );

                const end =
                    L.latLng(
                        endCoordinate[1],
                        endCoordinate[0]
                    );

                const distance =
                    map.distance(
                        start,
                        end
                    );


                if (
                    !Number.isFinite(distance) ||
                    distance <= 0
                ) {
                    continue;
                }


                segments.push({
                    start,
                    end,
                    distance
                });

                totalDistance +=
                    distance;
            }
        }
    );


    if (
        segments.length === 0 ||
        totalDistance <= 0
    ) {
        return null;
    }


    const targetDistance =
        totalDistance *
        positionRatio;

    let traveledDistance = 0;


    for (const segment of segments) {

        if (
            traveledDistance +
            segment.distance >=
            targetDistance
        ) {

            const remainingDistance =
                targetDistance -
                traveledDistance;

            const ratio =
                remainingDistance /
                segment.distance;

            return L.latLng(
                segment.start.lat +
                    (
                        segment.end.lat -
                        segment.start.lat
                    ) * ratio,
                segment.start.lng +
                    (
                        segment.end.lng -
                        segment.start.lng
                    ) * ratio
            );
        }


        traveledDistance +=
            segment.distance;
    }


    return segments[
        segments.length - 1
    ].end;
}


// ---------- 路線番号ラベル作成 ----------

function createRouteNumberLabel(
    geojson,
    route,
    layer
) {

    const routeKey =
        String(route.number);


    if (
        routeLabelMarkers.has(
            routeKey
        )
    ) {
        return;
    }


    const center =
        getRouteCenter(
            geojson,
            routeLabelPositionRatios.get(
                routeKey
            ) ?? 0.5
        ) ||
        layer.getBounds().getCenter();


    const icon =
        L.divIcon({
            className:
                "route-number-div-icon",
            html:
                `<span class="route-number-label">${route.number}</span>`,
            iconSize:
                [82, 48],
            iconAnchor:
                [41, 24]
        });


    const marker =
        L.marker(
            center,
            {
                icon,
                interactive: true,
                keyboard: true,
                riseOnHover: true,
                zIndexOffset: 1000,
                title:
                    `国道${route.number}号を選択`
            }
        );


    marker.on(
        "click",
        function () {

            selectRouteLayer(
                layer,
                route,
                true
            );
        }
    );


    marker.addTo(
        routeLabelLayer
    );

    routeLabelMarkers.set(
        routeKey,
        marker
    );
}


// ---------- 走破率更新 ----------

function updateProgressDisplay() {

    const totalCount =
        routesData.length > 0
            ? routesData.length
            : 48;

    const completedCount =
        routesData.filter(
            route =>
                getEffectiveStatus(route) ===
                "走破済"
        ).length;

    const percentage =
        totalCount > 0
            ? Math.round(
                completedCount /
                totalCount *
                100
            )
            : 0;


    if (progressPercent) {

        progressPercent.textContent =
            `${percentage}%`;
    }


    if (completedRouteCount) {

        completedRouteCount.textContent =
            completedCount;
    }


    if (totalRouteCount) {

        totalRouteCount.textContent =
            totalCount;
    }


    if (progressDonut) {

        progressDonut.style.setProperty(
            "--progress",
            `${percentage}%`
        );

        progressDonut.style.background =
            `conic-gradient(
                #16a34a 0% ${percentage}%,
                #e5e7eb ${percentage}% 100%
            )`;

        progressDonut.setAttribute(
            "aria-label",
            `走破率${percentage}パーセント。${totalCount}路線中${completedCount}路線走破済み`
        );
    }


    console.log(
        `走破率更新: ${completedCount}/${totalCount}路線 ${percentage}%`
    );
}


// ---------- 情報パネル更新 ----------

function updatePanel(route) {

    emptyPanel.hidden = true;
    panelContent.hidden = false;


    routeNumber.textContent =
        "Route " +
        (route.number ?? "-");


    routeName.textContent =
        route.name ??
        "名称未登録";


    routeStart.textContent =
        route.start ??
        "未登録";


    routeEnd.textContent =
        route.end ??
        "未登録";


    const status =
        getEffectiveStatus(route);

    const statusColor =
        getStatusColor(status);


    routeStatus.textContent =
        status;

    routeStatus.style.color =
        statusColor;

    routeStatus.parentElement.style.borderLeft =
        `6px solid ${statusColor}`;


    if (
        route.photo &&
        route.photo !== "未登録"
    ) {

        routePhoto.src =
            "photos/" +
            route.photo;

        routePhoto.style.display =
            "block";

        photoValue.textContent =
            "1枚";

    } else {

        routePhoto.removeAttribute("src");

        routePhoto.style.display =
            "none";

        photoValue.textContent =
            "未登録";
    }


    const recordUrl =
        `record.html?route=${route.number}`;

    const savedRecord =
        getSavedRecord(route.number);

    const recordLink =
        document.createElement("a");

    recordLink.href =
        recordUrl;

    recordLink.textContent =
        savedRecord
            ? "走破記録を見る・編集"
            : "走破記録を入力";

    publicRecordValue.innerHTML = "";
    publicRecordValue.appendChild(
        recordLink
    );


    relatedTripsValue.innerHTML = "";


    const relatedTrips =
        window.Hokkaido48TripData
            ? window.Hokkaido48TripData.getRelatedTrips(
                route.number
            )
            : [];


    if (relatedTrips.length === 0) {

        relatedTripsValue.textContent =
            "関連Tripなし";

        return;
    }


    relatedTrips.forEach(
        function (trip) {

            const item =
                document.createElement("div");

            item.style.marginBottom =
                "10px";


            const link =
                document.createElement("a");

            link.href =
                `trip.html?trip=${encodeURIComponent(trip.id)}&route=${route.number}`;

            link.textContent =
                trip.tripName ||
                "名称未登録";

            link.style.fontWeight =
                "bold";


            item.appendChild(link);


            if (trip.startDate) {

                const date =
                    document.createElement("div");

                date.textContent =
                    trip.startDate.replaceAll(
                        "-",
                        "/"
                    );

                date.style.marginTop =
                    "3px";

                date.style.fontSize =
                    "13px";

                date.style.color =
                    "#6b7280";

                item.appendChild(date);
            }


            relatedTripsValue.appendChild(
                item
            );
        }
    );
}


// ---------- 全路線の色更新 ----------

function refreshRouteStyles() {

    allLayers.eachLayer(
        function (routeGroup) {

            routeGroup.eachLayer(
                function (layer) {

                    if (!layer.routeData) {
                        return;
                    }


                    if (layer === selectedLayer) {

                        layer.setStyle({
                            color: "#2563eb",
                            weight: 10,
                            opacity: 1
                        });

                    } else {

                        layer.setStyle(
                            getRouteStyle(
                                layer.routeData
                            )
                        );
                    }
                }
            );
        }
    );
}


// ---------- 保存内容反映 ----------

function refreshSavedRecordStatus() {

    updateProgressDisplay();

    refreshRouteStyles();

    renderRouteFinder();


    if (
        selectedLayer &&
        selectedLayer.routeData
    ) {

        updatePanel(
            selectedLayer.routeData
        );
    }
}


// ---------- 路線選択 ----------

function selectRouteLayer(
    layer,
    route,
    updateUrl
) {

    if (
        selectedLayer &&
        selectedLayer !== layer
    ) {

        selectedLayer.setStyle(
            getRouteStyle(
                selectedLayer.routeData
            )
        );
    }


    layer.setStyle({
        color: "#2563eb",
        weight: 10,
        opacity: 1
    });


    if (
        typeof layer.bringToFront ===
        "function"
    ) {

        layer.bringToFront();
    }


    routeLabelMarkers.forEach(
        function (marker) {

            marker.setZIndexOffset(
                1000
            );
        }
    );


    const selectedRouteLabel =
        routeLabelMarkers.get(
            String(route.number)
        );


    if (selectedRouteLabel) {

        selectedRouteLabel.setZIndexOffset(
            3000
        );
    }


    selectedLayer =
        layer;


    updatePanel(
        route
    );


    map.fitBounds(
        layer.getBounds(),
        {
            padding:
                [40, 40],
            maxZoom:
                13
        }
    );


    if (updateUrl) {

        const url =
            new URL(
                window.location.href
            );

        url.searchParams.set(
            "route",
            route.number
        );

        window.history.replaceState(
            null,
            "",
            url
        );
    }
}


// ---------- 路線レイヤー作成 ----------

function createRouteLayer(
    geojson,
    route
) {

    if (
        nonSelectableRouteNumbers.has(
            String(route.number)
        )
    ) {
        return;
    }

    const routeLayer =
        L.geoJSON(
            geojson,
            {

                pointToLayer:
                    function (
                        feature,
                        latlng
                    ) {

                        return L.circle(
                            latlng,
                            {
                                radius: 200
                            }
                        );
                    },

                style: function () {

                    return getRouteStyle(
                        route
                    );
                },


                onEachFeature:
                    function (
                        feature,
                        layer
                    ) {

                        if (
                            !feature.properties
                        ) {

                            feature.properties = {};
                        }


                        feature.properties.number =
                            route.number;


                        layer.routeData =
                            route;


                        if (
                            !routeLayers.has(
                                String(route.number)
                            )
                        ) {

                            routeLayers.set(
                                String(route.number),
                                layer
                            );
                        }


                        layer.on(
                            "click",
                            function () {

                                selectRouteLayer(
                                    layer,
                                    route,
                                    true
                                );
                            }
                        );
                    }
            }
        );


    routeLayer.addTo(
        allLayers
    );


    const selectionLayer =
        routeLayers.get(
            String(route.number)
        );


    if (selectionLayer) {

        createRouteNumberLabel(
            geojson,
            route,
            selectionLayer
        );
    }
}


// ---------- 別タブ保存時の自動更新 ----------

window.addEventListener(
    "storage",
    function (event) {

        if (
            event.key === "hokkaido48Trips" ||
            (
                event.key &&
                /^route\d{3}Record$/.test(
                    event.key
                )
            )
        ) {

            refreshSavedRecordStatus();
        }
    }
);


// ---------- メイン画面へ戻った時の更新 ----------

window.addEventListener(
    "focus",
    function () {

        if (
            routesData.length > 0
        ) {

            refreshSavedRecordStatus();
        }
    }
);


// ---------- タブ再表示時の更新 ----------

document.addEventListener(
    "visibilitychange",
    function () {

        if (
            document.visibilityState ===
            "visible" &&
            routesData.length > 0
        ) {

            refreshSavedRecordStatus();
        }
    }
);


// ---------- データ読込 ----------

fetch("data/routes.json")

    .then(
        function (response) {

            if (!response.ok) {

                throw new Error(
                    `routes.json読込失敗: ${response.status}`
                );
            }

            return response.json();
        }
    )

    .then(
        function (routes) {

            routesData =
                routes;

            updateProgressDisplay();

            renderRouteFinder();


            const loadTasks =
                routesData.map(
                    function (route) {

                        return fetch(
                            getGeojsonPath(
                                route.number
                            )
                        )

                            .then(
                                function (response) {

                                    if (
                                        !response.ok
                                    ) {

                                        throw new Error(
                                            `HTTP ${response.status}`
                                        );
                                    }

                                    return response.json();
                                }
                            )

                            .then(
                                function (geojson) {

                                    createRouteLayer(
                                        geojson,
                                        route
                                    );
                                }
                            )

                            .catch(
                                function (error) {

                                    console.error(
                                        "GeoJSON読み込みエラー:",
                                        route.number,
                                        error
                                    );
                                }
                            );
                    }
                );


            return Promise.all(
                loadTasks
            );
        }
    )

    .then(
        function () {

            const requestedRouteNumber =
                new URLSearchParams(
                    window.location.search
                ).get("route");

            const requestedLayer =
                requestedRouteNumber
                    ? routeLayers.get(
                        String(
                            Number(
                                requestedRouteNumber
                            )
                        )
                    )
                    : null;

            const requestedRoute =
                requestedRouteNumber
                    ? routesData.find(
                        route =>
                            String(route.number) ===
                            String(
                                Number(
                                    requestedRouteNumber
                                )
                            )
                    )
                    : null;


            if (
                requestedLayer &&
                requestedRoute
            ) {

                selectRouteLayer(
                    requestedLayer,
                    requestedRoute,
                    false
                );

            } else if (
                allLayers.getLayers()
                    .length > 0
            ) {

                map.fitBounds(
                    allLayers.getBounds(),
                    {
                        padding:
                            [20, 20]
                    }
                );
            }


            refreshSavedRecordStatus();


            console.log(
                "48路線読み込み完了"
            );
        }
    )

    .catch(
        function (error) {

            console.error(
                "読み込みエラー:",
                error
            );
        }
    );


console.log(
    "Version3.4 Route Finder Ready"
);
