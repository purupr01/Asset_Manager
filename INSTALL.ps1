#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$SiteName  = "AssetManager"
$AppPath   = "C:\inetpub\wwwroot\assetmanager"
$Port      = 8081
$PoolName  = "AssetManagerPool"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  ITProAcademy Asset Manager - IIS Setup" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check IIS ────────────────────────────────────────────────────────
Write-Host "[1/7] Checking IIS installation..." -ForegroundColor Yellow
$iis = Get-Service -Name W3SVC -ErrorAction SilentlyContinue
if (-not $iis) {
    Write-Host "      IIS not found. Installing Windows features..." -ForegroundColor Yellow
    Install-WindowsFeature -Name Web-Server,Web-Mgmt-Tools -IncludeManagementTools
    Write-Host "      OK IIS installed." -ForegroundColor Green
} else {
    Write-Host "      OK IIS is installed (Status: $($iis.Status))" -ForegroundColor Green
}

# ── Step 2: Check .NET 8 Hosting Bundle / ANCM V2 ───────────────────────────
Write-Host ""
Write-Host "[2/7] Checking .NET 8 Hosting Bundle (ANCM V2)..." -ForegroundColor Yellow

$ancmDll = "$env:ProgramFiles\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll"

if (Test-Path $ancmDll) {
    Write-Host "      OK ASP.NET Core Module V2 found." -ForegroundColor Green
} else {
    Write-Host "      MISSING: ASP.NET Core Module V2 not found." -ForegroundColor Red
    Write-Host "      Location checked: $ancmDll" -ForegroundColor Red
    Write-Host ""
    Write-Host "      ACTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "      1. Download .NET 8 Hosting Bundle from:" -ForegroundColor Yellow
    Write-Host "         https://dotnet.microsoft.com/download/dotnet/8.0" -ForegroundColor Yellow
    Write-Host "      2. Choose: Windows > Hosting Bundle" -ForegroundColor Yellow
    Write-Host "      3. Install as Administrator" -ForegroundColor Yellow
    Write-Host "      4. Run: iisreset /restart" -ForegroundColor Yellow
    Write-Host "      5. Re-run this script" -ForegroundColor Yellow
    Write-Host ""
    $yn = Read-Host "      Attempt automatic download now? (Y/N)"
    if ($yn -eq "Y" -or $yn -eq "y") {
        $url  = "https://download.visualstudio.microsoft.com/download/pr/dotnet-hosting-8.0.15-win.exe"
        $dest = "$env:TEMP\dotnet-hosting-8-win.exe"
        Write-Host "      Downloading..." -ForegroundColor Yellow
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
            Write-Host "      Installing silently..." -ForegroundColor Yellow
            Start-Process -FilePath $dest -ArgumentList "/quiet /norestart" -Wait
            Write-Host "      OK Hosting Bundle installed." -ForegroundColor Green
        } catch {
            Write-Host "      Download failed: $_" -ForegroundColor Red
            Write-Host "      Please install manually then re-run this script." -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "      Install the Hosting Bundle then re-run this script." -ForegroundColor Yellow
        exit 1
    }
}

$dotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
if ($dotnetCmd) {
    $ver = & dotnet --version 2>$null
    Write-Host "      OK dotnet.exe version: $ver" -ForegroundColor Green
} else {
    Write-Host "      WARNING: dotnet not in PATH. A reboot may be needed." -ForegroundColor Yellow
}

# ── Step 3: IIS Reset ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/7] Restarting IIS to register ANCM module..." -ForegroundColor Yellow
& iisreset /restart
Write-Host "      OK IIS restarted." -ForegroundColor Green

# ── Step 4: Create directories ───────────────────────────────────────────────
Write-Host ""
Write-Host "[4/7] Creating site directories..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $AppPath        -Force | Out-Null
New-Item -ItemType Directory -Path "$AppPath\logs" -Force | Out-Null
New-Item -ItemType Directory -Path "$AppPath\Data" -Force | Out-Null
Write-Host "      OK Created: $AppPath" -ForegroundColor Green
Write-Host "      OK Created: $AppPath\logs" -ForegroundColor Green
Write-Host "      OK Created: $AppPath\Data" -ForegroundColor Green

# ── Step 5: Permissions ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/7] Setting IIS_IUSRS write permissions on Data\ and logs\..." -ForegroundColor Yellow

$folders = @("$AppPath\Data", "$AppPath\logs")
foreach ($folder in $folders) {
    $acl  = Get-Acl $folder
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "IIS_IUSRS",
        "Modify",
        "ContainerInherit,ObjectInherit",
        "None",
        "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -Path $folder -AclObject $acl
    Write-Host "      OK Permissions set on $folder" -ForegroundColor Green
}

# ── Step 6: Application Pool ─────────────────────────────────────────────────
Write-Host ""
Write-Host "[6/7] Configuring Application Pool: $PoolName..." -ForegroundColor Yellow
Import-Module WebAdministration -ErrorAction SilentlyContinue

$poolPath = "IIS:\AppPools\$PoolName"
if (Test-Path $poolPath) {
    Write-Host "      App pool already exists, updating settings." -ForegroundColor Yellow
} else {
    New-WebAppPool -Name $PoolName | Out-Null
    Write-Host "      OK Created app pool: $PoolName" -ForegroundColor Green
}

Set-ItemProperty $poolPath managedRuntimeVersion    ""
Set-ItemProperty $poolPath startMode                "AlwaysRunning"
Set-ItemProperty $poolPath processModel.idleTimeout "00:00:00"
Write-Host "      OK App pool set to No Managed Code." -ForegroundColor Green
Write-Host "      OK Start mode: AlwaysRunning." -ForegroundColor Green

# ── Step 7: Website ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] Configuring IIS Website on port $Port..." -ForegroundColor Yellow

$existingSite = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
if ($existingSite) {
    Write-Host "      Site '$SiteName' already exists, updating." -ForegroundColor Yellow
    Set-ItemProperty "IIS:\Sites\$SiteName" physicalPath $AppPath
    Set-ItemProperty "IIS:\Sites\$SiteName" applicationPool $PoolName
} else {
    New-Website -Name $SiteName `
                -PhysicalPath $AppPath `
                -ApplicationPool $PoolName `
                -Port $Port `
                -Force | Out-Null
    Write-Host "      OK Website '$SiteName' created on port $Port." -ForegroundColor Green
}

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "  IIS setup complete!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. Build the app on your dev machine:" -ForegroundColor White
Write-Host "     dotnet publish -c Release -o ./publish" -ForegroundColor White
Write-Host "  2. Copy publish\ contents to:" -ForegroundColor White
Write-Host "     $AppPath" -ForegroundColor White
Write-Host "  3. Open browser: http://localhost:$Port/" -ForegroundColor White
Write-Host "  4. Test APIs:" -ForegroundColor White
Write-Host "     http://localhost:$Port/api/activation" -ForegroundColor White
Write-Host "     http://localhost:$Port/api/users" -ForegroundColor White
Write-Host ""
