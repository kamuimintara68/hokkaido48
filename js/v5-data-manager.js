"use strict";
(function () {
  const TRIPS_KEY = "hokkaido48Trips";
  const MANUAL_STATUS_KEY = "hokkaido48V5ManualRouteStatus";
  const CONFIRMED_STATUS_KEY = "hokkaido48V5ConfirmedRouteStatus";
  const BACKUP_KEY = "hokkaido48V5DataManagerBackups";
  const ROUTE_URL = "data/routes-v50.json";
  const $ = id => document.getElementById(id);
  const tripSelect = $("dmTripSelect"), tripType = $("dmTripType"), editor = $("dmEditor"), empty = $("dmEmpty");
  const tripName = $("dmTripName"), startDate = $("dmStartDate"), endDate = $("dmEndDate"), memo = $("dmMemo");
  const routeChecks = $("dmRouteChecks"), gpxList = $("dmGpxList"), statusList = $("dmRouteStatusList");
  const saveStatus = $("dmSaveStatus"), backupStatus = $("dmBackupStatus"), restoreBackup = $("dmRestoreBackup");
  let routes = [], trips = [], manualStatuses = {};

  function loadTrips() {
    try { const x = JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]"); return Array.isArray(x) ? x : []; } catch { return []; }
  }
  function loadStatuses() {
    try { const x = JSON.parse(localStorage.getItem(MANUAL_STATUS_KEY) || "{}"); return x && typeof x === "object" && !Array.isArray(x) ? x : {}; } catch { return {}; }
  }
  function loadBackups() {
    try { const x = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]"); return Array.isArray(x) ? x : []; } catch { return []; }
  }
  function saveBackup(reason) {
    const backups = loadBackups();
    backups.push({ id:`backup-${Date.now()}`, savedAt:new Date().toISOString(), reason, trips:loadTrips(), manualStatuses:loadStatuses(), confirmedStatuses:(() => { try { return JSON.parse(localStorage.getItem(CONFIRMED_STATUS_KEY) || "{}"); } catch { return {}; } })() });
    while (backups.length > 20) backups.shift();
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
    renderBackupInfo();
  }
  function persistTrips() { localStorage.setItem(TRIPS_KEY, JSON.stringify(trips)); }
  function persistStatuses() { localStorage.setItem(MANUAL_STATUS_KEY, JSON.stringify(manualStatuses)); }
  function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
  function routeNumbersFromTrip(trip) {
    if (!trip) return [];
    if (Array.isArray(trip.confirmedRouteNumbers)) return [...new Set(trip.confirmedRouteNumbers.map(String))];
    if (Array.isArray(trip.routeSegments)) return [...new Set(trip.routeSegments.map(s => String(s?.routeNumber || "")).filter(Boolean))];
    if (Array.isArray(trip.routes)) return [...new Set(trip.routes.map(String))];
    return String(trip.routes || "").split(/[,、\s→/]+/).map(x => x.replace(/\D/g, "")).filter(Boolean);
  }
  function selectedTripIndex() { const n = Number(tripSelect.value); return Number.isInteger(n) && n >= 0 && n < trips.length ? n : -1; }
  function currentTrip() { const i = selectedTripIndex(); return i >= 0 ? trips[i] : null; }

  function renderTripSelect(preferIndex) {
    trips = loadTrips();
    tripSelect.innerHTML = '<option value="">旅を選択</option>';
    trips.forEach((t,i) => {
      const opt=document.createElement("option"); opt.value=String(i);
      const name=t.tripName || t.displayName || t.name || "名称未登録";
      const date=t.startDate || t.date || t.plannedDate || "日付未登録";
      opt.textContent=`${date}｜${name}${t.planningStatus === "planned" ? "［計画］" : "［実走］"}`;
      tripSelect.appendChild(opt);
    });
    if (Number.isInteger(preferIndex) && preferIndex >= 0 && preferIndex < trips.length) tripSelect.value=String(preferIndex);
    renderTripEditor();
  }
  function renderTripEditor() {
    const t=currentTrip();
    if (!t) { editor.hidden=true; empty.hidden=false; tripType.textContent=""; return; }
    editor.hidden=false; empty.hidden=true;
    tripType.textContent = t.planningStatus === "planned" ? "計画データ" : "実走記録";
    tripName.value=t.tripName || t.displayName || t.name || "";
    startDate.value=t.startDate || t.date || t.plannedDate || "";
    endDate.value=t.endDate || startDate.value || "";
    memo.value=t.memo || t.impressions || t.actionLog || "";
    const selected=new Set(routeNumbersFromTrip(t));
    routeChecks.innerHTML = routes.filter(r => r.challengeTarget !== false).map(r => `
      <label class="data-route-check"><input type="checkbox" value="${escapeHtml(r.number)}" ${selected.has(String(r.number)) ? "checked" : ""}><span><strong>国道${escapeHtml(r.number)}号</strong><small>${escapeHtml(r.start)} → ${escapeHtml(r.end)}</small></span></label>`).join("");
    renderGpx(t);
  }
  function renderGpx(t) {
    const imports=Array.isArray(t.materialImports) ? t.materialImports : [];
    if (!imports.length) { gpxList.innerHTML='<div class="empty-box">GPX取込記録はありません。</div>'; return; }
    gpxList.innerHTML="";
    imports.forEach((item,idx) => {
      const gpxs=Array.isArray(item?.gpx) ? item.gpx : [];
      if (!gpxs.length) return;
      const row=document.createElement("div"); row.className="data-gpx-row";
      const files=gpxs.map(g => `${g.fileName || "GPX"}${Number.isFinite(Number(g.distanceKm)) ? ` ／ ${Number(g.distanceKm).toFixed(1)}km` : ""}`).join("、");
      row.innerHTML=`<div><strong>${escapeHtml(files)}</strong><small>取込：${escapeHtml(item.importedAt || "不明")}</small></div><button type="button" class="danger-outline-button">このGPX取込を解除</button>`;
      row.querySelector("button").addEventListener("click", () => detachGpx(idx, files));
      gpxList.appendChild(row);
    });
    if (!gpxList.children.length) gpxList.innerHTML='<div class="empty-box">GPX取込記録はありません。</div>';
  }
  function detachGpx(importIndex, label) {
    const idx=selectedTripIndex(), t=trips[idx]; if (!t) return;
    if (!confirm(`${label} の紐づけを解除しますか？\nRoute状態は自動変更しません。`)) return;
    saveBackup(`GPX取込解除：${t.tripName || "名称未登録"}`);
    const imports=Array.isArray(t.materialImports) ? t.materialImports.slice() : [];
    const removed=imports[importIndex]; imports.splice(importIndex,1); t.materialImports=imports;
    const fileNames=new Set((removed?.gpx || []).map(g => String(g.fileName || "")));
    if (Array.isArray(t.gpxRouteConfirmations)) t.gpxRouteConfirmations=t.gpxRouteConfirmations.filter(c => !fileNames.has(String(c?.fileName || "")));
    if (Array.isArray(t.gpxRouteConfirmations)) t.confirmedRouteNumbers=[...new Set(t.gpxRouteConfirmations.flatMap(c => Array.isArray(c.routeNumbers) ? c.routeNumbers.map(String) : []))];
    t.updatedAt=new Date().toISOString(); trips[idx]=t; persistTrips(); renderTripEditor(); flash("GPX取込を解除しました。必要なら走行国道も修正してください。");
  }
  function saveBasic() {
    const idx=selectedTripIndex(), t=trips[idx]; if (!t) return;
    saveBackup(`基本情報変更：${t.tripName || "名称未登録"}`);
    t.tripName=tripName.value.trim() || "名称未登録"; t.startDate=startDate.value; t.endDate=endDate.value || startDate.value; t.memo=memo.value.trim(); t.updatedAt=new Date().toISOString();
    trips[idx]=t; persistTrips(); renderTripSelect(idx); flash("基本情報を保存しました。");
  }
  function saveRoutes() {
    const idx=selectedTripIndex(), t=trips[idx]; if (!t) return;
    const numbers=[...routeChecks.querySelectorAll('input[type="checkbox"]:checked')].map(x => String(x.value));
    saveBackup(`走行国道変更：${t.tripName || "名称未登録"}`);
    t.confirmedRouteNumbers=numbers.slice(); t.routes=numbers.join(",");
    const existing=Array.isArray(t.routeSegments) ? t.routeSegments : [];
    t.routeSegments=numbers.map(n => existing.find(s => String(s?.routeNumber || "")===n) || { routeNumber:n, status:"partial", source:"v5-data-manager-manual" });
    t.updatedAt=new Date().toISOString(); trips[idx]=t; persistTrips(); flash(`走行国道を ${numbers.length}路線で保存しました。`);
  }
  function deleteTrip() {
    const idx=selectedTripIndex(), t=trips[idx]; if (!t) return;
    const name=t.tripName || "名称未登録";
    if (t.planningStatus !== "planned") {
      const typed=prompt(`実走記録を削除します。確認のため旅名を入力してください。\n${name}`);
      if (typed !== name) { alert("旅名が一致しないため削除しませんでした。"); return; }
    } else if (!confirm(`計画「${name}」を削除しますか？`)) return;
    saveBackup(`旅削除：${name}`); trips.splice(idx,1); persistTrips(); renderTripSelect(); flash("旅を削除しました。");
  }

  function renderStatuses() {
    manualStatuses=loadStatuses();
    statusList.innerHTML=routes.filter(r => r.challengeTarget !== false).map(r => {
      const n=String(r.number), cur=manualStatuses[n] || "auto";
      return `<div class="data-status-row"><div><strong>国道${escapeHtml(n)}号</strong><small>${escapeHtml(r.start)} → ${escapeHtml(r.end)}</small></div><select data-route="${escapeHtml(n)}"><option value="auto" ${cur==="auto"?"selected":""}>自動</option><option value="未走破" ${cur==="未走破"?"selected":""}>未走破</option><option value="一部走破" ${cur==="一部走破"?"selected":""}>一部走破</option><option value="全線走破" ${cur==="全線走破"?"selected":""}>全線走破</option></select></div>`;
    }).join("");
  }
  function saveStatuses() {
    saveBackup("Route手動状態変更");
    const next={}; statusList.querySelectorAll("select[data-route]").forEach(sel => { if (sel.value !== "auto") next[String(sel.dataset.route)] = sel.value; });
    manualStatuses=next; persistStatuses(); renderStatuses(); flash("Route手動状態を保存しました。路線選択画面ではこの指定を優先します。");
  }
  function renderBackupInfo() {
    const backups=loadBackups(); const last=backups[backups.length-1];
    if (!last) { backupStatus.textContent="まだこの画面からの変更はありません。"; restoreBackup.disabled=true; return; }
    const d=new Date(last.savedAt); backupStatus.textContent=`直前：${d.toLocaleString("ja-JP")} ／ ${last.reason || "変更前"}`; restoreBackup.disabled=false;
  }
  function restoreLastBackup() {
    const backups=loadBackups(); const last=backups[backups.length-1]; if (!last) return;
    if (!confirm(`直前の変更前状態へ戻しますか？\n${last.reason || "変更前バックアップ"}`)) return;
    localStorage.setItem(TRIPS_KEY, JSON.stringify(last.trips || [])); localStorage.setItem(MANUAL_STATUS_KEY, JSON.stringify(last.manualStatuses || {})); localStorage.setItem(CONFIRMED_STATUS_KEY, JSON.stringify(last.confirmedStatuses || {})); backups.pop(); localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
    renderTripSelect(); renderStatuses(); renderBackupInfo(); flash("直前の変更を復元しました。");
  }
  function flash(text) { saveStatus.textContent=text; setTimeout(() => { if (saveStatus.textContent===text) saveStatus.textContent=""; }, 5000); }

  tripSelect.addEventListener("change", renderTripEditor);
  $("dmSaveBasic").addEventListener("click", saveBasic); $("dmSaveRoutes").addEventListener("click", saveRoutes); $("dmDeleteTrip").addEventListener("click", deleteTrip); $("dmSaveStatuses").addEventListener("click", saveStatuses); restoreBackup.addEventListener("click", restoreLastBackup);

  fetch(ROUTE_URL, {cache:"no-store"}).then(r => { if (!r.ok) throw new Error("routes read failed"); return r.json(); }).then(data => {
    routes=Array.isArray(data) ? data : (Array.isArray(data.routes) ? data.routes : []); renderTripSelect(); renderStatuses(); renderBackupInfo();
  }).catch(err => { console.error(err); statusList.innerHTML='<div class="empty-box">路線データを読み込めませんでした。</div>'; renderTripSelect(); renderBackupInfo(); });
})();
