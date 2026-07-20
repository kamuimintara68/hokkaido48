"use strict";

const TripData = window.Hokkaido48TripData;

const fields = [
    "tripName",
    "startDate",
    "endDate",
    "actionLog",
    "timeline",
    "impressions",
    "improvements",
    "thumbnail",
    "ferment",
    "noteArticle",
    "memo"
];

const tripId = document.getElementById("tripId");
const message = document.getElementById("message");
const tripList = document.getElementById("tripList");
const deleteButton = document.getElementById("deleteButton");
const routeSequence = document.getElementById("routeSequence");
const mapInstruction = document.getElementById("mapInstruction");

let routesMaster = [];
let routeSegments = [];
let selectionMode = null;
let mapRefreshToken = 0;

const geojsonCache = new Map();
const connectionCache = new Map();

const routeMap = L.map("routeMap").setView([43.8, 142.8], 6);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors"
    }
).addTo(routeMap);

const routeLayerGroup = L.layerGroup().addTo(routeMap);
const selectedSectionLayerGroup = L.layerGroup().addTo(routeMap);
const pointLayerGroup = L.layerGroup().addTo(routeMap);
const candidateLayerGroup = L.layerGroup().addTo(routeMap);

const routeColors = [
    "#2563eb",
    "#7c3aed",
    "#db2777",
    "#0891b2",
    "#ca8a04",
    "#4f46e5"
];


function createTripId() {

    return (
        "trip-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8)
    );
}


function createRouteSegment(routeNumber) {

    return {
        id: TripData.createSegmentId(),
        routeNumber: routeNumber ? String(routeNumber) : "",
        status: "partial",
        startPoint: null,
        endPoint: null,
        confirmedPath: []
    };
}


function clonePoint(point) {

    const normalized = TripData.normalizePoint(point);

    return normalized ? { ...normalized } : null;
}


function cloneSegments(segments) {

    return segments.map(segment => ({
        id: segment.id || TripData.createSegmentId(),
        routeNumber: String(segment.routeNumber || ""),
        status: segment.status === "complete" ? "complete" : "partial",
        startPoint: clonePoint(segment.startPoint),
        endPoint: clonePoint(segment.endPoint),
        confirmedPath: Array.isArray(segment.confirmedPath)
            ? segment.confirmedPath
                .filter(point => Array.isArray(point) && point.length >= 2)
                .map(point => [Number(point[0]), Number(point[1])])
                .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
            : []
    }));
}


function pointText(point) {

    return point
        ? point.label || "指定地点"
        : "地点未指定";
}


function getRouteMaster(routeNumber) {

    return routesMaster.find(
        route => String(route.number) === String(routeNumber)
    );
}


function createRouteSelect(segment, segmentIndex) {

    const select = document.createElement("select");
    select.setAttribute("aria-label", `走行順${segmentIndex + 1}の国道`);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "国道を選択";
    select.appendChild(placeholder);

    routesMaster.forEach(route => {

        const option = document.createElement("option");
        option.value = String(route.number);
        option.textContent =
            `国道${route.number}号　${route.start}－${route.end}`;

        if (String(segment.routeNumber) === String(route.number)) {
            option.selected = true;
        }

        select.appendChild(option);
    });

    select.addEventListener("change", function () {

        resetAdjacentConnections(segmentIndex);
        segment.routeNumber = select.value;
        refreshRouteBuilder(true);
    });

    return select;
}


function createStatusSelect(segment) {

    const select = document.createElement("select");
    select.setAttribute("aria-label", "走破状態");

    [
        ["partial", "一部走破"],
        ["complete", "全線走破"]
    ].forEach(([value, label]) => {

        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = segment.status === value;
        select.appendChild(option);
    });

    select.addEventListener("change", function () {

        segment.status = select.value;
        refreshRouteMap(false);
    });

    return select;
}


function createPointBox(title, point, buttonText, onClick) {

    const box = document.createElement("div");
    box.className = "point-box";

    const heading = document.createElement("strong");
    heading.textContent = title;

    const value = document.createElement("span");
    value.textContent = pointText(point);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "point-button";
    button.textContent = buttonText;
    button.addEventListener("click", onClick);

    box.appendChild(heading);
    box.appendChild(value);
    box.appendChild(button);

    return box;
}


function createSegmentActions(segmentIndex) {

    const actions = document.createElement("div");
    actions.className = "segment-actions";

    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "small-button";
    moveUp.textContent = "↑";
    moveUp.title = "一つ前へ移動";
    moveUp.disabled = segmentIndex === 0;
    moveUp.addEventListener("click", function () {

        if (segmentIndex === 0) {
            return;
        }

        [
            routeSegments[segmentIndex - 1],
            routeSegments[segmentIndex]
        ] = [
            routeSegments[segmentIndex],
            routeSegments[segmentIndex - 1]
        ];

        clearAllConnections();
        refreshRouteBuilder(true);
    });

    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "small-button";
    moveDown.textContent = "↓";
    moveDown.title = "一つ後へ移動";
    moveDown.disabled = segmentIndex === routeSegments.length - 1;
    moveDown.addEventListener("click", function () {

        if (segmentIndex >= routeSegments.length - 1) {
            return;
        }

        [
            routeSegments[segmentIndex],
            routeSegments[segmentIndex + 1]
        ] = [
            routeSegments[segmentIndex + 1],
            routeSegments[segmentIndex]
        ];

        clearAllConnections();
        refreshRouteBuilder(true);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-button remove-button";
    remove.textContent = "削除";
    remove.addEventListener("click", function () {

        routeSegments.splice(segmentIndex, 1);

        if (routeSegments.length === 0) {
            routeSegments.push(createRouteSegment());
        }

        clearAllConnections();
        refreshRouteBuilder(true);
    });

    actions.appendChild(moveUp);
    actions.appendChild(moveDown);
    actions.appendChild(remove);

    return actions;
}


function createSegmentCard(segment, segmentIndex) {

    const card = document.createElement("article");
    card.className = "route-segment-card";

    const title = document.createElement("div");
    title.className = "route-segment-title";

    const titleText = document.createElement("span");
    titleText.textContent = `走行順 ${segmentIndex + 1}`;

    title.appendChild(titleText);
    title.appendChild(createSegmentActions(segmentIndex));

    const selectGrid = document.createElement("div");
    selectGrid.className = "route-segment-grid";
    selectGrid.appendChild(createRouteSelect(segment, segmentIndex));
    selectGrid.appendChild(createStatusSelect(segment));

    const pointGrid = document.createElement("div");
    pointGrid.className = "point-grid";
    pointGrid.appendChild(
        createPointBox(
            "開始地点",
            segment.startPoint,
            "地図から指定",
            function () {
                beginPointSelection("start", segmentIndex);
            }
        )
    );
    pointGrid.appendChild(
        createPointBox(
            "終了地点",
            segment.endPoint,
            "地図から指定",
            function () {
                beginPointSelection("end", segmentIndex);
            }
        )
    );

    card.appendChild(title);
    card.appendChild(selectGrid);

    if (
        segment.status === "partial" &&
        Array.isArray(segment.confirmedPath) &&
        segment.confirmedPath.length >= 2
    ) {
        const confirmedNote = document.createElement("p");
        confirmedNote.className = "auto-confirmed-note";
        confirmedNote.textContent =
            `✅ GPX＋TXT自動確定済み区間（${segment.confirmedPath.length}点）`;
        confirmedNote.style.margin = "10px 0 0";
        confirmedNote.style.fontWeight = "700";
        confirmedNote.style.color = "#166534";
        card.appendChild(confirmedNote);
    }

    card.appendChild(pointGrid);

    return card;
}


function connectionKey(firstSegment, secondSegment) {

    return `${firstSegment.routeNumber}|${secondSegment.routeNumber}`;
}


function samePoint(firstPoint, secondPoint) {

    if (!firstPoint || !secondPoint) {
        return false;
    }

    return distanceMeters(firstPoint, secondPoint) < 30;
}


function createConnectionCard(segmentIndex) {

    const firstSegment = routeSegments[segmentIndex];
    const secondSegment = routeSegments[segmentIndex + 1];
    const card = document.createElement("div");
    card.className = "connection-card";

    const title = document.createElement("div");
    title.className = "connection-title";

    if (!firstSegment.routeNumber || !secondSegment.routeNumber) {

        title.textContent = "前後の国道を選ぶと接続候補を検索します。";
        card.appendChild(title);
        return card;
    }

    title.textContent =
        `国道${firstSegment.routeNumber}号 → 国道${secondSegment.routeNumber}号`;

    card.appendChild(title);

    const candidateArea = document.createElement("div");
    candidateArea.className = "connection-candidates";
    card.appendChild(candidateArea);

    const key = connectionKey(firstSegment, secondSegment);
    const cacheEntry = connectionCache.get(key);

    if (!cacheEntry) {

        candidateArea.textContent = "接続候補を検索中です。";
        findAndCacheConnections(segmentIndex);
        return card;
    }

    if (cacheEntry.status === "loading") {

        candidateArea.textContent = "接続候補を検索中です。";
        return card;
    }

    if (cacheEntry.candidates.length === 0) {

        const text = document.createElement("span");
        text.textContent = "自動候補が見つかりません。";
        candidateArea.appendChild(text);
    }

    cacheEntry.candidates.forEach((candidate, candidateIndex) => {

        const button = document.createElement("button");
        button.type = "button";
        button.className = "candidate-button";
        button.textContent = candidate.label;

        if (
            samePoint(firstSegment.endPoint, candidate) &&
            samePoint(secondSegment.startPoint, candidate)
        ) {
            button.classList.add("selected");
        }

        button.addEventListener("click", function () {

            selectConnection(segmentIndex, {
                ...candidate,
                label:
                    `国道${firstSegment.routeNumber}号→` +
                    `国道${secondSegment.routeNumber}号 ` +
                    candidate.label,
                source: "automatic-connection"
            });
        });

        button.addEventListener("mouseenter", function () {

            showCandidateOnMap(candidate, candidateIndex + 1);
        });

        candidateArea.appendChild(button);
    });

    const manualButton = document.createElement("button");
    manualButton.type = "button";
    manualButton.className = "candidate-button";
    manualButton.textContent = "地図から指定";
    manualButton.addEventListener("click", function () {

        beginConnectionSelection(segmentIndex);
    });

    candidateArea.appendChild(manualButton);

    return card;
}


function renderRouteSequence() {

    routeSequence.innerHTML = "";

    routeSegments.forEach((segment, segmentIndex) => {

        routeSequence.appendChild(
            createSegmentCard(segment, segmentIndex)
        );

        if (segmentIndex < routeSegments.length - 1) {
            routeSequence.appendChild(
                createConnectionCard(segmentIndex)
            );
        }
    });
}


function resetAdjacentConnections(segmentIndex) {

    const segment = routeSegments[segmentIndex];

    if (segmentIndex > 0) {

        routeSegments[segmentIndex - 1].endPoint = null;
        segment.startPoint = null;
    }

    if (segmentIndex < routeSegments.length - 1) {

        segment.endPoint = null;
        routeSegments[segmentIndex + 1].startPoint = null;
    }
}


function clearAllConnections() {

    for (let index = 0; index < routeSegments.length - 1; index += 1) {

        routeSegments[index].endPoint = null;
        routeSegments[index + 1].startPoint = null;
    }
}


function beginPointSelection(type, segmentIndex) {

    const segment = routeSegments[segmentIndex];

    if (!segment.routeNumber) {

        message.textContent = "先に国道を選択してください。";
        return;
    }

    if (type === "start" && segmentIndex > 0) {

        beginConnectionSelection(segmentIndex - 1);
        return;
    }

    if (type === "end" && segmentIndex < routeSegments.length - 1) {

        beginConnectionSelection(segmentIndex);
        return;
    }

    selectionMode = {
        type,
        segmentIndex
    };

    mapInstruction.textContent =
        `国道${segment.routeNumber}号の` +
        `${type === "start" ? "開始" : "終了"}地点付近を地図で選択してください。`;
}


function beginConnectionSelection(segmentIndex) {

    const firstSegment = routeSegments[segmentIndex];
    const secondSegment = routeSegments[segmentIndex + 1];

    selectionMode = {
        type: "connection",
        segmentIndex
    };

    mapInstruction.textContent =
        `国道${firstSegment.routeNumber}号から国道${secondSegment.routeNumber}号へ` +
        "乗り換えた地点付近を地図で選択してください。";
}


function selectConnection(segmentIndex, point) {

    const firstSegment = routeSegments[segmentIndex];
    const secondSegment = routeSegments[segmentIndex + 1];

    firstSegment.endPoint = clonePoint(point);
    secondSegment.startPoint = clonePoint(point);
    selectionMode = null;

    mapInstruction.textContent = point.label;
    refreshRouteBuilder(false);
}


function getGeojsonPath(routeNumber) {

    return (
        "data/geojson/route_" +
        String(routeNumber).padStart(3, "0") +
        ".geojson"
    );
}


function loadRouteGeojson(routeNumber) {

    const key = String(routeNumber);

    if (!geojsonCache.has(key)) {

        geojsonCache.set(
            key,
            fetch(getGeojsonPath(routeNumber))
                .then(response => {

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    return response.json();
                })
                .catch(error => {

                    geojsonCache.delete(key);
                    throw error;
                })
        );
    }

    return geojsonCache.get(key);
}


function extractCoordinateLines(geojson) {

    const lines = [];

    function collect(item) {

        if (!item) {
            return;
        }

        if (item.type === "FeatureCollection") {
            (item.features || []).forEach(collect);
            return;
        }

        if (item.type === "Feature") {
            collect(item.geometry);
            return;
        }

        if (item.type === "GeometryCollection") {
            (item.geometries || []).forEach(collect);
            return;
        }

        if (item.type === "LineString") {

            const line = (item.coordinates || [])
                .filter(coordinate =>
                    Array.isArray(coordinate) && coordinate.length >= 2
                )
                .map(coordinate => ({
                    lat: Number(coordinate[1]),
                    lng: Number(coordinate[0])
                }))
                .filter(point =>
                    Number.isFinite(point.lat) && Number.isFinite(point.lng)
                );

            if (line.length > 0) {
                lines.push(line);
            }

            return;
        }

        if (item.type === "MultiLineString") {

            (item.coordinates || []).forEach(coordinates => {
                collect({
                    type: "LineString",
                    coordinates
                });
            });
        }
    }

    collect(geojson);
    return lines;
}


function flattenRoutePoints(geojson) {

    const points = [];
    let sequence = 0;

    extractCoordinateLines(geojson).forEach((line, lineIndex) => {

        line.forEach((point, pointIndex) => {

            points.push({
                ...point,
                lineIndex,
                pointIndex,
                sequence
            });

            sequence += 1;
        });

        sequence += 1000;
    });

    return points;
}


function distanceMeters(firstPoint, secondPoint) {

    const earthRadius = 6371000;
    const toRadians = value => value * Math.PI / 180;
    const firstLat = toRadians(Number(firstPoint.lat));
    const secondLat = toRadians(Number(secondPoint.lat));
    const latDifference = secondLat - firstLat;
    const lngDifference =
        toRadians(Number(secondPoint.lng) - Number(firstPoint.lng));

    const a =
        Math.sin(latDifference / 2) ** 2 +
        Math.cos(firstLat) *
        Math.cos(secondLat) *
        Math.sin(lngDifference / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


function midpoint(firstPoint, secondPoint) {

    return {
        lat: (Number(firstPoint.lat) + Number(secondPoint.lat)) / 2,
        lng: (Number(firstPoint.lng) + Number(secondPoint.lng)) / 2
    };
}


function buildPointGrid(points, cellSize) {

    const grid = new Map();

    points.forEach(point => {

        const x = Math.floor(point.lat / cellSize);
        const y = Math.floor(point.lng / cellSize);
        const key = `${x}:${y}`;

        if (!grid.has(key)) {
            grid.set(key, []);
        }

        grid.get(key).push(point);
    });

    return grid;
}


function getNearbyGridPoints(grid, point, cellSize) {

    const nearby = [];
    const baseX = Math.floor(point.lat / cellSize);
    const baseY = Math.floor(point.lng / cellSize);

    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {

        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {

            const key = `${baseX + xOffset}:${baseY + yOffset}`;
            nearby.push(...(grid.get(key) || []));
        }
    }

    return nearby;
}


function deduplicateCandidates(candidates) {

    const deduplicated = [];

    candidates.forEach(candidate => {

        if (
            !deduplicated.some(existing =>
                distanceMeters(existing, candidate) < 300
            )
        ) {
            deduplicated.push(candidate);
        }
    });

    return deduplicated.slice(0, 8);
}


function findConnectionCandidates(firstGeojson, secondGeojson) {

    const firstPoints = flattenRoutePoints(firstGeojson);
    const secondPoints = flattenRoutePoints(secondGeojson);
    const cellSize = 0.002;
    const secondGrid = buildPointGrid(secondPoints, cellSize);
    const matches = [];

    firstPoints.forEach(firstPoint => {

        let nearestPoint = null;
        let nearestDistance = Infinity;

        getNearbyGridPoints(secondGrid, firstPoint, cellSize)
            .forEach(secondPoint => {

                const distance = distanceMeters(firstPoint, secondPoint);

                if (distance < nearestDistance) {
                    nearestPoint = secondPoint;
                    nearestDistance = distance;
                }
            });

        if (nearestPoint && nearestDistance <= 160) {

            matches.push({
                sequence: firstPoint.sequence,
                distance: nearestDistance,
                point: midpoint(firstPoint, nearestPoint)
            });
        }
    });

    if (matches.length === 0) {
        return [];
    }

    const groups = [];

    matches.forEach(match => {

        const currentGroup = groups[groups.length - 1];

        if (
            !currentGroup ||
            match.sequence - currentGroup.lastSequence > 80 ||
            distanceMeters(currentGroup.lastPoint, match.point) > 900
        ) {

            groups.push({
                matches: [match],
                lastSequence: match.sequence,
                lastPoint: match.point
            });

        } else {

            currentGroup.matches.push(match);
            currentGroup.lastSequence = match.sequence;
            currentGroup.lastPoint = match.point;
        }
    });

    const rawCandidates = [];

    groups.forEach(group => {

        const groupMatches = group.matches;
        const first = groupMatches[0];
        const last = groupMatches[groupMatches.length - 1];
        const span = distanceMeters(first.point, last.point);

        if (span >= 700) {

            rawCandidates.push({
                ...first.point,
                kind: "overlap-start"
            });
            rawCandidates.push({
                ...last.point,
                kind: "overlap-end"
            });

        } else {

            const best = [...groupMatches].sort(
                (a, b) => a.distance - b.distance
            )[0];

            rawCandidates.push({
                ...best.point,
                kind: "intersection"
            });
        }
    });

    return deduplicateCandidates(rawCandidates)
        .map((candidate, index) => ({
            ...candidate,
            label:
                candidate.kind === "overlap-start"
                    ? `重複区間入口 ${index + 1}`
                    : candidate.kind === "overlap-end"
                        ? `重複区間出口 ${index + 1}`
                        : `接続候補 ${index + 1}`,
            source: "automatic-candidate"
        }));
}


function findAndCacheConnections(segmentIndex) {

    const firstSegment = routeSegments[segmentIndex];
    const secondSegment = routeSegments[segmentIndex + 1];
    const key = connectionKey(firstSegment, secondSegment);

    if (connectionCache.has(key)) {
        return;
    }

    connectionCache.set(key, {
        status: "loading",
        candidates: []
    });

    Promise.all([
        loadRouteGeojson(firstSegment.routeNumber),
        loadRouteGeojson(secondSegment.routeNumber)
    ])
        .then(([firstGeojson, secondGeojson]) => {

            const candidates = findConnectionCandidates(
                firstGeojson,
                secondGeojson
            );

            connectionCache.set(key, {
                status: "ready",
                candidates
            });

            const currentFirstSegment = routeSegments[segmentIndex];
            const currentSecondSegment = routeSegments[segmentIndex + 1];

            if (
                candidates.length === 1 &&
                currentFirstSegment === firstSegment &&
                currentSecondSegment === secondSegment &&
                !firstSegment.endPoint &&
                !secondSegment.startPoint
            ) {

                selectConnection(segmentIndex, {
                    ...candidates[0],
                    label:
                        `国道${firstSegment.routeNumber}号→` +
                        `国道${secondSegment.routeNumber}号 ` +
                        candidates[0].label,
                    source: "automatic-connection"
                });

                return;
            }

            renderRouteSequence();
            refreshCandidateMarkers();
        })
        .catch(error => {

            console.error("接続候補検索エラー:", error);

            connectionCache.set(key, {
                status: "ready",
                candidates: []
            });

            renderRouteSequence();
        });
}


function findNearestPoint(geojson, targetPoint) {

    let nearestPoint = null;
    let nearestDistance = Infinity;

    flattenRoutePoints(geojson).forEach(point => {

        const distance = distanceMeters(point, targetPoint);

        if (distance < nearestDistance) {
            nearestPoint = point;
            nearestDistance = distance;
        }
    });

    return nearestPoint
        ? {
            lat: nearestPoint.lat,
            lng: nearestPoint.lng,
            distance: nearestDistance
        }
        : null;
}


function buildSelectedSection(geojson, startPoint, endPoint) {

    if (!startPoint || !endPoint) {
        return [];
    }

    const lines = extractCoordinateLines(geojson);
    let bestStart = null;
    let bestEnd = null;

    lines.forEach((line, lineIndex) => {

        line.forEach((point, pointIndex) => {

            const startDistance = distanceMeters(point, startPoint);
            const endDistance = distanceMeters(point, endPoint);

            if (!bestStart || startDistance < bestStart.distance) {
                bestStart = { lineIndex, pointIndex, distance: startDistance };
            }

            if (!bestEnd || endDistance < bestEnd.distance) {
                bestEnd = { lineIndex, pointIndex, distance: endDistance };
            }
        });
    });

    if (
        !bestStart ||
        !bestEnd ||
        bestStart.lineIndex !== bestEnd.lineIndex
    ) {
        return [];
    }

    const line = lines[bestStart.lineIndex];
    const fromIndex = Math.min(bestStart.pointIndex, bestEnd.pointIndex);
    const toIndex = Math.max(bestStart.pointIndex, bestEnd.pointIndex);

    return line
        .slice(fromIndex, toIndex + 1)
        .map(point => [point.lat, point.lng]);
}


function addPointMarker(point, label, color) {

    if (!point) {
        return;
    }

    L.circleMarker(
        [point.lat, point.lng],
        {
            radius: 7,
            color,
            weight: 3,
            fillColor: "#ffffff",
            fillOpacity: 1
        }
    )
        .bindTooltip(label)
        .addTo(pointLayerGroup);
}


function refreshCandidateMarkers() {

    candidateLayerGroup.clearLayers();

    for (let index = 0; index < routeSegments.length - 1; index += 1) {

        const firstSegment = routeSegments[index];
        const secondSegment = routeSegments[index + 1];

        if (!firstSegment.routeNumber || !secondSegment.routeNumber) {
            continue;
        }

        const entry = connectionCache.get(
            connectionKey(firstSegment, secondSegment)
        );

        if (!entry || entry.status !== "ready") {
            continue;
        }

        entry.candidates.forEach(candidate => {

            L.circleMarker(
                [candidate.lat, candidate.lng],
                {
                    radius: 6,
                    color: "#1d4ed8",
                    weight: 2,
                    fillColor: "#bfdbfe",
                    fillOpacity: 0.9
                }
            )
                .bindTooltip(
                    `${candidate.label}：` +
                    `国道${firstSegment.routeNumber}号→` +
                    `国道${secondSegment.routeNumber}号`
                )
                .on("click", function () {

                    selectConnection(index, {
                        ...candidate,
                        label:
                            `国道${firstSegment.routeNumber}号→` +
                            `国道${secondSegment.routeNumber}号 ` +
                            candidate.label,
                        source: "automatic-connection"
                    });
                })
                .addTo(candidateLayerGroup);
        });
    }
}


function showCandidateOnMap(candidate, candidateNumber) {

    routeMap.panTo([candidate.lat, candidate.lng]);
    mapInstruction.textContent = `接続候補${candidateNumber}を地図中央に表示しています。`;
}


async function refreshRouteMap(shouldFit) {

    const currentToken = ++mapRefreshToken;
    routeLayerGroup.clearLayers();
    selectedSectionLayerGroup.clearLayers();
    pointLayerGroup.clearLayers();

    const bounds = L.latLngBounds();

    const loadTasks = routeSegments.map(async (segment, segmentIndex) => {

        if (!segment.routeNumber) {
            return;
        }

        try {

            const geojson = await loadRouteGeojson(segment.routeNumber);

            if (currentToken !== mapRefreshToken) {
                return;
            }

            const color = routeColors[segmentIndex % routeColors.length];
            const routeLayer = L.geoJSON(
                geojson,
                {
                    style: {
                        color,
                        weight: 6,
                        opacity: 0.55
                    },
                    interactive: false
                }
            ).addTo(routeLayerGroup);

            bounds.extend(routeLayer.getBounds());

            if (segment.status === "complete") {

                L.geoJSON(
                    geojson,
                    {
                        style: {
                            color: "#16a34a",
                            weight: 8,
                            opacity: 0.9
                        },
                        interactive: false
                    }
                ).addTo(selectedSectionLayerGroup);

            } else {

                const selectedSection = buildSelectedSection(
                    geojson,
                    segment.startPoint,
                    segment.endPoint
                );

                if (selectedSection.length >= 2) {

                    L.polyline(
                        selectedSection,
                        {
                            color: "#ea580c",
                            weight: 9,
                            opacity: 0.95
                        }
                    ).addTo(selectedSectionLayerGroup);
                }
            }

            addPointMarker(
                segment.startPoint,
                `国道${segment.routeNumber}号 開始地点`,
                "#15803d"
            );
            addPointMarker(
                segment.endPoint,
                `国道${segment.routeNumber}号 終了地点`,
                "#b91c1c"
            );

        } catch (error) {

            console.error(
                `国道${segment.routeNumber}号の地図読込エラー:`,
                error
            );
        }
    });

    await Promise.all(loadTasks);

    if (
        currentToken === mapRefreshToken &&
        shouldFit &&
        bounds.isValid()
    ) {

        routeMap.fitBounds(bounds, {
            padding: [24, 24],
            maxZoom: 12
        });
    }

    refreshCandidateMarkers();
}


function refreshRouteBuilder(shouldFit) {

    renderRouteSequence();
    refreshRouteMap(shouldFit);
}


routeMap.on("click", async function (event) {

    if (!selectionMode) {
        return;
    }

    const currentMode = { ...selectionMode };

    if (currentMode.type === "connection") {

        const firstSegment = routeSegments[currentMode.segmentIndex];
        const secondSegment = routeSegments[currentMode.segmentIndex + 1];

        try {

            const [firstGeojson, secondGeojson] = await Promise.all([
                loadRouteGeojson(firstSegment.routeNumber),
                loadRouteGeojson(secondSegment.routeNumber)
            ]);

            const firstPoint = findNearestPoint(firstGeojson, event.latlng);
            const secondPoint = findNearestPoint(secondGeojson, event.latlng);
            const chosenPoint =
                firstPoint && secondPoint
                    ? midpoint(firstPoint, secondPoint)
                    : event.latlng;

            selectConnection(currentMode.segmentIndex, {
                ...chosenPoint,
                label:
                    `国道${firstSegment.routeNumber}号→` +
                    `国道${secondSegment.routeNumber}号 手動指定地点`,
                source: "manual-connection"
            });

        } catch (error) {

            console.error("接続地点指定エラー:", error);
            message.textContent = "接続地点を指定できませんでした。";
        }

        return;
    }

    const segment = routeSegments[currentMode.segmentIndex];

    try {

        const geojson = await loadRouteGeojson(segment.routeNumber);
        const nearestPoint = findNearestPoint(geojson, event.latlng);

        if (!nearestPoint) {
            return;
        }

        const point = {
            lat: nearestPoint.lat,
            lng: nearestPoint.lng,
            label:
                `国道${segment.routeNumber}号 ` +
                `${currentMode.type === "start" ? "開始" : "終了"}地点`,
            source: "manual-route-point"
        };

        segment[`${currentMode.type}Point`] = point;
        selectionMode = null;
        mapInstruction.textContent = point.label + "を指定しました。";
        refreshRouteBuilder(false);

    } catch (error) {

        console.error("地点指定エラー:", error);
        message.textContent = "地点を指定できませんでした。";
    }
});


function getInputData() {

    const trip = {
        id: tripId.value || createTripId(),
        updatedAt: new Date().toISOString(),
        routeSegments: cloneSegments(routeSegments)
            .filter(segment => segment.routeNumber)
    };

    fields.forEach(field => {

        trip[field] = document.getElementById(field).value.trim();
    });

    return TripData.normalizeTrip(trip);
}


function clearForm() {

    tripId.value = "";

    fields.forEach(field => {
        document.getElementById(field).value = "";
    });

    routeSegments = [createRouteSegment()];
    selectionMode = null;
    deleteButton.disabled = true;
    message.textContent = "新しいTripを入力できます。";
    mapInstruction.textContent = "国道を選択すると地図に表示されます。";
    refreshRouteBuilder(true);
}


function saveTrip() {

    const trip = getInputData();

    if (!trip.tripName) {

        message.textContent = "Trip名を入力してください。";
        return;
    }

    if (trip.routeSegments.length === 0) {

        message.textContent = "走行した国道を選択してください。";
        return;
    }

    const readResult = TripData.readTrips();

    if (!readResult.ok) {
        message.textContent =
            "保存済みTripを読み込めないため、上書きを中止しました。データ管理からバックアップしてください。";
        return;
    }

    const trips = readResult.trips;
    const existingIndex = trips.findIndex(item => item.id === trip.id);

    if (existingIndex >= 0) {

        trips[existingIndex] = {
            ...trips[existingIndex],
            ...trip
        };

    } else {

        trips.push(trip);
    }

    const saveResult = TripData.saveTrips(trips);

    if (!saveResult.ok) {
        message.textContent =
            "Tripを保存できませんでした。入力内容は消去していません。";
        return;
    }

    tripId.value = trip.id;
    deleteButton.disabled = false;

    const missingPointCount = trip.routeSegments.filter(segment =>
        segment.status === "partial" &&
        (!segment.startPoint || !segment.endPoint)
    ).length;

    message.textContent = missingPointCount > 0
        ? `Tripを保存しました。一部走破の地点未指定が${missingPointCount}件あります。`
        : "Tripを保存しました。地図と走破率へ反映されます。";

    renderTripList();
}


function loadTrip(id) {

    const trip = TripData.getTrips().find(item => item.id === id);

    if (!trip) {

        message.textContent = "Tripデータが見つかりません。";
        return;
    }

    tripId.value = trip.id;

    fields.forEach(field => {
        document.getElementById(field).value = trip[field] || "";
    });

    routeSegments = trip.routeSegments.length > 0
        ? cloneSegments(trip.routeSegments)
        : [createRouteSegment()];

    deleteButton.disabled = false;
    message.textContent = "保存済みTripを読み込みました。";
    mapInstruction.textContent = "走行順と接続地点を確認してください。";
    refreshRouteBuilder(true);

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


function deleteTrip() {

    const id = tripId.value;

    if (!id) {
        return;
    }

    const tripName =
        document.getElementById("tripName").value.trim() ||
        "このTrip";

    const confirmed = window.confirm(
        `「${tripName}」を削除しますか？削除後は元に戻せません。`
    );

    if (!confirmed) {
        return;
    }

    const readResult = TripData.readTrips();

    if (!readResult.ok) {
        message.textContent =
            "保存済みTripを読み込めないため、削除を中止しました。データ管理からバックアップしてください。";
        return;
    }

    const trips = readResult.trips.filter(trip => trip.id !== id);
    const saveResult = TripData.saveTrips(trips);

    if (!saveResult.ok) {
        message.textContent =
            "Tripを削除できませんでした。保存済みデータは変更していません。";
        return;
    }

    clearForm();
    message.textContent = "Tripを削除し、地図と走破率を再計算しました。";
    renderTripList();
}


function formatDate(dateText) {

    return dateText
        ? dateText.replaceAll("-", "/")
        : "日付未登録";
}


function shortenText(text, maxLength) {

    if (!text) {
        return "未登録";
    }

    return text.length <= maxLength
        ? text
        : text.slice(0, maxLength) + "…";
}


function getTripRouteSummaries(trip) {

    const summaries = new Map();

    trip.routeSegments.forEach(segment => {

        const current = summaries.get(segment.routeNumber);

        if (!current || segment.status === "complete") {
            summaries.set(segment.routeNumber, segment.status);
        }
    });

    return [...summaries.entries()];
}


function createTripRouteLinks(trip) {

    const container = document.createElement("div");
    container.className = "route-links";

    getTripRouteSummaries(trip).forEach(([routeNumber, status]) => {

        const routeLink = document.createElement("a");
        routeLink.className =
            status === "complete"
                ? "route-link"
                : "route-link partial";
        routeLink.href = `index.html?route=${routeNumber}`;
        routeLink.textContent =
            `国道${routeNumber}号 ` +
            `(${TripData.getStatusLabel(status)})`;
        routeLink.title = `国道${routeNumber}号を地図で開く`;

        container.appendChild(routeLink);
    });

    return container;
}


function renderTripList() {

    const trips = TripData.getTrips();
    tripList.innerHTML = "";

    if (trips.length === 0) {

        tripList.innerHTML =
            '<p class="trip-list-empty">保存済みTripはありません。</p>';
        return;
    }

    [...trips]
        .sort((a, b) =>
            (b.startDate || "").localeCompare(a.startDate || "")
        )
        .forEach(trip => {

            const card = document.createElement("article");
            card.className = "trip-card";

            const title = document.createElement("h3");
            title.className = "trip-card-title";
            title.textContent = trip.tripName || "名称未登録";

            const date = document.createElement("p");
            date.className = "trip-card-date";
            const startDate = formatDate(trip.startDate);
            const endDate = trip.endDate ? formatDate(trip.endDate) : "";
            date.textContent =
                endDate && endDate !== startDate
                    ? `${startDate} ～ ${endDate}`
                    : startDate;

            const info = document.createElement("div");
            info.className = "trip-card-info";

            [
                ["🚗 行動ログ：", trip.actionLog],
                ["💭 感想・気づき：", trip.impressions],
                ["💡 記事ネタ：", trip.ferment],
                ["🔗 関連note記事：", trip.noteArticle],
                ["📝 メモ：", trip.memo]
            ].forEach(([label, value]) => {

                const line = document.createElement("span");
                line.textContent = label + shortenText(value, 35);
                info.appendChild(line);
            });

            const openButton = document.createElement("button");
            openButton.type = "button";
            openButton.className = "open-button";
            openButton.textContent = "Tripを開く";
            openButton.addEventListener("click", function () {
                loadTrip(trip.id);
            });

            card.appendChild(title);
            card.appendChild(date);
            card.appendChild(createTripRouteLinks(trip));
            card.appendChild(info);
            card.appendChild(openButton);
            tripList.appendChild(card);
        });
}


document
    .getElementById("addRouteButton")
    .addEventListener("click", function () {

        routeSegments.push(createRouteSegment());
        refreshRouteBuilder(false);
    });

document
    .getElementById("saveButton")
    .addEventListener("click", saveTrip);

document
    .getElementById("clearButton")
    .addEventListener("click", clearForm);

deleteButton.addEventListener("click", deleteTrip);


async function initialize() {

    try {

        const response = await fetch("data/routes.json");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        routesMaster = await response.json();

    } catch (error) {

        console.error("routes.json読込エラー:", error);
        message.textContent = "国道一覧を読み込めませんでした。";
    }

    routeSegments = [createRouteSegment()];
    renderTripList();

    const urlParams = new URLSearchParams(window.location.search);
    const requestedTripId = urlParams.get("trip");
    const requestedRouteNumber = urlParams.get("route");

    if (requestedRouteNumber) {

        document.getElementById("backToRouteLink").href =
            `index.html?route=${encodeURIComponent(requestedRouteNumber)}`;
    }

    if (requestedTripId) {
        loadTrip(requestedTripId);
    } else {
        refreshRouteBuilder(true);
    }

    setTimeout(function () {
        routeMap.invalidateSize();
    }, 0);

    console.log(
        "北海道48路線ふらふらlog Trip Version3.6 Ready"
    );
}


initialize();
