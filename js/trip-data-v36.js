(function (global) {
    "use strict";

    const STORAGE_KEY = "hokkaido48Trips";

    function parseRouteNumbers(routeText) {

        if (!routeText) {
            return [];
        }

        const source = Array.isArray(routeText)
            ? routeText.join(",")
            : String(routeText);

        return [
            ...new Set(
                source
                    .normalize("NFKC")
                    .split(/[,\s、，・→>]+/)
                    .map(value => value.replace(/[^0-9]/g, ""))
                    .filter(Boolean)
                    .map(value => String(Number(value)))
            )
        ];
    }

    function normalizePoint(point) {

        if (!point || typeof point !== "object") {
            return null;
        }

        const lat = Number(point.lat);
        const lng = Number(point.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return null;
        }

        return {
            lat,
            lng,
            label: String(point.label || "地点未登録"),
            source: String(point.source || "saved")
        };
    }

    function normalizeConfirmedPath(path) {

        if (!Array.isArray(path)) {
            return [];
        }

        return path
            .map(point => {
                if (Array.isArray(point) && point.length >= 2) {
                    const lat = Number(point[0]);
                    const lng = Number(point[1]);
                    return Number.isFinite(lat) && Number.isFinite(lng)
                        ? [lat, lng]
                        : null;
                }

                if (point && typeof point === "object") {
                    const lat = Number(point.lat);
                    const lng = Number(point.lng);
                    return Number.isFinite(lat) && Number.isFinite(lng)
                        ? [lat, lng]
                        : null;
                }

                return null;
            })
            .filter(Boolean);
    }

    function normalizeConfirmedPaths(paths, fallbackPath) {

        const normalized = Array.isArray(paths)
            ? paths
                .map(path => normalizeConfirmedPath(path))
                .filter(path => path.length >= 2)
            : [];

        if (normalized.length) {
            return normalized;
        }

        const fallback = normalizeConfirmedPath(fallbackPath);
        return fallback.length >= 2 ? [fallback] : [];
    }

    function createSegmentId() {

        return (
            "segment-" +
            Date.now() +
            "-" +
            Math.random().toString(36).slice(2, 8)
        );
    }

    function normalizeSegment(segment, fallbackRouteNumber) {

        const routeNumber = parseRouteNumbers(
            segment && segment.routeNumber
                ? segment.routeNumber
                : fallbackRouteNumber
        )[0] || "";

        return {
            id: String(
                (segment && segment.id) || createSegmentId()
            ),
            routeNumber,
            status:
                segment && segment.status === "complete"
                    ? "complete"
                    : "partial",
            startPoint: normalizePoint(
                segment && segment.startPoint
            ),
            endPoint: normalizePoint(
                segment && segment.endPoint
            ),
            confirmedPath: normalizeConfirmedPath(
                segment && segment.confirmedPath
            ),
            confirmedPaths: normalizeConfirmedPaths(
                segment && segment.confirmedPaths,
                segment && segment.confirmedPath
            )
        };
    }

    function normalizeTrip(trip) {

        const source =
            trip && typeof trip === "object"
                ? trip
                : {};

        let routeSegments = [];

        if (
            Array.isArray(source.routeSegments) &&
            source.routeSegments.length > 0
        ) {

            routeSegments = source.routeSegments
                .map(segment => normalizeSegment(segment))
                .filter(segment => segment.routeNumber);

        } else {

            routeSegments = parseRouteNumbers(source.routes)
                .map(routeNumber => normalizeSegment(
                    {
                        routeNumber,
                        status: "partial"
                    }
                ));
        }

        const routes = [
            ...new Set(
                routeSegments
                    .map(segment => segment.routeNumber)
                    .filter(Boolean)
            )
        ].join(",");

        return {
            ...source,
            schemaVersion: 2,
            routes,
            routeSegments
        };
    }

    function readTrips() {

        const savedData = localStorage.getItem(STORAGE_KEY);

        if (!savedData) {
            return {
                ok: true,
                exists: false,
                trips: [],
                raw: null
            };
        }

        try {

            const parsed = JSON.parse(savedData);

            if (!Array.isArray(parsed)) {
                return {
                    ok: false,
                    exists: true,
                    trips: [],
                    raw: savedData,
                    error: "Trip保存データが配列形式ではありません。"
                };
            }

            return {
                ok: true,
                exists: true,
                trips: parsed.map(normalizeTrip),
                raw: savedData
            };

        } catch (error) {

            console.error("Tripデータ読込エラー:", error);

            return {
                ok: false,
                exists: true,
                trips: [],
                raw: savedData,
                error: "Trip保存データを読み込めません。"
            };
        }
    }

    function getTrips() {

        const result = readTrips();
        return result.ok ? result.trips : [];
    }

    function saveTrips(trips) {

        if (!Array.isArray(trips)) {
            return {
                ok: false,
                error: "Trip保存データが配列ではありません。"
            };
        }

        const normalizedTrips = trips.map(normalizeTrip);

        try {

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(normalizedTrips)
            );

            return {
                ok: true,
                trips: normalizedTrips
            };

        } catch (error) {

            console.error("Tripデータ保存エラー:", error);

            return {
                ok: false,
                error: "Tripデータを保存できませんでした。"
            };
        }
    }

    function getSegmentsForRoute(trip, routeNumber) {

        const target = String(Number(routeNumber));

        return normalizeTrip(trip)
            .routeSegments
            .filter(segment => segment.routeNumber === target);
    }

    function getRelatedTrips(routeNumber, trips) {

        const sourceTrips = Array.isArray(trips)
            ? trips.map(normalizeTrip)
            : getTrips();

        return sourceTrips
            .filter(trip =>
                getSegmentsForRoute(trip, routeNumber).length > 0
            )
            .sort((a, b) =>
                (b.startDate || "").localeCompare(a.startDate || "")
            );
    }

    function getRouteStatus(routeNumber, trips) {

        const relatedTrips = getRelatedTrips(routeNumber, trips);
        let hasPartial = false;

        for (const trip of relatedTrips) {

            const segments = getSegmentsForRoute(trip, routeNumber);

            if (segments.some(segment => segment.status === "complete")) {
                return "走破済";
            }

            if (segments.length > 0) {
                hasPartial = true;
            }
        }

        return hasPartial ? "走破中" : "未走破";
    }

    function getStatusLabel(status) {

        return status === "complete"
            ? "全線走破"
            : "一部走破";
    }

    function formatPoint(point) {

        const normalized = normalizePoint(point);

        return normalized
            ? normalized.label
            : "地点未指定";
    }

    global.Hokkaido48TripData = {
        STORAGE_KEY,
        createSegmentId,
        formatPoint,
        getRelatedTrips,
        getRouteStatus,
        getSegmentsForRoute,
        getStatusLabel,
        getTrips,
        normalizePoint,
        normalizeConfirmedPath,
        normalizeTrip,
        parseRouteNumbers,
        readTrips,
        saveTrips
    };

})(window);

