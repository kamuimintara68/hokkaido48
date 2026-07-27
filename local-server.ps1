param(
    [int]$Port = 8765,
    [string]$Root = "."
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "ローカルサーバーを開始できませんでした。" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Read-Host "Enterで終了"
    exit 1
}

Write-Host ""
Write-Host "北海道48路線 ローカル確認サーバー" -ForegroundColor Green
Write-Host "公開フォルダ: $Root"
Write-Host "URL: $prefix"
Write-Host ""
Write-Host "この黒い画面は、確認中は閉じないでください。"
Write-Host "終了するときは Ctrl+C を押します。"
Write-Host ""

Start-Process "$prefix`plan.html"

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".geojson" = "application/geo+json; charset=utf-8"
    ".gpx"  = "application/gpx+xml; charset=utf-8"
    ".xml"  = "application/xml; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $requestPath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart("/"))

        if ([string]::IsNullOrWhiteSpace($requestPath)) {
            $requestPath = "index.html"
        }

        $requestPath = $requestPath -replace "/", [IO.Path]::DirectorySeparatorChar
        $candidate = [IO.Path]::GetFullPath((Join-Path $Root $requestPath))

        if (-not $candidate.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $context.Response.StatusCode = 403
            $context.Response.Close()
            continue
        }

        if (Test-Path $candidate -PathType Container) {
            $candidate = Join-Path $candidate "index.html"
        }

        if (-not (Test-Path $candidate -PathType Leaf)) {
            $context.Response.StatusCode = 404
            $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.Close()
            continue
        }

        $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
        $context.Response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { "application/octet-stream" }
        $context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        $context.Response.Headers["Pragma"] = "no-cache"
        $context.Response.Headers["Expires"] = "0"

        $bytes = [IO.File]::ReadAllBytes($candidate)
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    } catch [System.Net.HttpListenerException] {
        break
    } catch {
        Write-Host "エラー: $($_.Exception.Message)" -ForegroundColor Yellow
        try { $context.Response.StatusCode = 500; $context.Response.Close() } catch {}
    }
}

try { $listener.Stop() } catch {}
try { $listener.Close() } catch {}
