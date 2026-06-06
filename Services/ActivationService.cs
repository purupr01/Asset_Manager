using System.Text.Json;
using AssetManager.Models;

namespace AssetManager.Services;

/// <summary>
/// Thread-safe file-backed activation store.
/// State is persisted in Data/activation.json — shared by ALL browsers and devices.
/// UsedKeys list prevents the same key from ever being activated twice.
/// </summary>
public class ActivationService
{
    private readonly string           _filePath;
    private readonly SemaphoreSlim    _lock  = new(1, 1);
    private          ActivationRecord _cache;

    private static readonly JsonSerializerOptions _json = new()
    {
        WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public ActivationService(IWebHostEnvironment env)
    {
        var dir   = Path.Combine(env.ContentRootPath, "Data");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "activation.json");
        _cache    = Load();
    }

    public ActivationRecord Get() => _cache;

    /// <summary>
    /// Saves a new activation key. Returns an error string if the key was already used.
    /// </summary>
    public (ActivationRecord? Record, string? Error) Save(string key, string expires, string activatedBy)
    {
        _lock.Wait();
        try
        {
            // Reject if this exact key has been used before on this server
            var used = _cache.UsedKeys ?? new List<string>();
            if (used.Contains(key))
                return (null, "This activation key has already been used. Please generate a new key.");

            var newUsed = new List<string>(used) { key };
            var record  = new ActivationRecord
            {
                Activated   = true,
                Key         = key,
                Expires     = expires,
                ActivatedAt = DateTime.UtcNow.ToString("o"),
                ActivatedBy = activatedBy,
                UsedKeys    = newUsed
            };
            Write(record);
            _cache = record;
            return (record, null);
        }
        finally { _lock.Release(); }
    }

    public void Clear()
    {
        _lock.Wait();
        try
        {
            // Clear active state but keep the usedKeys history to block re-use
            var empty = ActivationRecord.Empty(_cache.UsedKeys);
            Write(empty);
            _cache = empty;
        }
        finally { _lock.Release(); }
    }

    private ActivationRecord Load()
    {
        if (!File.Exists(_filePath)) return ActivationRecord.Empty(null);
        try
        {
            return JsonSerializer.Deserialize<ActivationRecord>(File.ReadAllText(_filePath), _json)
                   ?? ActivationRecord.Empty(null);
        }
        catch { return ActivationRecord.Empty(null); }
    }

    private void Write(ActivationRecord r) =>
        File.WriteAllText(_filePath, JsonSerializer.Serialize(r, _json));
}
