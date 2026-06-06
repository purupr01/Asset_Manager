using System.Text.Json;
using AssetManager.Models;

namespace AssetManager.Services;

/// <summary>
/// Thread-safe file-backed user store.
/// All accounts are persisted in Data/users.json — shared by ALL browsers and devices.
/// Password hash algorithm matches the browser-side hashPassword() in auth.js exactly.
/// </summary>
public class UsersService
{
    private readonly string           _filePath;
    private readonly SemaphoreSlim    _lock  = new(1, 1);
    private          List<UserRecord> _cache;

    private static readonly HashSet<string> ValidRoles =
        new(StringComparer.OrdinalIgnoreCase) { "admin", "manager", "auditor", "viewer" };

    private static readonly JsonSerializerOptions _json = new()
    {
        WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public UsersService(IWebHostEnvironment env)
    {
        var dir   = Path.Combine(env.ContentRootPath, "Data");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "users.json");
        _cache    = Load();
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    public List<UserRecord> GetAll() => _cache;

    public UserRecord? Authenticate(string username, string password)
    {
        var hash = Hash(password);
        return _cache.FirstOrDefault(u =>
            string.Equals(u.Username, username, StringComparison.OrdinalIgnoreCase)
            && u.Active && u.PasswordHash == hash);
    }

    public (UserRecord? User, string? Error) Create(UserSaveRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Username)) return (null, "Username is required.");
        if (string.IsNullOrWhiteSpace(r.FullName)) return (null, "Full name is required.");
        if (string.IsNullOrWhiteSpace(r.Email))    return (null, "Email is required.");
        if (string.IsNullOrWhiteSpace(r.Password)) return (null, "Password is required.");
        if (!ValidRoles.Contains(r.Role ?? ""))    return (null, "Invalid role.");

        _lock.Wait();
        try
        {
            if (_cache.Any(u => string.Equals(u.Username, r.Username, StringComparison.OrdinalIgnoreCase)))
                return (null, "Username already taken.");

            var newId = NextId();
            var user  = new UserRecord
            {
                Id           = newId,
                Username     = r.Username.Trim(),
                PasswordHash = Hash(r.Password),
                FullName     = r.FullName.Trim(),
                Email        = r.Email.Trim(),
                Role         = r.Role!.ToLower(),
                Active       = r.Active,
                CreatedAt    = DateTime.UtcNow.ToString("o")
            };
            _cache.Add(user);
            Write(_cache);
            return (user, null);
        }
        finally { _lock.Release(); }
    }

    public (UserRecord? User, string? Error) Update(string id, UserSaveRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Username)) return (null, "Username is required.");
        if (string.IsNullOrWhiteSpace(r.FullName)) return (null, "Full name is required.");
        if (string.IsNullOrWhiteSpace(r.Email))    return (null, "Email is required.");
        if (!ValidRoles.Contains(r.Role ?? ""))    return (null, "Invalid role.");

        _lock.Wait();
        try
        {
            var user = _cache.FirstOrDefault(u => u.Id == id);
            if (user is null) return (null, "User not found.");

            if (_cache.Any(u => u.Id != id &&
                string.Equals(u.Username, r.Username, StringComparison.OrdinalIgnoreCase)))
                return (null, "Username already taken.");

            if (user.Username.Equals("admin", StringComparison.OrdinalIgnoreCase) &&
                !r.Username.Equals("admin", StringComparison.OrdinalIgnoreCase))
                return (null, "Built-in admin username cannot be changed.");

            user.FullName = r.FullName.Trim();
            user.Username = r.Username.Trim();
            user.Email    = r.Email.Trim();
            user.Role     = r.Role!.ToLower();
            user.Active   = r.Active;
            if (!string.IsNullOrWhiteSpace(r.Password))
                user.PasswordHash = Hash(r.Password);

            Write(_cache);
            return (user, null);
        }
        finally { _lock.Release(); }
    }

    public (UserRecord? User, string? Error) ToggleActive(string id)
    {
        _lock.Wait();
        try
        {
            var user = _cache.FirstOrDefault(u => u.Id == id);
            if (user is null) return (null, "User not found.");
            if (user.Username.Equals("admin", StringComparison.OrdinalIgnoreCase))
                return (null, "Built-in admin account cannot be disabled.");
            user.Active = !user.Active;
            Write(_cache);
            return (user, null);
        }
        finally { _lock.Release(); }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// djb2 hash — MUST match the browser-side hashPassword() in auth.js exactly.
    /// Both use seeds a=5381 b=52711 with the same unsigned 32-bit arithmetic.
    /// </summary>
    public static string Hash(string pw)
    {
        uint a = 5381, b = 52711;
        foreach (var c in pw)
        {
            a = unchecked(((a << 5) + a) + c);
            b = unchecked(((b << 5) + b) + c);
        }
        return $"{a:x8}{b:x8}";
    }

    private string NextId()
    {
        var n = _cache.Count + 1;
        var id = $"USR{n:D4}";
        while (_cache.Any(u => u.Id == id)) id = $"USR{++n:D4}";
        return id;
    }

    private List<UserRecord> Load()
    {
        if (!File.Exists(_filePath)) return Bootstrap();
        try
        {
            var users = JsonSerializer.Deserialize<List<UserRecord>>(File.ReadAllText(_filePath), _json);
            if (users is { Count: > 0 }) return users;
        }
        catch { /* fall through */ }
        return Bootstrap();
    }

    private List<UserRecord> Bootstrap()
    {
        var list = new List<UserRecord>
        {
            new()
            {
                Id           = "USR0001",
                Username     = "admin",
                PasswordHash = Hash("admin123"),
                FullName     = "System Administrator",
                Email        = "admin@company.local",
                Role         = "admin",
                Active       = true,
                CreatedAt    = DateTime.UtcNow.ToString("o")
            }
        };
        Write(list);
        return list;
    }

    private void Write(List<UserRecord> users) =>
        File.WriteAllText(_filePath, JsonSerializer.Serialize(users, _json));
}
