const DEFAULT_TYPES = ["Laptop", "Desktop", "Server", "Firewall", "Switch", "Printer", "Mobile", "Software"];
const STATUS = ["Assigned", "Available", "In Repair", "Retired"];

// state is now server-backed; populated by fetchAppData() on boot
const state = { logo: "", activation: null, branches: [], assetTypes: [], employees: [], assets: [], tickets: [], activities: [] };

// Always read asset types from state (falls back to defaults if none saved yet)
function getAssetTypes() {
  return (state.assetTypes && state.assetTypes.length > 0) ? state.assetTypes : [...DEFAULT_TYPES];
}

const titles = {
  dashboard:   ["Dashboard",       "Enterprise overview of assets, assignments, warranty exposure, and office health."],
  assets:      ["Assets",          "Track hardware, software, custody, warranty, AMC, and lifecycle status."],
  employees:   ["Employees",       "Manage employee asset ownership for 10,000+ users across office locations."],
  maintenance: ["Maintenance",     "Monitor repair, replacement, audit, and service desk requests."],
  reports:     ["Reports",         "Generate management reports and export them as DOC, XLSX, or PDF."],
  users:       ["Access Control",  "Manage system users, roles, and access permissions."],
  settings:    ["Settings",        "Branding, activation, and application controls."]
};

let _appBooted = false;

document.addEventListener("DOMContentLoaded", () => {
  wireLoginScreen();
  wirePwToggle();
  if (currentUser()) {
    bootApp();
  } else {
    showLoginScreen();
  }
});

async function bootApp() {
  if (_appBooted) {
    hideLoginScreen();
    await fetchActivation(true);
    await fetchServerLogo();
    await fetchAppData();
    renderSessionBar();
    applyRbac();
    renderAll();
    return;
  }
  _appBooted = true;
  hideLoginScreen();

  await fetchActivation();
  await fetchServerLogo();
  await fetchAppData();

  if (_activation.activated) {
    state.activation = { key: _activation.key, expires: _activation.expires };
  }

  renderSessionBar();
  wireNavigation();
  wireActions();
  wireUserManagement();
  populateFilters();
  applyRbac();
  renderAll();

  const searchEl = document.getElementById("globalSearch");
  if (searchEl) searchEl.style.display = "none";
}

function wirePwToggle() {
  const btn = document.getElementById("pwToggle");
  const inp = document.getElementById("loginPassword");
  if (btn && inp) {
    btn.addEventListener("click", () => {
      inp.type = inp.type === "password" ? "text" : "password";
    });
  }
}

// ── Server App Data ────────────────────────────────────────────────────────────

const APPDATA_API = "/api/appdata";

async function fetchAppData() {
  try {
    const res  = await fetch(APPDATA_API + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    state.assets     = data.assets     || [];
    state.employees  = data.employees  || [];
    state.tickets    = (data.tickets   || []).map(t => ({
      description: "", category: "Hardware", requesterId: "", assetTag: "",
      impact: "Medium", dueDate: offsetDate(3), notes: [], ...t
    }));
    state.branches   = data.branches   || [];
    state.assetTypes = data.assetTypes || [];
    state.activities = data.activities || [];
  } catch (e) {
    console.warn("fetchAppData failed:", e.message);
  }
}

async function saveState() {
  try {
    await fetch(APPDATA_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assets:     state.assets,
        employees:  state.employees,
        tickets:    state.tickets,
        branches:   state.branches,
        assetTypes: state.assetTypes,
        activities: state.activities.slice(0, 200)
      })
    });
  } catch (e) {
    console.warn("saveState failed:", e.message);
  }
}

function getBranches() {
  if (!state.branches) state.branches = [];
  return state.branches;
}

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Server Logo ───────────────────────────────────────────────────────────────

let _serverLogo = "";

async function fetchServerLogo() {
  try {
    const res  = await fetch("/api/logo?t=" + Date.now(), { cache: "no-store" });
    const data = await res.json();
    _serverLogo = data.logo || "";
  } catch (e) {
    console.warn("Logo fetch failed:", e.message);
  }
}

async function pushServerLogo(dataUrl) {
  const res = await fetch("/api/logo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logo: dataUrl })
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  _serverLogo = dataUrl;
}

async function clearServerLogo() {
  await fetch("/api/logo", { method: "DELETE" });
  _serverLogo = "";
}

function getActiveLogo() {
  return _serverLogo || "";
}

// ── Activation ────────────────────────────────────────────────────────────────

const ACTIVATION_API = "/api/activation";
const ACT_CACHE_KEY  = "itpro_activation_cache_v1";
const ACT_CACHE_TTL  = 5 * 60 * 1000;

let _activation = { activated: false, key: null, expires: null, checkedAt: 0 };

async function fetchActivation(forceRefresh = false) {
  const now    = Date.now();
  const cached = (() => { try { return JSON.parse(localStorage.getItem(ACT_CACHE_KEY)); } catch (_) { return null; } })();
  if (!forceRefresh && cached && cached.checkedAt && (now - cached.checkedAt) < ACT_CACHE_TTL) {
    _activation = cached;
    return _activation;
  }
  try {
    const res  = await fetch(ACTIVATION_API + "?t=" + now, { cache: "no-store" });
    const data = await res.json();
    _activation = { ...data, checkedAt: now };
    localStorage.setItem(ACT_CACHE_KEY, JSON.stringify(_activation));
  } catch (err) {
    console.warn("Activation server unreachable:", err.message);
    if (cached) _activation = cached;
  }
  return _activation;
}

async function pushActivation(key, expires) {
  const user = currentUser();
  const res  = await fetch(ACTIVATION_API, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ key, expires, activatedBy: user?.fullName || "admin" })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }
  _activation = { activated: true, key, expires, checkedAt: Date.now() };
  localStorage.setItem(ACT_CACHE_KEY, JSON.stringify(_activation));
  return _activation;
}

function isActivated() {
  if (!_activation.activated) return false;
  return Math.ceil((new Date(_activation.expires) - new Date()) / 86400000) >= 0;
}

function getLicenseStatus() {
  if (!_activation.activated) return { active: false, message: "Not activated." };
  const days = Math.ceil((new Date(_activation.expires) - new Date()) / 86400000);
  if (days < 0) return { active: false, message: `Expired on ${_activation.expires}.` };
  return { active: true, message: `Activated for ${days} more day(s), until ${_activation.expires}.` };
}

function applyActivationGate(viewName) {
  const gate    = document.getElementById("activationGate");
  const blocked = !isActivated() && viewName !== "settings";
  gate.hidden   = !blocked;
}

// ── Navigation ─────────────────────────────────────────────────────────────────

function wireNavigation() {
  document.querySelectorAll(".nav-item").forEach(btn =>
    btn.addEventListener("click", () => showView(btn.dataset.view)));
}

const SEARCH_CONFIG = {
  assets:      { placeholder: "Search by asset tag, model, serial, employee...", show: true },
  employees:   { placeholder: "Search by name, email, department, ID...",        show: true },
  maintenance: { placeholder: "Search tickets by ID, title, owner...",           show: true },
  reports:     { placeholder: "Filter report preview...",                        show: true },
  users:       { placeholder: "Search users by name, username, role...",         show: true },
  dashboard:   { show: false },
  settings:    { show: false },
};

function showView(name) {
  document.querySelectorAll(".nav-item").forEach(item =>
    item.classList.toggle("active", item.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`${name}View`).classList.add("active");
  document.getElementById("screenTitle").textContent     = titles[name][0];
  document.getElementById("screenSubtitle").textContent  = titles[name][1];
  applyActivationGate(name);

  const cfg      = SEARCH_CONFIG[name] || { show: false };
  const searchEl = document.getElementById("globalSearch");
  if (searchEl) {
    searchEl.style.display = cfg.show ? "" : "none";
    if (cfg.show && cfg.placeholder) searchEl.placeholder = cfg.placeholder;
    if (cfg.show) searchEl.value = "";
  }

  applyRbac();
  if (name === "reports" && hasPerm("reports")) renderReportPreview();
  if (name === "users")       renderUsersView();
  if (name === "maintenance") renderTickets();
}

// ── Wire Actions ───────────────────────────────────────────────────────────────

function wireActions() {
  // Asset
  document.getElementById("openAssetForm").addEventListener("click", () => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    openEntityDialog("asset");
  });
  // Employee
  document.getElementById("openEmployeeForm").addEventListener("click", () => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    openEntityDialog("employee");
  });
  // Ticket
  document.getElementById("openTicketForm").addEventListener("click", () => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    openEntityDialog("ticket");
  });
  // Cancel dialog
  document.getElementById("cancelDialog").addEventListener("click", closeEntityDialog);
  // Save entity
  document.getElementById("saveEntity").addEventListener("click", () => {
    const type     = document.getElementById("entityDialog").dataset.type;
    const recordId = document.getElementById("entityDialog").dataset.recordId || "";
    try {
      saveEntity(type, recordId || null);
      closeEntityDialog();
    } catch (err) {
      console.error("saveEntity failed:", err);
      alert("Could not save record: " + err.message);
    }
  });

  // Filters
  document.getElementById("assetStatusFilter").addEventListener("change", renderAssets);
  document.getElementById("assetBranchFilter").addEventListener("change", renderAssets);
  document.getElementById("ticketStatusFilter").addEventListener("change", renderTickets);
  document.getElementById("ticketPriorityFilter").addEventListener("change", renderTickets);

  // Global search
  document.getElementById("globalSearch").addEventListener("input", () => {
    const active = document.querySelector(".nav-item.active")?.dataset.view;
    if (active === "assets")       renderAssets();
    else if (active === "employees")   renderEmployees();
    else if (active === "maintenance") renderTickets();
    else if (active === "reports")     renderReportPreview();
    else if (active === "users")       renderUsersView();
  });

  // Reports
  document.getElementById("reportType").addEventListener("change", () => {
    const type = document.getElementById("reportType").value;
    document.getElementById("customReportBuilder").style.display = type === "custom" ? "" : "none";
    renderReportPreview();
  });
  document.getElementById("reportBranch").addEventListener("change", renderReportPreview);

  // Custom report fields
  ["crAssets","crEmployees","crTickets","crAssetStatus","crAssetType","crTicketStatus","crTicketPriority"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", renderReportPreview);
  });

  // Exports
  document.getElementById("exportDoc").addEventListener("click", () => {
    if (!hasPerm("download")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    exportDoc(buildReport());
  });
  document.getElementById("exportXlsx").addEventListener("click", () => {
    if (!hasPerm("download")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    exportXlsx(buildReport());
  });
  document.getElementById("exportPdf").addEventListener("click", () => {
    if (!hasPerm("download")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    exportPdf(buildReport());
  });
  document.querySelector("[data-export='branch']").addEventListener("click", () => {
    if (!hasPerm("download")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    exportXlsx(buildReport("branch"));
  });

  // Tickets export
  document.getElementById("exportTicketsCsv").addEventListener("click", () => {
    if (!hasPerm("download")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    exportTicketsCsv();
  });

  // Logo
  document.getElementById("logoUpload").addEventListener("change", handleLogoUpload);
  document.getElementById("clearLogo").addEventListener("click", async () => {
    try {
      await clearServerLogo();
      renderLogo();
      document.getElementById("logoStatus").innerHTML = `<span style="color:var(--muted)">Logo removed.</span>`;
      document.getElementById("logoPreviewWrap").hidden = true;
    } catch (e) {
      document.getElementById("logoStatus").innerHTML = `<span style="color:var(--bad)">Error: ${e.message}</span>`;
    }
  });

  // Branches
  document.getElementById("addBranch").addEventListener("click", () => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    addBranch();
  });
  document.getElementById("newBranchName").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addBranch(); }
  });

  // Asset Types
  document.getElementById("addAssetType").addEventListener("click", () => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    addAssetType();
  });
  document.getElementById("newAssetTypeName").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addAssetType(); }
  });

  // Activation
  document.getElementById("activateTool").addEventListener("click", activateTool);

  // CSV imports
  document.getElementById("assetImportCsv").addEventListener("change", e => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    importComputerCsv(e);
  });
  document.getElementById("downloadComputerTemplate").addEventListener("click", downloadComputerTemplate);
  document.getElementById("employeeImportCsv").addEventListener("change", e => {
    if (!hasPerm("write")) return alertPerm();
    if (!isActivated()) return alertNotActivated();
    importUserCsv(e);
  });
  document.getElementById("downloadUserTemplate").addEventListener("click", downloadUserTemplate);

  // Ticket detail dialog close
  document.getElementById("closeTicketDetail").addEventListener("click", () => {
    document.getElementById("ticketDetailDialog").close();
  });
}

function alertNotActivated() {
  alert("Activation required. Please enter a valid key in Settings to use this feature.");
}

function alertPerm() {
  alert("Access denied. Your role does not have permission to perform this action.");
}

// ── Filters ────────────────────────────────────────────────────────────────────

function populateFilters() {
  ["assetBranchFilter", "reportBranch"].forEach(id => {
    const sel   = document.getElementById(id);
    const first = sel.options[0].outerHTML;
    sel.innerHTML = first + getBranches().map(b => `<option>${escapeHtml(b)}</option>`).join("");
  });
  // Populate custom report asset type filter
  const crAssetType = document.getElementById("crAssetType");
  if (crAssetType) {
    crAssetType.innerHTML = `<option value="">All types</option>` +
      getAssetTypes().map(t => `<option>${t}</option>`).join("");
  }
}

// ── Render All ─────────────────────────────────────────────────────────────────

function renderAll() {
  renderLogo();
  renderLicense();
  renderDashboard();
  renderAssets();
  renderEmployees();
  renderTickets();
  renderBranches();
  renderAssetTypes();
  if (hasPerm("reports")) renderReportPreview();
  applyRbac();
  const active = document.querySelector(".nav-item.active");
  if (active) applyActivationGate(active.dataset.view);
}

function renderLogo() {
  const logo    = getActiveLogo();
  const logoEl  = document.getElementById("companyLogo");
  logoEl.src    = logo || "";
  logoEl.style.display = logo ? "" : "none";

  // Update settings preview
  const wrap = document.getElementById("logoPreviewWrap");
  const prev = document.getElementById("logoPreview");
  if (wrap && prev) {
    if (logo) { prev.src = logo; wrap.hidden = false; }
    else       { wrap.hidden = true; }
  }
}

function renderLicense() {
  const status = getLicenseStatus();
  document.getElementById("licenseBanner").hidden = status.active;
  const statusEl = document.getElementById("licenseStatus");
  if (status.active) {
    statusEl.innerHTML = `<span style="color:var(--ok)">&#10003; ${status.message}</span>
      <span style="color:var(--muted);font-size:12px;display:block;margin-top:4px">
        Activation stored centrally — valid for all browsers and devices.
      </span>`;
  } else {
    statusEl.textContent = status.message;
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

function renderDashboard() {
  const assigned     = state.assets.filter(a => a.status === "Assigned").length;
  const available    = state.assets.filter(a => a.status === "Available").length;
  const warrantyRisk = getWarrantyRiskAssets().length;
  const value        = state.assets.reduce((s, a) => s + Number(a.value || 0), 0);
  const metrics = [
    ["Total Assets",  state.assets.length,                                       "Tracked inventory records"],
    ["Assigned",      assigned, `${state.assets.length ? Math.round((assigned / state.assets.length) * 100) : 0}% utilization`],
    ["Available",     available, "Ready for allocation"],
    ["Warranty Risk", warrantyRisk, "Expired or expiring in 30 days"],
    ["Employees",     state.employees.length.toLocaleString("en-IN"),            "Directory users"],
    ["Offices",       getBranches().length, "Defined office locations"],
    ["Open Tickets",  state.tickets.filter(t => t.status !== "Closed").length,   "Maintenance workload"],
    ["Asset Value",   formatMoney(value), "Book value estimate"]
  ];
  document.getElementById("metricsGrid").innerHTML = metrics
    .map(([label, number, hint]) =>
      `<article class="metric"><span>${label}</span><strong>${number}</strong><small>${hint}</small></article>`)
    .join("");

  const branchCounts = countBy(state.assets, "branch");
  const max = Math.max(0, ...Object.values(branchCounts));
  document.getElementById("branchChart").innerHTML = getBranches().length
    ? getBranches().map(b => {
        const count = branchCounts[b] || 0;
        const width = max ? Math.max(8, Math.round((count / max) * 100)) : 0;
        return `<div class="bar-row"><strong>${b}</strong><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><span>${count}</span></div>`;
      }).join("")
    : `<div class="alert"><strong>No offices defined</strong><span>Add offices in Settings.</span></div>`;

  document.getElementById("alertList").innerHTML = getWarrantyRiskAssets().slice(0, 6)
    .map(a => `<div class="alert"><strong>${a.tag} ${a.model}</strong><span>Warranty ends ${a.warrantyEnd} at ${a.branch}</span></div>`)
    .join("") || `<div class="alert"><strong>No critical alerts</strong><span>Warranty and AMC exposure is clear.</span></div>`;

  document.getElementById("activityList").innerHTML = state.activities.slice(0, 50)
    .map(a => `<div class="activity"><strong>${escapeHtml(a)}</strong><span>${new Date().toLocaleDateString()}</span></div>`)
    .join("") || `<div class="activity"><strong>No activity yet</strong><span>New records and imports will appear here.</span></div>`;
}

// ── Assets ─────────────────────────────────────────────────────────────────────

function renderAssets() {
  const status   = document.getElementById("assetStatusFilter").value;
  const branch   = document.getElementById("assetBranchFilter").value;
  const query    = document.getElementById("globalSearch").value.toLowerCase();
  const canEdit  = hasPerm("write");
  const empById  = Object.fromEntries(state.employees.map(e => [e.id, e]));

  const rows = state.assets
    .filter(a => !status || a.status === status)
    .filter(a => !branch || a.branch === branch)
    .filter(a => {
      if (!query) return true;
      const emp = empById[a.assignedTo];
      return [a.tag, a.type, a.name || "", a.model, a.serial, a.branch, emp?.name || ""].join(" ").toLowerCase().includes(query);
    })
    .slice(0, 250)
    .map(a => {
      const emp = empById[a.assignedTo];
      const sc  = a.status.replace(/\s/g, "");
      return `<tr>
        <td><strong>${a.tag}</strong><br><small>${a.serial}</small></td>
        <td>${escapeHtml(a.name || "—")}</td>
        <td>${a.type}</td>
        <td>${a.model}</td>
        <td>${emp ? emp.name : "Unassigned"}</td>
        <td>${a.branch}</td>
        <td><span class="pill ${sc}">${a.status}</span></td>
        <td>${a.warrantyEnd}</td>
        <td>${formatMoney(a.value)}</td>
        <td>${canEdit ? `
          <button class="ghost row-action" data-edit-asset="${a.id}">Edit</button>
          <button class="ghost row-action" style="color:var(--bad)" data-delete-asset="${a.id}">Delete</button>
        ` : ""}</td>
      </tr>`;
    }).join("");

  document.getElementById("assetRows").innerHTML = rows ||
    `<tr><td colspan="9">No assets found. Use New Asset or Computer Object Import to add assets.</td></tr>`;

  document.querySelectorAll("[data-edit-asset]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!hasPerm("write")) return alertPerm();
      if (!isActivated()) return alertNotActivated();
      openEntityDialog("asset", btn.dataset.editAsset);
    }));

  document.querySelectorAll("[data-delete-asset]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!hasPerm("write")) return alertPerm();
      if (!isActivated()) return alertNotActivated();
      deleteAsset(btn.dataset.deleteAsset);
    }));
}

function deleteAsset(id) {
  const asset = state.assets.find(a => a.id === id);
  if (!asset) return;
  if (!confirm(`Delete asset ${asset.tag} (${asset.model})? This cannot be undone.`)) return;
  state.assets = state.assets.filter(a => a.id !== id);
  state.activities.unshift(`Deleted asset ${asset.tag}`);
  saveState();
  renderAll();
}

// ── Employees ──────────────────────────────────────────────────────────────────

function renderEmployees() {
  const canEdit   = hasPerm("write");
  const query     = (document.getElementById("globalSearch")?.value || "").toLowerCase();
  const assetCounts = countBy(state.assets.filter(a => a.assignedTo), "assignedTo");

  const filtered = state.employees.filter(e => {
    if (!query) return true;
    return [e.id, e.name, e.email, e.department, e.manager, e.branch].join(" ").toLowerCase().includes(query);
  });

  document.getElementById("employeeRows").innerHTML = filtered.slice(0, 250)
    .map(e => `<tr>
      <td><strong>${e.id}</strong></td>
      <td>${e.name}</td>
      <td>${e.email}</td>
      <td>${e.department}</td>
      <td>${e.manager}</td>
      <td>${e.mobile}</td>
      <td>${e.branch}</td>
      <td>${assetCounts[e.id] || 0}</td>
      <td>${canEdit ? `
        <button class="ghost row-action" data-edit-employee="${e.id}">Edit</button>
        <button class="ghost row-action" style="color:var(--bad)" data-delete-employee="${e.id}">Delete</button>
      ` : ""}</td>
    </tr>`).join("")
    || `<tr><td colspan="9">${query ? "No employees match your search." : "No employees found."}</td></tr>`;

  document.querySelectorAll("[data-edit-employee]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!hasPerm("write")) return alertPerm();
      if (!isActivated()) return alertNotActivated();
      openEntityDialog("employee", btn.dataset.editEmployee);
    }));

  document.querySelectorAll("[data-delete-employee]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!hasPerm("write")) return alertPerm();
      if (!isActivated()) return alertNotActivated();
      deleteEmployee(btn.dataset.deleteEmployee);
    }));
}

function deleteEmployee(id) {
  const emp = state.employees.find(e => e.id === id);
  if (!emp) return;
  if (!confirm(`Delete employee ${emp.name} (${emp.id})? This cannot be undone.`)) return;
  state.employees = state.employees.filter(e => e.id !== id);
  // Unassign their assets
  state.assets.forEach(a => { if (a.assignedTo === id) a.assignedTo = ""; });
  state.activities.unshift(`Deleted employee ${emp.name}`);
  saveState();
  renderAll();
}

// ── Tickets (Table View) ───────────────────────────────────────────────────────

function renderTickets() {
  const statusFilter   = document.getElementById("ticketStatusFilter").value;
  const priorityFilter = document.getElementById("ticketPriorityFilter").value;
  const query          = (document.getElementById("globalSearch")?.value || "").toLowerCase();
  const canEdit        = hasPerm("write");
  const empById        = Object.fromEntries(state.employees.map(e => [e.id, e]));

  const filtered = state.tickets
    .filter(t => !statusFilter   || t.status === statusFilter)
    .filter(t => !priorityFilter || t.priority === priorityFilter)
    .filter(t => {
      if (!query) return true;
      const req = empById[t.requesterId];
      return [t.id, t.title, t.owner, t.assetTag, t.status, t.priority, req?.name || ""].join(" ").toLowerCase().includes(query);
    });

  const priorityColor = { Low: "var(--ok)", Medium: "var(--warn)", High: "var(--bad)", Critical: "#7b1fa2" };

  document.getElementById("ticketRows").innerHTML = filtered.map(t => {
    const req = empById[t.requesterId];
    const pc  = priorityColor[t.priority] || "var(--muted)";
    return `<tr>
      <td><strong>${t.id}</strong></td>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.category || "General")}</td>
      <td><span style="color:${pc};font-weight:700">${escapeHtml(t.priority || "")}</span></td>
      <td><span class="pill ${(t.status || "").replace(/\s/g, "")}">${escapeHtml(t.status || "")}</span></td>
      <td>${escapeHtml(t.owner || "")}</td>
      <td>${req ? escapeHtml(req.name) : (t.requesterId ? escapeHtml(t.requesterId) : "—")}</td>
      <td>${escapeHtml(t.assetTag || "—")}</td>
      <td>${escapeHtml(t.dueDate || "")}</td>
      <td>
        <button class="ghost row-action" data-view-ticket="${t.id}">View</button>
        ${canEdit ? `<button class="ghost row-action" data-edit-ticket="${t.id}">Edit</button>
        <button class="ghost row-action" style="color:var(--bad)" data-delete-ticket="${t.id}">Delete</button>` : ""}
      </td>
    </tr>`;
  }).join("")
  || `<tr><td colspan="10">${query ? "No tickets match your search." : "No tickets found. Click New Ticket to create one."}</td></tr>`;

  document.querySelectorAll("[data-view-ticket]").forEach(btn =>
    btn.addEventListener("click", () => openTicketDetail(btn.dataset.viewTicket)));
  document.querySelectorAll("[data-edit-ticket]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!hasPerm("write")) return alertPerm();
      openEntityDialog("ticket", btn.dataset.editTicket);
    }));
  document.querySelectorAll("[data-delete-ticket]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!hasPerm("write")) return alertPerm();
      deleteTicket(btn.dataset.deleteTicket);
    }));
}

function openTicketDetail(ticketId) {
  const ticket = state.tickets.find(t => t.id === ticketId);
  if (!ticket) return;
  const emp    = state.employees.find(e => e.id === ticket.requesterId);
  const asset  = state.assets.find(a => a.tag === ticket.assetTag);
  const canEdit = hasPerm("write");

  document.getElementById("ticketDetailTitle").textContent = ticket.id;
  document.getElementById("ticketDetailBody").innerHTML = `
    <dl class="detail-list">
      <dt>Title</dt><dd>${escapeHtml(ticket.title)}</dd>
      <dt>Status</dt><dd>${escapeHtml(ticket.status)}</dd>
      <dt>Priority</dt><dd>${escapeHtml(ticket.priority)}</dd>
      <dt>Category</dt><dd>${escapeHtml(ticket.category || "General")}</dd>
      <dt>Requester</dt><dd>${emp ? `${emp.name} (${emp.id})` : "Not tagged"}</dd>
      <dt>Asset</dt><dd>${asset ? `${asset.tag} - ${asset.model}` : ticket.assetTag || "Not tagged"}</dd>
      <dt>Owner</dt><dd>${escapeHtml(ticket.owner || "")}</dd>
      <dt>Due Date</dt><dd>${escapeHtml(ticket.dueDate || "")}</dd>
      <dt>Impact</dt><dd>${escapeHtml(ticket.impact || "")}</dd>
      <dt>Description</dt><dd>${escapeHtml(ticket.description || "")}</dd>
    </dl>
    <div class="note-list">
      <h3>Notes</h3>
      ${(ticket.notes || []).map(n =>
        `<div class="note"><strong>${escapeHtml(n.author || "IT")}</strong><span>${escapeHtml(n.at || "")}</span><p>${escapeHtml(n.text || "")}</p></div>`
      ).join("") || `<p class="muted">No notes yet.</p>`}
    </div>
    ${canEdit ? `<label>Add Note
      <textarea id="ticketNoteText" rows="3" placeholder="Add troubleshooting steps, resolution notes, or follow-up details"></textarea>
    </label>
    <button class="primary" style="margin-top:10px" data-add-note="${ticket.id}">Add Note</button>` : ""}`;

  document.querySelector("[data-add-note]")?.addEventListener("click", () => {
    addTicketNote(ticket.id);
    openTicketDetail(ticket.id); // refresh detail
  });

  document.getElementById("ticketDetailDialog").showModal();
}

function addTicketNote(ticketId) {
  const text   = document.getElementById("ticketNoteText")?.value?.trim();
  if (!text) return;
  const ticket = state.tickets.find(t => t.id === ticketId);
  const user   = currentUser();
  ticket.notes = ticket.notes || [];
  ticket.notes.unshift({ author: user ? user.fullName : "IT Support", text, at: new Date().toLocaleString() });
  state.activities.unshift(`Updated ticket ${ticket.id}`);
  saveState();
  renderTickets();
}

function deleteTicket(id) {
  const ticket = state.tickets.find(t => t.id === id);
  if (!ticket) return;
  if (!confirm(`Delete ticket ${ticket.id} "${ticket.title}"? This cannot be undone.`)) return;
  state.tickets = state.tickets.filter(t => t.id !== id);
  state.activities.unshift(`Deleted ticket ${ticket.id}`);
  saveState();
  renderTickets();
}

function exportTicketsCsv() {
  const headers = ["Ticket ID","Title","Category","Priority","Status","Owner","Requester","Asset","Due Date","Description"];
  const empById = Object.fromEntries(state.employees.map(e => [e.id, e]));
  const rows    = state.tickets.map(t => {
    const req = empById[t.requesterId];
    return [t.id, t.title, t.category, t.priority, t.status, t.owner, req?.name || t.requesterId || "", t.assetTag, t.dueDate, t.description].map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  downloadBlob("tickets-export.csv", new Blob([csv], { type: "text/csv" }));
}

// ── Branches ───────────────────────────────────────────────────────────────────

function renderBranches() {
  const counts = countBy(state.employees, "branch");
  document.getElementById("branchList").innerHTML = getBranches()
    .map((b, i) => `
      <div class="branch-item" data-idx="${i}">
        <div class="branch-item-info">
          <strong>${escapeHtml(b)}</strong>
          <span>${counts[b] || 0} employees</span>
        </div>
        <div class="branch-item-actions">
          <button class="ghost row-action" data-edit-branch="${i}" title="Rename">Edit</button>
          <button class="ghost row-action" style="color:var(--bad)" data-delete-branch="${i}" title="Delete">Delete</button>
        </div>
      </div>`)
    .join("");

  document.querySelectorAll("[data-edit-branch]").forEach(btn =>
    btn.addEventListener("click", () => editBranch(Number(btn.dataset.editBranch))));
  document.querySelectorAll("[data-delete-branch]").forEach(btn =>
    btn.addEventListener("click", () => deleteBranch(Number(btn.dataset.deleteBranch))));
}

function editBranch(idx) {
  if (!hasPerm("write")) return alertPerm();
  if (!isActivated()) return alertNotActivated();
  const current = state.branches[idx];
  const newName = prompt(`Rename office:`, current);
  if (!newName || !newName.trim() || newName.trim() === current) return;
  const trimmed = newName.trim();
  if (state.branches.some((b, i) => i !== idx && b.toLowerCase() === trimmed.toLowerCase()))
    return alert("An office with that name already exists.");
  // Update all assets and employees referencing the old name
  state.assets.forEach(a   => { if (a.branch === current)   a.branch = trimmed; });
  state.employees.forEach(e => { if (e.branch === current)  e.branch = trimmed; });
  state.branches[idx] = trimmed;
  state.activities.unshift(`Renamed office "${current}" to "${trimmed}"`);
  saveState(); populateFilters(); renderAll();
}

function deleteBranch(idx) {
  if (!hasPerm("write")) return alertPerm();
  if (!isActivated()) return alertNotActivated();
  const name = state.branches[idx];
  const assetCount    = state.assets.filter(a => a.branch === name).length;
  const employeeCount = state.employees.filter(e => e.branch === name).length;
  const warn = (assetCount || employeeCount)
    ? `\n\nWarning: ${assetCount} asset(s) and ${employeeCount} employee(s) reference this office. Their branch field will be cleared.`
    : "";
  if (!confirm(`Delete office "${name}"?${warn}`)) return;
  state.assets.forEach(a   => { if (a.branch === name)   a.branch = ""; });
  state.employees.forEach(e => { if (e.branch === name)  e.branch = ""; });
  state.branches.splice(idx, 1);
  state.activities.unshift(`Deleted office "${name}"`);
  saveState(); populateFilters(); renderAll();
}

function addBranch() {
  const input  = document.getElementById("newBranchName");
  const branch = input.value.trim();
  if (!branch) return;
  if (!getBranches().some(b => b.toLowerCase() === branch.toLowerCase())) {
    state.branches.push(branch);
    state.activities.unshift(`Added office ${branch}`);
    saveState(); populateFilters(); renderAll();
  }
  input.value = "";
}

// ── Asset Types ────────────────────────────────────────────────────────────────

function renderAssetTypes() {
  const el = document.getElementById("assetTypeList");
  if (!el) return;
  const types = getAssetTypes();
  el.innerHTML = types.map((t, i) => `
    <div class="branch-item" data-idx="${i}">
      <div class="branch-item-info"><strong>${escapeHtml(t)}</strong></div>
      <div class="branch-item-actions">
        <button class="ghost row-action" data-edit-type="${i}">Edit</button>
        <button class="ghost row-action" style="color:var(--bad)" data-delete-type="${i}">Delete</button>
      </div>
    </div>`).join("");

  document.querySelectorAll("[data-edit-type]").forEach(btn =>
    btn.addEventListener("click", () => editAssetType(Number(btn.dataset.editType))));
  document.querySelectorAll("[data-delete-type]").forEach(btn =>
    btn.addEventListener("click", () => deleteAssetType(Number(btn.dataset.deleteType))));
}

function addAssetType() {
  if (!hasPerm("write")) return alertPerm();
  if (!isActivated()) return alertNotActivated();
  const input = document.getElementById("newAssetTypeName");
  const name  = input.value.trim();
  if (!name) return;
  const types = getAssetTypes();
  if (types.some(t => t.toLowerCase() === name.toLowerCase()))
    return alert("That asset type already exists.");
  state.assetTypes = [...types, name];
  state.activities.unshift(`Added asset type "${name}"`);
  input.value = "";
  saveState(); populateFilters(); renderAll();
}

function editAssetType(idx) {
  if (!hasPerm("write")) return alertPerm();
  if (!isActivated()) return alertNotActivated();
  const types   = getAssetTypes();
  const current = types[idx];
  const newName = prompt(`Rename asset type:`, current);
  if (!newName || !newName.trim() || newName.trim() === current) return;
  const trimmed = newName.trim();
  if (types.some((t, i) => i !== idx && t.toLowerCase() === trimmed.toLowerCase()))
    return alert("That asset type already exists.");
  // Update all assets using the old type
  state.assets.forEach(a => { if (a.type === current) a.type = trimmed; });
  const updated = [...types];
  updated[idx]  = trimmed;
  state.assetTypes = updated;
  state.activities.unshift(`Renamed asset type "${current}" to "${trimmed}"`);
  saveState(); populateFilters(); renderAll();
}

function deleteAssetType(idx) {
  if (!hasPerm("write")) return alertPerm();
  if (!isActivated()) return alertNotActivated();
  const types = getAssetTypes();
  const name  = types[idx];
  const count = state.assets.filter(a => a.type === name).length;
  const warn  = count ? `\n\nWarning: ${count} asset(s) use this type. Their type field will be cleared.` : "";
  if (!confirm(`Delete asset type "${name}"?${warn}`)) return;
  state.assets.forEach(a => { if (a.type === name) a.type = ""; });
  const updated = types.filter((_, i) => i !== idx);
  state.assetTypes = updated;
  state.activities.unshift(`Deleted asset type "${name}"`);
  saveState(); populateFilters(); renderAll();
}

function openEntityDialog(type, recordId) {
  const dialog = document.getElementById("entityDialog");
  dialog.dataset.type     = type;
  dialog.dataset.recordId = recordId || "";
  document.getElementById("dialogTitle").textContent   = getDialogTitle(type, Boolean(recordId));
  document.getElementById("dialogFields").innerHTML    = getEntityFields(type, recordId);
  dialog.showModal();
}

function getDialogTitle(type, isEdit) {
  if (type === "asset")    return isEdit ? "Edit Asset"    : "New Asset";
  if (type === "employee") return isEdit ? "Edit Employee" : "New Employee";
  return isEdit ? "Edit Ticket" : "Create Ticket";
}

function closeEntityDialog() {
  document.getElementById("dialogFields").innerHTML = "";
  document.getElementById("entityDialog").close();
}

function getEntityFields(type, recordId) {
  if (type === "employee") {
    const e = state.employees.find(i => i.id === recordId) || {};
    return `
      <label>Employee ID<input name="id" value="${escapeAttr(e.id || `EMP${String(state.employees.length + 1).padStart(4, "0")}`)}" required></label>
      <label>Full Name<input name="name" value="${escapeAttr(e.name || "")}" required></label>
      <label>Email<input name="email" type="email" value="${escapeAttr(e.email || "")}" required></label>
      <label>Department<input name="department" value="${escapeAttr(e.department || "")}" required></label>
      <label>Manager<input name="manager" value="${escapeAttr(e.manager || "")}" required></label>
      <label>Mobile Number<input name="mobile" value="${escapeAttr(e.mobile || "")}" required></label>
      ${branchField(e.branch || "")}`;
  }
  if (type === "ticket") {
    const t = state.tickets.find(i => i.id === recordId) || {};
    return `
      <label>Title<input name="title" value="${escapeAttr(t.title || "")}" required></label>
      <label>Description<textarea name="description" rows="4" required>${escapeHtml(t.description || "")}</textarea></label>
      <label>Status<select name="status">${["Open","In Progress","On Hold","Closed"].map(v => `<option ${t.status===v?"selected":""}>${v}</option>`).join("")}</select></label>
      <label>Priority<select name="priority">${["Low","Medium","High","Critical"].map(v => `<option ${t.priority===v?"selected":""}>${v}</option>`).join("")}</select></label>
      <label>Impact<select name="impact">${["Low","Medium","High","Business Critical"].map(v => `<option ${t.impact===v?"selected":""}>${v}</option>`).join("")}</select></label>
      <label>Category<select name="category">${["Hardware","Software","Network","Access","Audit","Other"].map(v => `<option ${t.category===v?"selected":""}>${v}</option>`).join("")}</select></label>
      <label>Owner<input name="owner" value="${escapeAttr(t.owner || "IT Support")}"></label>
      <label>Due Date<input name="dueDate" type="date" value="${escapeAttr(t.dueDate || offsetDate(3))}"></label>
      <label>Tagged Employee ID<input name="requesterId" list="employeePicker" value="${escapeAttr(t.requesterId || "")}" placeholder="EMP0001"></label>
      <datalist id="employeePicker">${state.employees.slice(0,800).map(e => `<option value="${e.id}">${escapeHtml(e.name)} - ${escapeHtml(e.email)}</option>`).join("")}</datalist>
      <label>Tagged Asset Tag<input name="assetTag" list="assetPicker" value="${escapeAttr(t.assetTag || "")}" placeholder="ITP-00001"></label>
      <datalist id="assetPicker">${state.assets.slice(0,800).map(a => `<option value="${a.tag}">${escapeHtml(a.model)} - ${escapeHtml(a.branch)}</option>`).join("")}</datalist>`;
  }
  // Asset
  const a = state.assets.find(i => i.id === recordId) || {};
  return `
    <label>Asset Tag<input name="tag" value="${escapeAttr(a.tag || `ITP-${String(state.assets.length + 1).padStart(5, "0")}`)}" required></label>
    <label>Asset Name<input name="name" value="${escapeAttr(a.name || "")}" placeholder="e.g. John's Laptop, Reception Printer" required></label>
    <label>Type<select name="type">${getAssetTypes().map(t => `<option ${a.type===t?"selected":""}>${t}</option>`).join("")}</select></label>
    <label>Model<input name="model" value="${escapeAttr(a.model || "")}" required></label>
    <label>Serial<input name="serial" value="${escapeAttr(a.serial || "")}" required></label>
    <label>Status<select name="status">${STATUS.map(s => `<option ${a.status===s?"selected":""}>${s}</option>`).join("")}</select></label>
    ${branchField(a.branch || "")}
    <label>Assigned Employee ID<input name="assignedTo" list="employeePicker2" value="${escapeAttr(a.assignedTo || "")}" placeholder="EMP0001"></label>
    <datalist id="employeePicker2">${state.employees.slice(0,500).map(e => `<option value="${e.id}">${e.name}</option>`).join("")}</datalist>
    <label>Warranty End<input name="warrantyEnd" type="date" value="${escapeAttr(a.warrantyEnd || offsetDate(365))}"></label>
    <label>AMC End<input name="amcEnd" type="date" value="${escapeAttr(a.amcEnd || offsetDate(365))}"></label>
    <label>Value<input name="value" type="number" value="${escapeAttr(a.value || 45000)}"></label>
    <label>Location<input name="location" value="${escapeAttr(a.location || "")}"></label>
    <label>Notes<textarea name="notes" rows="3">${escapeHtml(a.notes || "")}</textarea></label>`;
}

function branchField(value) {
  return `<label>Branch<input name="branch" list="branchPicker" value="${escapeAttr(value)}" placeholder="Type or select office" required></label>
    <datalist id="branchPicker">${getBranches().map(b => `<option value="${escapeAttr(b)}"></option>`).join("")}</datalist>`;
}

function saveEntity(type, recordId) {
  // Collect form data from named inputs/selects/textareas inside dialogFields
  const fields  = document.getElementById("dialogFields");
  const inputs  = fields.querySelectorAll("input[name], select[name], textarea[name]");
  const data    = {};
  inputs.forEach(el => { data[el.name] = el.value; });

  const user = currentUser();
  ensureBranch(data.branch);

  if (type === "employee") {
    const existing = state.employees.find(e => e.id === recordId);
    if (existing) {
      const oldId = existing.id;
      Object.assign(existing, data);
      if (oldId !== data.id) {
        state.assets.forEach(a  => { if (a.assignedTo === oldId)   a.assignedTo  = data.id; });
        state.tickets.forEach(t => { if (t.requesterId === oldId)  t.requesterId = data.id; });
      }
      state.activities.unshift(`${user?.fullName || "System"} edited employee ${data.name}`);
    } else {
      state.employees.unshift(data);
      state.activities.unshift(`${user?.fullName || "System"} created employee ${data.name}`);
    }
  } else if (type === "ticket") {
    if (recordId) {
      const ticket = state.tickets.find(t => t.id === recordId);
      Object.assign(ticket, data);
      ticket.notes = ticket.notes || [];
      state.activities.unshift(`${user?.fullName || "System"} edited ticket ${ticket.id}`);
    } else {
      const ticket = { id: `TCK-${1000 + state.tickets.length + 1}`, notes: [], ...data };
      ticket.notes.unshift({ author: user?.fullName || data.owner || "IT Support", text: "Ticket created.", at: new Date().toLocaleString() });
      state.tickets.unshift(ticket);
      state.activities.unshift(`${user?.fullName || "System"} created ticket ${data.title}`);
    }
  } else {
    // Asset
    const existing = state.assets.find(a => a.id === recordId);
    const payload  = {
      purchaseDate: existing?.purchaseDate || new Date().toISOString().slice(0, 10),
      amcEnd:    data.amcEnd || offsetDate(365),
      location:  data.location || data.branch,
      notes:     data.notes || "",
      ...data,
      value: Number(data.value || 0)
    };
    if (existing) {
      const oldTag = existing.tag;
      Object.assign(existing, payload);
      if (oldTag !== data.tag) {
        state.tickets.forEach(t => { if (t.assetTag === oldTag) t.assetTag = data.tag; });
      }
      state.activities.unshift(`${user?.fullName || "System"} edited asset ${data.tag}`);
    } else {
      state.assets.unshift({ id: crypto.randomUUID(), ...payload });
      state.activities.unshift(`${user?.fullName || "System"} created asset ${data.tag}`);
    }
  }

  saveState();
  renderAll();
}

function ensureBranch(branch) {
  if (!branch) return;
  if (!getBranches().some(b => b.toLowerCase() === branch.toLowerCase())) state.branches.push(branch);
}

// ── Activation ─────────────────────────────────────────────────────────────────

async function activateTool() {
  const key      = document.getElementById("activationKey").value.trim();
  const parsed   = parseActivationKey(key);
  const statusEl = document.getElementById("licenseStatus");
  if (!parsed.valid) { statusEl.textContent = parsed.message; return; }

  statusEl.textContent = "Saving activation to server…";
  try {
    await pushActivation(key, parsed.expires);
    state.activation = { key, expires: parsed.expires };
    statusEl.textContent = "";
    renderLicense();
    renderAll();
  } catch (err) {
    statusEl.textContent = "⚠ Could not save to server: " + err.message;
  }
}

function parseActivationKey(key) {
  // New format (v2): ITPRO-YYYYMMDD-DAYS-SALT-CHECKSUM  (5 segments, unique per generation)
  const v2 = key.match(/^ITPRO-(\d{8})-(\d{1,4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (v2) {
    const base = `ITPRO-${v2[1]}-${v2[2]}-${v2[3]}`;        // date + days + salt
    if (checksum(base) !== v2[4]) return { valid: false, message: "Invalid key — checksum mismatch." };
    const start = new Date(`${v2[1].slice(0,4)}-${v2[1].slice(4,6)}-${v2[1].slice(6,8)}T00:00:00`);
    start.setDate(start.getDate() + Number(v2[2]));
    return { valid: true, expires: start.toISOString().slice(0, 10) };
  }

  // Legacy format (v1): ITPRO-YYYYMMDD-DAYS-CHECKSUM  (4 segments, kept for existing keys)
  const v1 = key.match(/^ITPRO-(\d{8})-(\d{1,4})-([A-Z0-9]{4})$/);
  if (v1) {
    const base = `ITPRO-${v1[1]}-${v1[2]}`;
    if (checksum(base) !== v1[3]) return { valid: false, message: "Invalid key — checksum mismatch." };
    const start = new Date(`${v1[1].slice(0,4)}-${v1[1].slice(4,6)}-${v1[1].slice(6,8)}T00:00:00`);
    start.setDate(start.getDate() + Number(v1[2]));
    return { valid: true, expires: start.toISOString().slice(0, 10) };
  }

  return { valid: false, message: "Invalid key format. Expected ITPRO-YYYYMMDD-DAYS-SALT-CHECKSUM." };
}

function checksum(text) {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) % 1679616;
  return value.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

// ── Logo Upload ─────────────────────────────────────────────────────────────────

async function handleLogoUpload(event) {
  const file     = event.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("logoStatus");
  statusEl.textContent = "Uploading logo to server…";
  const reader   = new FileReader();
  reader.onload  = async () => {
    try {
      await pushServerLogo(reader.result);
      renderLogo();
      statusEl.innerHTML = `<span style="color:var(--ok)">&#10003; Logo uploaded — visible to all users.</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span style="color:var(--bad)">⚠ Upload failed: ${e.message}</span>`;
    }
  };
  reader.readAsDataURL(file);
}

// ── Computer Object Import ─────────────────────────────────────────────────────

function importComputerCsv(event) {
  const file     = event.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("assetImportStatus");
  statusEl.textContent = "Reading file…";
  const reader   = new FileReader();
  reader.onload  = () => {
    const rows = reader.result.split(/\r?\n/).filter(Boolean).slice(1);
    let imported = 0, skipped = 0;
    rows.forEach(line => {
      const [name, os, branch, serialNumber, model, assignedUser] = line.split(",").map(v => v.trim());
      if (!name) return;
      const tag             = `IMP-${name.toUpperCase().replace(/\s/g, "-").slice(0, 12)}`;
      const resolvedBranch  = branch || getBranches()[0] || "HQ";
      ensureBranch(resolvedBranch);
      const existing = state.assets.find(a => a.serial === serialNumber && serialNumber);
      if (existing) { skipped++; return; }
      state.assets.unshift({
        id: crypto.randomUUID(), tag,
        type: os && os.toLowerCase().includes("server") ? "Server" : "Desktop",
        model: model || name, serial: serialNumber || name,
        branch: resolvedBranch, status: "Available", assignedTo: assignedUser || "",
        warrantyEnd: offsetDate(365), amcEnd: offsetDate(365), value: 0,
        purchaseDate: new Date().toISOString().slice(0, 10), location: resolvedBranch,
        notes: `Imported via Computer Object Import. OS: ${os || "Unknown"}.`
      });
      imported++;
    });
    state.activities.unshift(`Computer Object Import: ${imported} imported, ${skipped} skipped`);
    saveState(); populateFilters(); renderAll();
    statusEl.innerHTML = `<span style="color:var(--ok)">&#10003; ${imported} computer object(s) imported. ${skipped ? `${skipped} skipped (duplicate serial).` : ""}</span>`;
    event.target.value = "";
  };
  reader.onerror = () => { statusEl.innerHTML = `<span style="color:var(--bad)">&#9888; Failed to read file.</span>`; };
  reader.readAsText(file);
}

function downloadComputerTemplate() {
  downloadBlob("computer-object-template.csv", new Blob(
    ["name,os,branch,serialNumber,model,assignedUser\nWKS-BLR-001,Windows 11 Pro,Bangalore HQ,SN123456,Dell OptiPlex 7090,EMP0001\n"],
    { type: "text/csv" }
  ));
}

// ── User Object Import ─────────────────────────────────────────────────────────

function importUserCsv(event) {
  const file     = event.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("employeeImportStatus");
  statusEl.textContent = "Reading file…";
  const reader   = new FileReader();
  reader.onload  = () => {
    const rows = reader.result.split(/\r?\n/).filter(Boolean).slice(1);
    let imported = 0, updated = 0;
    rows.forEach(line => {
      const [id, name, email, department, manager, mobile, branch] = line.split(",").map(v => v.trim());
      if (!name || !email) return;
      const resolvedBranch = branch || getBranches()[0] || "HQ";
      ensureBranch(resolvedBranch);
      const existing = state.employees.find(e => e.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        Object.assign(existing, { id: id || existing.id, name, department, manager: manager || existing.manager, mobile: mobile || existing.mobile, branch: resolvedBranch });
        updated++;
      } else {
        state.employees.push({ id: id || `EMP${String(state.employees.length + 1).padStart(4, "0")}`, name, email, department, manager, mobile, branch: resolvedBranch });
        imported++;
      }
    });
    state.activities.unshift(`User Object Import: ${imported} imported, ${updated} updated`);
    saveState(); populateFilters(); renderAll();
    statusEl.innerHTML = `<span style="color:var(--ok)">&#10003; ${imported} user(s) imported, ${updated} updated.</span>`;
    event.target.value = "";
  };
  reader.onerror = () => { statusEl.innerHTML = `<span style="color:var(--bad)">&#9888; Failed to read file.</span>`; };
  reader.readAsText(file);
}

function downloadUserTemplate() {
  downloadBlob("user-object-template.csv", new Blob(
    ["employeeId,name,email,department,manager,mobile,branch\nEMP0001,Priya Shah,priya.shah@company.local,IT,Amit Rao,+91 98765 43210,Bangalore HQ\n"],
    { type: "text/csv" }
  ));
}

// ── Reports ────────────────────────────────────────────────────────────────────

function renderReportPreview() {
  if (!hasPerm("reports")) return;
  const query  = (document.getElementById("globalSearch")?.value || "").toLowerCase();
  const report = buildReport();
  if (query) {
    report.rows = report.rows.filter(row =>
      row.some(cell => String(cell).toLowerCase().includes(query))
    );
  }
  document.getElementById("reportPreview").innerHTML = createReportHtml(report, { preview: true, limit: 50 });
}

function buildReport(forcedType) {
  const type   = forcedType || document.getElementById("reportType").value;
  const branch = document.getElementById("reportBranch").value;
  const scopedAssets = state.assets.filter(a => !branch || a.branch === branch);
  const empById = Object.fromEntries(state.employees.map(e => [e.id, e]));

  if (type === "custom") return buildCustomReport(branch, empById);

  if (type === "tickets") return {
    title: "Maintenance Tickets Report", subtitle: "All maintenance, audit, and service desk tickets.",
    headers: ["Ticket ID","Title","Category","Priority","Status","Owner","Requester","Asset Tag","Due Date"],
    rows: state.tickets.map(t => {
      const req = empById[t.requesterId];
      return [t.id, t.title, t.category || "General", t.priority, t.status, t.owner || "", req?.name || t.requesterId || "", t.assetTag || "", t.dueDate || ""];
    })
  };

  if (type === "branch") return {
    title: "Office Allocation Report", subtitle: "Asset count and value by office location.",
    headers: ["Office","Assets","Assigned","Available","Value"],
    rows: getBranches().filter(n => !branch || n === branch).map(n => {
      const assets = scopedAssets.filter(a => a.branch === n);
      return [n, assets.length, assets.filter(a => a.status === "Assigned").length, assets.filter(a => a.status === "Available").length, formatMoney(assets.reduce((s, a) => s + Number(a.value || 0), 0))];
    })
  };

  if (type === "warranty") return {
    title: "Warranty and AMC Report", subtitle: "All assets with warranty or AMC expiry details — highlights expired and expiring within 90 days.",
    headers: ["Asset Tag","Asset Name","Model","Office","Warranty End","AMC End","Days Left","Status","Assigned To"],
    rows: scopedAssets
      .filter(a => a.warrantyEnd || a.amcEnd)
      .sort((a, b) => {
        const da = a.warrantyEnd ? new Date(a.warrantyEnd) : new Date("9999-12-31");
        const db = b.warrantyEnd ? new Date(b.warrantyEnd) : new Date("9999-12-31");
        return da - db;
      })
      .map(a => {
        const daysLeft = a.warrantyEnd
          ? Math.ceil((new Date(a.warrantyEnd) - new Date()) / 86400000)
          : null;
        const daysStr = daysLeft === null ? "—"
          : daysLeft < 0  ? `Expired ${Math.abs(daysLeft)}d ago`
          : daysLeft === 0 ? "Expires today"
          : `${daysLeft}d remaining`;
        return [
          a.tag, a.name || a.model, a.model, a.branch,
          a.warrantyEnd || "—", a.amcEnd || "—", daysStr,
          a.status, empById[a.assignedTo]?.name || "Unassigned"
        ];
      })
  };

  if (type === "licenses") return {
    title: "Software License Report", subtitle: "Software subscriptions and assigned license inventory.",
    headers: ["Asset Tag","Product","Office","Assigned To","Renewal","Value"],
    rows: scopedAssets.filter(a => a.type === "Software").map(a => [a.tag, a.model, a.branch, empById[a.assignedTo]?.name || "Pool", a.amcEnd, formatMoney(a.value)])
  };

  if (type === "inventory") return {
    title: "Full Inventory Report", subtitle: "Complete asset register with ownership and lifecycle details.",
    headers: ["Asset Tag","Asset Name","Type","Model","Serial","Assigned To","Office","Status","Warranty End","Value"],
    rows: scopedAssets.map(a => [
      a.tag,
      a.name   || "—",
      a.type   || "—",
      a.model  || "—",
      a.serial || "—",
      empById[a.assignedTo]?.name || "Unassigned",
      a.branch || "—",
      a.status || "—",
      a.warrantyEnd || "—",
      formatMoney(a.value)
    ])
  };

  // Summary (default)
  const counts = countBy(scopedAssets, "type");
  return {
    title: "Executive Summary Report", subtitle: "Management summary for IT asset estate.",
    headers: ["Category","Count","Notes"],
    rows: [
      ["Employees", state.employees.length, "Directory users in scope"],
      ["Assets", scopedAssets.length, "Hardware and software inventory"],
      ["Assigned Assets", scopedAssets.filter(a => a.status === "Assigned").length, "Currently allocated"],
      ["Warranty Risk", scopedAssets.filter(isWarrantyRisk).length, "Expired or expiring within 30 days"],
      ["Open Tickets", state.tickets.filter(t => t.status !== "Closed").length, "Active maintenance workload"],
      ...Object.entries(counts).map(([n, c]) => [n, c, "Asset category count"])
    ]
  };
}

function buildCustomReport(branch, empById) {
  const inclAssets    = document.getElementById("crAssets")?.checked;
  const inclEmployees = document.getElementById("crEmployees")?.checked;
  const inclTickets   = document.getElementById("crTickets")?.checked;
  const assetStatus   = document.getElementById("crAssetStatus")?.value  || "";
  const assetType     = document.getElementById("crAssetType")?.value    || "";
  const ticketStatus  = document.getElementById("crTicketStatus")?.value || "";
  const ticketPriority= document.getElementById("crTicketPriority")?.value || "";

  // Build separate sub-tables; merge with a section-break row so headers stay aligned
  // We use the widest header set (10 cols) and pad shorter rows with empty strings
  const COLS = 10;
  const pad  = row => { while (row.length < COLS) row.push(""); return row; };

  const allHeaders = ["#","Asset Tag / ID","Name / Title","Type / Category","Model / Email","Branch / Office","Status","Assigned To / Owner","Warranty / Due Date","Value / Assets"];
  const rows = [];

  if (inclAssets) {
    let assets = state.assets.filter(a => !branch || a.branch === branch);
    if (assetStatus) assets = assets.filter(a => a.status === assetStatus);
    if (assetType)   assets = assets.filter(a => a.type   === assetType);

    // Section header row
    rows.push(pad(["── ASSETS ──", `${assets.length} record(s)`, "", "", "", "", "", "", "", ""]));
    // Column label row
    rows.push(pad(["#","Asset Tag","Asset Name","Type","Model","Office","Status","Assigned To","Warranty End","Value"]));
    assets.forEach((a, i) => rows.push(pad([
      i + 1,
      a.tag    || "—",
      a.name   || "—",
      a.type   || "—",
      a.model  || "—",
      a.branch || "—",
      a.status || "—",
      empById[a.assignedTo]?.name || "Unassigned",
      a.warrantyEnd || "—",
      formatMoney(a.value)
    ])));
  }

  if (inclEmployees) {
    const assetCounts = countBy(state.assets.filter(a => a.assignedTo), "assignedTo");
    let employees = state.employees;

    rows.push(pad(["── EMPLOYEES ──", `${employees.length} record(s)`, "", "", "", "", "", "", "", ""]));
    rows.push(pad(["#","Employee ID","Full Name","Department","Email","Branch","Manager","Mobile","Assets",""]));
    employees.forEach((e, i) => rows.push(pad([
      i + 1,
      e.id         || "—",
      e.name       || "—",
      e.department || "—",
      e.email      || "—",
      e.branch     || "—",
      e.manager    || "—",
      e.mobile     || "—",
      `${assetCounts[e.id] || 0} asset(s)`,
      ""
    ])));
  }

  if (inclTickets) {
    let tickets = [...state.tickets];
    if (ticketStatus)    tickets = tickets.filter(t => t.status   === ticketStatus);
    if (ticketPriority)  tickets = tickets.filter(t => t.priority === ticketPriority);

    rows.push(pad(["── TICKETS ──", `${tickets.length} record(s)`, "", "", "", "", "", "", "", ""]));
    rows.push(pad(["#","Ticket ID","Title","Category","Priority","Status","Owner","Requester","Asset Tag","Due Date"]));
    tickets.forEach((t, i) => {
      const req = empById[t.requesterId];
      rows.push(pad([
        i + 1,
        t.id          || "—",
        t.title       || "—",
        t.category    || "—",
        t.priority    || "—",
        t.status      || "—",
        t.owner       || "—",
        req?.name     || t.requesterId || "—",
        t.assetTag    || "—",
        t.dueDate     || "—"
      ]));
    });
  }

  const sourceLabels = [
    inclAssets    ? "Assets"    : null,
    inclEmployees ? "Employees" : null,
    inclTickets   ? "Tickets"   : null,
  ].filter(Boolean).join(", ") || "None";

  return {
    title:    "Custom Report",
    subtitle: `Data sources: ${sourceLabels}${branch ? " · Office: " + branch : ""}`,
    headers:  allHeaders,
    rows
  };
}

// ── Logo (Settings) ─────────────────────────────────────────────────────────────

// ── Exports ────────────────────────────────────────────────────────────────────

function exportDoc(report) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>${reportStyles()}</head><body>${createReportHtml(report)}</body></html>`;
  downloadBlob(`${slug(report.title)}.doc`, new Blob([html], { type: "application/msword" }));
}

function exportXlsx(report) {
  const rows = [report.headers, ...report.rows];
  const sheetData = rows.map((row, ri) =>
    `<row r="${ri+1}">${row.map((cell, ci) =>
      `<c r="${columnName(ci+1)}${ri+1}" t="inlineStr"><is><t>${xmlEscape(String(cell))}</t></is></c>`
    ).join("")}</row>`).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`
  };
  downloadBlob(`${slug(report.title)}.xlsx`, zipFiles(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
}

async function exportPdf(report) {
  const logoImage = await getPdfLogoImage();
  const pdf       = buildReportPdf(report, logoImage);
  downloadBlob(`${slug(report.title)}.pdf`, new Blob([pdf], { type: "application/pdf" }));
}

async function getPdfLogoImage() {
  const logo = getActiveLogo();
  if (!logo) return null;
  try {
    const img    = await loadImage(logo);
    const canvas = document.createElement("canvas");
    const ratio  = Math.min(180 / img.naturalWidth, 70 / img.naturalHeight, 1);
    canvas.width  = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    return { bytes: dataUrlToBytes(dataUrl), width: canvas.width, height: canvas.height };
  } catch (e) { console.warn("Logo embed failed:", e); return null; }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}

function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.split(",")[1]);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function createReportHtml(report, options = {}) {
  const rows = report.rows.slice(0, options.limit || report.rows.length);
  const logo = getActiveLogo();
  return `
    <section class="report-doc">
      <header class="report-header">
        <div class="report-brand">
          ${logo ? `<img src="${logo}" alt="Company logo">` : `<p class="report-kicker">Company Asset Report</p>`}
          <h1>${escapeHtml(report.title)}</h1>
          <p>${escapeHtml(report.subtitle)}</p>
        </div>
        <div class="report-meta">
          <strong>Generated</strong><span>${new Date().toLocaleString()}</span>
          <strong>Rows</strong><span>${report.rows.length}</span>
          <strong>Branches</strong><span>${getBranches().length}</span>
        </div>
      </header>
      <div class="report-summary">${reportSummaryCards(report).map(item =>
        `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(String(item.value))}</strong></div>`).join("")}
      </div>
      <table class="report-table">
        <thead><tr>${report.headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row, ri) => {
          // Section-break rows in custom report (start with ──) get a styled separator
          const isSection = row[0] && String(row[0]).startsWith("──");
          // Column-label rows in custom report (row after a section row) — bold
          const isColLabel = !isSection && ri > 0 && String(rows[ri - 1][0]).startsWith("──");
          if (isSection) {
            return `<tr style="background:#176b87;color:#fff"><td colspan="${report.headers.length}" style="font-weight:700;padding:7px 8px">${escapeHtml(String(row[0]))} <span style="font-weight:400;opacity:.85">${escapeHtml(String(row[1]))}</span></td></tr>`;
          }
          if (isColLabel) {
            return `<tr style="background:#e8f4f8">${row.map(cell => `<td style="font-weight:700;font-size:11px;color:#0f4d61">${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`;
          }
          return `<tr>${row.map(cell => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`;
        }).join("")}</tbody>
      </table>
      ${options.preview ? `<p class="muted" style="margin-top:8px;font-size:12px">Showing ${Math.min(options.limit, report.rows.length)} of ${report.rows.length} rows.</p>` : ""}
      <footer class="report-footer"></footer>
    </section>`;
}

function reportStyles() {
  return `<style>
body{font-family:Arial,sans-serif;color:#172033;margin:28px}
.report-header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #176b87;padding-bottom:16px;margin-bottom:18px}
.report-brand img{max-width:150px;max-height:62px;object-fit:contain;margin-bottom:10px}
.report-kicker{font-size:12px;font-weight:700;color:#176b87;text-transform:uppercase;margin:0 0 6px}
h1{font-size:26px;margin:0 0 6px}
.report-header p{margin:0;color:#536173}
.report-meta{display:grid;grid-template-columns:auto auto;gap:5px 12px;font-size:12px;min-width:180px}
.report-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
.report-summary div{border:1px solid #cfd8e6;background:#f6f9fc;padding:10px}
.report-summary span{display:block;color:#536173;font-size:12px;margin-bottom:4px}
.report-summary strong{display:block;font-size:20px}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{border:1px solid #cfd8e6;padding:6px;text-align:left;vertical-align:top}
th{background:#176b87;color:white}
tr:nth-child(even) td{background:#f8fafc}
.report-footer{display:flex;justify-content:space-between;margin-top:18px;color:#536173;font-size:11px}
.report-footer strong{color:#172033}
</style>`;
}

function reportSummaryCards(report) {
  return [
    { label: "Employees",    value: state.employees.length.toLocaleString("en-IN") },
    { label: "Assets",       value: state.assets.length.toLocaleString("en-IN") },
    { label: "Report Rows",  value: report.rows.length.toLocaleString("en-IN") },
    { label: "Open Tickets", value: state.tickets.filter(t => t.status !== "Closed").length }
  ];
}

// ── PDF builder ────────────────────────────────────────────────────────────────

function buildReportPdf(report, logoImage = null) {
  const colWidths = distributeColumns(report.headers.length);
  const PAGE_W   = 515;   // usable width: 595 - 40 left margin - 40 right margin
  const pages = [];
  let current = [
    { image: logoImage, x: 405, y: 760, width: logoImage ? logoImage.width : 0, height: logoImage ? logoImage.height : 0 },
    { text: logoImage ? "" : "Company Asset Report", size: 9,  x: 40, y: 800, width: PAGE_W },
    { text: report.title,    size: 18, x: 40, y: 776, width: PAGE_W },
    { text: report.subtitle, size: 10, x: 40, y: 758, width: PAGE_W },
    { text: `Generated: ${new Date().toLocaleString()} | Rows: ${report.rows.length} | Branches: ${getBranches().length}`, size: 9, x: 40, y: 740, width: PAGE_W }
  ];
  const PAGE_W_INNER = PAGE_W;  // alias for closures below
  let y = 710;
  const pushHeader = () => {
    let x = 40;
    report.headers.forEach((h, i) => { current.push({ text: h, size: 8, x, y, bold: true, width: colWidths[i] }); x += colWidths[i]; });
    y -= 16;
  };
  const nextPage = () => {
    pages.push(current);
    current = [
      { text: report.title, size: 11, x: 40, y: 800, width: PAGE_W_INNER },
      { text: "Continued",  size: 8,  x: 500, y: 800, width: 80 }
    ];
    y = 772; pushHeader();
  };
  pushHeader();
  report.rows.slice(0, 600).forEach(row => {
    if (y < 54) nextPage();
    let x = 40;
    row.forEach((cell, i) => { current.push({ text: String(cell ?? ""), size: 7, x, y, width: colWidths[i] }); x += colWidths[i]; });
    y -= 14;
  });
  if (report.rows.length > 600) {
    if (y < 54) nextPage();
    current.push({ text: `PDF truncated at 600 rows. Use XLSX export for all ${report.rows.length} rows.`, size: 9, x: 40, y, width: PAGE_W_INNER });
  }
  pages.push(current);
  pages.forEach((page, i) => {
    page.push({ text: `Page ${i+1} of ${pages.length}`, size: 8, x: 40,  y: 24, width: 200 });
  });
  return buildPdfPages(pages, logoImage);
}

function distributeColumns(count) {
  const width = Math.floor(515 / Math.max(count, 1));
  return Array.from({ length: count }, () => width);
}

function buildPdfPages(pages, logoImage = null) {
  const fontStart     = pages.length * 2 + 3;
  const imageObjectId = logoImage ? fontStart + 2 : null;
  const encoder       = new TextEncoder();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_,i) => `${3+i*2} 0 R`).join(" ")}] /Count ${pages.length} >>`
  ];
  pages.forEach((items, index) => {
    const pageObj   = 3 + index * 2;
    const contentObj = pageObj + 1;
    const streamLines = items.map(item => {
      if (item.image && index === 0)
        return `q ${item.width} 0 0 ${item.height} ${item.x} ${item.y} cm /Im1 Do Q`;
      const font = item.bold ? "/F2" : "/F1";
      const txt  = pdfEscape(normalizePdfText(item.text, item.width));
      return `BT ${font} ${item.size} Tf ${item.x} ${item.y} Td (${txt}) Tj ET`;
    });
    const streamBody  = streamLines.join("\n");
    const streamBytes = encoder.encode(streamBody).length;   // true byte length
    const xObject = logoImage ? ` /XObject << /Im1 ${imageObjectId} 0 R >>` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontStart} 0 R /F2 ${fontStart+1} 0 R >>${xObject} >> /Contents ${contentObj} 0 R >>`
    );
    objects.push(`<< /Length ${streamBytes} >>\nstream\n${streamBody}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  if (logoImage) objects.push({
    binary: logoImage.bytes,
    header: `<< /Type /XObject /Subtype /Image /Width ${logoImage.width} /Height ${logoImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoImage.bytes.length} >>\nstream\n`,
    footer: "\nendstream"
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    if (typeof obj === "string") pdf += `${index+1} 0 obj\n${obj}\nendobj\n`;
    else pdf += `${index+1} 0 obj\n${obj.header}${bytesToBinaryString(obj.binary)}${obj.footer}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(off => { pdf += `${String(off).padStart(10,"0")} 00000 n \n`; });
  pdf += `trailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return binaryStringToBytes(pdf);
}

function bytesToBinaryString(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 0x8000) result += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return result;
}

function binaryStringToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function normalizePdfText(text, width = 515) {
  // chars-per-pt ratio ≈ 0.55 for Helvetica at 1pt; we're conservative at /4.6 for typical sizes
  const limit = Math.max(10, Math.floor(width / 4.6));
  return String(text).replace(/[^\x20-\x7E]/g, "").slice(0, limit);
}

// ── ZIP / XLSX helper ──────────────────────────────────────────────────────────

function zipFiles(files, mimeType) {
  const encoder = new TextEncoder();
  const localParts = [], centralParts = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data      = encoder.encode(content);
    const crc       = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true); localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); ch.set(nameBytes, 46);
    centralParts.push(ch);
    offset += localHeader.length + data.length;
  });
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev  = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: mimeType });
}

function crc32(data) {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function downloadBlob(filename, blob) {
  const link   = document.createElement("a");
  link.href     = URL.createObjectURL(blob);
  link.download  = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getWarrantyRiskAssets() { return state.assets.filter(isWarrantyRisk); }
function isWarrantyRisk(asset)   { return (new Date(asset.warrantyEnd) - new Date()) / 86400000 <= 30; }
function countBy(items, key)     { return items.reduce((map, item) => { map[item[key]] = (map[item[key]] || 0) + 1; return map; }, {}); }
function formatMoney(value)      { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function escapeHtml(text)        { return String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" })[c]); }
function escapeAttr(text)        { return escapeHtml(String(text || "")); }
function xmlEscape(text)         { return String(text).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" })[c]); }
function pdfEscape(text)         { return text.replace(/[\\()]/g, "\\$&"); }
function slug(text)              { return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function columnName(number) {
  let name = "";
  while (number > 0) { const rem = (number-1)%26; name = String.fromCharCode(65+rem)+name; number = Math.floor((number-1)/26); }
  return name;
}
