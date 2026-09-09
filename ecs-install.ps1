$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run this script in an Administrator PowerShell window.'
}

Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command python.exe -ErrorAction SilentlyContinue)) {
    throw 'Python was not found. Install Python 3 for all users and add it to PATH first.'
}

$taskName = 'YijuXiangqiServer'
$pythonCommand = (Get-Command python.exe -ErrorAction Stop).Source
$launcher = Join-Path $PSScriptRoot 'ecs-launch.py'
$action = New-ScheduledTaskAction -Execute $pythonCommand -Argument "`"$launcher`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null

if (-not (Get-NetFirewallRule -DisplayName 'Yiju Xiangqi Web' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Yiju Xiangqi Web' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 | Out-Null
}

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1/api/status' -TimeoutSec 10
Write-Host "Yiju Xiangqi is running: $($response.Content)"
