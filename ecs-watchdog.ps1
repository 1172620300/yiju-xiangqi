$ErrorActionPreference = 'Stop'

$body = @{
    fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 1'
    legalMoves = @(@{ uci = 'a6a5' })
    depth = 1
} | ConvertTo-Json -Depth 4 -Compress

function Test-Pikafish {
    try {
        $result = Invoke-RestMethod -Uri 'http://127.0.0.1/api/move' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 35
        return $result.source -eq 'pikafish'
    } catch {
        $statusCode = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 429 -or $statusCode -eq 503) {
            return $true
        }
        return $false
    }
}

try {
    if (Test-Pikafish) {
        exit 0
    }
    Start-Sleep -Seconds 10
    if (Test-Pikafish) {
        exit 0
    }
    throw 'Pikafish failed two consecutive health checks.'
} catch {
    $listener = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and $listener.OwningProcess) {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Get-Process pikafish -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Stop-ScheduledTask -TaskName 'YijuXiangqiServer' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Start-ScheduledTask -TaskName 'YijuXiangqiServer'
    Start-Sleep -Seconds 12

    if (-not (Test-Pikafish)) {
        throw 'Pikafish remained unhealthy after restart.'
    }
}
