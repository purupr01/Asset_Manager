// ══════════════════════════════════════════════════════════════════════════════
// auth.js  —  Authentication & RBAC for ITProAcademy Asset Manager
//
// USER ACCOUNTS  → stored server-side in Data/users.json via /api/users
//                  visible to ALL browsers, devices, OS accounts
//
// SESSION TOKEN  → stored in sessionStorage (per browser tab only, auto-clears
//                  when the tab is closed — never written to localStorage)
// ══════════════════════════════════════════════════════════════════════════════

const SESSION_KEY = "itpro_sess_v1";

const ROLES = {
  admin:   { label: "Admin",   color: "#b83232", bg: "#fdecec",
             perms: ["read","write","reports","download","manage_users"] },
  manager: { label: "Manager", color: "#176b87", bg: "#e8f4f8",
             perms: ["read","write","reports","download"] },
  auditor: { label: "Auditor", color: "#1f8a5b", bg: "#e9f8f0",
             perms: ["read","reports","download"] },
  viewer:  { label: "Viewer",  color: "#b7791f", bg: "#fff4df",
             perms: ["read"] },
};

// ── Session ───────────────────────────────────────────────────────────────────

function _getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; }
  catch (_) { return null; }
}

function _setSession(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: user.id, username: user.username,
    fullName: user.fullName, role: user.role
  }));
}

function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

function currentUser() { return _getSession(); }

// Reads role directly from session — no extra server call needed
function hasPerm(perm) {
  const sess = _getSession();
  if (!sess?.role) return false;
  return (ROLES[sess.role]?.perms || []).includes(perm);
}

// ── Login / Logout ────────────────────────────────────────────────────────────

async function attemptLogin(username, password) {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (res.status === 401) return { ok: false, message: "Invalid username or password." };
    if (!res.ok)            return { ok: false, message: `Server error (${res.status}). Try again.` };
    const user = await res.json();
    _setSession(user);
    return { ok: true, user };
  } catch (err) {
    return { ok: false, message: "Cannot reach server. Check your network connection." };
  }
}

// ── Login screen ──────────────────────────────────────────────────────────────

function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
  const err = document.getElementById("loginError");
  err.textContent = ""; err.hidden = true;

  const savedUser = localStorage.getItem("itpro_last_user") || "";
  const unameEl   = document.getElementById("loginUsername");
  const pwEl      = document.getElementById("loginPassword");
  unameEl.value = savedUser;
  pwEl.value    = "";
  setTimeout(() => (savedUser ? pwEl : unameEl).focus(), 60);
}

function hideLoginScreen() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
}

function wireLoginScreen() {
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const u   = document.getElementById("loginUsername").value.trim();
    const p   = document.getElementById("loginPassword").value;
    const btn = document.querySelector(".login-btn");
    if (!u || !p) { _loginErr("Please enter both username and password."); return; }

    btn.disabled = true; btn.textContent = "Signing in…";
    const res = await attemptLogin(u, p);
    btn.disabled = false; btn.textContent = "Sign In";

    if (res.ok) {
      localStorage.setItem("itpro_last_user", u);
      hideLoginScreen();
      bootApp();
    } else {
      _loginErr(res.message);
    }
  });
}

function _loginErr(msg) {
  const el = document.getElementById("loginError");
  el.textContent = msg; el.hidden = false;
}

// ── Session bar ───────────────────────────────────────────────────────────────

function renderSessionBar() {
  const sess = _getSession();
  if (!sess) return;
  const role = ROLES[sess.role] || ROLES.viewer;
  document.getElementById("sessionBar").innerHTML = `
    <div class="session-info">
      <div class="session-avatar">${sess.fullName.charAt(0).toUpperCase()}</div>
      <div class="session-meta">
        <strong>${escapeHtml(sess.fullName)}</strong>
        <span class="role-pill" style="background:${role.bg};color:${role.color}">${role.label}</span>
      </div>
    </div>
    <button class="ghost session-logout" id="logoutBtn">Sign out</button>`;
  document.getElementById("logoutBtn").addEventListener("click", () => {
    clearSession(); showLoginScreen();
  });
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

function applyRbac() {
  const canWrite  = hasPerm("write");
  const canReport = hasPerm("reports");
  const canDL     = hasPerm("download");
  const canAdmin  = hasPerm("manage_users");

  const usersNav = document.querySelector("[data-view='users']");
  if (usersNav) usersNav.style.display = canAdmin ? "" : "none";

  document.querySelectorAll(".requires-write").forEach(el => {
    el.style.display = canWrite ? "" : "none";
  });
  document.querySelectorAll(".requires-download").forEach(el => {
    el.style.display = canDL ? "" : "none";
  });

  const gate    = document.getElementById("reportsGate");
  const content = document.getElementById("reportsContent");
  if (gate && content) {
    gate.style.display    = canReport ? "none" : "";
    content.style.display = canReport ? ""     : "none";
  }
}

// ── Access Control tab — all operations go to the server API ──────────────────

async function _fetchUsers() {
  const res = await fetch("/api/users", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

async function renderUsersView() {
  const tbody = document.getElementById("userRows");
  const sess  = _getSession();
  const query = (document.getElementById("globalSearch")?.value || "").toLowerCase();

  tbody.innerHTML = `<tr><td colspan="8" style="color:var(--muted)">Loading…</td></tr>`;

  let users;
  try { users = await _fetchUsers(); }
  catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--bad)">
      Could not load users: ${escapeHtml(err.message)}</td></tr>`;
    return;
  }

  const filtered = query
    ? users.filter(u => [u.id, u.fullName, u.username, u.email, u.role]
        .join(" ").toLowerCase().includes(query))
    : users;

  tbody.innerHTML = filtered.map(u => {
    const role   = ROLES[u.role] || ROLES.viewer;
    const isSelf = sess && u.id === sess.userId;
    return `<tr>
      <td><strong>${escapeHtml(u.id)}</strong></td>
      <td>${escapeHtml(u.fullName)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="role-pill" style="background:${role.bg};color:${role.color}">${role.label}</span></td>
      <td><span class="pill ${u.active ? "Available" : "Retired"}">${u.active ? "Active" : "Disabled"}</span></td>
      <td>${new Date(u.createdAt).toLocaleDateString()}</td>
      <td>
        <button class="ghost row-action" data-edit-user="${escapeAttr(u.id)}">Edit</button>
        ${(!isSelf && u.username !== "admin")
          ? `<button class="ghost row-action" style="color:var(--bad)"
               data-toggle-user="${escapeAttr(u.id)}">${u.active ? "Disable" : "Enable"}</button>`
          : ""}
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="8">
    ${query ? "No users match your search." : "No users found."}</td></tr>`;

  document.querySelectorAll("[data-edit-user]").forEach(btn =>
    btn.addEventListener("click", () => openUserDialog(btn.dataset.editUser)));
  document.querySelectorAll("[data-toggle-user]").forEach(btn =>
    btn.addEventListener("click", () => _toggleUser(btn.dataset.toggleUser)));
}

async function openUserDialog(userId) {
  const isNew = !userId;
  let user = {};
  if (!isNew) {
    try {
      const all = await _fetchUsers();
      user = all.find(u => u.id === userId) || {};
    } catch (_) {}
  }

  document.getElementById("userDialogTitle").textContent = isNew ? "Create User" : "Edit User";
  document.getElementById("userFields").innerHTML = `
    <label>Full Name
      <input name="fullName" value="${escapeAttr(user.fullName || "")}" required></label>
    <label>Username
      <input name="username" value="${escapeAttr(user.username || "")}" required autocomplete="off"></label>
    <label>Email
      <input name="email" type="email" value="${escapeAttr(user.email || "")}" required></label>
    <label>Role
      <select name="role">
        ${Object.entries(ROLES).map(([k, v]) =>
          `<option value="${k}"${user.role === k ? " selected" : ""}>${v.label}</option>`
        ).join("")}
      </select>
    </label>
    <label>${isNew ? "Password" : "New Password (leave blank to keep)"}
      <input name="password" type="password" ${isNew ? "required" : ""}
        autocomplete="new-password"
        placeholder="${isNew ? "Enter password" : "Leave blank to keep current"}">
    </label>
    <label>Confirm Password
      <input name="passwordConfirm" type="password" ${isNew ? "required" : ""}
        autocomplete="new-password">
    </label>
    <label class="checkbox-label">
      <input type="checkbox" name="active"${user.active !== false ? " checked" : ""}> Account Active
    </label>`;

  document.getElementById("saveUserBtn").onclick = async e => {
    e.preventDefault();
    await _saveUserRecord(userId);
  };
  document.getElementById("userDialog").showModal();
}

async function _saveUserRecord(userId) {
  const fd   = new FormData(document.getElementById("userForm"));
  const data = Object.fromEntries(fd.entries());
  const isNew = !userId;

  if (data.password && data.password !== data.passwordConfirm)
    { alert("Passwords do not match."); return; }
  if (isNew && !data.password)
    { alert("Password is required for new users."); return; }
  if (!data.fullName || !data.username || !data.email)
    { alert("All fields are required."); return; }

  const payload = {
    username: data.username, fullName: data.fullName,
    email: data.email, role: data.role,
    active: data.active === "on",
    ...(data.password ? { password: data.password } : {})
  };

  try {
    const url    = isNew ? "/api/users" : `/api/users/${userId}`;
    const method = isNew ? "POST" : "PUT";
    const res    = await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
      alert("Error: " + (err.error || "Could not save user."));
      return;
    }
    document.getElementById("userDialog").close();
    await renderUsersView();
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

async function _toggleUser(userId) {
  try {
    const res = await fetch(`/api/users/${userId}/toggle`, { method: "PATCH" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
      alert("Error: " + (err.error || "Could not update user."));
      return;
    }
    await renderUsersView();
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

function wireUserManagement() {
  document.getElementById("openUserForm").addEventListener("click", () => openUserDialog(null));
  document.getElementById("cancelUserDialog").addEventListener("click", () => {
    document.getElementById("userDialog").close();
  });
}

// ── Reset (clears local session cache only — server data is unchanged) ─────────

function resetAuthStore() {
  if (!confirm(
    "This clears your local session and cache.\n\n" +
    "Server user accounts are NOT affected.\n\n" +
    "To fully reset users, delete Data/users.json on the server.\n\nContinue?"
  )) return;
  clearSession();
  localStorage.removeItem("itpro_last_user");
  location.reload();
}
