namespace backend.Entities;
using System.ComponentModel.DataAnnotations;




// Local persisted copy of a user's GitHub repository, refreshed each time
// GET /api/GitHub/repositories runs. Named "Record" (not "GitHubRepository")
// to avoid colliding with backend.Services.GitHubRepository, which is the
// DTO used to deserialize GitHub's API response.
public class GitHubRepositoryRecord
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid UserId { get; set; }

    // GitHub's own numeric repo id — used to match existing rows on refresh.
    [Required]
    public long GitHubRepoId { get; set; }

    [Required]
    public string Name { get; set; } = string.Empty;

    [Required]
    public string FullName { get; set; } = string.Empty;

    public string? Description { get; set; }

    [Required]
    public string HtmlUrl { get; set; } = string.Empty;

    public bool IsPrivate { get; set; }

    public string? Language { get; set; }

    public int StargazersCount { get; set; }

    public int ForksCount { get; set; }

    // "Updated at" as reported by GitHub for the repo itself.
    public DateTime? RepoUpdatedAt { get; set; }

    // When we last synced this row from the GitHub API.
    public DateTime FetchedAt { get; set; } = DateTime.UtcNow;
}