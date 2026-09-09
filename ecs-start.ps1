$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot
$env:XIANGQI_HOST = '0.0.0.0'
$env:XIANGQI_PORT = '80'
$env:XIANGQI_ENGINE_SLOTS = '1'
Remove-Item Env:XIANGQI_USER -ErrorAction SilentlyContinue
Remove-Item Env:XIANGQI_PASSWORD -ErrorAction SilentlyContinue

$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
    throw 'Python was not found. Install Python 3 for all users and add it to PATH.'
}

& $pythonCommand.Source server.py
