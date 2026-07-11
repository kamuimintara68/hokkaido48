// =====================================================
// 北海道48路線ふらふらlog
// Version 2.6
// app.js
// 走破率ドーナツグラフ・Status自動更新版
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

const noteValue =
    document.getElementById("noteValue");

const fermentValue =
    document.getElementById("fermentValue");

const publicRecordValue =
    document.getElementById("publicRecordValue");
const relatedTripsValue =
    document.getElementById("relatedTripsValue");

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

const allLayers =
    L.featureGroup().addTo(map);


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


// ---------- 実際の走破状態 ----------

function getEffectiveStatus(route) {

    const storageKey =
        getRecordStorageKey(route.number);

    const savedRecord =
        localStorage.getItem(storageKey);

    if (savedRecord) {
        return "走破済";
    }

    return route.status ?? "未走破";
}


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
        weight: 4,
        opacity: 0.9
    };
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


    if (
        route.note &&
        route.note !== "未登録"
    ) {

        noteValue.innerHTML =
            `<a href="${route.note}" target="_blank" rel="noopener noreferrer">noteを見る</a>`;

    } else {

        noteValue.textContent =
            "未登録";
    }


    if (
        route.ferment &&
        route.ferment !== "未登録"
    ) {

        fermentValue.innerHTML =
            `<a href="${route.ferment}" target="_blank" rel="noopener noreferrer">Ferment Logを見る</a>`;

    } else {

        fermentValue.textContent =
            "未登録";
    }


    if (
        route.publicRecord &&
        route.publicRecord !== "未登録"
    ) {

        const recordUrl =
            `record.html?route=${route.number}`;

        publicRecordValue.innerHTML =
            `<a href="${recordUrl}" target="_blank" rel="noopener noreferrer">走破記録を見る</a>`;

    } else {

        publicRecordValue.textContent =
            "未登録";
    }


    relatedTripsValue.innerHTML = "";


    let trips = [];

    const savedTrips =
        localStorage.getItem(
            "hokkaido48Trips"
        );


    if (savedTrips) {

        try {

            trips =
                JSON.parse(savedTrips);

        } catch (error) {

            console.error(
                "Tripデータ読込エラー:",
                error
            );
        }
    }


    const selectedRouteNumber =
        String(route.number);


    const relatedTrips =
        trips
            .filter(function (trip) {

                const routeNumbers =
                    String(trip.routes || "")
    .normalize("NFKC")
                        .split(/[,\s、，・]+/)
                        .map(function (value) {

                            return value.replace(
                                /[^0-9]/g,
                                ""
                            );
                        })
                        .filter(function (value) {

                            return value !== "";
                        });

                return routeNumbers.includes(
                    selectedRouteNumber
                );
            })
            .sort(function (a, b) {

                return (
                    (b.startDate || "")
                        .localeCompare(
                            a.startDate || ""
                        )
                );
            });


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
                `trip.html?trip=${encodeURIComponent(trip.id)}`;

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
                            weight: 7,
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


    if (
        selectedLayer &&
        selectedLayer.routeData
    ) {

        updatePanel(
            selectedLayer.routeData
        );
    }
}


// ---------- 路線レイヤー作成 ----------

function createRouteLayer(
    geojson,
    route
) {

    const routeLayer =
        L.geoJSON(
            geojson,
            {

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


                        layer.on(
                            "click",
                            function () {

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
                                    weight: 7,
                                    opacity: 1
                                });


                                selectedLayer =
                                    layer;


                                updatePanel(
                                    route
                                );


                                map.fitBounds(
                                    layer.getBounds(),
                                    {
                                        padding:
                                            [40, 40]
                                    }
                                );
                            }
                        );
                    }
            }
        );


    routeLayer.addTo(
        allLayers
    );
}


// ---------- 別タブ保存時の自動更新 ----------

window.addEventListener(
    "storage",
    function (event) {

        if (
            event.key &&
            /^route\d{3}Record$/.test(
                event.key
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

            if (
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
    " Version2.6 Ready"
);