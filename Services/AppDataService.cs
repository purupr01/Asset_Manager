using System.Text.Json;
using System.Text.Json.Serialization;

namespace AssetManager.Services;

/// <summary>
/// Thread-safe file-backed store for Assets, Employees, Tickets, Branches,
/// AssetTypes, and Activities. All data is persisted in Data/appdata.json.
/// </summary>
public class AppDataService
{
    private readonly string        _filePath;
    private readonly SemaphoreSlim _lock  = new(1, 1);
    private          AppData       _cache;

    private static readonly JsonSerializerOptions _json = new()
    {
        WriteIndented               = true,
        PropertyNamingPolicy        = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition      = JsonIgnoreCondition.WhenWritingNull
    };

    public AppDataService(IWebHostEnvironment env)
    {
        var dir   = Path.Combine(env.ContentRootPath, "Data");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "appdata.json");
        _cache    = Load();
    }

    public AppData Get() => _cache;

    public AppData Save(AppData incoming)
    {
        _lock.Wait();
        try { _cache = incoming; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    public AppData PatchAssets(List<AssetRecord> assets)
    {
        _lock.Wait();
        try { _cache.Assets = assets; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    public AppData PatchEmployees(List<EmployeeRecord> employees)
    {
        _lock.Wait();
        try { _cache.Employees = employees; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    public AppData PatchTickets(List<TicketRecord> tickets)
    {
        _lock.Wait();
        try { _cache.Tickets = tickets; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    public AppData PatchBranches(List<string> branches)
    {
        _lock.Wait();
        try { _cache.Branches = branches; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    public AppData PatchAssetTypes(List<string> assetTypes)
    {
        _lock.Wait();
        try { _cache.AssetTypes = assetTypes; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    public AppData PatchActivities(List<string> activities)
    {
        _lock.Wait();
        try { _cache.Activities = activities; Write(_cache); }
        finally { _lock.Release(); }
        return _cache;
    }

    private AppData Load()
    {
        if (!File.Exists(_filePath)) return new AppData();
        try
        {
            return JsonSerializer.Deserialize<AppData>(File.ReadAllText(_filePath), _json)
                   ?? new AppData();
        }
        catch { return new AppData(); }
    }

    private void Write(AppData d) =>
        File.WriteAllText(_filePath, JsonSerializer.Serialize(d, _json));
}

// ── Model classes ───────────────────────────────────────────────────────────────

public class AppData
{
    [JsonPropertyName("assets")]      public List<AssetRecord>    Assets      { get; set; } = new();
    [JsonPropertyName("employees")]   public List<EmployeeRecord> Employees   { get; set; } = new();
    [JsonPropertyName("tickets")]     public List<TicketRecord>   Tickets     { get; set; } = new();
    [JsonPropertyName("branches")]    public List<string>         Branches    { get; set; } = new();
    [JsonPropertyName("assetTypes")]  public List<string>?        AssetTypes  { get; set; }
    [JsonPropertyName("activities")]  public List<string>         Activities  { get; set; } = new();
}

public class AssetRecord
{
    [JsonPropertyName("id")]           public string? Id           { get; set; }
    [JsonPropertyName("tag")]          public string? Tag          { get; set; }
    [JsonPropertyName("name")]         public string? Name         { get; set; }
    [JsonPropertyName("type")]         public string? Type         { get; set; }
    [JsonPropertyName("model")]        public string? Model        { get; set; }
    [JsonPropertyName("serial")]       public string? Serial       { get; set; }
    [JsonPropertyName("status")]       public string? Status       { get; set; }
    [JsonPropertyName("branch")]       public string? Branch       { get; set; }
    [JsonPropertyName("assignedTo")]   public string? AssignedTo   { get; set; }
    [JsonPropertyName("warrantyEnd")]  public string? WarrantyEnd  { get; set; }
    [JsonPropertyName("amcEnd")]       public string? AmcEnd       { get; set; }
    [JsonPropertyName("value")]        public double  Value        { get; set; }
    [JsonPropertyName("purchaseDate")] public string? PurchaseDate { get; set; }
    [JsonPropertyName("location")]     public string? Location     { get; set; }
    [JsonPropertyName("notes")]        public string? Notes        { get; set; }
}

public class EmployeeRecord
{
    [JsonPropertyName("id")]         public string? Id         { get; set; }
    [JsonPropertyName("name")]       public string? Name       { get; set; }
    [JsonPropertyName("email")]      public string? Email      { get; set; }
    [JsonPropertyName("department")] public string? Department { get; set; }
    [JsonPropertyName("manager")]    public string? Manager    { get; set; }
    [JsonPropertyName("mobile")]     public string? Mobile     { get; set; }
    [JsonPropertyName("branch")]     public string? Branch     { get; set; }
}

public class TicketNote
{
    [JsonPropertyName("author")] public string? Author { get; set; }
    [JsonPropertyName("text")]   public string? Text   { get; set; }
    [JsonPropertyName("at")]     public string? At     { get; set; }
}

public class TicketRecord
{
    [JsonPropertyName("id")]          public string?           Id          { get; set; }
    [JsonPropertyName("title")]       public string?           Title       { get; set; }
    [JsonPropertyName("description")] public string?           Description { get; set; }
    [JsonPropertyName("status")]      public string?           Status      { get; set; }
    [JsonPropertyName("priority")]    public string?           Priority    { get; set; }
    [JsonPropertyName("impact")]      public string?           Impact      { get; set; }
    [JsonPropertyName("category")]    public string?           Category    { get; set; }
    [JsonPropertyName("owner")]       public string?           Owner       { get; set; }
    [JsonPropertyName("dueDate")]     public string?           DueDate     { get; set; }
    [JsonPropertyName("requesterId")] public string?           RequesterId { get; set; }
    [JsonPropertyName("assetTag")]    public string?           AssetTag    { get; set; }
    [JsonPropertyName("notes")]       public List<TicketNote>? Notes       { get; set; }
}
