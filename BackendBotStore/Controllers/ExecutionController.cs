using System.Diagnostics;
using System.Text.Json;
using BackendBotStore.Data;
using BackendBotStore.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

/// <summary>
/// Runs ONE action of a registered package, on its own. It uses the same engine as a workflow run
/// (WorkflowExecutor): packages come from the Packages table, {{variables}} are resolved, arguments are converted
/// to the method's parameter types, and the DLL is loaded the same way.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ExecutionController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly WorkflowExecutor _executor;      // registered as Transient: one run's state per request
    private readonly IConfiguration _config;

    public ExecutionController(ApplicationDbContext db, WorkflowExecutor executor, IConfiguration config)
    {
        _db = db;
        _executor = executor;
        _config = config;
    }

    // ---------- Request model ----------
    public class ExecuteRequest
    {
        /// <summary>Package name, exactly as an action's ClassName in a workflow (e.g. "NotificationWindow").</summary>
        public string ClassName { get; set; } = "";

        public string FunctionName { get; set; } = "";

        /// <summary>
        /// Optional. Selects one registered version of the package; it must be the path of a registered package.
        /// Without ClassName, the package that owns this DLL is used. Arbitrary DLLs are never loaded.
        /// </summary>
        public string? DllPath { get; set; }

        /// <summary>Parameter name -> literal value or "{{variable}}".</summary>
        public Dictionary<string, JsonElement>? Inputs { get; set; }

        /// <summary>
        /// Optional values for the {{variables}} used in Inputs, same shape as a workflow's "variables":
        /// { "age": { "value": 34, "type": "NUMBER" } }.
        /// </summary>
        public Dictionary<string, WorkflowVariable>? Variables { get; set; }
    }

    // ---------- Endpoint ----------
    [HttpPost("execute")]
    public async Task<IActionResult> Execute([FromBody] ExecuteRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.FunctionName))
            return BadRequest(new { success = false, error = "FunctionName is required." });

        if (string.IsNullOrWhiteSpace(req.ClassName) && string.IsNullOrWhiteSpace(req.DllPath))
            return BadRequest(new { success = false, error = "ClassName (the package name) or DllPath is required." });

        if (req.ClassName.Equals(WorkflowExecutor.CorePackage, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, error = "Core actions (If, loops, variables ...) run only inside a workflow." });

        // 1. Find the registered package (same table the workflow controller resolves packages from).
        var (package, dllFull, problem) = await FindPackageAsync(req, ct);
        if (problem is not null) return problem;

        // 2. Run it through the workflow engine.
        _executor.AllowedPackageRoot = _config["Workflow:PackageRoot"];
        _executor.Cancellation = ct;

        var capture = new CaptureListener();
        _executor.Listener = capture;

        var stopwatch = Stopwatch.StartNew();
        bool ok;
        try
        {
            ok = await Task.Run(() => _executor.ExecuteSingleAction(
                package!.Name, dllFull!, req.FunctionName, req.Inputs, req.Variables), ct);
        }
        catch (OperationCanceledException)
        {
            return StatusCode(499, new { success = false, error = "Request was cancelled." });
        }
        stopwatch.Stop();

        // Inputs as the action received them (after {{variable}} resolution); secret-looking keys are masked.
        var inputs = capture.Inputs is null ? (JsonElement?)null : ToElement(WorkflowJson.SerializeMap(capture.Inputs));

        if (!ok)
        {
            return UnprocessableEntity(new
            {
                success = false,
                error = _executor.LastError,
                inputs,
                logs = _executor.Logs,
                durationMs = stopwatch.ElapsedMilliseconds
            });
        }

        return Ok(new
        {
            success = true,
            data = ToData(_executor.LastActionResult),
            inputs,
            logs = _executor.Logs,
            durationMs = stopwatch.ElapsedMilliseconds
        });
    }

    // ---------- helpers ----------

    /// <summary>
    /// Matches the request to a registered package: by name (latest registered version, or the version whose
    /// DLL path was supplied), or, when no name is given, by DLL path.
    /// </summary>
    private async Task<(PackageRef? Package, string? DllFull, IActionResult? Problem)> FindPackageAsync(
        ExecuteRequest req, CancellationToken ct)
    {
        var all = await _db.Packages.AsNoTracking()
            .Select(p => new PackageRef(p.Id, p.Name, p.FilePath))
            .ToListAsync(ct);

        string? wantedPath = string.IsNullOrWhiteSpace(req.DllPath) ? null : NormalizePath(req.DllPath);

        PackageRef? package;
        if (!string.IsNullOrWhiteSpace(req.ClassName))
        {
            var byName = all
                .Where(p => p.Name.Equals(req.ClassName.Trim(), StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(p => p.Id)
                .ToList();

            if (byName.Count == 0)
                return (null, null, NotFound(new { success = false, error = $"Package '{req.ClassName}' is not registered." }));

            package = wantedPath is null
                ? byName[0]
                : byName.FirstOrDefault(p => NormalizePath(p.FilePath) == wantedPath);

            if (package is null)
                return (null, null, BadRequest(new
                {
                    success = false,
                    error = $"DllPath does not match any registered version of package '{req.ClassName}'."
                }));
        }
        else
        {
            package = all.OrderByDescending(p => p.Id).FirstOrDefault(p => NormalizePath(p.FilePath) == wantedPath);
            if (package is null)
                return (null, null, NotFound(new { success = false, error = "No registered package uses that DllPath." }));
        }

        if (string.IsNullOrWhiteSpace(package.FilePath))
            return (null, null, NotFound(new { success = false, error = $"Package '{package.Name}' has no DLL path." }));

        var dllFull = NormalizePath(package.FilePath);

        // Optional extra guard: only DLLs below Execution:AllowedDllRoot, when it is configured.
        var allowedRoot = _config["Execution:AllowedDllRoot"];
        if (!string.IsNullOrWhiteSpace(allowedRoot))
        {
            var root = Path.GetFullPath(allowedRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!dllFull.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                return (null, null, BadRequest(new { success = false, error = "DLL path is outside the allowed directory." }));
        }

        if (!System.IO.File.Exists(dllFull))
            return (null, null, NotFound(new { success = false, error = $"DLL not found: {dllFull}" }));

        return (package, dllFull, null);
    }

    /// <summary>Absolute path, resolved against the same base folder the executor uses for relative paths.</summary>
    private static string NormalizePath(string path) => Path.GetFullPath(path, AppContext.BaseDirectory);

    /// <summary>
    /// The action's return value as JSON. A string that already holds a JSON object/array is returned as real JSON;
    /// DataTable / DataRow become { type, rowCount, headers, rows } / an object; unserialisable values are described.
    /// </summary>
    private static JsonElement ToData(object? result)
    {
        if (result is string s)
        {
            var trimmed = s.TrimStart();
            if (trimmed.StartsWith('{') || trimmed.StartsWith('['))
            {
                try
                {
                    using var doc = JsonDocument.Parse(s);
                    return doc.RootElement.Clone();
                }
                catch (JsonException) { /* plain text: fall through */ }
            }
        }

        return ToElement(WorkflowJson.Serialize(result));
    }

    private static JsonElement ToElement(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private sealed record PackageRef(long Id, string Name, string FilePath);

    /// <summary>Remembers the inputs of the action after {{variables}} were resolved.</summary>
    private sealed class CaptureListener : IWorkflowProgressListener
    {
        public IReadOnlyDictionary<string, object?>? Inputs { get; private set; }

        public void ActionStarted(string actionId, int sequence, WorkflowAction action) { }
        public void ActionInputsResolved(string actionId, IReadOnlyDictionary<string, object?> inputs) =>
            Inputs = new Dictionary<string, object?>(inputs);
        public void ActionCompleted(string actionId, IReadOnlyDictionary<string, object?> outputs) { }
        public void ActionFailed(string actionId, string error) { }
    }
}