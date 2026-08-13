param(
    [string]$Repo = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function ReadText([string]$Path) {
    return [System.IO.File]::ReadAllText($Path)
}

function WriteUtf8Bom([string]$Path, [string]$Text) {
    $enc = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

$gpxJs = Join-Path $Repo "js\v5-gpx-import.js"
$dashJs = Join-Path $Repo "js\v5-dashboard.js"
$homeJs = Join-Path $Repo "js\v5-home.js"
$gpxHtml = Join-Path $Repo "gpx-import.html"
$v5Html = Join-Path $Repo "v5.html"
$routeHtml = Join-Path $Repo "route-select.html"

$files = @($gpxJs, $dashJs, $homeJs, $gpxHtml, $v5Html, $routeHtml)
foreach ($path in $files) {
    if (-not (Test-Path $path)) {
        throw "Required file not found: $path"
    }
}

# v2 must already have patched the GPX core.
$gpxText = ReadText $gpxJs
if (-not $gpxText.Contains("function persistTrips(")) {
    throw "GPX core patch not found: persistTrips"
}
if (-not $gpxText.Contains("function compactConfirmedLines(")) {
    throw "GPX core patch not found: compactConfirmedLines"
}
if (-not $gpxText.Contains("candidateConfirmationSnapshot")) {
    throw "GPX core patch not found: candidateConfirmationSnapshot"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $Repo ("build54_finish_backup_" + $stamp)
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($path in @($dashJs, $homeJs, $gpxHtml, $v5Html, $routeHtml)) {
    Copy-Item $path (Join-Path $backupDir ([System.IO.Path]::GetFileName($path))) -Force
}

# Dashboard BFCache refresh.
$text = ReadText $dashJs
if (-not $text.Contains("Build54 BFCache Trip refresh")) {
    $needle = "  initMap();"
    $pos = $text.LastIndexOf($needle)
    if ($pos -lt 0) {
        throw "Dashboard initMap marker not found"
    }

    $insert = @'
  // Build54 BFCache Trip refresh
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    render().catch(function (error) {
      console.error(error);
    });
  });

'@
    $text = $text.Insert($pos, $insert)
    WriteUtf8Bom $dashJs $text
}

# Saved journeys BFCache refresh.
$text = ReadText $homeJs
if (-not $text.Contains("Build54 saved journeys refresh")) {
    $needle = "  initMap();"
    $pos = $text.LastIndexOf($needle)
    if ($pos -lt 0) {
        throw "Home initMap marker not found"
    }

    $insert = @'
  // Build54 saved journeys refresh
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    storedTrips = loadStoredTrips();
    renderSavedJourneys();
    renderMap();
  });

'@
    $text = $text.Insert($pos, $insert)
    WriteUtf8Bom $homeJs $text
}

# Cache busting and local Build54 test label.
function PatchHtml([string]$Path, [string]$ScriptName) {
    $html = ReadText $Path
    $escaped = [regex]::Escape($ScriptName)
    $html = [regex]::Replace(
        $html,
        $escaped + '\?v=[0-9A-Za-z._-]+',
        $ScriptName + "?v=20260812-54"
    )
    $html = $html.Replace(
        "Version 5.0 Build 20260809-53 Official Release",
        "Version 5.0 Build 20260812-54 Long GPX Safety Test"
    )
    WriteUtf8Bom $Path $html
}

PatchHtml $gpxHtml "js/v5-gpx-import.js"
PatchHtml $v5Html "js/v5-dashboard.js"
PatchHtml $routeHtml "js/v5-home.js"

Write-Host ""
Write-Host "Build54 ASCII finish patch v4 applied." -ForegroundColor Green
Write-Host "GPX core patch: confirmed" -ForegroundColor Green
Write-Host "Dashboard refresh: applied" -ForegroundColor Green
Write-Host "Saved journeys refresh: applied" -ForegroundColor Green
Write-Host ("Backup: " + $backupDir)
Write-Host ""
Write-Host "No Git commit or push was performed."
Write-Host "Next: open http://localhost:8765/gpx-import.html and press Ctrl+F5."
