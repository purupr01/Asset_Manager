using System.Text.Json;
using System.Text.Json.Serialization;
using AssetManager.Models;
using AssetManager.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<ActivationService>();
builder.Services.AddSingleton<UsersService>();
builder.Services.AddSingleton<AppDataService>();
builder.Services.Configure<JsonSerializerOptions>(opts =>
{
    opts.PropertyNamingPolicy   = JsonNamingPolicy.CamelCase;
    opts.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    opts.WriteIndented          = true;
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

// ═══════════════════════════════════════════════════════════════════
// LOGO API  — stores logo as a base64 data-URL in Data/logo.json
// ═══════════════════════════════════════════════════════════════════

string LogoFilePath(IWebHostEnvironment env) =>
    Path.Combine(env.ContentRootPath, "Data", "logo.json");

app.MapGet("/api/logo", (IWebHostEnvironment env) =>
{
    var path = LogoFilePath(env);
    if (!File.Exists(path)) return Results.Ok(new { logo = "" });
    try
    {
        var obj = JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(path));
        return Results.Ok(new { logo = obj.GetProperty("logo").GetString() ?? "" });
    }
    catch { return Results.Ok(new { logo = "" }); }
});

app.MapPost("/api/logo", async (IWebHostEnvironment env, HttpRequest req) =>
{
    JsonElement body;
    try   { body = await req.ReadFromJsonAsync<JsonElement>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }

    var logo = body.TryGetProperty("logo", out var v) ? v.GetString() ?? "" : "";
    var dir  = Path.Combine(env.ContentRootPath, "Data");
    Directory.CreateDirectory(dir);
    File.WriteAllText(LogoFilePath(env), JsonSerializer.Serialize(new { logo }));
    return Results.Ok(new { success = true });
});

app.MapDelete("/api/logo", (IWebHostEnvironment env) =>
{
    var path = LogoFilePath(env);
    if (File.Exists(path)) File.Delete(path);
    return Results.Ok(new { success = true });
});

// ═══════════════════════════════════════════════════════════════════
// ACTIVATION API
// ═══════════════════════════════════════════════════════════════════

app.MapGet("/api/activation", (ActivationService svc) =>
    Results.Ok(svc.Get()));

app.MapPost("/api/activation", async (ActivationService svc, HttpRequest req) =>
{
    ActivationRequest? body;
    try   { body = await req.ReadFromJsonAsync<ActivationRequest>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }

    if (body is null || string.IsNullOrWhiteSpace(body.Key) || string.IsNullOrWhiteSpace(body.Expires))
        return Results.BadRequest(new { error = "key and expires are required." });

    var (saved, error) = svc.Save(body.Key, body.Expires, body.ActivatedBy ?? "unknown");
    if (error is not null)
        return Results.BadRequest(new { error });

    return Results.Ok(new { success = true, expires = saved!.Expires });
});

app.MapDelete("/api/activation", (ActivationService svc) =>
{
    svc.Clear();
    return Results.Ok(new { success = true });
});

// ═══════════════════════════════════════════════════════════════════
// USERS API
// ═══════════════════════════════════════════════════════════════════

app.MapPost("/api/auth/login", async (UsersService svc, HttpRequest req) =>
{
    LoginRequest? body;
    try   { body = await req.ReadFromJsonAsync<LoginRequest>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }

    if (body is null || string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password))
        return Results.BadRequest(new { error = "username and password are required." });

    var user = svc.Authenticate(body.Username, body.Password);
    if (user is null) return Results.Unauthorized();

    return Results.Ok(new
    {
        id       = user.Id,
        username = user.Username,
        fullName = user.FullName,
        email    = user.Email,
        role     = user.Role,
        active   = user.Active
    });
});

app.MapGet("/api/users", (UsersService svc) =>
    Results.Ok(svc.GetAll().Select(u => new
    {
        id        = u.Id,
        username  = u.Username,
        fullName  = u.FullName,
        email     = u.Email,
        role      = u.Role,
        active    = u.Active,
        createdAt = u.CreatedAt
    })));

app.MapPost("/api/users", async (UsersService svc, HttpRequest req) =>
{
    UserSaveRequest? body;
    try   { body = await req.ReadFromJsonAsync<UserSaveRequest>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }

    if (body is null) return Results.BadRequest(new { error = "Empty body." });

    var (user, error) = svc.Create(body);
    if (error is not null) return Results.BadRequest(new { error });

    return Results.Ok(new
    {
        id        = user!.Id,
        username  = user.Username,
        fullName  = user.FullName,
        email     = user.Email,
        role      = user.Role,
        active    = user.Active,
        createdAt = user.CreatedAt
    });
});

app.MapPut("/api/users/{id}", async (string id, UsersService svc, HttpRequest req) =>
{
    UserSaveRequest? body;
    try   { body = await req.ReadFromJsonAsync<UserSaveRequest>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }

    if (body is null) return Results.BadRequest(new { error = "Empty body." });

    var (user, error) = svc.Update(id, body);
    if (error is not null) return Results.BadRequest(new { error });

    return Results.Ok(new
    {
        id        = user!.Id,
        username  = user.Username,
        fullName  = user.FullName,
        email     = user.Email,
        role      = user.Role,
        active    = user.Active,
        createdAt = user.CreatedAt
    });
});

app.MapMethods("/api/users/{id}/toggle", new[] { "PATCH" }, (string id, UsersService svc) =>
{
    var (user, error) = svc.ToggleActive(id);
    if (error is not null) return Results.BadRequest(new { error });
    return Results.Ok(new { id = user!.Id, active = user.Active });
});

// ═══════════════════════════════════════════════════════════════════
// APP DATA API  — assets, employees, tickets, branches, activities
// All stored server-side in Data/appdata.json
// ═══════════════════════════════════════════════════════════════════

app.MapGet("/api/appdata", (AppDataService svc) =>
    Results.Ok(svc.Get()));

app.MapPost("/api/appdata", async (AppDataService svc, HttpRequest req) =>
{
    AppData? body;
    try   { body = await req.ReadFromJsonAsync<AppData>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.Save(body));
});

app.MapPut("/api/appdata/assets", async (AppDataService svc, HttpRequest req) =>
{
    List<AssetRecord>? body;
    try   { body = await req.ReadFromJsonAsync<List<AssetRecord>>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.PatchAssets(body));
});

app.MapPut("/api/appdata/employees", async (AppDataService svc, HttpRequest req) =>
{
    List<EmployeeRecord>? body;
    try   { body = await req.ReadFromJsonAsync<List<EmployeeRecord>>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.PatchEmployees(body));
});

app.MapPut("/api/appdata/tickets", async (AppDataService svc, HttpRequest req) =>
{
    List<TicketRecord>? body;
    try   { body = await req.ReadFromJsonAsync<List<TicketRecord>>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.PatchTickets(body));
});

app.MapPut("/api/appdata/branches", async (AppDataService svc, HttpRequest req) =>
{
    List<string>? body;
    try   { body = await req.ReadFromJsonAsync<List<string>>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.PatchBranches(body));
});

app.MapPut("/api/appdata/assettypes", async (AppDataService svc, HttpRequest req) =>
{
    List<string>? body;
    try   { body = await req.ReadFromJsonAsync<List<string>>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.PatchAssetTypes(body));
});

app.MapPut("/api/appdata/activities", async (AppDataService svc, HttpRequest req) =>
{
    List<string>? body;
    try   { body = await req.ReadFromJsonAsync<List<string>>(); }
    catch { return Results.BadRequest(new { error = "Invalid JSON." }); }
    if (body is null) return Results.BadRequest(new { error = "Empty body." });
    return Results.Ok(svc.PatchActivities(body));
});

app.Run();
