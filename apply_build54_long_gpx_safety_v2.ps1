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

function Normalize-Lf([string]$Text) {
    return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Replace-Exact([string]$Text, [string]$Old, [string]$New, [string]$Label) {
    if (-not $Text.Contains($Old)) {
        throw "Build54 patch failed: target not found: $Label"
    }
    return $Text.Replace($Old, $New)
}

$jsPath = Join-Path $Repo "js\v5-gpx-import.js"
$dashboardPath = Join-Path $Repo "js\v5-dashboard.js"
$homeJsPath = Join-Path $Repo "js\v5-home.js"
$gpxHtmlPath = Join-Path $Repo "gpx-import.html"
$v5HtmlPath = Join-Path $Repo "v5.html"
$routeHtmlPath = Join-Path $Repo "route-select.html"

$required = @($jsPath, $dashboardPath, $homeJsPath, $gpxHtmlPath, $v5HtmlPath, $routeHtmlPath)
foreach ($path in $required) {
    if (-not (Test-Path $path)) {
        throw "Required file not found: $path"
    }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $Repo "build54_backup_$stamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($path in $required) {
    Copy-Item $path (Join-Path $backupDir ([System.IO.Path]::GetFileName($path))) -Force
}

# ------------------------------------------------------------
# 1) GPX import: stationary filtering, path compaction, safe save
# ------------------------------------------------------------
$text = Normalize-Lf (Read-Utf8 $jsPath)

$old = @'
  function buildTrackSegments(trackPoints) {
    const segments = [];
    for (let i = 1; i < trackPoints.length; i += 1) {
      const a = [trackPoints[i - 1].lat, trackPoints[i - 1].lon];
      const b = [trackPoints[i].lat, trackPoints[i].lon];
      const meters = haversine(a, b);
      segments.push({
        a, b,
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        meters,
        bearing: bearingDeg(a, b),
        startTime: trackPoints[i - 1].time || "",
        endTime: trackPoints[i].time || "",
        valid: Number.isFinite(meters) && meters > 0 && meters <= 3000
      });
    }
    return segments;
  }
'@

$new = @'
  function buildTrackSegments(trackPoints) {
    const segments = [];
    for (let i = 1; i < trackPoints.length; i += 1) {
      const a = [trackPoints[i - 1].lat, trackPoints[i - 1].lon];
      const b = [trackPoints[i].lat, trackPoints[i].lon];
      const meters = haversine(a, b);
      const stationary = Number.isFinite(meters) && meters <= 2;
      const gpsJump = Number.isFinite(meters) && meters > 3000;
      segments.push({
        a, b,
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        meters,
        bearing: bearingDeg(a, b),
        startTime: trackPoints[i - 1].time || "",
        endTime: trackPoints[i].time || "",
        stationary,
        gpsJump,
        // Build54: 2m以下の細かな揺れ・停止点は走行判定へ入れない。
        // 長距離旅の1秒間隔GPXでも、停止中の座標列を実走距離へ混ぜない。
        valid: Number.isFinite(meters) && meters > 2 && meters <= 3000
      });
    }
    return segments;
  }
'@
$text = Replace-Exact $text $old $new "buildTrackSegments"

$old = @'
  function maskToPolylines(mask, trackSegments) {
    const lines = [];
    let current = [];
    for (let i = 0; i < trackSegments.length; i += 1) {
      const seg = trackSegments[i];
      if (mask[i] && seg.valid) {
        if (!current.length) current.push(seg.a);
        current.push(seg.b);
      } else if (current.length) {
        if (current.length >= 2) lines.push(current);
        current = [];
      }
    }
    if (current.length >= 2) lines.push(current);
    return lines;
  }
'@

$new = @'
  function maskToPolylines(mask, trackSegments) {
    const lines = [];
    let current = [];
    for (let i = 0; i < trackSegments.length; i += 1) {
      const seg = trackSegments[i];
      if (mask[i] && seg.valid) {
        if (!current.length) current.push(seg.a);
        current.push(seg.b);
      } else if (seg && seg.stationary) {
        // Build54: 停止・微小揺れは実走線を分断しない。
        // 停車中に数千点記録される長時間GPXでも、1本の走行区間として維持する。
        continue;
      } else if (current.length) {
        if (current.length >= 2) lines.push(current);
        current = [];
      }
    }
    if (current.length >= 2) lines.push(current);
    return lines;
  }
'@
$text = Replace-Exact $text $old $new "maskToPolylines"

$old = @'
  function loadStoredTrips() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
'@

$new = @'
  function loadStoredTrips() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRIPS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function hasStoredPath(segment) {
    if (!segment || typeof segment !== "object") return false;
    if (Array.isArray(segment.confirmedPaths) && segment.confirmedPaths.some(path => Array.isArray(path) && path.length > 1)) return true;
    return Array.isArray(segment.confirmedPath) && segment.confirmedPath.length > 1;
  }

  function migrateDuplicateConfirmationPaths() {
    const trips = loadStoredTrips();
    let changed = false;

    trips.forEach(trip => {
      const segments = Array.isArray(trip && trip.routeSegments) ? trip.routeSegments : [];
      const confirmations = Array.isArray(trip && trip.gpxRouteConfirmations) ? trip.gpxRouteConfirmations : [];
      if (!segments.length || !confirmations.length) return;

      trip.gpxRouteConfirmations = confirmations.map(confirmation => {
        const fileName = String(confirmation && confirmation.fileName || "");
        const routesInConfirmation = Array.isArray(confirmation && confirmation.routes) ? confirmation.routes : [];
        let confirmationChanged = false;

        const compactRoutes = routesInConfirmation.map(route => {
          if (!route || typeof route !== "object") return route;
          const routeNumber = String(route.routeNumber ?? route.number ?? "");
          const hasDuplicate = (Array.isArray(route.confirmedPaths) && route.confirmedPaths.length)
            || (Array.isArray(route.confirmedPath) && route.confirmedPath.length);
          if (!routeNumber || !hasDuplicate) return route;

          const canonicalExists = segments.some(segment => {
            if (String(segment && segment.routeNumber || "") !== routeNumber) return false;
            if (!hasStoredPath(segment)) return false;
            const segmentFile = String(segment && segment.gpxFileName || "");
            return !fileName || !segmentFile || fileName === segmentFile;
          });
          if (!canonicalExists) return route;

          const compact = { ...route };
          delete compact.confirmedPaths;
          delete compact.confirmedPath;
          confirmationChanged = true;
          changed = true;
          return compact;
        });

        return confirmationChanged ? { ...confirmation, routes: compactRoutes } : confirmation;
      });
    });

    if (!changed) return;
    try {
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
      console.info("Build54: gpxRouteConfirmations内の重複実走線を整理しました。");
    } catch (error) {
      // 既存データを壊さない。整理に失敗しても通常読込は継続する。
      console.warn("Build54: 既存重複実走線の整理を保存できませんでした。", error);
    }
  }

  function persistTrips(trips, expectedIndex, expectedId) {
    let serialized = "";
    try {
      serialized = JSON.stringify(trips);
      localStorage.setItem(TRIPS_KEY, serialized);
    } catch (error) {
      console.error("Build54 Trip保存エラー:", error);
      const approxKb = serialized ? Math.round(new Blob([serialized]).size / 1024) : 0;
      const isQuota = error && (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014);
      confirmStatusEl.textContent = isQuota
        ? `保存容量が不足しています（今回保存後のTripデータ概算 ${approxKb.toLocaleString("ja-JP")} KB）。Build54で圧縮しても保存できない状態です。全データバックアップを保管してからデータ整理を行ってください。`
        : `Tripを保存できませんでした：${error && error.message ? error.message : "不明なエラー"}`;
      return false;
    }

    const verified = loadStoredTrips();
    const saved = Number.isInteger(expectedIndex) && expectedIndex >= 0 ? verified[expectedIndex] : null;
    if (!saved || (expectedId && String(saved.id || "") !== String(expectedId))) {
      console.error("Build54 Trip保存後検証エラー", { expectedIndex, expectedId, verifiedCount: verified.length });
      confirmStatusEl.textContent = "保存処理後のTripを再読込できませんでした。保存完了とは扱いません。";
      return false;
    }
    return true;
  }
'@
$text = Replace-Exact $text $old $new "loadStoredTrips + safe persistence"

$old = @'
  function compactPath(path, maxPoints = 180) {
    if (!Array.isArray(path) || path.length <= maxPoints) return Array.isArray(path) ? path.map(p => [Number(p[0]), Number(p[1])]) : [];
    const step = (path.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i += 1) {
      const p = path[Math.round(i * step)];
      out.push([Number(p[0]), Number(p[1])]);
    }
    return out;
  }
'@

$new = @'
  function compactPath(path, maxPoints = 180) {
    if (!Array.isArray(path) || path.length <= maxPoints) return Array.isArray(path) ? path.map(p => [Number(p[0]), Number(p[1])]) : [];
    const step = (path.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i += 1) {
      const p = path[Math.round(i * step)];
      out.push([Number(p[0]), Number(p[1])]);
    }
    return out;
  }

  function simplifyPath(path, toleranceMeters = 12) {
    const source = Array.isArray(path)
      ? path.filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
        .map(p => [Number(p[0]), Number(p[1])])
      : [];
    if (source.length <= 2) return source;

    const keep = new Uint8Array(source.length);
    keep[0] = 1;
    keep[source.length - 1] = 1;
    const stack = [[0, source.length - 1]];

    while (stack.length) {
      const [start, end] = stack.pop();
      let farthestIndex = -1;
      let farthestDistance = -1;
      for (let i = start + 1; i < end; i += 1) {
        const distance = pointSegmentDistanceMeters(source[i], source[start], source[end]);
        if (distance > farthestDistance) {
          farthestDistance = distance;
          farthestIndex = i;
        }
      }
      if (farthestIndex >= 0 && farthestDistance > toleranceMeters) {
        keep[farthestIndex] = 1;
        stack.push([start, farthestIndex], [farthestIndex, end]);
      }
    }

    return source.filter((_, index) => keep[index]);
  }

  function compactConfirmedLines(lines, maxPointsTotal = 800) {
    const simplified = (Array.isArray(lines) ? lines : [])
      .map(line => simplifyPath(line, 12))
      .filter(line => line.length >= 2);

    const totalPoints = simplified.reduce((sum, line) => sum + line.length, 0);
    if (totalPoints <= maxPointsTotal) return simplified;

    const ratio = maxPointsTotal / totalPoints;
    return simplified.map(line => {
      const target = Math.max(2, Math.floor(line.length * ratio));
      return compactPath(line, target);
    });
  }

  function compactMovingTrackPreview(points, maxPoints = 300) {
    const moving = [];
    let anchor = null;
    (Array.isArray(points) ? points : []).forEach(point => {
      if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lon))) return;
      if (!anchor) {
        moving.push(point);
        anchor = point;
        return;
      }
      const meters = haversine(
        [Number(anchor.lat), Number(anchor.lon)],
        [Number(point.lat), Number(point.lon)]
      );
      if (Number.isFinite(meters) && meters > 2) {
        moving.push(point);
        anchor = point;
      }
    });
    return compactTrackPreview(moving.length ? moving : points, maxPoints);
  }
'@
$text = Replace-Exact $text $old $new "path compaction"

$old = @'
  function candidateSaveSnapshot(item) {
    const lines = maskToPolylines(item.matchedMask, latestTrackSegments).map(line => compactPath(line));
    return {
      routeNumber: String(item.route.number),
      confidence: item.confidence,
      overlapClass: item.overlapClass,
      matchedKm: Number((item.matchedMeters / 1000).toFixed(2)),
      longestMatchedKm: Number((item.longestContinuous / 1000).toFixed(2)),
      independentKm: Number((item.independentMeters / 1000).toFixed(2)),
      sharedKm: Number((item.sharedMeters / 1000).toFixed(2)),
      sharedWith: item.sharedWith.map(v => String(v.number)),
      confirmedPaths: lines
    };
  }
'@

$new = @'
  function candidateMetricSnapshot(item) {
    return {
      routeNumber: String(item.route.number),
      confidence: item.confidence,
      overlapClass: item.overlapClass,
      matchedKm: Number((item.matchedMeters / 1000).toFixed(2)),
      longestMatchedKm: Number((item.longestContinuous / 1000).toFixed(2)),
      independentKm: Number((item.independentMeters / 1000).toFixed(2)),
      sharedKm: Number((item.sharedMeters / 1000).toFixed(2)),
      sharedWith: item.sharedWith.map(v => String(v.number))
    };
  }

  function candidateSaveSnapshot(item) {
    // Build54: 正本となる実走線はrouteSegments側だけに保存する。
    // 停止点を除外した一致線を形状保持簡略化し、1路線あたり概ね800点以内へ抑える。
    const lines = compactConfirmedLines(maskToPolylines(item.matchedMask, latestTrackSegments), 800);
    return { ...candidateMetricSnapshot(item), confirmedPaths: lines };
  }

  function candidateConfirmationSnapshot(item) {
    // gpxRouteConfirmationsは「人がどの国道を確定したか」の記録専用。
    // confirmedPathsはrouteSegmentsと重複するためBuild54以降は保存しない。
    return candidateMetricSnapshot(item);
  }
'@
$text = Replace-Exact $text $old $new "candidate snapshots"

$text = Replace-Exact $text `
    '    const previewTrack = compactTrackPreview(a.points);' `
    '    const previewTrack = compactMovingTrackPreview(a.points);' `
    "moving preview"

$text = Replace-Exact $text `
    '      routes: selectedItems.map(candidateSaveSnapshot)' `
    '      routes: selectedItems.map(candidateConfirmationSnapshot)' `
    "confirmation path dedup"

$text = Replace-Exact $text `
    '        pointCount: a.points.length,' `
    "        pointCount: a.points.length,`n        storedPreviewPointCount: previewTrack.length,`n        storageMode: `"movement-simplified-v54`"," `
    "import storage metadata"

$pattern = '(?m)^([ \t]*)trips\[target\.index\] = trip;\n\1localStorage\.setItem\(TRIPS_KEY, JSON\.stringify\(trips\)\);'
$replacement = '$1trips[target.index] = trip;' + "`n" + '$1if (!persistTrips(trips, target.index, trip.id || "")) return;'
$before = $text
$text = [regex]::Replace($text, $pattern, $replacement, 1)
if ($text -eq $before) {
    throw "Build54 patch failed: target not found: existing trip safe save"
}

$pattern = '(?m)^([ \t]*)trips\.push\(trip\);\n\1localStorage\.setItem\(TRIPS_KEY, JSON\.stringify\(trips\)\);'
$replacement = '$1trips.push(trip);' + "`n" + '$1const newIndex = trips.length - 1;' + "`n" + '$1if (!persistTrips(trips, newIndex, trip.id)) return;'
$before = $text
$text = [regex]::Replace($text, $pattern, $replacement, 1)
if ($text -eq $before) {
    throw "Build54 patch failed: target not found: new trip safe save"
}

$old = @'
  setFlowStage(0);
  initMap();
  loadTrips();
'@
$new = @'
  setFlowStage(0);
  initMap();
  // Build54: Build53までに二重保存された確定線を安全に整理して空き容量を確保する。
  migrateDuplicateConfirmationPaths();
  loadTrips();
'@
$text = Replace-Exact $text $old $new "startup migration"

Write-Utf8NoBom $jsPath $text

# ------------------------------------------------------------
# 2) Home dashboard: BFCache return must reload Trip evidence
# ------------------------------------------------------------
$text = Normalize-Lf (Read-Utf8 $dashboardPath)

$old = @'
  initMap();
  fitButton?.addEventListener("click", () => { if (fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [16, 16], maxZoom: 7 }); });
  render().catch(error => { console.error(error); messageEl.textContent = error.message || "走破記録マップを表示できませんでした。"; });
})();
'@
$new = @'
  function safeRender() {
    render().catch(error => {
      console.error(error);
      messageEl.textContent = error.message || "走破記録マップを表示できませんでした。";
    });
  }

  initMap();
  fitButton?.addEventListener("click", () => { if (fullBounds && fullBounds.isValid()) map.fitBounds(fullBounds, { padding: [16, 16], maxZoom: 7 }); });
  // GPX保存画面から「戻る」で復帰した場合も、localStorageを正本として再描画する。
  window.addEventListener("pageshow", event => { if (event.persisted) safeRender(); });
  window.addEventListener("storage", event => {
    if ([TRIPS_KEY, MANUAL_STATUS_KEY, CONFIRMED_STATUS_KEY].includes(event.key)) safeRender();
  });
  safeRender();
})();
'@
$text = Replace-Exact $text $old $new "dashboard re-render"
Write-Utf8NoBom $dashboardPath $text

# ------------------------------------------------------------
# 3) Saved journeys: reload localStorage after returning from GPX
# ------------------------------------------------------------
$text = Normalize-Lf (Read-Utf8 $homeJsPath)

$old = @'
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    restoreDraft();
    renderAll(false);
    generateRoughPlan();
  });
'@
$new = @'
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    storedTrips = loadStoredTrips();
    restoreDraft();
    renderAll(true);
    generateRoughPlan();
  });
'@
$text = Replace-Exact $text $old $new "saved journeys BFCache refresh"
Write-Utf8NoBom $homeJsPath $text

# ------------------------------------------------------------
# 4) Local test build labels / cache busting
# ------------------------------------------------------------
function Patch-Html([string]$Path, [string]$ScriptName) {
    $html = Normalize-Lf (Read-Utf8 $Path)
    $html = $html.Replace("$ScriptName?v=20260809-53", "$ScriptName?v=20260812-54")
    $html = $html.Replace(
        "Version 5.0 Build 20260809-53 Official Release",
        "Version 5.0 Build 20260812-54 Long GPX Safety Test"
    )
    Write-Utf8NoBom $Path $html
}

Patch-Html $gpxHtmlPath "js/v5-gpx-import.js"
Patch-Html $v5HtmlPath "js/v5-dashboard.js"
Patch-Html $routeHtmlPath "js/v5-home.js"

Write-Host ""
Write-Host "Build54 Long GPX Safety patch v2 applied." -ForegroundColor Green
Write-Host "Backup: $backupDir"
Write-Host ""
Write-Host "Changed:"
Write-Host "  js/v5-gpx-import.js"
Write-Host "  js/v5-dashboard.js"
Write-Host "  js/v5-home.js"
Write-Host "  gpx-import.html"
Write-Host "  v5.html"
Write-Host "  route-select.html"
Write-Host ""
Write-Host "No Git commit/push was performed."
Write-Host "Open http://localhost:8765/gpx-import.html and press Ctrl+F5."
