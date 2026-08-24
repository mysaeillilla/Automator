using System.Security.Claims;
using backend.Data;
using backend.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GithubRepositoryList : ControllerBase
{
    
     private readonly ApplicationDbContext _context; // adjust to your actual DbContext name

    public GithubRepositoryList(ApplicationDbContext context)
    {
        _context = context;
    }

    // GET /api/GitHub/repositories
    // Returns all locally persisted repo records for the current user.
    [HttpGet("repositories")]
    public async Task<ActionResult<IEnumerable<GitHubRepositoryRecord>>> GetRepositories()
    {
        var userId = GetUserId();
        if (userId == null)
            return Unauthorized();

        var repositories = await _context.GitHubRepositories
            .Where(r => r.UserId == userId.Value)
            .OrderByDescending(r => r.RepoUpdatedAt)
            .ToListAsync();

        return Ok(repositories);
    }

    // GET /api/GitHub/repositories/{id}
    // Returns a single repo record by its local Id, scoped to the current user.
    [HttpGet("repositories/{id:guid}")]
    public async Task<ActionResult<GitHubRepositoryRecord>> GetRepository(Guid id)
    {
        var userId = GetUserId();
        if (userId == null)
            return Unauthorized();

        var repository = await _context.GitHubRepositories
            .FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId.Value);

        if (repository == null)
            return NotFound();

        return Ok(repository);
    }

    private Guid? GetUserId()
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                    ?? User.FindFirst("sub")?.Value; // adjust to whatever claim your interceptor/token uses

        return Guid.TryParse(claim, out var userId) ? userId : null;
    }
}
