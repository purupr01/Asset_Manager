using System.Text.Json.Serialization;

namespace AssetManager.Models;

public class UserRecord
{
    [JsonPropertyName("id")]           public string Id           { get; set; } = "";
    [JsonPropertyName("username")]     public string Username     { get; set; } = "";
    [JsonPropertyName("passwordHash")] public string PasswordHash { get; set; } = "";
    [JsonPropertyName("fullName")]     public string FullName     { get; set; } = "";
    [JsonPropertyName("email")]        public string Email        { get; set; } = "";
    [JsonPropertyName("role")]         public string Role         { get; set; } = "viewer";
    [JsonPropertyName("active")]       public bool   Active       { get; set; } = true;
    [JsonPropertyName("createdAt")]    public string CreatedAt    { get; set; } = "";
}

public class LoginRequest
{
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("password")] public string? Password { get; set; }
}

public class UserSaveRequest
{
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("fullName")] public string? FullName { get; set; }
    [JsonPropertyName("email")]    public string? Email    { get; set; }
    [JsonPropertyName("role")]     public string? Role     { get; set; }
    [JsonPropertyName("active")]   public bool    Active   { get; set; } = true;
    [JsonPropertyName("password")] public string? Password { get; set; }
}
