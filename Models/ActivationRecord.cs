using System.Text.Json.Serialization;

namespace AssetManager.Models;

public class ActivationRecord
{
    [JsonPropertyName("activated")]  public bool         Activated   { get; set; }
    [JsonPropertyName("key")]        public string?      Key         { get; set; }
    [JsonPropertyName("expires")]    public string?      Expires     { get; set; }
    [JsonPropertyName("activatedAt")]public string?      ActivatedAt { get; set; }
    [JsonPropertyName("activatedBy")]public string?      ActivatedBy { get; set; }
    /// <summary>Every key ever successfully activated on this server — prevents re-use.</summary>
    [JsonPropertyName("usedKeys")]   public List<string>? UsedKeys   { get; set; }

    public static ActivationRecord Empty(List<string>? usedKeys) => new()
    {
        Activated   = false,
        Key         = null,
        Expires     = null,
        ActivatedAt = null,
        ActivatedBy = null,
        UsedKeys    = usedKeys
    };
}

public class ActivationRequest
{
    [JsonPropertyName("key")]        public string? Key         { get; set; }
    [JsonPropertyName("expires")]    public string? Expires     { get; set; }
    [JsonPropertyName("activatedBy")]public string? ActivatedBy { get; set; }
}
