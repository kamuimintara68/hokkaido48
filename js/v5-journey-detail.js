"use strict";
(function () {
  const TRIPS_KEY = "hokkaido48Trips";
  const Store = window.Hokkaido48JourneyStore;
  const $ = id => document.getElementById(id);
  const categoryLabels = {
    fuel: "燃料", meal: "食事", bath: "温泉・入浴", lodging: "宿泊",
    toll: "高速・駐車", shopping: "買い物", other: "その他"
  };
  const categoryAliases = {
    fuel: "fuel", "燃料": "fuel", "給油": "fuel", "ガソリン": "fuel", "軽油": "fuel",
    meal: "meal", "食事": "meal", "飲食": "meal", "食品": "meal",
    bath: "bath", "温泉": "bath", "入浴": "bath", "温泉・入浴": "bath",
    lodging: "lodging", "宿泊": "lodging", "ホテル": "lodging",
    toll: "toll", "高速": "toll", "駐車": "toll", "高速・駐車": "toll",
    shopping: "shopping", "買い物": "shopping", "購入": "shopping",
    other: "other", "その他": "other"
  };
  const ACCOUNTING_CHAT_LINKS_KEY = "hokkaido48V5AccountingChatLinks";
  let trips = [];
  let context = null;
  let candidateMembers = [];
  let currentJourney = null;
  let selectedDayRef = "";
  let editingExpenseId = "";
  let pendingAccountingImport = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[character]));
  }

  function readTrips() {
    try {
      const value = JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function selectedTripIndex() {
    const value = Number(new URLSearchParams(location.search).get("trip"));
    return Number.isInteger(value) && value >= 0 && value < trips.length ? value : -1;
  }

  function formatDate(value) {
    const source = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return source || "日付未登録";
    const [year, month, day] = source.split("-");
    return `${year}/${month}/${day}`;
  }

  function formatPeriod(start, end) {
    if (!start) return "日付未登録";
    return !end || start === end ? formatDate(start) : `${formatDate(start)} ～ ${formatDate(end)}`;
  }

  function yen(value) {
    return `${Math.round(Number(value) || 0).toLocaleString("ja-JP")}円`;
  }

  function routeNumbers(trip) {
    if (Array.isArray(trip && trip.confirmedRouteNumbers)) return [...new Set(trip.confirmedRouteNumbers.map(String).filter(Boolean))];
    if (Array.isArray(trip && trip.routeSegments)) return [...new Set(trip.routeSegments.map(item => String(item && item.routeNumber || "")).filter(Boolean))];
    const value = Array.isArray(trip && trip.routes) ? trip.routes.join(",") : String(trip && trip.routes || "");
    return [...new Set(value.split(/[,、\s→/]+/).map(item => item.replace(/\D/g, "")).filter(Boolean))];
  }

  function gpxItems(trip) {
    return (Array.isArray(trip && trip.materialImports) ? trip.materialImports : [])
      .flatMap(item => Array.isArray(item && item.gpx) ? item.gpx : [])
      .filter(Boolean);
  }

  function tripDistance(trip) {
    const gpx = gpxItems(trip);
    if (gpx.length) return gpx.reduce((sum, item) => sum + (Number(item.distanceKm) || 0), 0);
    const direct = Number(trip && (trip.distanceKm || trip.totalDistanceKm));
    return Number.isFinite(direct) && direct > 0 ? direct : 0;
  }

  function memberByRef(ref) {
    return candidateMembers.find(item => item.ref === ref) || context.members.find(item => item.ref === ref) || null;
  }

  function currentMemberRefs() {
    return [...$("journeyMemberChecks").querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
  }

  function currentMembers() {
    const refs = new Set(Array.isArray(currentJourney && currentJourney.tripRefs) ? currentJourney.tripRefs : []);
    return candidateMembers.filter(item => refs.has(item.ref)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.index - b.index);
  }

  function calculatedPeriod(members) {
    const dates = members.map(item => item.date).filter(Boolean).sort();
    return { start: dates[0] || "", end: dates[dates.length - 1] || dates[0] || "" };
  }

  function totalExpenses() {
    return (Array.isArray(currentJourney && currentJourney.expenses) ? currentJourney.expenses : [])
      .reduce((sum, item) => sum + (Number(item && item.amount) || 0), 0);
  }

  function updateHero() {
    const members = currentMembers();
    const period = calculatedPeriod(members);
    const distance = members.reduce((sum, item) => sum + tripDistance(item.trip), 0);
    $("journeyDetailTitle").textContent = currentJourney.title || "名称未登録";
    $("journeyDetailPeriod").textContent = formatPeriod(period.start, period.end);
    $("journeyPeriodValue").textContent = formatPeriod(period.start, period.end);
    $("journeyDayCount").textContent = String(members.length);
    $("journeyDistance").innerHTML = `${distance.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}<small>km</small>`;
    $("journeyExpenseTotal").innerHTML = `${Math.round(totalExpenses()).toLocaleString("ja-JP")}<small>円</small>`;
  }

  function buildCandidates(selectedIndex) {
    const inferred = Store.getJourneyContext(trips, selectedIndex, { schemaVersion: 1, journeys: [], dayDetails: {} });
    const map = new Map();
    [...(context.members || []), ...(inferred && inferred.members || [])].forEach(item => map.set(item.ref, item));
    return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.index - b.index);
  }

  function renderMemberChecks() {
    const container = $("journeyMemberChecks");
    const selected = new Set(currentJourney.tripRefs || []);
    container.innerHTML = "";
    candidateMembers.forEach((item, index) => {
      const label = document.createElement("label");
      label.className = "journey-member-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.ref;
      input.checked = selected.has(item.ref);
      const copy = document.createElement("span");
      const dayNumber = index + 1;
      const heading = document.createElement("strong");
      const name = document.createElement("small");
      heading.textContent = `DAY${dayNumber}　${formatDate(item.date)}`;
      name.textContent = Store.tripName(item.trip);
      copy.append(heading, name);
      label.append(input, copy);
      container.appendChild(label);
    });
  }

  function renderJourneyForm() {
    $("journeyTitleInput").value = currentJourney.title || "";
    $("journeyVehicleInput").value = currentJourney.vehicle || "";
    $("journeyMemoInput").value = currentJourney.memo || "";
    $("accountingChatUrlInput").value = currentAccountingChatUrl();
    $("journeyGroupState").textContent = context.inferred ? `${currentJourney.tripRefs.length}日分を自動で候補化` : `${currentJourney.tripRefs.length}日分を保存済み`;
    $("journeyGroupState").classList.toggle("saved", !context.inferred);
    renderMemberChecks();
    syncAccountingChatLink();
  }

  function normalizedAccountingChatUrl(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    let parsed;
    try { parsed = new URL(source); } catch { throw new Error("会計チャットURLを確認してください。"); }
    const host = parsed.hostname.toLowerCase();
    const isChatGpt = host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
    if (parsed.protocol !== "https:" || !isChatGpt) throw new Error("ChatGPTの会話URL（https://chatgpt.com/...）を入力してください。");
    return parsed.href;
  }

  function readAccountingChatLinks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ACCOUNTING_CHAT_LINKS_KEY) || "null");
      const links = parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.links && typeof parsed.links === "object" && !Array.isArray(parsed.links)
        ? parsed.links
        : {};
      return { schemaVersion: 1, links: { ...links } };
    } catch {
      return { schemaVersion: 1, links: {} };
    }
  }

  function writeAccountingChatLinks(store) {
    const links = {};
    Object.entries(store && store.links || {}).forEach(([key, value]) => {
      const url = String(value || "").trim();
      if (key && url) links[String(key)] = url;
    });
    const serialized = JSON.stringify({ schemaVersion: 1, links });
    localStorage.setItem(ACCOUNTING_CHAT_LINKS_KEY, serialized);
    if (localStorage.getItem(ACCOUNTING_CHAT_LINKS_KEY) !== serialized) throw new Error("端末内の保存内容を確認できませんでした。");
    return { schemaVersion: 1, links };
  }

  function accountingChatUrlForKey(key) {
    return String(readAccountingChatLinks().links[String(key || "")] || "").trim();
  }

  function currentAccountingChatUrl() {
    return accountingChatUrlForKey(accountingSyncKey());
  }

  function storeAccountingChatUrl(key, url) {
    const syncKey = String(key || "").trim();
    if (!syncKey) throw new Error("この旅のsyncKeyを作成できませんでした。");
    const store = readAccountingChatLinks();
    if (url) store.links[syncKey] = url;
    else delete store.links[syncKey];
    writeAccountingChatLinks(store);
  }

  function moveAccountingChatUrl(previousKey, nextKey) {
    if (!previousKey || !nextKey || previousKey === nextKey) return;
    const store = readAccountingChatLinks();
    const previousUrl = String(store.links[previousKey] || "").trim();
    if (!previousUrl) return;
    if (!store.links[nextKey]) store.links[nextKey] = previousUrl;
    delete store.links[previousKey];
    writeAccountingChatLinks(store);
  }

  function inferredLegacySyncKey(journey) {
    const recorded = String(journey && journey.accountingSync && journey.accountingSync.syncKey || "").trim();
    if (recorded) return recorded;
    const refs = new Set(Array.isArray(journey && journey.tripRefs) ? journey.tripRefs.map(String) : []);
    const dates = trips.map((trip, index) => ({ ref: Store.tripRef(trip, index), date: Store.tripDate(trip) }))
      .filter(item => refs.has(item.ref) && item.date)
      .map(item => item.date)
      .sort();
    if (!dates.length) return "";
    return `${dates[0]}|${dates[dates.length - 1]}|${normalizedTitle(journey && journey.title)}`;
  }

  function migrateLegacyAccountingChatUrls() {
    const raw = localStorage.getItem(Store.STORAGE_KEY);
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.journeys)) return;
    const linkStore = readAccountingChatLinks();
    let migrated = false;
    let cleaned = false;
    parsed.journeys = parsed.journeys.map(journey => {
      if (!journey || typeof journey !== "object" || Array.isArray(journey)) return journey;
      const { accountingChatUrl, ...rest } = journey;
      if (accountingChatUrl !== undefined) cleaned = true;
      if (String(accountingChatUrl || "").trim()) {
        try {
          const key = inferredLegacySyncKey(journey);
          const url = normalizedAccountingChatUrl(accountingChatUrl);
          if (key && url && !linkStore.links[key]) {
            linkStore.links[key] = url;
            migrated = true;
          }
        } catch {
          // 旧形式の不正なURLは旅データから除去するだけにします。
        }
      }
      return rest;
    });
    if (migrated) writeAccountingChatLinks(linkStore);
    if (cleaned) localStorage.setItem(Store.STORAGE_KEY, JSON.stringify(parsed));
  }

  function syncAccountingChatLink() {
    const inputValue = $("accountingChatUrlInput").value.trim();
    const savedValue = currentAccountingChatUrl();
    const isSavedValue = Boolean(savedValue) && inputValue === savedValue;
    const link = $("openAccountingChatLink");
    link.hidden = !savedValue;
    link.href = savedValue || "#";
    $("deleteAccountingChatButton").hidden = !savedValue;
    $("saveAccountingChatButton").textContent = savedValue ? "URLを変更" : "会計チャットURLを設定";
    const sync = currentJourney && currentJourney.accountingSync;
    const state = $("accountingChatState");
    state.className = "";
    if (sync && Number(sync.itemCount) >= 0) {
      state.textContent = "取込済み";
      state.classList.add("saved");
    } else {
      state.textContent = "未取込";
    }
    const meta = $("accountingSyncMeta");
    const code = document.createElement("code");
    code.id = "accountingSyncKeyValue";
    code.textContent = accountingSyncKey();
    meta.replaceChildren(document.createTextNode(sync
      ? `前回 ${Number(sync.itemCount) || 0}件・${formatSyncDate(sync.sourceUpdatedAt || sync.importedAt || sync.syncedAt)} ／ syncKey：`
      : "この旅のsyncKey："), code);
    if (!isSavedValue && inputValue) $("accountingChatMessage").textContent = savedValue ? "変更するURLを保存してください。" : "URLを設定すると、この端末から会計チャットを開けます。";
  }

  function normalizedTitle(value) {
    return Store.baseJourneyName(String(value || "")).normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
  }

  function journeyPeriodFor(journey) {
    const refs = new Set(Array.isArray(journey && journey.tripRefs) ? journey.tripRefs.map(String) : []);
    const dates = trips.map((trip, index) => ({ ref: Store.tripRef(trip, index), date: Store.tripDate(trip) }))
      .filter(item => refs.has(item.ref) && item.date)
      .map(item => item.date)
      .sort();
    return { start: dates[0] || "", end: dates[dates.length - 1] || dates[0] || "" };
  }

  function currentJourneyPeriod() {
    return journeyPeriodFor(currentJourney);
  }

  function derivedAccountingSyncKey(journey) {
    const period = journeyPeriodFor(journey);
    return `${period.start || "date-unknown"}|${period.end || period.start || "date-unknown"}|${normalizedTitle(journey && journey.title)}`;
  }

  function accountingSyncKeysFor(journey) {
    const keys = new Set([derivedAccountingSyncKey(journey)]);
    const recorded = String(journey && journey.accountingSync && journey.accountingSync.syncKey || "").trim();
    if (recorded) keys.add(recorded);
    return [...keys];
  }

  function accountingSyncKey() {
    return derivedAccountingSyncKey(currentJourney);
  }

  function formatSyncDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "日時未記録";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(date);
  }

  function setAccountingSyncState(label, kind, meta, message, error = false) {
    const state = $("accountingChatState");
    state.textContent = label;
    state.className = kind || "";
    $("accountingSyncMeta").textContent = meta || "";
    $("accountingChatMessage").textContent = message || "";
    $("accountingChatMessage").classList.toggle("error", Boolean(error));
  }

  function stringLimit(value, length) {
    return String(value ?? "").trim().slice(0, length);
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeExternalExpense(item, index, recordKey, sourceUpdatedAt) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const date = String(item.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
    const category = categoryAliases[String(item.category || "").trim()] || "other";
    const identitySource = JSON.stringify([
      item.date || "", category, Math.round(amount), item.vendor || item.store || "", item.memo || "", item.liters || "", item.distanceKm || "", index
    ]);
    const externalId = stringLimit(item.id, 120) || `generated-${hashText(identitySource)}`;
    const now = sourceUpdatedAt || new Date().toISOString();
    return {
      id: `accounting-sync-${hashText(`${recordKey}|${externalId}`)}`,
      externalId,
      date,
      category,
      amount: Math.round(amount),
      vendor: stringLimit(item.vendor || item.store || item.payee, 150),
      memo: stringLimit(item.memo || item.note || item.description, 500),
      liters: category === "fuel" ? numberOrNull(item.liters) : null,
      distanceKm: category === "fuel" ? numberOrNull(item.distanceKm) : null,
      syncSource: "accounting-chat",
      syncRecordKey: recordKey,
      createdAt: String(item.createdAt || now),
      updatedAt: String(item.updatedAt || now)
    };
  }

  function validateAccountingSource(value) {
    let source = value;
    if (Array.isArray(source)) source = { schemaVersion: 1, journeys: source };
    else if (source && typeof source === "object" && !Array.isArray(source) && !Array.isArray(source.journeys) && source.syncKey && Array.isArray(source.expenses)) {
      source = { schemaVersion: 1, journeys: [source] };
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("会計データの構成を確認できません。");
    if (source.schemaVersion !== undefined && Number(source.schemaVersion) !== 1) throw new Error("対応していない会計データ形式です。");
    if (!Array.isArray(source.journeys) || !source.journeys.length) throw new Error("会計データに旅一覧がありません。");
    return { ...source, schemaVersion: 1 };
  }

  function parseAccountingPaste(textValue) {
    const source = String(textValue || "").trim();
    if (!source) throw new Error("会計チャットが出力したJSONを貼り付けてください。");
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [fenced && fenced[1], source];
    const firstObject = source.indexOf("{");
    const lastObject = source.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) candidates.push(source.slice(firstObject, lastObject + 1));
    const firstArray = source.indexOf("[");
    const lastArray = source.lastIndexOf("]");
    if (firstArray >= 0 && lastArray > firstArray) candidates.push(source.slice(firstArray, lastArray + 1));
    for (const candidate of candidates.filter(Boolean)) {
      try { return validateAccountingSource(JSON.parse(candidate.trim())); } catch { /* 次の候補を確認します。 */ }
    }
    throw new Error("JSONを読み取れませんでした。会計チャットの出力を省略せず、そのまま貼り付けてください。");
  }

  function availableJourneys() {
    const saved = Store.read().journeys.slice();
    const currentIndex = saved.findIndex(journey => String(journey.id) === String(currentJourney.id));
    if (currentIndex >= 0) saved[currentIndex] = currentJourney;
    else saved.push(currentJourney);
    return saved;
  }

  function resetAccountingImportPreview(clearInput = false) {
    pendingAccountingImport = null;
    $("accountingImportPreview").hidden = true;
    $("accountingImportPreview").innerHTML = "";
    $("applyAccountingImportButton").hidden = true;
    if (clearInput) $("accountingImportInput").value = "";
  }

  function renderAccountingImportPreview(result) {
    const preview = $("accountingImportPreview");
    const lines = result.plans.map(plan => plan.error
      ? `<li class="error">${escapeHtml(plan.label)}：${escapeHtml(plan.error)}</li>`
      : `<li>${escapeHtml(plan.journeyTitle)}：${plan.imported.length}件・${yen(plan.total)}（チャット由来分を置換）</li>`);
    preview.innerHTML = `<strong>${result.blocked ? "取込前に確認が必要です" : "取込内容を確認しました"}</strong><ul>${lines.join("")}</ul><div class="import-total">${result.blocked ? "問題を直したJSONを貼り直してください。" : `対象 ${result.plans.length}旅・合計 ${result.itemCount}件・${yen(result.total)}`}</div>`;
    preview.hidden = false;
    $("applyAccountingImportButton").hidden = result.blocked;
  }

  function previewAccountingImport() {
    const pasted = $("accountingImportInput").value;
    const source = parseAccountingPaste(pasted);
    const journeys = availableJourneys();
    const duplicateKeys = new Set();
    const seenKeys = new Set();
    source.journeys.forEach(record => {
      const key = String(record && record.syncKey || "").trim();
      if (seenKeys.has(key)) duplicateKeys.add(key);
      seenKeys.add(key);
    });
    const plans = source.journeys.map((record, recordIndex) => {
      const recordKey = String(record && record.syncKey || "").trim();
      const label = String(record && record.title || recordKey || `旅${recordIndex + 1}`);
      if (!record || typeof record !== "object" || Array.isArray(record)) return { label, error: "旅レコードの形式が正しくありません。" };
      if (!recordKey) return { label, error: "syncKeyがありません。" };
      if (duplicateKeys.has(recordKey)) return { label, error: "同じsyncKeyがJSON内に重複しています。" };
      if (!Array.isArray(record.expenses)) return { label, error: "expensesが配列ではありません。" };
      const matches = journeys.filter(journey => accountingSyncKeysFor(journey).includes(recordKey));
      if (!matches.length) return { label, error: `一致する旅がありません（syncKey: ${recordKey}）。` };
      if (matches.length > 1) return { label, error: "同じsyncKeyの旅が複数あります。旅の名称・期間を確認してください。" };
      const sourceUpdatedAt = String(record.updatedAt || source.updatedAt || new Date().toISOString());
      const imported = record.expenses.map((item, index) => normalizeExternalExpense(item, index, recordKey, sourceUpdatedAt)).filter(Boolean);
      if (imported.length !== record.expenses.length) return { label, error: "日付・金額などを確認できない明細があります。全明細を直してから取込してください。" };
      if (new Set(imported.map(item => item.id)).size !== imported.length) return { label, error: "同じidの明細が重複しています。" };
      return {
        label,
        journeyId: String(matches[0].id),
        journeyTitle: matches[0].title || label,
        recordKey,
        sourceUpdatedAt,
        imported,
        total: imported.reduce((sum, item) => sum + item.amount, 0)
      };
    });
    const blocked = plans.some(plan => plan.error);
    const result = {
      source,
      inputHash: hashText(pasted),
      plans,
      blocked,
      itemCount: plans.reduce((sum, plan) => sum + (plan.imported ? plan.imported.length : 0), 0),
      total: plans.reduce((sum, plan) => sum + (plan.total || 0), 0)
    };
    pendingAccountingImport = result;
    renderAccountingImportPreview(result);
    $("accountingChatMessage").classList.toggle("error", blocked);
    $("accountingChatMessage").textContent = blocked ? "取込はまだ実行していません。赤字の内容を直してください。" : "内容を確認しました。青い「確認した内容を取込」を押すまで保存データは変わりません。";
    return result;
  }

  function applyAccountingImport() {
    if (!pendingAccountingImport || pendingAccountingImport.blocked) throw new Error("先に貼り付け内容を確認してください。");
    if (pendingAccountingImport.inputHash !== hashText($("accountingImportInput").value)) throw new Error("確認後にJSONが変更されています。もう一度、内容を確認してください。");
    saveJourney(false);
    const store = Store.read();
    const importedAt = new Date().toISOString();
    pendingAccountingImport.plans.forEach(plan => {
      const index = store.journeys.findIndex(journey => String(journey.id) === plan.journeyId);
      if (index < 0) throw new Error(`${plan.journeyTitle}の保存先を確認できませんでした。`);
      const journey = store.journeys[index];
      const manual = (Array.isArray(journey.expenses) ? journey.expenses : []).filter(item => !item || item.syncSource !== "accounting-chat");
      store.journeys[index] = {
        ...journey,
        expenses: [...manual, ...plan.imported],
        accountingSync: {
          syncKey: plan.recordKey,
          sourceUpdatedAt: plan.sourceUpdatedAt,
          importedAt,
          itemCount: plan.imported.length,
          source: "manual-chat-import"
        },
        updatedAt: importedAt
      };
    });
    Store.write(store);
    const savedCurrent = store.journeys.find(journey => String(journey.id) === String(currentJourney.id));
    if (savedCurrent) currentJourney = { ...savedCurrent, expenses: [...(savedCurrent.expenses || [])] };
    context.inferred = false;
    renderJourneyForm();
    renderExpenses();
    updateHero();
    const result = pendingAccountingImport;
    pendingAccountingImport = null;
    $("applyAccountingImportButton").hidden = true;
    $("accountingImportPreview").innerHTML = `<strong>取込が完了しました</strong><div class="import-total">${result.plans.length}旅・${result.itemCount}件・${yen(result.total)}を保存しました。手入力の明細は残しています。</div>`;
    $("accountingChatMessage").classList.remove("error");
    $("accountingChatMessage").textContent = "✓ 会計チャットの全明細を旅・日付・分類へ振り分けました。次回の再取込ではチャット由来分だけを置き換えます。";
    return result;
  }

  function accountingRequestInstruction() {
    const period = currentJourneyPeriod();
    const template = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      journeys: [{
        syncKey: accountingSyncKey(),
        title: currentJourney.title || "名称未登録",
        periodStart: period.start,
        periodEnd: period.end,
        updatedAt: new Date().toISOString(),
        expenses: []
      }]
    };
    return [
      "この会話に記録されている、この旅の会計明細を北海道48路線システムへの取込用JSONにまとめてください。GitHubへの保存・接続・更新は不要です。",
      "返答は説明文やMarkdownのコード枠を付けず、JSONだけを出力してください。会話内の有効な全明細をexpensesへ入れ、訂正後の金額を採用し、削除済みの明細は含めないでください。",
      "次のテンプレートのsyncKey・title・periodStart・periodEndは一字も変更しないでください。updatedAtは出力時刻へ更新してください。",
      JSON.stringify(template, null, 2),
      "expensesの各明細には、id（同じ明細は次回も同じid）、date（YYYY-MM-DD）、category（fuel/meal/bath/lodging/toll/shopping/other）、amount（正の整数）、vendor、memoを入れてください。燃料だけlitersとdistanceKmも入れてください。値がない任意項目は空文字またはnullで構いません。",
      "この旅以外の会計も同時にまとめる場合は、同じ形式の旅レコードをjourneys配列へ追加してください。ただし、各旅に北海道48路線システムから指定されたsyncKeyがある場合だけ追加してください。"
    ].join("\n\n");
  }

  async function copyAccountingRequest() {
    const value = accountingRequestInstruction();
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
    } else {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      if (!document.execCommand("copy")) throw new Error("コピーできませんでした。");
      area.remove();
    }
    $("accountingChatMessage").classList.remove("error");
    $("accountingChatMessage").textContent = "✓ 依頼文をコピーしました。会計チャットへ貼り付け、返ってきたJSONをこの画面へ戻してください。";
  }

  function toDateTimeLocal(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  }

  function defaultDayTimes(member) {
    const gpx = gpxItems(member.trip);
    const first = gpx[0] || {};
    const last = gpx[gpx.length - 1] || {};
    return {
      start: toDateTimeLocal(first.startTime || member.trip.startTime || ""),
      end: toDateTimeLocal(last.endTime || member.trip.endTime || "")
    };
  }

  function renderDayTabs() {
    const members = currentMembers();
    if (!members.some(item => item.ref === selectedDayRef)) selectedDayRef = members[0] && members[0].ref || "";
    const container = $("journeyDayTabs");
    container.innerHTML = "";
    members.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      button.className = `journey-day-tab${item.ref === selectedDayRef ? " active" : ""}`;
      button.setAttribute("aria-selected", item.ref === selectedDayRef ? "true" : "false");
      button.innerHTML = `<span>DAY${index + 1}</span><strong>${formatDate(item.date)}</strong><small>${routeNumbers(item.trip).length}路線</small>`;
      button.addEventListener("click", () => {
        selectedDayRef = item.ref;
        history.replaceState(null, "", `journey-detail.html?trip=${item.index}`);
        renderDayTabs();
        renderDayForm();
      });
      container.appendChild(button);
    });
  }

  function renderDayForm() {
    const member = memberByRef(selectedDayRef);
    const store = Store.read();
    const detail = store.dayDetails[selectedDayRef] || {};
    const defaults = member ? defaultDayTimes(member) : { start: "", end: "" };
    $("dayStartInput").value = detail.startDateTime || defaults.start;
    $("dayEndInput").value = detail.endDateTime || defaults.end;
    $("dayVehicleInput").value = detail.vehicle || "";
    $("dayLodgingInput").value = detail.lodging || "";
    $("dayStopsInput").value = detail.stops || "";
    $("dayDetailInput").value = detail.detail || "";
    $("dayMemoInput").value = detail.memo || "";
    if (!member) {
      $("dayRouteSummary").textContent = "DAY記録なし";
      $("dayGpxSummary").textContent = "—";
      return;
    }
    const numbers = routeNumbers(member.trip);
    $("dayRouteSummary").textContent = numbers.length ? numbers.map(number => `国道${number}号`).join("・") : "路線情報なし";
    const gpx = gpxItems(member.trip);
    $("dayGpxSummary").textContent = gpx.length
      ? gpx.map(item => `${item.fileName || "GPX"}${Number.isFinite(Number(item.distanceKm)) ? `（${Number(item.distanceKm).toFixed(1)}km）` : ""}`).join("、")
      : "GPX情報なし";
    $("expenseDateInput").value = $("expenseDateInput").value || member.date || "";
    $("daySaveMessage").textContent = "";
  }

  function saveJourney(showMessage = true) {
    const previousSyncKey = accountingSyncKey();
    const refs = currentMemberRefs();
    currentJourney = Store.saveJourney({
      ...currentJourney,
      title: $("journeyTitleInput").value,
      vehicle: $("journeyVehicleInput").value,
      memo: $("journeyMemoInput").value,
      tripRefs: refs
    });
    context.inferred = false;
    context.members = candidateMembers.filter(item => refs.includes(item.ref));
    selectedDayRef = refs.includes(selectedDayRef) ? selectedDayRef : refs[0];
    moveAccountingChatUrl(previousSyncKey, accountingSyncKey());
    renderJourneyForm();
    renderDayTabs();
    renderDayForm();
    renderExpenses();
    updateHero();
    if (showMessage) {
      $("journeySaveMessage").textContent = `✓ ${refs.length}日分を一つの旅として保存しました。`;
      setTimeout(() => { $("journeySaveMessage").textContent = ""; }, 5000);
    }
    return currentJourney;
  }

  function saveAccountingChatLink() {
    const previous = currentAccountingChatUrl();
    const next = normalizedAccountingChatUrl($("accountingChatUrlInput").value);
    if (!next) throw new Error("会計チャットURLを入力してください。削除する場合は「URLを削除」を押してください。");
    storeAccountingChatUrl(accountingSyncKey(), next);
    $("accountingChatUrlInput").value = next;
    $("accountingChatMessage").classList.remove("error");
    $("accountingChatMessage").textContent = previous ? "✓ この端末の会計チャットURLを変更しました。" : "✓ この端末に会計チャットURLを設定しました。";
    syncAccountingChatLink();
    renderExpenses();
  }

  function deleteAccountingChatLink() {
    const previous = currentAccountingChatUrl();
    if (!previous) return;
    if (!window.confirm("この端末に保存した会計チャットURLを削除しますか？\n取り込んだ会計データは削除されません。")) return;
    storeAccountingChatUrl(accountingSyncKey(), "");
    $("accountingChatUrlInput").value = "";
    $("accountingChatMessage").classList.remove("error");
    $("accountingChatMessage").textContent = "✓ この端末から会計チャットURLを削除しました。取り込んだ会計データは残しています。";
    syncAccountingChatLink();
    renderExpenses();
  }

  function saveDay() {
    if (!selectedDayRef) return;
    Store.saveDayDetail(selectedDayRef, {
      startDateTime: $("dayStartInput").value,
      endDateTime: $("dayEndInput").value,
      vehicle: $("dayVehicleInput").value.trim(),
      lodging: $("dayLodgingInput").value.trim(),
      stops: $("dayStopsInput").value.trim(),
      detail: $("dayDetailInput").value.trim(),
      memo: $("dayMemoInput").value.trim()
    });
    $("daySaveMessage").textContent = "✓ このDAYの詳細を保存しました。";
    setTimeout(() => { $("daySaveMessage").textContent = ""; }, 5000);
  }

  function updateFuelVisibility() {
    const isFuel = $("expenseCategoryInput").value === "fuel";
    $("fuelExpenseFields").hidden = !isFuel;
    updateFuelEfficiency();
  }

  function updateFuelEfficiency() {
    const liters = Number($("expenseLitersInput").value);
    const distance = Number($("expenseDistanceInput").value);
    $("fuelEfficiencyPreview").textContent = liters > 0 && distance > 0 ? `${(distance / liters).toFixed(1)} km/L` : "—";
  }

  function resetExpenseForm() {
    editingExpenseId = "";
    const member = memberByRef(selectedDayRef);
    $("expenseDateInput").value = member && member.date || "";
    $("expenseCategoryInput").value = "fuel";
    $("expenseAmountInput").value = "";
    $("expenseVendorInput").value = "";
    $("expenseMemoInput").value = "";
    $("expenseLitersInput").value = "";
    $("expenseDistanceInput").value = "";
    $("saveExpenseButton").textContent = "明細を追加";
    $("cancelExpenseEditButton").hidden = true;
    updateFuelVisibility();
  }

  function editExpense(id) {
    const item = (currentJourney.expenses || []).find(expense => expense.id === id);
    if (!item || item.syncSource === "accounting-chat") return;
    editingExpenseId = id;
    $("expenseDateInput").value = item.date || "";
    $("expenseCategoryInput").value = item.category || "other";
    $("expenseAmountInput").value = String(item.amount || "");
    $("expenseVendorInput").value = item.vendor || "";
    $("expenseMemoInput").value = item.memo || "";
    $("expenseLitersInput").value = item.liters || "";
    $("expenseDistanceInput").value = item.distanceKm || "";
    $("saveExpenseButton").textContent = "明細を更新";
    $("cancelExpenseEditButton").hidden = false;
    updateFuelVisibility();
    $("expenseAmountInput").focus();
  }

  function saveExpense() {
    const amount = Number($("expenseAmountInput").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      $("expenseSaveMessage").textContent = "金額を入力してください。";
      return;
    }
    saveJourney(false);
    const now = new Date().toISOString();
    const item = {
      id: editingExpenseId || Store.uid("expense"),
      date: $("expenseDateInput").value,
      category: $("expenseCategoryInput").value,
      amount: Math.round(amount),
      vendor: $("expenseVendorInput").value.trim(),
      memo: $("expenseMemoInput").value.trim(),
      liters: $("expenseCategoryInput").value === "fuel" ? Number($("expenseLitersInput").value) || null : null,
      distanceKm: $("expenseCategoryInput").value === "fuel" ? Number($("expenseDistanceInput").value) || null : null,
      updatedAt: now
    };
    const expenses = Array.isArray(currentJourney.expenses) ? currentJourney.expenses.slice() : [];
    const index = expenses.findIndex(expense => expense.id === item.id);
    if (index >= 0) expenses[index] = { ...expenses[index], ...item };
    else expenses.push({ ...item, createdAt: now });
    currentJourney = Store.saveJourney({ ...currentJourney, expenses });
    renderExpenses();
    updateHero();
    $("expenseSaveMessage").textContent = index >= 0 ? "✓ 明細を更新しました。" : "✓ 旅の経費へ追加しました。";
    resetExpenseForm();
  }

  function deleteExpense(id) {
    const item = (currentJourney.expenses || []).find(expense => expense.id === id);
    if (!item || item.syncSource === "accounting-chat" || !confirm(`${categoryLabels[item.category] || "経費"} ${yen(item.amount)}を削除しますか？`)) return;
    currentJourney = Store.saveJourney({ ...currentJourney, expenses: currentJourney.expenses.filter(expense => expense.id !== id) });
    renderExpenses();
    updateHero();
    if (editingExpenseId === id) resetExpenseForm();
  }

  function renderExpenses() {
    const expenses = (Array.isArray(currentJourney.expenses) ? currentJourney.expenses : []).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const total = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    $("expensePanelTotal").textContent = `合計 ${yen(total)}`;
    const categories = {};
    const dates = {};
    const accountingChatUrl = currentAccountingChatUrl();
    expenses.forEach(item => {
      categories[item.category] = (categories[item.category] || 0) + (Number(item.amount) || 0);
      const date = item.date || "日付なし";
      dates[date] = (dates[date] || 0) + (Number(item.amount) || 0);
    });
    $("expenseCategorySummary").innerHTML = Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([category, amount]) => `<div><span>${categoryLabels[category] || "その他"}</span><strong>${yen(amount)}</strong></div>`).join("") || '<p>分類別の合計は、明細を追加すると表示されます。</p>';
    $("expenseDaySummary").innerHTML = Object.entries(dates).map(([date, amount]) => `<div><span>${escapeHtml(date === "日付なし" ? date : formatDate(date))}</span><strong>${yen(amount)}</strong></div>`).join("");
    const body = $("expenseTableBody");
    body.innerHTML = "";
    expenses.forEach(item => {
      const row = document.createElement("tr");
      const category = categoryLabels[item.category] ? item.category : "other";
      const isSynced = item.syncSource === "accounting-chat";
      const fuel = category === "fuel" && Number(item.liters) > 0 && Number(item.distanceKm) > 0
        ? `${Number(item.liters).toFixed(2)}L／${Number(item.distanceKm).toFixed(1)}km／${(Number(item.distanceKm) / Number(item.liters)).toFixed(1)}km/L`
        : "";
      row.innerHTML = `<td>${escapeHtml(formatDate(item.date || ""))}</td><td><span class="expense-kind kind-${category}">${categoryLabels[category]}</span>${isSynced ? '<span class="expense-sync-source">チャット取込</span>' : ""}</td><td><strong></strong><small></small></td><td>${fuel || "—"}</td><td class="expense-amount">${yen(item.amount)}</td><td><div class="expense-row-actions"></div></td>`;
      row.querySelector("td:nth-child(3) strong").textContent = item.vendor || "内容未登録";
      row.querySelector("td:nth-child(3) small").textContent = item.memo || "";
      const actions = row.querySelector(".expense-row-actions");
      if (isSynced && accountingChatUrl) {
        const link = document.createElement("a");
        link.textContent = "チャットで修正";
        link.href = accountingChatUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.appendChild(link);
      } else if (!isSynced) {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit";
        editButton.textContent = "編集";
        editButton.addEventListener("click", () => editExpense(item.id));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete";
        deleteButton.textContent = "削除";
        deleteButton.addEventListener("click", () => deleteExpense(item.id));
        actions.append(editButton, deleteButton);
      }
      body.appendChild(row);
    });
    $("expenseEmpty").hidden = expenses.length > 0;
  }

  function initialize() {
    if (!Store) throw new Error("旅詳細の保存機能を読み込めませんでした。");
    trips = readTrips();
    migrateLegacyAccountingChatUrls();
    const index = selectedTripIndex();
    if (index < 0 || !trips[index]) throw new Error("対象の旅カードを確認できません。ホームから旅を選び直してください。");
    context = Store.getJourneyContext(trips, index, Store.read());
    if (!context) throw new Error("旅の詳細を読み込めませんでした。");
    currentJourney = { ...context.journey, tripRefs: [...(context.journey.tripRefs || [])], expenses: [...(context.journey.expenses || [])] };
    selectedDayRef = context.selectedRef;
    candidateMembers = buildCandidates(index);
    renderJourneyForm();
    renderDayTabs();
    renderDayForm();
    renderExpenses();
    updateHero();
    $("journeyDetailContent").hidden = false;
  }

  $("saveJourneyButton").addEventListener("click", () => {
    try { saveJourney(true); } catch (error) { console.error(error); $("journeySaveMessage").textContent = `保存できませんでした：${error.message}`; }
  });
  $("saveDayButton").addEventListener("click", () => {
    try { saveDay(); } catch (error) { console.error(error); $("daySaveMessage").textContent = `保存できませんでした：${error.message}`; }
  });
  $("accountingChatUrlInput").addEventListener("input", () => {
    $("accountingChatMessage").textContent = $("accountingChatUrlInput").value.trim() ? "URLを設定・変更すると、この端末から開けます。" : "";
    syncAccountingChatLink();
  });
  $("saveAccountingChatButton").addEventListener("click", () => {
    try { saveAccountingChatLink(); } catch (error) { console.error(error); $("accountingChatMessage").classList.add("error"); $("accountingChatMessage").textContent = `保存できませんでした：${error.message}`; syncAccountingChatLink(); }
  });
  $("deleteAccountingChatButton").addEventListener("click", deleteAccountingChatLink);
  $("copyAccountingRequestButton").addEventListener("click", () => {
    try { saveJourney(false); } catch (error) {
      console.error(error);
      $("accountingChatMessage").classList.add("error");
      $("accountingChatMessage").textContent = `依頼文を作れませんでした：${error.message}`;
      return;
    }
    copyAccountingRequest().catch(error => {
      console.error(error);
      $("accountingChatMessage").classList.add("error");
      $("accountingChatMessage").textContent = `コピーできませんでした：${error.message}`;
    });
  });
  $("accountingImportInput").addEventListener("input", () => {
    if (pendingAccountingImport) resetAccountingImportPreview(false);
    $("accountingChatMessage").classList.remove("error");
    $("accountingChatMessage").textContent = $("accountingImportInput").value.trim() ? "JSONを貼り付けました。まず「貼り付け内容を確認」を押してください。" : "";
  });
  $("previewAccountingImportButton").addEventListener("click", () => {
    try { previewAccountingImport(); } catch (error) {
      console.error(error);
      resetAccountingImportPreview(false);
      $("accountingChatMessage").classList.add("error");
      $("accountingChatMessage").textContent = `確認できませんでした：${error.message}`;
    }
  });
  $("clearAccountingImportButton").addEventListener("click", () => {
    resetAccountingImportPreview(true);
    $("accountingChatMessage").classList.remove("error");
    $("accountingChatMessage").textContent = "入力内容を消去しました。保存済みの会計データは変更していません。";
  });
  $("applyAccountingImportButton").addEventListener("click", () => {
    try { applyAccountingImport(); } catch (error) {
      console.error(error);
      $("accountingChatMessage").classList.add("error");
      $("accountingChatMessage").textContent = `取込できませんでした：${error.message}`;
    }
  });
  $("expenseCategoryInput").addEventListener("change", updateFuelVisibility);
  $("expenseLitersInput").addEventListener("input", updateFuelEfficiency);
  $("expenseDistanceInput").addEventListener("input", updateFuelEfficiency);
  $("saveExpenseButton").addEventListener("click", () => {
    try { saveExpense(); } catch (error) { console.error(error); $("expenseSaveMessage").textContent = `保存できませんでした：${error.message}`; }
  });
  $("cancelExpenseEditButton").addEventListener("click", resetExpenseForm);
  try {
    initialize();
  } catch (error) {
    console.error(error);
    $("journeyLoadError").hidden = false;
    $("journeyLoadError").textContent = error.message;
  }
})();
