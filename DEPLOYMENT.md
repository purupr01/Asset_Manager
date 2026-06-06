# ITProAcademy Asset Manager — Production Deployment Guide
## ASP.NET Core 8 · IIS · Windows Server · v1.0
### Scaled for 8,000+ Employees

---

## Quick Reference

| Item | Value |
|------|-------|
| Default port | 8081 |
| Default admin | admin / admin123 |
| Data folder | C:\inetpub\wwwroot\assetmanager\Data\ |
| App pool | AssetManagerPool (No Managed Code) |
| .NET requirement | .NET 8 Hosting Bundle on IIS server |
| Key generator | http://SERVER:8081/key-generator.html |

---

## Project Structure

```
AssetManager/
├── AssetManager.csproj
├── Program.cs                   All API routes (Minimal API)
├── web.config                   IIS / ANCM V2 config
├── appsettings.json
├── appsettings.Production.json
├── INSTALL.ps1                  One-time IIS server setup script
├── ActivationRecord.cs
├── ActivationService.cs
├── UserRecord.cs
├── UsersService.cs
├── AppDataService.cs
├── Data/
│   ├── appdata.json             Assets, employees, tickets, branches, activities
│   ├── users.json               User accounts (hashed passwords)
│   ├── activation.json          Activation state
│   └── logo.json                Company logo (base64)
└── wwwroot/
    ├── index.html
    ├── app.js
    ├── auth.js
    ├── styles.css
    ├── key-generator.html
    └── key-generator.js
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Windows Server | 2019 or 2022 (recommended for production) | 2016 minimum |
| IIS | 10+ | Enable Web-Server role |
| .NET 8 Hosting Bundle | 8.x | Includes ANCM V2 — on IIS server |
| .NET 8 SDK | 8.x | On dev/build machine only |
| RAM | 4 GB minimum (8 GB recommended) | For 8,000 employees + large JSON |
| Disk | 10 GB minimum | Data folder grows with assets & employees |

---

## Step 1 — Prepare the IIS Server

Open PowerShell as Administrator on the IIS server:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\INSTALL.ps1
```

What INSTALL.ps1 does:
1. Checks / installs IIS (Web-Server + Web-Mgmt-Tools)
2. Checks for .NET 8 Hosting Bundle — downloads and installs if missing
3. Runs `iisreset /restart` to register ANCM V2
4. Creates `C:\inetpub\wwwroot\assetmanager\`, `Data\`, `logs\`
5. Grants `IIS_IUSRS` Modify on `Data\` and `logs\`
6. Creates **AssetManagerPool** (No Managed Code, AlwaysRunning, no idle timeout)
7. Creates **AssetManager** website on port **8081**

---

## Step 2 — Build on Dev Machine

```powershell
cd AssetManager
dotnet publish -c Release -o ./publish
```

---

## Step 3 — Copy to IIS Server

```powershell
robocopy publish C:\inetpub\wwwroot\assetmanager /E /IS
```

---

## Step 4 — Verify

```
http://localhost:8081/
http://localhost:8081/api/activation   → {"activated":false,...}
http://localhost:8081/api/users        → [{"id":"USR0001","username":"admin",...}]
```

---

## Step 5 — Firewall

```powershell
New-NetFirewallRule -DisplayName "AssetManager 8081" `
  -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow
```

---

## Step 6 — First Login and Activation

1. Browse to `http://SERVER-IP:8081/`
2. Log in: `admin` / `admin123`
3. **Change the admin password immediately** — Access Control → Edit
4. Go to Settings → Activation
5. Open `key-generator.html`, generate a key (e.g., 365 days)
6. Paste and click Activate — all browsers unlocked

---

## Default Credentials

| Username | Password | Role |
|---|---|---|
| admin | admin123 | Admin (full access) |

**Change this immediately after first login.**

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/activation` | Get activation state |
| POST | `/api/activation` | Save activation |
| DELETE | `/api/activation` | Clear activation |
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user |
| PUT | `/api/users/{id}` | Update user |
| PATCH | `/api/users/{id}/toggle` | Toggle active state |
| GET | `/api/appdata` | Get all app data |
| POST | `/api/appdata` | Replace all app data |
| PUT | `/api/appdata/assets` | Update assets only |
| PUT | `/api/appdata/employees` | Update employees only |
| PUT | `/api/appdata/tickets` | Update tickets only |
| PUT | `/api/appdata/branches` | Update branches only |
| PUT | `/api/appdata/activities` | Update activities only |
| GET | `/api/logo` | Get logo |
| POST | `/api/logo` | Save logo |
| DELETE | `/api/logo` | Remove logo |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| HTTP 500.19 (0x8007000d) | Install .NET 8 Hosting Bundle → `iisreset /restart` |
| API returns 404 | Check app pool running; check stdout logs |
| Activation resets on restart | `icacls Data /grant "IIS_IUSRS:(OI)(CI)M"` |
| Users not visible on other machines | Same icacls fix |
| App pool stopped | `Start-WebAppPool -Name AssetManagerPool` |
| Port 8081 in use | `netstat -ano | findstr :8081` |
| Slow with 8000+ employees | See Production Tuning section below |

```powershell
# Check logs
Get-Content "C:\inetpub\wwwroot\assetmanager\logs\stdout_*.log" -Tail 50

# Check permissions
icacls "C:\inetpub\wwwroot\assetmanager\Data"

# Repair permissions
icacls "C:\inetpub\wwwroot\assetmanager\Data" /grant "IIS_IUSRS:(OI)(CI)M"
icacls "C:\inetpub\wwwroot\assetmanager\logs" /grant "IIS_IUSRS:(OI)(CI)M"
```

---

## Production Tuning for 8,000+ Employees

### Memory and App Pool
```powershell
# Increase .NET worker process memory limit (default is often 1 GB)
# Edit in IIS Manager → Application Pools → AssetManagerPool → Advanced Settings
# Or via PowerShell:
Set-ItemProperty "IIS:\AppPools\AssetManagerPool" recycling.periodicRestart.memory 0
Set-ItemProperty "IIS:\AppPools\AssetManagerPool" recycling.periodicRestart.privateMemory 0
```

### web.config — Increase Request Limits for Large CSV Imports
The default IIS request size limit is 30 MB. Large AD CSV exports (8,000 users) can exceed this.
Add inside `<system.webServer>` in web.config:

```xml
<security>
  <requestFiltering>
    <requestLimits maxAllowedContentLength="104857600" />
  </requestFiltering>
</security>
```

### Backup the Data folder
Schedule a daily backup of `C:\inetpub\wwwroot\assetmanager\Data\`:

```powershell
# Add to Windows Task Scheduler — run daily
$date = Get-Date -Format "yyyy-MM-dd"
$src  = "C:\inetpub\wwwroot\assetmanager\Data"
$dest = "D:\Backups\AssetManager\$date"
robocopy $src $dest /E /LOG:"D:\Backups\AssetManager\backup-$date.log"
```

### Enable HTTPS (Required for Production)
1. Add HTTPS binding in IIS Manager with your SSL certificate (port 443)
2. Add to Program.cs before `app.Run()`: `app.UseHttpsRedirection();`
3. Update web.config ASPNETCORE_URLS: `https://0.0.0.0:443;http://0.0.0.0:8081`
4. Rebuild and redeploy

---

*ITProAcademy.co.in — Asset Manager v1.0*
