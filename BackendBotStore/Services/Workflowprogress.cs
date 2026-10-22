using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using BackendBotStore.Data;      // <- namespace of your DbContext (rename ApplicationDbContext below to match)
using BackendBotStore.Entities;

namespace BackendBotStore.Services;

// ─────────────────────────────────────────────────────────────
//  Callbacks raised by WorkflowExecutor while a run is in flight
// ─────────────────────────────────────────────────────────────

public interface IWorkflowProgressListener
{
    void ActionStarted(string actionId, int sequence, WorkflowAction action);
    void ActionInputsResolved(string actionId, IReadOnlyDictionary<string, object?> inputs);
    void ActionCompleted(string actionId, IReadOnlyDictionary<string, object?> outputs);
    void ActionFailed(string actionId, string error);
}

// ─────────────────────────────────────────────────────────────
//  Safe JSON helper for storing arbitrary inputs / outputs
// ─────────────────────────────────────────────────────────────

public static class WorkflowJson
{
    private const int MaxCharsPerValue = 100_000;

    private static readonly JsonSerializerOptions Options = new()
    {
        ReferenceHandler = ReferenceHandler.IgnoreCycles,
        MaxDepth = 64
    };

    // Top-level keys that look like secrets are masked before anything is stored.
    private static readonly Regex SecretKey =
        new("pass(word)?|secret|token|api[_-]?key|credential", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Serializes one value; never throws, and replaces huge or unserializable values with a marker.</summary>
    public static string Serialize(object? value)
    {
        if (value is null) return "null";

        try
        {
            var json = JsonSerializer.Serialize(value, Options);
            return json.Length <= MaxCharsPerValue
                ? json
                : JsonSerializer.Serialize(new { _truncated = true, length = json.Length, type = value.GetType().Name });
        }
        catch (Exception)
        {
            return JsonSerializer.Serialize(new { _notSerializable = true, type = value.GetType().FullName });
        }
    }

    /// <summary>Serializes name -> value pairs, limiting and masking each value on its own.</summary>
    public static string SerializeMap(IEnumerable<KeyValuePair<string, object?>> map)
    {
        var result = new Dictionary<string, JsonElement>();
        foreach (var (key, value) in map)
        {
            var safe = SecretKey.IsMatch(key) ? "***" : value;
            result[key] = JsonSerializer.Deserialize<JsonElement>(Serialize(safe));
        }
        return JsonSerializer.Serialize(result);
    }
}

// ─────────────────────────────────────────────────────────────
//  Listener that writes progress to the database as it happens
// ─────────────────────────────────────────────────────────────

public sealed class DbWorkflowProgressListener : IWorkflowProgressListener
{
    private readonly ApplicationDbContext _db;
    private readonly WorkflowExecutionStatus _execution;
    private readonly Dictionary<string, WorkflowActionExecutionStatus> _rows = new();

    public string? FailedActionId { get; private set; }

    public DbWorkflowProgressListener(ApplicationDbContext db, WorkflowExecutionStatus execution)
    {
        _db = db;
        _execution = execution;
    }

    public void ActionStarted(string actionId, int sequence, WorkflowAction action)
    {
        var row = new WorkflowActionExecutionStatus
        {
            WorkflowExecutionStatusId = _execution.Id,
            Sequence = sequence,
            ActionId = actionId,
            ClassName = action.ClassName,
            FunctionName = action.FunctionName,
            Status = ExecutionState.Running,
            StartedAtUtc = DateTime.UtcNow
        };

        _rows[actionId] = row;
        _db.WorkflowActionExecutions.Add(row);
        _db.SaveChanges();
    }

    public void ActionInputsResolved(string actionId, IReadOnlyDictionary<string, object?> inputs)
    {
        var row = _rows[actionId];
        row.InputsJson = WorkflowJson.SerializeMap(inputs);
        _db.SaveChanges();
    }

    public void ActionCompleted(string actionId, IReadOnlyDictionary<string, object?> outputs)
    {
        var row = _rows[actionId];
        Finish(row, ExecutionState.Succeeded);
        row.OutputsJson = WorkflowJson.SerializeMap(outputs);

        _execution.CompletedActions++;
        _db.SaveChanges();
    }

    public void ActionFailed(string actionId, string error)
    {
        var row = _rows[actionId];
        Finish(row, ExecutionState.Failed);
        row.Error = error;

        FailedActionId = actionId;
        _db.SaveChanges();
    }

    private static void Finish(WorkflowActionExecutionStatus row, ExecutionState state)
    {
        row.Status = state;
        row.CompletedAtUtc = DateTime.UtcNow;
        row.DurationMs = row.StartedAtUtc is null
            ? null
            : (long)(row.CompletedAtUtc.Value - row.StartedAtUtc.Value).TotalMilliseconds;
    }
}

// ─────────────────────────────────────────────────────────────
//  Runs a workflow in the background so the POST can return at once.
//  Register as a singleton: builder.Services.AddSingleton<WorkflowRunner>();
// ─────────────────────────────────────────────────────────────

public sealed class WorkflowRunner
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<WorkflowRunner> _logger;

    public WorkflowRunner(IServiceScopeFactory scopeFactory, ILogger<WorkflowRunner> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>Fire-and-forget. Progress is written to the WorkflowExecutionStatus row with this id.</summary>
    public void Start(Guid executionId, string workflowJson) =>
        _ = Task.Run(() => Run(executionId, workflowJson));

    private void Run(Guid executionId, string workflowJson)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var executor = scope.ServiceProvider.GetRequiredService<WorkflowExecutor>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();

        executor.AllowedPackageRoot = configuration["Workflow:PackageRoot"];

        var execution = db.WorkflowExecutions.Find(executionId);
        if (execution is null)
        {
            _logger.LogError("Workflow execution {ExecutionId} not found.", executionId);
            return;
        }

        var stopwatch = Stopwatch.StartNew();
        var listener = new DbWorkflowProgressListener(db, execution);

        try
        {
            execution.Status = ExecutionState.Running;
            execution.StartedAtUtc = DateTime.UtcNow;
            db.SaveChanges();

            executor.Listener = listener;
            var success = executor.ExecuteWorkflow(workflowJson);

            execution.Status = success ? ExecutionState.Succeeded : ExecutionState.Failed;
            execution.Error = executor.LastError;
            execution.FailedActionId = success ? null : listener.FailedActionId;
            execution.OutputsJson = success ? WorkflowJson.SerializeMap(executor.GetOutputVariables()) : null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Workflow execution {ExecutionId} crashed.", executionId);
            execution.Status = ExecutionState.Failed;
            execution.Error = ex.Message;
        }
        finally
        {
            execution.LogsJson = JsonSerializer.Serialize(executor.Logs);
            execution.CompletedAtUtc = DateTime.UtcNow;
            execution.DurationMs = stopwatch.ElapsedMilliseconds;
            db.SaveChanges();
        }
    }
}