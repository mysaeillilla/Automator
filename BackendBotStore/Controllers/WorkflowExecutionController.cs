using System.Text.Json;
using System.Text.Json.Nodes;
using BackendBotStore.Data;      // <- namespace of your DbContext
using BackendBotStore.Entities;
using BackendBotStore.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

/// <summary>Describes one built-in "Core" action so the designer can render it and its child blocks.</summary>
public sealed record CoreActionInfo(
    string Name,
    string Description,
    Dictionary<string, string> Inputs,
    Dictionary<string, string> Outputs,
    string[] Blocks,
    bool HasCondition);

[ApiController]
[Route("api/[controller]")]
public class WorkflowExecutionController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly WorkflowRunner _runner;

    /// <summary>Child-action lists a Core action can contain. Used to count nested actions.</summary>
    private static readonly string[] BlockProperties = { "Body", "Then", "Else", "Catch" };

    private static readonly CoreActionInfo[] CoreActions =
    {
        new("SetVariable", "Assigns a value to a variable.",
            new() { ["Value"] = "ANY" }, new() { ["Response"] = "ANY" }, Array.Empty<string>(), false),

        new("Evaluate", "Evaluates an expression over the workflow variables, e.g. \"count + 1\".",
            new() { ["Expression"] = "STRING" }, new() { ["Response"] = "ANY" }, Array.Empty<string>(), false),

        new("If", "Runs Then when the condition is true, otherwise Else.",
            new(), new(), new[] { "Then", "Else" }, true),

        new("ForEach", "Loops over a list, dictionary, data table or JSON array/object.",
            new() { ["Collection"] = "ANY" },
            new() { ["Item"] = "ANY", ["Index"] = "NUMBER", ["Key"] = "ANY" },
            new[] { "Body" }, false),

        new("ForCount", "Loops from From to To (inclusive) by Step.",
            new() { ["From"] = "NUMBER", ["To"] = "NUMBER", ["Step"] = "NUMBER" },
            new() { ["Index"] = "NUMBER" },
            new[] { "Body" }, false),

        new("While", "Repeats Body while the condition is true.",
            new(), new(), new[] { "Body" }, true),

        new("Break", "Exits the innermost loop.", new(), new(), Array.Empty<string>(), false),
        new("Continue", "Skips to the next iteration of the innermost loop.", new(), new(), Array.Empty<string>(), false),
        new("Return", "Stops the workflow successfully.", new(), new(), Array.Empty<string>(), false),

        new("TryCatch", "Runs Body; if an action fails, stores the message in Error and runs Catch.",
            new(), new() { ["Error"] = "STRING" }, new[] { "Body", "Catch" }, false),

        new("Fail", "Fails the workflow (or the enclosing TryCatch) with a message.",
            new() { ["Message"] = "STRING" }, new(), Array.Empty<string>(), false),
    };

    public WorkflowExecutionController(ApplicationDbContext db, WorkflowRunner runner)
    {
        _db = db;
        _runner = runner;
    }

    /// <summary>
    /// Lists the registered packages (id and name only; DLL paths are not exposed).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetPackages()
    {
        var packages = await _db.Packages.AsNoTracking()
            .OrderBy(p => p.Name)
            .ThenByDescending(p => p.Id)
            .Select(p => new { p.Id, p.Name })
            .ToListAsync();

        return Ok(packages);
    }

    /// <summary>
    /// Built-in control actions (ClassName "Core"). They need no DLL and must not be listed under "packages".
    /// </summary>
    [HttpGet("core")]
    public IActionResult GetCoreActions() => Ok(new { package = WorkflowExecutor.CorePackage, actions = CoreActions });

    /// <summary>
    /// Starts a saved workflow (looked up by its id in the Workflows table)
    /// and returns immediately with an execution id.
    /// Every key under "packages" in the workflow JSON is a package name; its value is replaced
    /// with the DLL path from the Packages table (matched by name) before the workflow is handed
    /// to the runner. Each non-Core action's "ClassName" refers to one of these package names;
    /// "Core" actions are built in and need no package.
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

        // 2. Count actions (including nested ones) from the resolved JSON.
        //    With loops this is the number of steps defined, not the number that will execute.
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
    /// Action ids are paths: "3" (top level), "3[2].1" (2nd-index iteration of loop 3, first child),
    /// "4.then.1" / "4.else.1" (If branches), "5.try.1" / "5.catch.1" (TryCatch).
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

    private static bool IsCoreName(string name) =>
        name.Equals(WorkflowExecutor.CorePackage, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Looks at the "packages" object of the workflow JSON. Every key is treated as a package name;
    /// it is matched against Packages.Name and its value is replaced with the package's DLL path
    /// (normalized to an absolute path, the same way the executor resolves it).
    /// If several versions of a package exist, the most recently registered one (highest Id) is used.
    /// The built-in "Core" package is not looked up: if present it is removed from the section,
    /// because the executor handles Core actions itself.
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

        // Core is built in: drop it so it is never treated as a missing DLL.
        var coreKeys = packages
            .Select(p => p.Key)
            .Where(IsCoreName)
            .ToList();

        foreach (var key in coreKeys)
            packages.Remove(key);

        // Every remaining key is a package name.
        var packageNames = packages
            .Select(p => p.Key)
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .ToList();

        if (packageNames.Count == 0)
            return (coreKeys.Count > 0 ? root.ToJsonString() : workflowJson, missing);

        var found = await _db.Packages.AsNoTracking()
            .Where(p => packageNames.Contains(p.Name))
            .Select(p => new { p.Id, p.Name, p.FilePath })
            .ToListAsync();

        var latestByName = found
            .GroupBy(p => p.Name)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.Id).First().FilePath);

        foreach (var name in packageNames)
        {
            if (!latestByName.TryGetValue(name, out var path) || string.IsNullOrWhiteSpace(path))
            {
                missing.Add(name);
                continue;
            }

            // Same base the executor uses for relative paths, so the check and the load agree.
            var fullPath = Path.GetFullPath(path, AppContext.BaseDirectory);

            if (!System.IO.File.Exists(fullPath))
            {
                missing.Add(name);
                continue;
            }

            packages[name] = fullPath;
        }

        return (root.ToJsonString(), missing);
    }

    private static JsonElement? ParseJson(string? json) =>
        string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<JsonElement>(json);

    /// <summary>Counts every action in the workflow, including those nested in Body / Then / Else / Catch.</summary>
    private static int CountActions(JsonElement workflow)
    {
        if (workflow.ValueKind != JsonValueKind.Object) return 0;

        foreach (var property in workflow.EnumerateObject())
        {
            if (property.Name.Equals("Actions", StringComparison.OrdinalIgnoreCase))
                return CountActionList(property.Value);
        }
        return 0;
    }

    /// <summary>Accepts the new array form and the legacy {"1": {...}, "2": {...}} object form.</summary>
    private static int CountActionList(JsonElement list) => list.ValueKind switch
    {
        JsonValueKind.Array  => list.EnumerateArray().Sum(CountActionNode),
        JsonValueKind.Object => list.EnumerateObject().Sum(p => CountActionNode(p.Value)),
        _ => 0
    };

    private static int CountActionNode(JsonElement action)
    {
        if (action.ValueKind != JsonValueKind.Object) return 0;

        var count = 1;
        foreach (var property in action.EnumerateObject())
        {
            if (BlockProperties.Any(b => b.Equals(property.Name, StringComparison.OrdinalIgnoreCase)))
                count += CountActionList(property.Value);
        }
        return count;
    }
}