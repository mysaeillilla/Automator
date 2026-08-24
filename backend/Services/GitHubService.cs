using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using backend.Data;
using backend.Entities;
using backend.Models;

namespace backend.Services;

public class GitHubService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ApplicationDbContext _context;
    private readonly IDataProtector _tokenProtector;
    private readonly IDataProtector _stateProtector;

    public GitHubService(
        HttpClient httpClient,
        IConfiguration configuration,
        ApplicationDbContext context,
        IDataProtectionProvider dataProtectionProvider)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _context = context;
        _tokenProtector = dataProtectionProvider.CreateProtector("GitHub.AccessToken.v1");
        _stateProtector = dataProtectionProvider.CreateProtector("GitHub.OAuthState.v1");
    }

    // --- Authorization URL now embeds a signed state so callback knows the user ---
    public string GetAuthorizationUrl(Guid userId)
    {
        var clientId = _configuration["GitHub:ClientId"];
        var callbackUrl = _configuration["GitHub:CallbackUrl"];

        var statePayload = $"{userId}|{DateTime.UtcNow:O}";
        var state = Uri.EscapeDataString(_stateProtector.Protect(statePayload));

        var url =
            "https://github.com/login/oauth/authorize" +
            $"?client_id={Uri.EscapeDataString(clientId!)}" +
            $"&redirect_uri={Uri.EscapeDataString(callbackUrl!)}" +
            "&scope=repo" +
            $"&state={state}";

        return url;
    }

    public Guid? TryResolveUserIdFromState(string state, TimeSpan maxAge)
    {
        try
        {
            var payload = _stateProtector.Unprotect(Uri.UnescapeDataString(state));
            var parts = payload.Split('|');
            if (parts.Length != 2) return null;
            if (!Guid.TryParse(parts[0], out var userId)) return null;
            if (!DateTime.TryParse(parts[1], out var issuedAt)) return null;
            if (DateTime.UtcNow - issuedAt > maxAge) return null;

            return userId;
        }
        catch
        {
            return null; // tampered or invalid — reject
        }
    }

    public async Task<GitHubTokenResponse?> ExchangeCodeForTokenAsync(string code)
    {
        var clientId = _configuration["GitHub:ClientId"];
        var clientSecret = _configuration["GitHub:ClientSecret"];

        var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://github.com/login/oauth/access_token"
        );

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var body = new
        {
            client_id = clientId,
            client_secret = clientSecret,
            code = code
        };

        request.Content = JsonContent.Create(body);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<GitHubTokenResponse>();
    }

    public async Task<string?> GetGitHubUsernameAsync(string accessToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.UserAgent.ParseAdd("Automator");

        var response = await _httpClient.SendAsync(request);
        if (!response.IsSuccessStatusCode) return null;

        var json = await response.Content.ReadFromJsonAsync<Dictionary<string, object>>();
        return json != null && json.TryGetValue("login", out var login) ? login.ToString() : null;
    }

    public async Task<List<GitHubRepository>> GetRepositoriesAsync(string accessToken)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Get,
            "https://api.github.com/user/repos?per_page=100"
        );

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.UserAgent.ParseAdd("Automator");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2026-03-10");

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var repositories = await response.Content.ReadFromJsonAsync<List<GitHubRepository>>();
        return repositories ?? [];
    }

    // --- Persistence ---
    public async Task SaveConnectionAsync(Guid userId, string accessToken, string? scope, string? githubUsername)
    {
        var encrypted = _tokenProtector.Protect(accessToken);

        var existing = await _context.GitHubConnections.FirstOrDefaultAsync(c => c.UserId == userId);
        if (existing != null)
        {
            existing.EncryptedAccessToken = encrypted;
            existing.Scope = scope;
            existing.GitHubUsername = githubUsername;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _context.GitHubConnections.Add(new GitHubConnection
            {
                UserId = userId,
                EncryptedAccessToken = encrypted,
                Scope = scope,
                GitHubUsername = githubUsername,
                ConnectedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync();
    }

    public async Task<string?> GetStoredTokenAsync(Guid userId)
    {
        var connection = await _context.GitHubConnections
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.UserId == userId);

        if (connection == null) return null;

        try
        {
            return _tokenProtector.Unprotect(connection.EncryptedAccessToken);
        }
        catch
        {
            return null; // Data Protection key rotated/corrupted — treat as disconnected
        }
    }

    public async Task<GitHubConnection?> GetConnectionStatusAsync(Guid userId) =>
        await _context.GitHubConnections.AsNoTracking().FirstOrDefaultAsync(c => c.UserId == userId);

    public async Task DisconnectAsync(Guid userId)
    {
        var connection = await _context.GitHubConnections.FirstOrDefaultAsync(c => c.UserId == userId);
        if (connection != null)
        {
            _context.GitHubConnections.Remove(connection);
            await _context.SaveChangesAsync();
        }
    }

    // =========================================================
    // Persist the given repositories as this user's current set.
    // Upserts anything returned by GitHub, and removes local rows
    // for repos that are no longer returned (deleted / access revoked).
    // =========================================================
    public async Task SaveRepositoriesAsync(Guid userId, List<GitHubRepository> repositories)
    {
        var existing = await _context.GitHubRepositories
            .Where(r => r.UserId == userId)
            .ToListAsync();

        var existingByRepoId = existing.ToDictionary(r => r.GitHubRepoId);
        var incomingRepoIds = repositories.Select(r => r.Id).ToHashSet();

        foreach (var repo in repositories)
        {
            if (existingByRepoId.TryGetValue(repo.Id, out var record))
            {
                record.Name = repo.Name;
                record.FullName = repo.FullName;
                record.Description = repo.Description;
                record.HtmlUrl = repo.HtmlUrl;
                record.IsPrivate = repo.Private;
                record.Language = repo.Language;
                record.StargazersCount = repo.StargazersCount;
                record.ForksCount = repo.ForksCount;
                record.RepoUpdatedAt = repo.UpdatedAt;
                record.FetchedAt = DateTime.UtcNow;
            }
            else
            {
                _context.GitHubRepositories.Add(new GitHubRepositoryRecord
                {
                    UserId = userId,
                    GitHubRepoId = repo.Id,
                    Name = repo.Name,
                    FullName = repo.FullName,
                    Description = repo.Description,
                    HtmlUrl = repo.HtmlUrl,
                    IsPrivate = repo.Private,
                    Language = repo.Language,
                    StargazersCount = repo.StargazersCount,
                    ForksCount = repo.ForksCount,
                    RepoUpdatedAt = repo.UpdatedAt,
                    FetchedAt = DateTime.UtcNow
                });
            }
        }

        var stale = existing.Where(r => !incomingRepoIds.Contains(r.GitHubRepoId));
        _context.GitHubRepositories.RemoveRange(stale);

        await _context.SaveChangesAsync();
    }
}

public class GitHubTokenResponse
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; set; } = "";

    [JsonPropertyName("token_type")]
    public string TokenType { get; set; } = "";

    [JsonPropertyName("scope")]
    public string Scope { get; set; } = "";
}

public class GitHubRepository
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    [JsonPropertyName("full_name")]
    public string FullName { get; set; } = "";
    [JsonPropertyName("html_url")]
    public string HtmlUrl { get; set; } = "";
    [JsonPropertyName("clone_url")]
    public string CloneUrl { get; set; } = "";
    [JsonPropertyName("ssh_url")]
    public string SshUrl { get; set; } = "";
    [JsonPropertyName("default_branch")]
    public string DefaultBranch { get; set; } = "";
    public bool Private { get; set; }
    public string? Description { get; set; }
    public GitHubOwner? Owner { get; set; }

    [JsonPropertyName("stargazers_count")]
    public int StargazersCount { get; set; }
    [JsonPropertyName("forks_count")]
    public int ForksCount { get; set; }
    public string? Language { get; set; }
    [JsonPropertyName("updated_at")]
    public DateTime? UpdatedAt { get; set; }
}

public class GitHubOwner
{
    public string Login { get; set; } = "";
}