# ITProAcademy Asset Manager — Production Setup Guide
## Scaled for 8,000 Employees · Windows Server 2019/2022 · IIS

---

## Overview

This guide walks you through a complete production deployment of the Asset Manager for an
organisation with approximately 8,000 employees across multiple offices. It covers server
sizing, IIS hardening, bulk data import from Active Directory, user role setup, backup
strategy, HTTPS, and ongoing operations.

Estimated setup time: 2–4 hours for a fresh server.

---

## Part 1 — Server Sizing and Preparation

### 1.1 Recommended Server Specifications

| Resource | Minimum | Recommended | Notes |
|---|---|---|---|
| CPU | 2 vCPU | 4 vCPU | ASP.NET Core is single-process, lightweight |
| RAM | 4 GB | 8 GB | appdata.json for 8k employees ≈ 20–30 MB in memory |
| OS Disk (C:) | 60 GB | 100 GB | OS + IIS + .NET runtime |
| Data Disk (D:) | 20 GB | 50 GB | App files + Data/ folder + backups |
| OS | Windows Server 2019 | Windows Server 2022 | 2016 works but not recommended |
| Network | 100 Mbps LAN | 1 Gbps LAN | All 8,000 users on the same segment |

### 1.2 Windows Server Preparation

Run these on the server before anything else (PowerShell as Administrator):

```powershell
# Set a static IP (replace with your values)
New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.1.50 `
  -PrefixLength 24 -DefaultGateway 192.168.1.1
Set-DnsClientServerAddress -InterfaceAlias "Ethernet" `
  -ServerAddresses ("192.168.1.10","192.168.1.11")

# Set hostname
Rename-Computer -NewName "ASSETMGR01" -Force

# Install IIS with required features
Install-WindowsFeature -Name Web-Server, Web-Mgmt-Tools, Web-Mgmt-Console `
  -IncludeManagementTools

# Verify IIS installed
Get-Service W3SVC
```

### 1.3 Dedicated Data Drive (Recommended)

If you have a separate data disk (D:), store the Data folder there to keep OS disk clean:

```powershell
# Format and label the data drive if new
# (Skip if already formatted)
Initialize-Disk -Number 1 -PartitionStyle MBR
New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter D
Format-Volume -DriveLetter D -FileSystem NTFS -NewFileSystemLabel "Data" -Confirm:$false

# Create the app and backup directories
New-Item -ItemType Directory -Path "D:\AssetManagerData" -Force
New-Item -ItemType Directory -Path "D:\Backups\AssetManager" -Force
```

---

## Part 2 — Install .NET 8 and IIS

### 2.1 Run the Setup Script

Copy your project folder to the server, then:

```powershell
cd C:\AssetManager-Source
Set-ExecutionPolicy Bypass -Scope Process -Force
.\INSTALL.ps1
```

The script handles: IIS install check, .NET 8 Hosting Bundle download/install,
iisreset, folder creation, permissions, app pool, and website on port 8081.

### 2.2 If Using a Separate Data Drive

After INSTALL.ps1 completes, move the Data folder to D: and create a symlink:

```powershell
# Move Data folder to D: drive
Move-Item "C:\inetpub\wwwroot\assetmanager\Data" "D:\AssetManagerData\Data"

# Create a junction (symlink) so the app still finds Data/ in its expected location
cmd /c mklink /J "C:\inetpub\wwwroot\assetmanager\Data" "D:\AssetManagerData\Data"

# Re-apply permissions to the real path
icacls "D:\AssetManagerData\Data" /grant "IIS_IUSRS:(OI)(CI)M"
```

### 2.3 Verify .NET 8 Runtime

```powershell
dotnet --version
# Should show 8.x.x

Test-Path "C:\Program Files\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll"
# Must return True
```

---

## Part 3 — Build and Deploy

### 3.1 Build on Dev Machine

On your development machine (needs .NET 8 SDK):

```powershell
cd AssetManager
dotnet publish -c Release -o ./publish
```

### 3.2 Copy to IIS Server

Option A — Robocopy (recommended, preserves timestamps):
```powershell
robocopy .\publish C:\inetpub\wwwroot\assetmanager /E /IS /LOG:deploy.log
```

Option B — WinSCP or FileZilla over SFTP/SCP.

Option C — Share the publish folder and copy across the network:
```powershell
# On the IIS server
net use Z: \\DEVMACHINE\publish /user:DOMAIN\you password
robocopy Z:\ C:\inetpub\wwwroot\assetmanager /E /IS
net use Z: /delete
```

### 3.3 Confirm Permissions After Copy

```powershell
icacls "C:\inetpub\wwwroot\assetmanager\Data" /grant "IIS_IUSRS:(OI)(CI)M"
icacls "C:\inetpub\wwwroot\assetmanager\logs" /grant "IIS_IUSRS:(OI)(CI)M"
```

### 3.4 Start the Site and Verify

```powershell
Start-WebAppPool -Name "AssetManagerPool"
Start-Website -Name "AssetManager"

# Test locally on the server
Invoke-WebRequest http://localhost:8081/api/activation -UseBasicParsing
# Expected: {"activated":false,"key":null,"expires":null,...}

Invoke-WebRequest http://localhost:8081/api/users -UseBasicParsing
# Expected: [{"id":"USR0001","username":"admin",...}]
```

---

## Part 4 — HTTPS Setup (Required for Production)

### 4.1 Obtain an SSL Certificate

Option A — Internal CA (recommended for intranet):
```powershell
# Request from your internal CA (replace with your CA server and template)
$cert = Get-Certificate -Template "WebServer" -CertStoreLocation "Cert:\LocalMachine\My" `
  -DnsName "assetmanager.yourdomain.local" -Url ldap:
```

Option B — Self-signed (testing/small orgs only):
```powershell
$cert = New-SelfSignedCertificate `
  -DnsName "assetmanager.yourdomain.local", "192.168.1.50" `
  -CertStoreLocation "Cert:\LocalMachine\My" `
  -NotAfter (Get-Date).AddYears(3)
Write-Host "Thumbprint: $($cert.Thumbprint)"
```

Option C — Import an existing PFX:
```powershell
Import-PfxCertificate -FilePath "C:\Certs\assetmanager.pfx" `
  -CertStoreLocation "Cert:\LocalMachine\My" `
  -Password (Read-Host -AsSecureString "PFX Password")
```

### 4.2 Add HTTPS Binding to IIS

```powershell
Import-Module WebAdministration

# Get your certificate thumbprint
$thumbprint = (Get-ChildItem Cert:\LocalMachine\My |
  Where-Object { $_.Subject -like "*assetmanager*" } |
  Select-Object -First 1).Thumbprint

# Add HTTPS binding
New-WebBinding -Name "AssetManager" -Protocol "https" -Port 443 -IPAddress "*"

# Bind the certificate
$binding = Get-WebBinding -Name "AssetManager" -Protocol "https"
$binding.AddSslCertificate($thumbprint, "My")

Write-Host "HTTPS binding added with thumbprint: $thumbprint"
```

### 4.3 Update web.config for HTTPS

In `C:\inetpub\wwwroot\assetmanager\web.config`, update the ASPNETCORE_URLS:

```xml
<environmentVariable name="ASPNETCORE_URLS"
  value="https://0.0.0.0:443;http://0.0.0.0:8081" />
```

### 4.4 Add HTTPS Redirect in Program.cs

Before `app.Run()` in Program.cs add:
```csharp
app.UseHttpsRedirection();
```

Then rebuild and redeploy. After this, `http://SERVER:8081` redirects to `https://SERVER:443`.

### 4.5 Open Firewall for HTTPS

```powershell
New-NetFirewallRule -DisplayName "AssetManager HTTPS 443" `
  -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

---

## Part 5 — Open Firewall for LAN Access

```powershell
# Port 8081 (HTTP)
New-NetFirewallRule -DisplayName "AssetManager HTTP 8081" `
  -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow

# Port 443 (HTTPS — if using HTTPS)
New-NetFirewallRule -DisplayName "AssetManager HTTPS 443" `
  -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Employees access the app at: `http://192.168.1.50:8081/` or `https://assetmanager.yourdomain.local/`

---

## Part 6 — DNS (Optional but Recommended)

Create an internal DNS A record so employees use a friendly URL instead of an IP.

```powershell
# On your internal DNS server (Windows DNS)
Add-DnsServerResourceRecordA `
  -ZoneName "yourdomain.local" `
  -Name "assetmanager" `
  -IPv4Address "192.168.1.50"

# Test resolution from any workstation
nslookup assetmanager.yourdomain.local
```

After DNS propagates, employees use: `http://assetmanager.yourdomain.local:8081/`
With HTTPS: `https://assetmanager.yourdomain.local/`

---

## Part 7 — First Login, Admin Setup, and Activation

### 7.1 Change Admin Password

1. Browse to `http://SERVER-IP:8081/`
2. Log in: `admin` / `admin123`
3. Go to **Access Control** → find admin → **Edit**
4. Set a strong password (12+ characters, mix of types)
5. Click **Save User**

### 7.2 Generate and Enter Activation Key

1. Open `http://SERVER-IP:8081/key-generator.html`
2. Set Start Date: today
3. Set Valid Days: 365 (or your preferred duration, max 3650)
4. Enter your organisation name as Customer Reference
5. Click **Generate Key** → **Copy Key**
6. Go back to the main app → **Settings** → **Activation**
7. Paste the key → **Activate**
8. Status shows: "Activated for 365 more day(s)"

### 7.3 Add Office Locations

Go to **Settings → Offices** and add all your office/branch names before importing data.
These are referenced in asset and employee records.

Examples:
- Bangalore HQ
- Mumbai Office
- Delhi NCR
- Chennai Branch
- Hyderabad Office

### 7.4 Upload Company Logo

Go to **Settings → Branding** → upload your company logo PNG/JPG.
The logo appears in the topbar for all users and is embedded in all exported reports.

---

## Part 8 — Create User Accounts

Create accounts for all IT staff who will manage the system. Go to **Access Control → New User**.

### Role Assignment for 8,000-Employee Organisation

| Role | Who Gets It | Typical Count |
|---|---|---|
| Admin | IT Manager, Lead Admin | 2–3 people |
| Manager | IT Supervisors, Asset Team Lead | 3–5 people |
| Auditor | Finance / Audit staff, Compliance officer | 2–4 people |
| Viewer | HR leads, department managers needing read access | 10–20 people |

### Permissions Summary

| Permission | Admin | Manager | Auditor | Viewer |
|---|:---:|:---:|:---:|:---:|
| View assets and employees | ✅ | ✅ | ✅ | ✅ |
| Create / edit / delete records | ✅ | ✅ | ❌ | ❌ |
| View and export reports | ✅ | ✅ | ✅ | ❌ |
| Manage user accounts | ✅ | ❌ | ❌ | ❌ |

---

## Part 9 — Bulk Import from Active Directory

This is the fastest way to load 8,000 employees and their computers into the system.

### 9.1 Export User Objects from Active Directory

Run on a Domain Controller or any machine with the AD PowerShell module:

```powershell
# Export all enabled users to CSV
Get-ADUser -Filter {Enabled -eq $true} -Properties `
  EmployeeID, Name, EmailAddress, Department, Manager, MobilePhone, Office `
| Select-Object `
  @{N='employeeId'; E={$_.EmployeeID}},
  @{N='name';       E={$_.Name}},
  @{N='email';      E={$_.EmailAddress}},
  @{N='department'; E={$_.Department}},
  @{N='manager';    E={(Get-ADUser $_.Manager -Properties DisplayName -EA SilentlyContinue).DisplayName}},
  @{N='mobile';     E={$_.MobilePhone}},
  @{N='branch';     E={$_.Office}}
| Export-Csv -Path "C:\Exports\employees.csv" -NoTypeInformation -Encoding UTF8
```

Upload `employees.csv` via **Employees → User Object Import**.

Column format required: `employeeId, name, email, department, manager, mobile, branch`

**Notes:**
- Employees with duplicate emails are updated, not duplicated
- If EmployeeID is blank in AD, the system auto-generates IDs (EMP0001, EMP0002, ...)
- Import in batches of 2,000 if you experience browser timeout issues

### 9.2 Export Computer Objects from Active Directory

```powershell
# Export all enabled computer objects to CSV
Get-ADComputer -Filter {Enabled -eq $true} -Properties `
  Name, OperatingSystem, Location, SerialNumber, Description `
| Select-Object `
  @{N='name';         E={$_.Name}},
  @{N='os';           E={$_.OperatingSystem}},
  @{N='office';       E={$_.Location}},
  @{N='serialNumber'; E={$_.SerialNumber}},
  @{N='model';        E={$_.Description}},
  @{N='assignedUser'; E={""}}
| Export-Csv -Path "C:\Exports\computers.csv" -NoTypeInformation -Encoding UTF8
```

Upload `computers.csv` via **Assets → Computer Object Import**.

Column format required: `name, os, office, serialNumber, model, assignedUser`

**Notes:**
- Assets with duplicate serial numbers are skipped (safe to re-upload)
- OS containing "server" sets type to Server; otherwise Desktop
- `assignedUser` should be an Employee ID (EMP0001 format) if you want to pre-assign

### 9.3 Recommended Import Order

1. Add all office names in Settings first (so branch fields resolve correctly)
2. Import Employees first (so employee IDs exist before assets reference them)
3. Import Computer Assets
4. Manually add servers, switches, printers, and other non-AD assets as needed
5. Assign assets to employees via the Edit button on each asset

### 9.4 Handling Large Imports (8,000 rows)

The app processes CSV imports in the browser. For 8,000 employees, the file is typically
5–15 MB which processes in under 30 seconds on modern hardware. If you have issues:

- Split the CSV into batches of 2,000 rows each
- Upload one batch at a time (duplicate emails are safe — they update instead of duplicate)
- Use Chrome or Edge for best performance with large files

---

## Part 10 — Performance Tuning for 8,000 Employees

### 10.1 IIS Application Pool Settings

```powershell
Import-Module WebAdministration
$pool = "IIS:\AppPools\AssetManagerPool"

# Disable memory-based recycling (prevent unexpected restarts under load)
Set-ItemProperty $pool recycling.periodicRestart.memory 0
Set-ItemProperty $pool recycling.periodicRestart.privateMemory 0

# Keep process warm — no idle timeout
Set-ItemProperty $pool processModel.idleTimeout "00:00:00"

# AlwaysRunning — pre-start before first request
Set-ItemProperty $pool startMode "AlwaysRunning"

# Increase queue length for concurrent users
Set-ItemProperty $pool queueLength 5000

Write-Host "App pool tuned for production."
```

### 10.2 Request Size Limit for Large Imports

Large AD CSV files can exceed IIS's default 30 MB limit. Add to `web.config` inside
`<system.webServer>`:

```xml
<security>
  <requestFiltering>
    <requestLimits maxAllowedContentLength="104857600" />
  </requestFiltering>
</security>
```

Also add to `appsettings.json` if needed (Kestrel limit):
```json
{
  "Kestrel": {
    "Limits": {
      "MaxRequestBodySize": 104857600
    }
  }
}
```

### 10.3 Expected Performance with 8,000 Employees

| Operation | Expected Time | Notes |
|---|---|---|
| Initial page load | < 2 seconds | Static files cached after first load |
| Load dashboard | < 1 second | Reads entire appdata.json into memory |
| Load assets list (5,000 assets) | < 1 second | In-memory filtering |
| Load employees list (8,000) | 1–2 seconds | In-memory, browser rendering |
| CSV import 2,000 employees | 5–15 seconds | Browser-side processing + one API call |
| Export XLSX (full inventory) | 3–8 seconds | Browser-side ZIP construction |
| Export PDF (full inventory) | 5–10 seconds | Browser-side PDF build |
| API response time (/api/appdata) | < 200 ms | Reads cached JSON from memory |

The JSON data file for 8,000 employees + 10,000 assets + 500 tickets is approximately
15–25 MB. This is loaded once into server memory on startup and kept there.

### 10.4 Concurrent Users

The application uses a SemaphoreSlim to serialise file writes. Concurrent reads are
unlimited. For 8,000 employees, typical concurrent active users at any time is
15–50 IT staff, which is well within capacity.

If you expect more than 100 concurrent write operations per minute, consider increasing
worker process count in IIS (web garden) — though for most organisations, the single
process default is more than sufficient.

---

## Part 11 — Backup Strategy

### 11.1 What to Back Up

Everything important is in `Data\` — four JSON files:

| File | Size (8k org) | How Often |
|---|---|---|
| appdata.json | 15–25 MB | Daily + before imports |
| users.json | < 100 KB | After any user changes |
| activation.json | < 1 KB | After activation |
| logo.json | 50–500 KB | After logo changes |

### 11.2 Automated Daily Backup Script

Save this as `C:\Scripts\backup-assetmanager.ps1`:

```powershell
$src    = "C:\inetpub\wwwroot\assetmanager\Data"
$dest   = "D:\Backups\AssetManager"
$date   = Get-Date -Format "yyyy-MM-dd_HHmm"
$target = "$dest\$date"

New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item "$src\*" -Destination $target -Recurse

# Keep only last 30 days of backups
Get-ChildItem $dest -Directory |
  Sort-Object CreationTime -Descending |
  Select-Object -Skip 30 |
  Remove-Item -Recurse -Force

Write-Host "Backup complete: $target"
```

Schedule it in Task Scheduler:

```powershell
$action  = New-ScheduledTaskAction -Execute "PowerShell.exe" `
             -Argument "-NonInteractive -File C:\Scripts\backup-assetmanager.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00AM"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "AssetManager-DailyBackup" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force

Write-Host "Daily backup scheduled for 2:00 AM."
```

### 11.3 Pre-Import Backup

Before any large bulk import, take a manual backup:

```powershell
$date = Get-Date -Format "yyyy-MM-dd_HHmm"
Copy-Item "C:\inetpub\wwwroot\assetmanager\Data" `
          "D:\Backups\AssetManager\pre-import-$date" -Recurse
Write-Host "Pre-import backup complete."
```

### 11.4 Restore from Backup

```powershell
# Stop the app pool, restore, restart
Stop-WebAppPool -Name "AssetManagerPool"

$backup = "D:\Backups\AssetManager\2026-06-01_0200"   # adjust path
Copy-Item "$backup\*" "C:\inetpub\wwwroot\assetmanager\Data\" -Force

Start-WebAppPool -Name "AssetManagerPool"
Write-Host "Restore complete."
```

---

## Part 12 — Ongoing Operations

### 12.1 Updating the Application

When a new version is released:

```powershell
# 1. Backup first
$date = Get-Date -Format "yyyy-MM-dd_HHmm"
Copy-Item "C:\inetpub\wwwroot\assetmanager\Data" `
          "D:\Backups\AssetManager\pre-update-$date" -Recurse

# 2. Build new version on dev machine
# dotnet publish -c Release -o ./publish

# 3. Stop the pool
Stop-WebAppPool -Name "AssetManagerPool"

# 4. Copy new files (preserve Data\ folder)
robocopy .\publish C:\inetpub\wwwroot\assetmanager /E /IS /XD Data logs

# 5. Restart
Start-WebAppPool -Name "AssetManagerPool"
Write-Host "Update complete."
```

### 12.2 Monitoring

```powershell
# Check app pool status
Get-WebAppPoolState -Name "AssetManagerPool"

# Check site status
Get-Website -Name "AssetManager" | Select-Object Name, State, PhysicalPath

# Check recent errors in stdout log
Get-ChildItem "C:\inetpub\wwwroot\assetmanager\logs\stdout_*.log" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  Get-Content -Tail 100

# Check Windows Event Log for IIS errors
Get-EventLog -LogName Application -Source "IIS*","ASP.NET*" -Newest 20 |
  Format-Table TimeGenerated, Source, Message -Wrap
```

### 12.3 Rotating the Activation Key

Keys should be renewed before expiry to avoid downtime. You will see a warning
banner in the app when the key is about to expire.

1. Open `key-generator.html`
2. Generate a new key with a new start date
3. Settings → Activation → paste new key → Activate
4. The old key is replaced immediately

### 12.4 Adding New Offices

Settings → Offices → type office name → Add Office.
New offices are instantly available in all branch dropdowns.

### 12.5 Disabling a User Account

Access Control → find the user → click **Disable**.
The account is immediately locked — the user cannot log in until re-enabled.
Their data and records are not affected.

---

## Part 13 — Security Hardening Checklist

Work through this list before going live with 8,000 employees:

```
[ ] Change the default admin password (admin/admin123)
[ ] Enable HTTPS with a valid internal CA or public certificate
[ ] Restrict port 8081 to internal LAN only in Windows Firewall
[ ] Move key-generator.html to admin-only access or an offline tool
[ ] Schedule automated daily backups of the Data/ folder
[ ] Store backups on a different drive or server
[ ] Set up Windows Event Log monitoring or SIEM forwarding
[ ] Create named accounts for all IT staff (no shared admin login)
[ ] Assign minimum required roles (use Viewer for read-only staff)
[ ] Set a maximum activation key validity (365 days recommended)
[ ] Document the activation key and store it securely
[ ] Test restore procedure from backup before go-live
[ ] Test login from a non-admin account before go-live
```

---

## Part 14 — Quick Health-Check Commands

Run these any time to verify the system is healthy:

```powershell
# Is the app pool running?
(Get-WebAppPoolState -Name "AssetManagerPool").Value

# Is the website running?
(Get-Website -Name "AssetManager").State

# Is the API responding?
(Invoke-WebRequest http://localhost:8081/api/activation -UseBasicParsing).StatusCode
# Expected: 200

# How big is the data file?
(Get-Item "C:\inetpub\wwwroot\assetmanager\Data\appdata.json").Length / 1MB

# Last backup time
(Get-ChildItem "D:\Backups\AssetManager" -Directory |
  Sort-Object CreationTime -Descending |
  Select-Object -First 1).Name

# Any errors in last hour?
Get-EventLog -LogName Application -EntryType Error -After (Get-Date).AddHours(-1) |
  Where-Object { $_.Source -like "*IIS*" -or $_.Source -like "*ASP*" }
```

---

## Appendix A — Complete File Layout After Deployment

```
C:\inetpub\wwwroot\assetmanager\
├── AssetManager.dll                 Main application
├── AssetManager.exe                 Self-contained launcher
├── web.config                       IIS configuration
├── appsettings.json
├── appsettings.Production.json
├── Data\
│   ├── appdata.json                 ALL business data (back this up!)
│   ├── users.json                   User accounts
│   ├── activation.json              Activation state
│   └── logo.json                    Company logo
├── logs\
│   └── stdout_*.log                 Application logs
└── wwwroot\
    ├── index.html
    ├── app.js
    ├── auth.js
    ├── styles.css
    ├── key-generator.html
    └── key-generator.js
```

---

## Appendix B — Full PowerShell Setup Sequence (Copy-Paste Ready)

```powershell
# ============================================================
# Run on the IIS server as Administrator
# Replace values marked <<CHANGE>> with your own
# ============================================================

# 1. Static IP
New-NetIPAddress -InterfaceAlias "Ethernet" `
  -IPAddress "192.168.1.50" `       # <<CHANGE>>
  -PrefixLength 24 `
  -DefaultGateway "192.168.1.1"     # <<CHANGE>>

# 2. Hostname
Rename-Computer -NewName "ASSETMGR01" -Force   # <<CHANGE>>

# 3. IIS features
Install-WindowsFeature -Name Web-Server,Web-Mgmt-Tools -IncludeManagementTools

# 4. Run setup script (from project source folder)
Set-ExecutionPolicy Bypass -Scope Process -Force
.\INSTALL.ps1

# 5. Deploy published files
robocopy .\publish C:\inetpub\wwwroot\assetmanager /E /IS

# 6. Permissions
icacls "C:\inetpub\wwwroot\assetmanager\Data" /grant "IIS_IUSRS:(OI)(CI)M"
icacls "C:\inetpub\wwwroot\assetmanager\logs" /grant "IIS_IUSRS:(OI)(CI)M"

# 7. Firewall
New-NetFirewallRule -DisplayName "AssetManager 8081" `
  -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow

# 8. Tune app pool
Import-Module WebAdministration
Set-ItemProperty "IIS:\AppPools\AssetManagerPool" recycling.periodicRestart.memory 0
Set-ItemProperty "IIS:\AppPools\AssetManagerPool" recycling.periodicRestart.privateMemory 0
Set-ItemProperty "IIS:\AppPools\AssetManagerPool" processModel.idleTimeout "00:00:00"
Set-ItemProperty "IIS:\AppPools\AssetManagerPool" startMode "AlwaysRunning"

# 9. Restart IIS
iisreset /restart

# 10. Verify
Invoke-WebRequest http://localhost:8081/api/activation -UseBasicParsing
```

---

*ITProAcademy.co.in — Asset Manager v1.0 — Production Guide for 8,000+ Employees*
