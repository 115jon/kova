<#!
.SYNOPSIS
    Starts the Kova local development environment.

.DESCRIPTION
    Kova has two local entry points:

      preview
        Starts the combined Vite + Cloudflare Worker dev server and serves the
        dashboard over http://localhost:5174. This is the fastest mode for
        reviewing the landing page and dashboard UI.

      full
        Starts the same dev server and ensures Caddy is running with the root
        Caddyfile. Use https://auth.lvh.me for OAuth, hosted authentication,
        wildcard app subdomains, and production-like HTTPS behavior.

    The script never kills an existing process. If the requested port is
    already occupied, it prints the owning process and exits so you can decide
    whether that process is safe to stop.

.PARAMETER Mode
    Either 'full' (default) or 'preview'.

.PARAMETER Port
    Local Vite/Worker port. Defaults to 5174, matching wrangler.toml and the
    Caddyfile.

.PARAMETER Open
    Opens the correct browser URL after the dev server accepts connections.

.PARAMETER SkipCaddy
    In full mode, skip starting Caddy. This is useful when Caddy is managed by
    another terminal, service, or workflow.

.PARAMETER SkipPortCheck
    Bypass the safety check for an occupied port. Use only when attaching to a
    process you intentionally started yourself.

.EXAMPLE
    .\scripts\dev.ps1
    Starts the full local environment with Caddy and opens no browser window.

.EXAMPLE
    .\scripts\dev.ps1 -Mode preview -Open
    Starts a loopback-only preview and opens http://localhost:5174/.

.EXAMPLE
    .\scripts\dev.ps1 -Mode full -SkipCaddy -Open
    Starts the dev server while leaving Caddy management to another process.
#>

[CmdletBinding()]
param(
    [ValidateSet("full", "preview")]
    [string]$Mode = "full",

    [ValidateRange(1, 65535)]
    [int]$Port = 5174,

    [switch]$Open,

    [switch]$SkipCaddy,

    [switch]$SkipPortCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Caddyfile = Join-Path $RepoRoot "Caddyfile"
$DevVars = Join-Path $RepoRoot "dashboard\.dev.vars"
$DashboardUrl = "http://localhost:$Port/"
$AuthUrl = "https://auth.lvh.me/"

function Write-Step {
    param([string]$Message)
    Write-Host "[kova] $Message" -ForegroundColor Cyan
}

function Write-WarningStep {
    param([string]$Message)
    Write-Host "[kova] $Message" -ForegroundColor Yellow
}

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Get-ListeningPortOwner {
    param([int]$PortNumber)

    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        return $null
    }

    return Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Assert-PortAvailable {
    param([int]$PortNumber)

    $connection = Get-ListeningPortOwner -PortNumber $PortNumber
    if (-not $connection) {
        return
    }

    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
    $commandLine = if ($owner) { $owner.CommandLine } else { "process $($connection.OwningProcess)" }

    throw @"
Port $PortNumber is already in use.
Owning PID: $($connection.OwningProcess)
Command:    $commandLine

Stop that process manually if it is stale, or rerun with -Port <other-port>.
This script does not terminate processes it did not start.
"@
}

function Get-DevVar {
    param(
        [string]$Path,
        [string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $line = Get-Content -LiteralPath $Path |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
        Select-Object -Last 1

    if (-not $line) {
        return $null
    }

    return ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim()
}

function Assert-LocalConfiguration {
    if ($Mode -eq "full" -and -not $SkipCaddy -and -not (Test-Path -LiteralPath $Caddyfile)) {
        throw "Caddyfile was not found at $Caddyfile."
    }

    if (-not (Test-Path -LiteralPath $DevVars)) {
        throw "dashboard/.dev.vars was not found. Create it before starting the Worker dev server."
    }

    $authUrl = Get-DevVar -Path $DevVars -Name "AUTH_URL"
    if ([string]::IsNullOrWhiteSpace($authUrl)) {
        throw "dashboard/.dev.vars must define AUTH_URL."
    }

    if ($Mode -eq "full" -and $authUrl -ne $AuthUrl.TrimEnd("/")) {
        Write-WarningStep "AUTH_URL is '$authUrl'. Full mode is documented for https://auth.lvh.me."
    }
}

function Start-CaddyIfNeeded {
    if ($SkipCaddy) {
        Write-WarningStep "Skipping Caddy. Full OAuth and wildcard hosted-auth flows may not work."
        return
    }

    $caddyProcess = Get-Process -Name "caddy" -ErrorAction SilentlyContinue
    if ($caddyProcess) {
        Write-Step "Caddy is already running; leaving the existing daemon untouched."
        return
    }

    Write-Step "Starting Caddy from $Caddyfile"
    & caddy start --config $Caddyfile
    if ($LASTEXITCODE -ne 0) {
        throw "Caddy failed to start with exit code $LASTEXITCODE."
    }
}

function Wait-ForPort {
    param(
        [int]$PortNumber,
        [System.Diagnostics.Process]$Process
    )

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "The dev server exited before port $PortNumber became available. Exit code: $($Process.ExitCode)."
        }

        if (Get-ListeningPortOwner -PortNumber $PortNumber) {
            return
        }

        Start-Sleep -Milliseconds 250
    }

    throw "Timed out waiting for the dev server on port $PortNumber."
}

function Stop-OwnedProcess {
    param([System.Diagnostics.Process]$Process)

    $Process.Refresh()
    if ($Process.HasExited) {
        return
    }

    Write-Step "Stopping the dev server started by this script."
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
}

Require-Command -Name "node"
Require-Command -Name "pnpm"
if ($Mode -eq "full" -and -not $SkipCaddy) {
    Require-Command -Name "caddy"
}

Assert-LocalConfiguration
if (-not $SkipPortCheck) {
    Assert-PortAvailable -PortNumber $Port
}

if ($Mode -eq "full") {
    Start-CaddyIfNeeded
}

$targetUrl = if ($Mode -eq "full" -and -not $SkipCaddy) { $AuthUrl } else { $DashboardUrl }
$pnpm = (Get-Command pnpm).Source
$arguments = @(
    "--filter", "dashboard",
    "run", "dev",
    "--host", "localhost",
    "--port", $Port.ToString()
)

Write-Step "Starting the combined dashboard + Worker dev server on port $Port"
Write-Step "Preview URL: $DashboardUrl"
if ($Mode -eq "full" -and -not $SkipCaddy) {
    Write-Step "Auth URL:    $AuthUrl"
}

$serverProcess = Start-Process -FilePath $pnpm -ArgumentList $arguments -WorkingDirectory $RepoRoot -PassThru -NoNewWindow

try {
    Wait-ForPort -PortNumber $Port -Process $serverProcess
    Write-Step "Dev server is accepting connections."

    if ($Open) {
        Write-Step "Opening $targetUrl"
        Start-Process $targetUrl | Out-Null
    }

    while ($true) {
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) {
            exit $serverProcess.ExitCode
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    Stop-OwnedProcess -Process $serverProcess
}
