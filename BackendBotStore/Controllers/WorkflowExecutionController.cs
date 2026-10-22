using System.Text.Json;
using System.Text.Json.Nodes;
using BackendBotStore.Data;      // <- namespace of your DbContext
using BackendBotStore.Entities;
using BackendBotStore.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WorkflowExecutionController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly WorkflowRunner _runner;

    public WorkflowExecutionController(ApplicationDbContext db, WorkflowRunner runner)
    {
        _db = db;
        _runner = runner;
    }

    [HttpGet]
    public async Task<IActionResult> GetPackages()
    {
        return Ok("");
    }

    /// <summary>
    /// Starts a saved workflow (looked up by its id in the Workflows table)
    /// and returns immediately with an execution id.
    /// Package DLL paths left blank in the workflow JSON are resolved from the Packages table
    /// (matched by package name) before the workflow is handed to the runner.
    /// </summary>
    [HttpPost("execute/{workflowId:int}")]
    public async Task<IActionResult> Execute(int workflowId)
    {
        var workflow = await _db.Workflows.AsNoTracking().FirstOrDefaultAsync(w => w.Id == workflowId);
        if (workflow is null)
            return NotFound(new { success = false, error = $"Workflow {workflowId} not found." });

        // 1. Resolve package DLL paths into the workflow JSON.
        string resolvedJson;
        try
        {
            var (json, missing) = await ResolvePackagePathsAsync(workflow.WorkflowJson);

            if (missing.Count > 0)
                return UnprocessableEntity(new
                {
                    success = false,
                    error = $"Package(s) not found or DLL missing on disk: {string.Join(", ", missing)}."
                });

            resolvedJson = json;
        }
        catch (JsonException)
        {
            return UnprocessableEntity(new { success = false, error = $"Stored JSON for workflow {workflowId} is invalid." });
        }

        // 2. Count actions from the resolved JSON.
        int totalActions;
        try
        {
            using var document = JsonDocument.Parse(resolvedJson);
            totalActions = CountActions(document.RootElement);
        }
        catch (JsonException)
        {
            return UnprocessableEntity(new { success = false, error = $"Stored JSON for workflow {workflowId} is invalid." });
        }

        var execution = new WorkflowExecutionStatus
        {
            // Snapshot of exactly what is being run (with resolved package paths),
            // even if the workflow is re-uploaded later.
            WorkflowJson = resolvedJson,
            Status = ExecutionState.Pending,
            TotalActions = totalActions
        };

        _db.WorkflowExecutions.Add(execution);
        await _db.SaveChangesAsync();

        _runner.Start(execution.Id, resolvedJson);

        return AcceptedAtAction(nameof(GetStatus), new { id = execution.Id }, new
        {
            executionId = execution.Id,
            workflowId = workflow.Id,
            workflowName = workflow.Name,
            workflowVersion = workflow.Version,
            status = execution.Status.ToString(),
            statusUrl = Url.Action(nameof(GetStatus), new { id = execution.Id })
        });
    }

    /// <summary>
    /// While Pending/Running: per-action status with inputs and outputs.
    /// Once finished: overall status, error (if any) and the output variables with their values.
    /// Add ?includeActions=true to also get the per-action detail for a finished run.
    /// </summary>
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetStatus(Guid id, [FromQuery] bool includeActions = false)
    {
        var execution = await _db.WorkflowExecutions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (execution is null)
            return NotFound(new { success = false, error = $"Execution '{id}' not found." });

        var inFlight = execution.Status is ExecutionState.Pending or ExecutionState.Running;

        object? actions = null;
        if (inFlight || includeActions)
        {
            var rows = await _db.WorkflowActionExecutions.AsNoTracking()
                .Where(a => a.WorkflowExecutionStatusId == id)
                .OrderBy(a => a.Sequence)
                .ToListAsync();

            actions = rows.Select(a => new
            {
                a.Sequence,
                a.ActionId,
                a.ClassName,
                a.FunctionName,
                status = a.Status.ToString(),
                inputs = ParseJson(a.InputsJson),
                outputs = ParseJson(a.OutputsJson),
                a.Error,
                a.StartedAtUtc,
                a.CompletedAtUtc,
                a.DurationMs
            });
        }

        if (inFlight)
        {
            return Ok(new
            {
                executionId = execution.Id,
                status = execution.Status.ToString(),
                execution.TotalActions,
                execution.CompletedActions,
                execution.StartedAtUtc,
                actions
            });
        }

        return Ok(new
        {
            executionId = execution.Id,
            status = execution.Status.ToString(),
            success = execution.Status == ExecutionState.Succeeded,
            error = execution.Error,
            failedActionId = execution.FailedActionId,
            execution.TotalActions,
            execution.CompletedActions,
            execution.StartedAtUtc,
            execution.CompletedAtUtc,
            execution.DurationMs,
            outputs = ParseJson(execution.OutputsJson),   // variable name -> value
            actions                                       // null unless includeActions=true
        });
    }

    // ── helpers ──────────────────────────────────────────────

    /// <summary>
    /// Looks at the "packages" object of the workflow JSON. Every key is treated as a Package name;
    /// it is matched against Packages.Name and its value is replaced with the package's FilePath (DLL path).
    /// If several versions of a package exist, the most recently registered one (highest Id) is used.
    /// Returns the rewritten JSON plus the names that could not be resolved.
    /// </summary>
    private async Task<(string Json, List<string> Missing)> ResolvePackagePathsAsync(string workflowJson)
    {
        var missing = new List<string>();

        if (JsonNode.Parse(workflowJson) is not JsonObject root)
            return (workflowJson, missing);

        // Find the "packages" property (case-insensitive).
        string? packagesKey = null;
        foreach (var prop in root)
        {
            if (string.Equals(prop.Key, "packages", StringComparison.OrdinalIgnoreCase))
            {
                packagesKey = prop.Key;
                break;
            }
        }

        if (packagesKey is null || root[packagesKey] is not JsonObject packages)
            return (workflowJson, missing);   // no packages section, nothing to resolve

        // Collect package names, skipping legacy metadata keys.
        var packageNames = new List<string>();
        foreach (var prop in packages)
        {
            var key = prop.Key;
            if (string.IsNullOrWhiteSpace(key)) continue;
            if (string.Equals(key, "name", StringComparison.OrdinalIgnoreCase)) continue;
            if (string.Equals(key, "ClassName", StringComparison.OrdinalIgnoreCase)) continue;
            packageNames.Add(key);
        }

        if (packageNames.Count == 0)
            return (workflowJson, missing);

        var found = await _db.Packages.AsNoTracking()
            .Where(p => packageNames.Contains(p.Name))
            .Select(p => new { p.Id, p.Name, p.FilePath })
            .ToListAsync();

        var latestByName = found
            .GroupBy(p => p.Name)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.Id).First().FilePath);

        foreach (var name in packageNames)
        {
            if (!latestByName.TryGetValue(name, out var path) ||
                string.IsNullOrWhiteSpace(path) ||
                !System.IO.File.Exists(path))
            {
                missing.Add(name);
                continue;
            }

            packages[name] = path;
        }

        return (root.ToJsonString(), missing);
    }

    private static JsonElement? ParseJson(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<JsonElement>(json);

    private static int CountActions(JsonElement workflow)
    {
        if (workflow.ValueKind != JsonValueKind.Object) return 0;

        foreach (var property in workflow.EnumerateObject())
        {
            if (property.Name.Equals("Actions", StringComparison.OrdinalIgnoreCase) &&
                property.Value.ValueKind == JsonValueKind.Object)
                return property.Value.EnumerateObject().Count();
        }
        return 0;
    }
}