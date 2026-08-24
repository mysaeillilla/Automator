using System.Security.Claims;
using backend.Models;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GitHubController : ControllerBase
{
    private readonly GitHubService _githubService;
    private readonly IConfiguration _config;

    public GitHubController(GitHubService githubService, IConfiguration config)
    {
        _githubService = githubService;
        _config = config;
    }

    private Guid GetUserId()
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier) ?? User.FindFirst("sub");
        if (claim == null || !Guid.TryParse(claim.Value, out var userId))
            throw new UnauthorizedAccessException("Missing or invalid user id claim in token.");
        return userId;
    }

    [Authorize]
    [HttpGet("connect")]
    public IActionResult Connect()
    {
        var userId = GetUserId();
        var authorizationUrl = _githubService.GetAuthorizationUrl(userId);
        return Ok(new { url = authorizationUrl });
    }

    // Not [Authorize] — this is GitHub's own browser redirect, no JWT available.
    // User identity comes from the signed "state" param instead.
    [HttpGet("callback")]
    public async Task<IActionResult> Callback([FromQuery] string code, [FromQuery] string state)
    {
        var frontendBase = _config["Frontend:BaseUrl"];

        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
            return Redirect($"{frontendBase}/settings/github?error=missing_params");

        var userId = _githubService.TryResolveUserIdFromState(state, TimeSpan.FromMinutes(10));
        if (userId == null)
            return Redirect($"{frontendBase}/settings/github?error=invalid_state");

        var tokenResponse = await _githubService.ExchangeCodeForTokenAsync(code);
        if (string.IsNullOrWhiteSpace(tokenResponse?.AccessToken))
            return Redirect($"{frontendBase}/settings/github?error=token_exchange_failed");

        var githubUsername = await _githubService.GetGitHubUsernameAsync(tokenResponse.AccessToken);

        await _githubService.SaveConnectionAsync(
            userId.Value,
            tokenResponse.AccessToken,
            tokenResponse.Scope,
            githubUsername
        );

        return Redirect($"{frontendBase}/settings/github?connected=true");
    }

    // =========================================================
    // GET: api/GitHub/repositories
    // Fetches the user's repos from GitHub and persists/refreshes
    // the stored copy for that user, if connected.
    // =========================================================

    [Authorize]
    [HttpGet("repositories")]
    public async Task<IActionResult> GetRepositories()
    {
        var userId = GetUserId();
        var token = await _githubService.GetStoredTokenAsync(userId);

        if (token == null)
            return Unauthorized(new { message = "GitHub not connected. Please connect your account first." });

        var repositories = await _githubService.GetRepositoriesAsync(token);

        // Fetch from GitHub is the source of truth for the response; persistence
        // failures shouldn't block returning live data to the caller.
        try
        {
            await _githubService.SaveRepositoriesAsync(userId, repositories);
        }
        catch (Exception ex)
        {
            // Replace with your logger of choice.
            Console.Error.WriteLine($"Failed to persist GitHub repositories for user {userId}: {ex}");
        }

        return Ok(repositories);
    }

    [Authorize]
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus()
    {
        var userId = GetUserId();
        var connection = await _githubService.GetConnectionStatusAsync(userId);

        return Ok(new
        {
            connected = connection != null,
            githubUsername = connection?.GitHubUsername,
            connectedAt = connection?.ConnectedAt
        });
    }

    // Called by the Angular app when GitHub's OAuth callback URL is set to the frontend route.
    // Same logic as Callback(), but returns JSON instead of redirecting.
    [Authorize]
    [HttpPost("exchange")]
    public async Task<IActionResult> Exchange([FromBody] GitHubExchangeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Code) || string.IsNullOrWhiteSpace(request.State))
            return BadRequest(new { message = "Missing code or state." });

        var userIdFromState = _githubService.TryResolveUserIdFromState(request.State, TimeSpan.FromMinutes(10));
        if (userIdFromState == null)
            return BadRequest(new { message = "Invalid or expired GitHub authorization request." });

        // Defense-in-depth: state must belong to the currently logged-in user
        var currentUserId = GetUserId();
        if (userIdFromState != currentUserId)
            return Unauthorized(new { message = "State does not match the current session." });

        var tokenResponse = await _githubService.ExchangeCodeForTokenAsync(request.Code);
        if (string.IsNullOrWhiteSpace(tokenResponse?.AccessToken))
            return BadRequest(new { message = "Unable to obtain GitHub access token." });

        var githubUsername = await _githubService.GetGitHubUsernameAsync(tokenResponse.AccessToken);

        await _githubService.SaveConnectionAsync(
            currentUserId,
            tokenResponse.AccessToken,
            tokenResponse.Scope,
            githubUsername
        );

        return Ok(new { connected = true, githubUsername });
    }

    [Authorize]
    [HttpDelete("disconnect")]
    public async Task<IActionResult> Disconnect()
    {
        var userId = GetUserId();
        await _githubService.DisconnectAsync(userId);
        return NoContent();
    }
}