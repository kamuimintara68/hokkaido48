"use strict";

(function () {
  const SUPABASE_URL = "https://rlpverrmvpzupbnkwtse.supabase.co";
  const SUPABASE_KEY = "sb_publishable_GqQ4C2evdVKKev-Lq66KCg_Xkfi1-i0";
  const TABLE = "user_sync_data";
  const LOCAL_SYNCED_AT_KEY = "hokkaido48V5CloudSyncedAt";
  const LOCAL_SYNC_STATE_KEY = "hokkaido48V5CloudSyncState";
  const TRIPS_KEY = "hokkaido48Trips";
  const PATH_ENCODING = "delta-base36-e9-v1";
  const PATH_SCALE = 1000000000;
  const RECORD_KEY_PATTERN = /^route\d{3}Record$/;
  const SYNC_KEYS = new Set([
    TRIPS_KEY,
    "hokkaido48V5JourneyRecords",
    "hokkaido48V5AccountingChatLinks",
    "hokkaido48V5ManualRouteStatus",
    "hokkaido48V5ConfirmedRouteStatus",
    "hokkaido48V50JourneyDraft",
    "hokkaido48ActivePlan",
    "hokkaido48Plans"
  ]);
  // 変更前履歴と検索キャッシュは端末内だけの一時データ。同期するとTrip本体を
  // 何世代も複製してiPhoneのlocalStorage上限を超えるため、クラウドへ送らない。
  const VOLATILE_KEYS = new Set([
    "hokkaido48V5DataManagerBackups",
    "hokkaido48GeocodeCandidatesV2"
  ]);

  class CloudSyncConflictError extends Error {
    constructor(message) {
      super(message);
      this.name = "CloudSyncConflictError";
      this.code = "CLOUD_SYNC_CONFLICT";
    }
  }

  function client() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("クラウド接続ライブラリを読み込めませんでした。");
    }
    if (!window.Hokkaido48SupabaseClient) {
      window.Hokkaido48SupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return window.Hokkaido48SupabaseClient;
  }

  function isSyncKey(key) {
    const value = String(key || "");
    return SYNC_KEYS.has(value) || RECORD_KEY_PATTERN.test(value);
  }

  function allLocalKeys() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function normalizeConfirmedPaths(value) {
    if (!Array.isArray(value)) return [];
    return value.map(path => Array.isArray(path)
      ? path.map(point => [Number(point && point[0]), Number(point && point[1])])
        .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
      : [])
      .filter(path => path.length > 1);
  }

  function encodeConfirmedPaths(paths) {
    const encodedPaths = normalizeConfirmedPaths(paths).map(path => {
      let previousLat = 0;
      let previousLon = 0;
      return path.map((point, index) => {
        const lat = Math.round(point[0] * PATH_SCALE);
        const lon = Math.round(point[1] * PATH_SCALE);
        const latValue = index === 0 ? lat : lat - previousLat;
        const lonValue = index === 0 ? lon : lon - previousLon;
        previousLat = lat;
        previousLon = lon;
        return `${latValue.toString(36)}:${lonValue.toString(36)}`;
      }).join(",");
    });
    return { format: PATH_ENCODING, scale: PATH_SCALE, paths: encodedPaths };
  }

  function compactTripsRaw(rawValue) {
    let trips;
    try { trips = JSON.parse(rawValue); } catch { return rawValue; }
    if (!Array.isArray(trips)) return rawValue;

    trips.forEach(trip => {
      const segmentGeometryNumbers = new Set();
      (Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : []).forEach(segment => {
        if (!segment || typeof segment !== "object") return;
        const legacy = normalizeConfirmedPaths(segment.confirmedPaths);
        if (!legacy.length && Array.isArray(segment.confirmedPath)) {
          legacy.push(...normalizeConfirmedPaths([segment.confirmedPath]));
        }
        if (legacy.length && !(segment.confirmedGeometry && segment.confirmedGeometry.format === PATH_ENCODING)) {
          segment.confirmedGeometry = encodeConfirmedPaths(legacy);
        }
        if (segment.confirmedGeometry) {
          delete segment.confirmedPaths;
          delete segment.confirmedPath;
          if (String(segment.routeNumber || "")) segmentGeometryNumbers.add(String(segment.routeNumber));
        }
      });

      (Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : []).forEach(confirmation => {
        (Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : []).forEach(route => {
          if (!route || typeof route !== "object") return;
          const routeNumber = String(route.routeNumber ?? route.number ?? "");
          if (segmentGeometryNumbers.has(routeNumber)) {
            delete route.confirmedGeometry;
            delete route.confirmedPaths;
            delete route.confirmedPath;
            return;
          }
          const legacy = normalizeConfirmedPaths(route.confirmedPaths);
          if (!legacy.length && Array.isArray(route.confirmedPath)) {
            legacy.push(...normalizeConfirmedPaths([route.confirmedPath]));
          }
          if (legacy.length && !(route.confirmedGeometry && route.confirmedGeometry.format === PATH_ENCODING)) {
            route.confirmedGeometry = encodeConfirmedPaths(legacy);
          }
          if (route.confirmedGeometry) {
            delete route.confirmedPaths;
            delete route.confirmedPath;
          }
        });
      });
    });
    return JSON.stringify(trips);
  }

  function normalizedStorage(source) {
    const storage = {};
    Object.keys(source || {}).sort().forEach(key => {
      const value = source[key];
      if (!isSyncKey(key) || typeof value !== "string") return;
      storage[key] = key === TRIPS_KEY ? compactTripsRaw(value) : value;
    });
    return storage;
  }

  function storageFingerprint(storage) {
    const text = JSON.stringify(normalizedStorage(storage));
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(String(text || "")).length;
    return unescape(encodeURIComponent(String(text || ""))).length;
  }

  function storageSummary(storage) {
    const normalized = normalizedStorage(storage);
    let tripCount = 0;
    let journeyCount = 0;
    let routeRecordCount = 0;
    try {
      const trips = JSON.parse(normalized[TRIPS_KEY] || "[]");
      tripCount = Array.isArray(trips) ? trips.length : 0;
    } catch {}
    try {
      const records = JSON.parse(normalized.hokkaido48V5JourneyRecords || "null");
      journeyCount = Array.isArray(records && records.journeys) ? records.journeys.length : 0;
    } catch {}
    Object.keys(normalized).forEach(key => { if (RECORD_KEY_PATTERN.test(key)) routeRecordCount += 1; });
    return {
      tripCount,
      journeyCount,
      routeRecordCount,
      keyCount: Object.keys(normalized).length,
      bytes: utf8Bytes(JSON.stringify(normalized))
    };
  }

  function collectLocalStorage() {
    const source = {};
    allLocalKeys().forEach(key => {
      if (!isSyncKey(key)) return;
      const value = localStorage.getItem(key);
      if (value !== null) source[key] = value;
    });
    return normalizedStorage(source);
  }

  function collectLocalData() {
    const storage = collectLocalStorage();
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      fingerprint: storageFingerprint(storage),
      summary: storageSummary(storage),
      storage
    };
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== "object" || !payload.storage || typeof payload.storage !== "object" || Array.isArray(payload.storage)) {
      throw new Error("クラウドデータの形式が正しくありません。");
    }
    const storage = normalizedStorage(payload.storage);
    return {
      schemaVersion: 2,
      exportedAt: payload.exportedAt || "",
      fingerprint: storageFingerprint(storage),
      summary: storageSummary(storage),
      storage
    };
  }

  function captureKeys(keys) {
    const snapshot = {};
    keys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value !== null) snapshot[key] = value;
    });
    return snapshot;
  }

  function removeKeys(keys) {
    keys.forEach(key => localStorage.removeItem(key));
  }

  function writeAndVerify(storage) {
    Object.entries(storage).forEach(([key, value]) => localStorage.setItem(key, value));
    const verified = collectLocalStorage();
    if (JSON.stringify(verified) !== JSON.stringify(normalizedStorage(storage))) {
      throw new Error("保存後のデータ確認に失敗しました。");
    }
  }

  // 対象キーだけを入れ替える。失敗時は、同期前の状態を同じキー単位で完全に戻す。
  function applyCloudData(payload) {
    const normalized = normalizePayload(payload);
    const replaceKeys = allLocalKeys().filter(key => isSyncKey(key) || VOLATILE_KEYS.has(key));
    const previous = captureKeys(replaceKeys);
    try {
      removeKeys(replaceKeys);
      writeAndVerify(normalized.storage);
    } catch (error) {
      try {
        removeKeys(allLocalKeys().filter(key => isSyncKey(key) || VOLATILE_KEYS.has(key)));
        Object.entries(previous).forEach(([key, value]) => localStorage.setItem(key, value));
        const restored = captureKeys(Object.keys(previous));
        if (JSON.stringify(restored) !== JSON.stringify(previous)) throw new Error("rollback verification failed");
      } catch (rollbackError) {
        console.error("クラウド同期の巻き戻し失敗", rollbackError);
        throw new Error("端末への読込と元データへの復元に失敗しました。PC側とクラウドのデータは変更されていません。");
      }
      const quota = error && (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014 || /quota/i.test(String(error.message || "")));
      if (quota) throw new Error("端末の保存容量が不足しています。読込前の端末データへ戻しました。");
      throw new Error(`端末へ読み込めなかったため、読込前の状態へ戻しました。${error && error.message ? ` ${error.message}` : ""}`);
    }
    return normalized;
  }

  function readSyncState(userId) {
    try {
      const state = JSON.parse(localStorage.getItem(LOCAL_SYNC_STATE_KEY) || "null");
      return state && state.userId === userId ? state : null;
    } catch { return null; }
  }

  function saveSyncState(userId, revision, updatedAt, fingerprint) {
    const state = { userId, revision: Number(revision) || 0, updatedAt: updatedAt || "", fingerprint: fingerprint || "" };
    const write = () => {
      localStorage.setItem(LOCAL_SYNC_STATE_KEY, JSON.stringify(state));
      if (updatedAt) localStorage.setItem(LOCAL_SYNCED_AT_KEY, updatedAt);
    };
    try { write(); return true; }
    catch (firstError) {
      // 同期本体は保存済みなので、一時履歴・再生成可能なキャッシュだけを空けて再試行する。
      try { removeKeys([...VOLATILE_KEYS]); write(); return true; }
      catch (secondError) { console.warn("同期日時を端末へ保存できませんでした。", secondError || firstError); return false; }
    }
  }

  async function currentUser() {
    const { data, error } = await client().auth.getUser();
    if (error && (error.name === "AuthSessionMissingError" || /session missing/i.test(String(error.message || "")))) return null;
    if (error) throw error;
    return data && data.user ? data.user : null;
  }

  async function signInWithEmail(email) {
    const address = String(email || "").trim();
    if (!address) throw new Error("メールアドレスを入力してください。");
    const { error } = await client().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.href.split("#")[0].split("?")[0] }
    });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
  }

  async function readCloudRow(userId) {
    const { data, error } = await client().from(TABLE)
      .select("payload, revision, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function upload(options = {}) {
    const user = await currentUser();
    if (!user) throw new Error("先にログインしてください。");
    const payload = collectLocalData();
    const row = await readCloudRow(user.id);
    const remote = row ? normalizePayload(row.payload) : null;
    const state = readSyncState(user.id);
    const remoteRevision = Number(row && row.revision) || 0;
    const remoteDiffers = Boolean(remote && remote.fingerprint !== payload.fingerprint);
    const localChangedSinceSync = Boolean(state && state.fingerprint && state.fingerprint !== payload.fingerprint);
    const remoteChangedSinceSync = Boolean(state && remoteRevision > Number(state.revision || 0));
    const firstDifferentUpload = Boolean(!state && remoteDiffers);
    if (!options.force && remoteDiffers && (firstDifferentUpload || (localChangedSinceSync && remoteChangedSinceSync))) {
      throw new CloudSyncConflictError("クラウド側とこの端末の両方に異なるデータがあります。内容を確認せず上書きしないため停止しました。");
    }

    const now = new Date().toISOString();
    const revision = remoteRevision + 1;
    const { data, error } = await client().from(TABLE).upsert({
      user_id: user.id,
      payload,
      revision,
      device_updated_at: now,
      updated_at: now
    }, { onConflict: "user_id" }).select("revision, updated_at").single();
    if (error) throw error;
    const savedRevision = Number(data && data.revision) || revision;
    const savedAt = data && data.updated_at ? data.updated_at : now;
    saveSyncState(user.id, savedRevision, savedAt, payload.fingerprint);
    return { updatedAt: savedAt, revision: savedRevision, summary: payload.summary };
  }

  async function download() {
    const user = await currentUser();
    if (!user) throw new Error("先にログインしてください。");
    const row = await readCloudRow(user.id);
    if (!row) throw new Error("クラウドにはまだ保存データがありません。");
    const payload = applyCloudData(row.payload);
    const updatedAt = row.updated_at || new Date().toISOString();
    saveSyncState(user.id, Number(row.revision) || 0, updatedAt, payload.fingerprint);
    return { updatedAt, revision: Number(row.revision) || 0, summary: payload.summary };
  }

  async function inspect() {
    const user = await currentUser();
    const local = collectLocalData();
    if (!user) return { user: null, local: local.summary, remote: null, updatedAt: "", revision: 0 };
    const row = await readCloudRow(user.id);
    const remote = row ? normalizePayload(row.payload) : null;
    return {
      user,
      local: local.summary,
      remote: remote ? remote.summary : null,
      updatedAt: row && row.updated_at ? row.updated_at : "",
      revision: Number(row && row.revision) || 0
    };
  }

  window.Hokkaido48CloudSync = {
    client,
    currentUser,
    signInWithEmail,
    signOut,
    upload,
    download,
    inspect,
    collectLocalData,
    applyCloudData,
    normalizePayload,
    storageSummary,
    isSyncKey
  };
})();
