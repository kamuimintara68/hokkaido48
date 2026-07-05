let map;
let selectedRoute = null;
let selectedLayer = null;

const ROUTES_JSON_PATH = "data/routes.json";

document.addEventListener("DOMContentLoaded", () => {
    initializeMap();
    setupStatusButtons();
    setupButtons();
    loadRoutes();
});

function initializeMap() {
    map = L.map("map").setView([43.7, 142.6], 7);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
    }).addTo(map);
}

async function loadRoutes() {
    const response = await fetch(ROUTES_JSON_PATH);
    const json = await response.json();

    for (const route of json.routes) {
        const geoResponse = await fetch("data/" + route.geojson);
        const geojson = await geoResponse.json();

        const layerGroup = L.geoJSON(geojson, {
            style: getNormalStyle(route)
        }).addTo(map);

        layerGroup.eachLayer(layer => {
            layer.on("click", () => selectRoute(route, layer));
        });

        map.fitBounds(layerGroup.getBounds(), {
            padding: [30, 30]
        });
    }
}

function selectRoute(route, layer) {
    if (selectedLayer && selectedRoute) {
        selectedLayer.setStyle(getNormalStyle(selectedRoute));
    }

    selectedRoute = route;
    selectedLayer = layer;

    selectedLayer.setStyle(getSelectedStyle());

    updateInfoPanel(route);
}

function updateInfoPanel(route) {
    document.getElementById("routeNumber").textContent = "国道" + route.number + "号";
    document.getElementById("routeName").textContent = route.name || "未登録";
    document.getElementById("routeStart").textContent = route.start || "未登録";
    document.getElementById("routeEnd").textContent = route.end || "未登録";
    document.getElementById("routeStatus").textContent = getStatusText(route.status);

    document.getElementById("photoCount").textContent =
        route.photoCount ? route.photoCount + "枚" : "未登録";

    document.getElementById("noteInfo").textContent =
        route.note ? "登録済" : "未登録";

    document.getElementById("kinInfo").textContent =
        route.kin || "未登録";

    document.getElementById("noteDisplay").textContent =
        route.note || "未登録";

    const photoBox = document.querySelector(".photo-placeholder");

    if (route.photo) {
        photoBox.innerHTML =
            `<img src="photos/${route.photo}" alt="路線写真" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`;
    } else {
        photoBox.innerHTML = "<span>写真未登録</span>";
    }
}

function setupStatusButtons() {
    document.getElementById("btnUntraveled").onclick = () => {
        changeSelectedStatus("untraveled");
    };

    document.getElementById("btnPartial").onclick = () => {
        changeSelectedStatus("partial");
    };

    document.getElementById("btnTraveled").onclick = () => {
        changeSelectedStatus("traveled");
    };
}

function setupButtons() {
    document.getElementById("btnOpenPhoto").onclick = () => {
        if (!selectedRoute || !selectedRoute.photo) {
            alert("写真は登録されていません。");
            return;
        }

        window.open("photos/" + selectedRoute.photo, "_blank");
    };

    document.getElementById("btnOpenNote").onclick = () => {
        if (!selectedRoute || !selectedRoute.note) {
            alert("noteは登録されていません。");
            return;
        }

        window.open(selectedRoute.note, "_blank");
    };
}

function changeSelectedStatus(status) {
    if (!selectedRoute || !selectedLayer) {
        alert("先に路線をクリックしてください。");
        return;
    }

    selectedRoute.status = status;
    selectedLayer.setStyle(getSelectedStyle());
    updateInfoPanel(selectedRoute);
}

function getNormalStyle(route) {
    return {
        color: getStatusColor(route.status),
        weight: 5,
        opacity: 0.9
    };
}

function getSelectedStyle() {
    return {
        color: "#1565c0",
        weight: 8,
        opacity: 1
    };
}

function getStatusColor(status) {
    if (status === "traveled") {
        return "#2e7d32";
    }

    if (status === "partial") {
        return "#f9a825";
    }

    return "#d32f2f";
}

function getStatusText(status) {
    if (status === "traveled") {
        return "走破済";
    }

    if (status === "partial") {
        return "一部走破";
    }

    return "未走破";
}