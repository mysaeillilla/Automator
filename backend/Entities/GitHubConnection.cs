using backend.Entities;

namespace backend.Models;

public class GitHubConnection
{
    public int Id { get; set; }

    public Guid UserId { get; set; }
    public Users User { get; set; } = null!;

    public string EncryptedAccessToken { get; set; } = string.Empty;
    public string? GitHubUsername { get; set; }
    public string? Scope { get; set; }

    public DateTime ConnectedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class GitHubExchangeRequest
{
    public string Code { get; set; } = "";
    public string State { get; set; } = "";
}