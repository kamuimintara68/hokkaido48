param(
    [string]$Repo = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path)
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

$gpxJs = Join-Path $Repo "js\v5-gpx-import.js"
$dashJs = Join-Path $Repo "js\v5-dashboard.js"
$homeJs = Join-Path $Repo "js\v5-home.js"
$gpxHtml = Join-Path $Repo "gpx-import.html"
$v5Html = Join-Path $Repo "v5.html"
$routeHtml = Join-Path $Repo "route-select.html"

foreach ($path in @($gpxJs,$dashJs,$homeJs,$gpxHtml,$v5Html,$routeHtml)) {
    if (-not (Test-Path $path)) { throw "Required file not found: $path" }
}

# v2がGPX本体へ書き込めたことを先に確認する。
$gpxText = Read-Utf8 $gpxJs
if (-not $gpxText.Contains("function persistTrips(") -or
    -not $gpxText.Contains("function compactConfirmedLines(") -or
    -not $gpxText.Contains("candidateConfirmationSnapshot")) {
    throw "Build54 GPX本体の修正が確認できません。ここでは先へ進めません。"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $Repo "build54_finish_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($path in @($dashJs,$homeJs,$gpxHtml,$v5Html,$routeHtml)) {
    Copy-Item $path (Join-Path $backupDir ([System.IO.Path]::GetFileName($path))) -Force
}

# ------------------------------------------------------------
# トップ画面：戻る操作(BFCache)でもTripを再読込して地図を再描画
# ------------------------------------------------------------
$text = Read-Utf8 $dashJs
$marker = "Build54 BFCache Trip refresh"
if (-not $text.Contains($marker)) {
    $needle = '  render().catch(error => { console.error(error); messageEl.textContent = error.message || "走破記録マップを表示できませんでした。"; });'
    $pos = $text.IndexOf($needle)
    if ($pos -lt 0) {
        throw "Build54 finish failed: dashboard render line not found"
    }
    $insert = @'
  // Build54 BFCache Trip refresh
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    render().catch(error => {
      console.error(error);
      messageEl.textContent = error.message || "走破記録マップを表示できませんでした。";
    });
  });
'@
    $text = $text.Insert($pos, $insert + "`n")
    Write-Utf8NoBom $dashJs $text
}

# ------------------------------------------------------------
# 保存済み旅一覧：GPX画面から戻ったときlocalStorageを再読込
# ------------------------------------------------------------
$text = Read-Utf8 $homeJs
$marker = "Build54 saved journeys refresh"
if (-not $text.Contains($marker)) {
    $needle = '  initMap();'
    $pos = $text.LastIndexOf($needle)
    if ($pos -lt 0) {
        throw "Build54 finish failed: v5-home initMap line not found"
    }
    $insert = @'
  // Build54 saved journeys refresh
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    storedTrips = loadStoredTrips();
    renderSavedJourneys();
    renderMap();
  });

'@
    $text = $text.Insert($pos, $insert)
    Write-Utf8NoBom $homeJs $text
}

# ------------------------------------------------------------
# HTML: Build54テスト表示とキャッシュ更新
# ------------------------------------------------------------
function Patch-Html([string]$Path, [string]$ScriptName) {
    $html = Read-Utf8 $Path
    $html = [regex]::Replace(
        $html,
        [regex]::Escape($ScriptName) + '\?v=[0-9A-Za-z._-]+',
        "$ScriptName?v=20260812-54"
    )
    $html = $html.Replace(
        "Version 5.0 Build 20260809-53 Official Release",
        "Version 5.0 Build 20260812-54 Long GPX Safety Test"
    )
    Write-Utf8NoBom $Path $html
}

Patch-Html $gpxHtml "js/v5-gpx-import.js"
Patch-Html $v5Html "js/v5-dashboard.js"
Patch-Html $routeHtml "js/v5-home.js"

Write-Host ""
Write-Host "Build54 finish patch v3 applied." -ForegroundColor Green
Write-Host "GPX core patch: confirmed" -ForegroundColor Green
Write-Host "Dashboard refresh: applied" -ForegroundColor Green
Write-Host "Saved journeys refresh: applied" -ForegroundColor Green
Write-Host "Backup: $backupDir"
Write-Host ""
Write-Host "No Git commit/push was performed."
Write-Host "Next: open http://localhost:8765/gpx-import.html and press Ctrl+F5."
