"use strict";
(function (global) {
  const STORAGE_KEY = "hokkaido48V5JourneyRecords";
  const SCHEMA_VERSION = 1;

  function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function withoutAccountingChatUrl(value) {
    const { accountingChatUrl: _privateUrl, ...journey } = safeObject(value);
    return journey;
  }

  function emptyStore() {
    return { schemaVersion: SCHEMA_VERSION, journeys: [], dayDetails: {} };
  }

  function read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
      return {
        schemaVersion: SCHEMA_VERSION,
        journeys: Array.isArray(parsed.journeys)
          ? parsed.journeys.filter(item => item && typeof item === "object" && !Array.isArray(item)).map(withoutAccountingChatUrl)
          : [],
        dayDetails: safeObject(parsed.dayDetails)
      };
    } catch (error) {
      console.error("旅詳細データ読込エラー:", error);
      return emptyStore();
    }
  }

  function write(store) {
    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      journeys: Array.isArray(store && store.journeys) ? store.journeys.map(withoutAccountingChatUrl) : [],
      dayDetails: safeObject(store && store.dayDetails)
    };
    const serialized = JSON.stringify(normalized);
    localStorage.setItem(STORAGE_KEY, serialized);
    const verified = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!verified || JSON.stringify(verified) !== serialized) throw new Error("保存内容を読み戻して確認できませんでした。");
    return normalized;
  }

  function uid(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return `${prefix}-${global.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function tripDate(trip) {
    return String(trip && (trip.startDate || trip.date || trip.plannedDate) || "");
  }

  function tripName(trip) {
    return String(trip && (trip.tripName || trip.displayName || trip.name) || "名称未登録");
  }

  function tripRef(trip, index) {
    const id = String(trip && trip.id || "").trim();
    if (id) return `id:${id}`;
    return `legacy:${tripDate(trip)}|${tripName(trip)}|${Number(index)}`;
  }

  function baseJourneyName(value) {
    let name = String(value || "").normalize("NFKC").trim();
    name = name.replace(/[\s　]*(?:DAY|Day|day)[\s　]*[0-9]+(?:[\s　].*)?$/u, "").trim();
    name = name.replace(/[\s　]*[-_／/][\s　]*[0-9]{8}$/u, "").trim();
    return name || String(value || "名称未登録").trim();
  }

  function dateValue(value) {
    const time = Date.parse(`${String(value || "")}T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
  }

  function inferredCluster(trips, selectedIndex) {
    const selected = trips[selectedIndex];
    if (!selected) return [];
    const base = baseJourneyName(tripName(selected));
    const candidates = trips.map((trip, index) => ({ trip, index, date: tripDate(trip) }))
      .filter(item => item.trip && item.trip.planningStatus !== "planned" && baseJourneyName(tripName(item.trip)) === base)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.index - b.index);
    if (candidates.length <= 1) return candidates;
    const clusters = [];
    let current = [];
    candidates.forEach(item => {
      const previous = current[current.length - 1];
      const previousTime = previous && dateValue(previous.date);
      const currentTime = dateValue(item.date);
      const gapDays = previousTime !== null && currentTime !== null ? Math.round((currentTime - previousTime) / 86400000) : null;
      if (current.length && (gapDays === null || gapDays < 0 || gapDays > 2)) {
        clusters.push(current);
        current = [];
      }
      current.push(item);
    });
    if (current.length) clusters.push(current);
    return clusters.find(cluster => cluster.some(item => item.index === selectedIndex)) || [{ trip: selected, index: selectedIndex, date: tripDate(selected) }];
  }

  function findJourneyForRef(store, ref) {
    return (Array.isArray(store && store.journeys) ? store.journeys : []).find(journey => Array.isArray(journey.tripRefs) && journey.tripRefs.includes(ref)) || null;
  }

  function getJourneyContext(trips, selectedIndex, storeValue) {
    const store = storeValue || read();
    const selected = trips[selectedIndex];
    if (!selected) return null;
    const selectedRef = tripRef(selected, selectedIndex);
    const existing = findJourneyForRef(store, selectedRef);
    let members;
    if (existing) {
      const refs = new Set(Array.isArray(existing.tripRefs) ? existing.tripRefs : []);
      members = trips.map((trip, index) => ({ trip, index, ref: tripRef(trip, index), date: tripDate(trip) }))
        .filter(item => refs.has(item.ref));
    } else {
      members = inferredCluster(trips, selectedIndex).map(item => ({ ...item, ref: tripRef(item.trip, item.index) }));
    }
    members.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.index - b.index);
    const dates = members.map(item => item.date).filter(Boolean).sort();
    const title = existing && existing.title || baseJourneyName(tripName(selected));
    return {
      journey: existing || {
        id: uid("journey"),
        title,
        vehicle: "",
        memo: "",
        tripRefs: members.map(item => item.ref),
        expenses: [],
        createdAt: ""
      },
      members,
      selectedRef,
      inferred: !existing,
      period: { start: dates[0] || "", end: dates[dates.length - 1] || dates[0] || "" }
    };
  }

  function saveJourney(journey) {
    const store = read();
    const now = new Date().toISOString();
    const journeyWithoutPrivateUrl = withoutAccountingChatUrl(journey);
    const value = {
      ...journeyWithoutPrivateUrl,
      id: String(journey && journey.id || uid("journey")),
      title: String(journey && journey.title || "名称未登録").trim() || "名称未登録",
      vehicle: String(journey && journey.vehicle || "").trim(),
      memo: String(journey && journey.memo || "").trim(),
      tripRefs: [...new Set(Array.isArray(journey && journey.tripRefs) ? journey.tripRefs.map(String).filter(Boolean) : [])],
      expenses: Array.isArray(journey && journey.expenses) ? journey.expenses : [],
      createdAt: String(journey && journey.createdAt || now),
      updatedAt: now
    };
    if (!value.tripRefs.length) throw new Error("旅に含めるDAYを1件以上選んでください。");
    const selectedRefs = new Set(value.tripRefs);
    store.journeys = store.journeys.map(item => {
      if (String(item.id) === value.id) return item;
      const tripRefs = (Array.isArray(item.tripRefs) ? item.tripRefs : []).filter(ref => !selectedRefs.has(String(ref)));
      return { ...item, tripRefs };
    }).filter(item => Array.isArray(item.tripRefs) && item.tripRefs.length);
    const index = store.journeys.findIndex(item => String(item.id) === value.id);
    if (index >= 0) store.journeys[index] = value;
    else store.journeys.push(value);
    write(store);
    return value;
  }

  function saveDayDetail(ref, detail) {
    if (!ref) throw new Error("DAY記録を特定できませんでした。");
    const store = read();
    store.dayDetails[ref] = {
      ...safeObject(detail),
      updatedAt: new Date().toISOString()
    };
    write(store);
    return store.dayDetails[ref];
  }

  global.Hokkaido48JourneyStore = {
    STORAGE_KEY,
    read,
    write,
    uid,
    tripDate,
    tripName,
    tripRef,
    baseJourneyName,
    getJourneyContext,
    findJourneyForRef,
    saveJourney,
    saveDayDetail
  };
})(window);
