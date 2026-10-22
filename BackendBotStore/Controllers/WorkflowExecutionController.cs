using System.Text.Json;
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
    /// </summary>
    [HttpPost("execute/{workflowId:int}")]
    public async Task<IActionResult> Execute(int workflowId)
    {
        var workflow = await _db.Workflows.AsNoTracking().FirstOrDefaultAsync(w => w.Id == workflowId);
        if (workflow is null)
            return NotFound(new { success = false, error = $"Workflow {workflowId} not found." });

        int totalActions;
        try
        {
            using var document = JsonDocument.Parse(workflow.WorkflowJson);
            totalActions = CountActions(document.RootElement);
        }
        catch (JsonException)
        {
            return UnprocessableEntity(new { success = false, error = $"Stored JSON for workflow {workflowId} is invalid." });
        }

        var execution = new WorkflowExecutionStatus
        {
            // Snapshot of exactly what is being run, even if the workflow is re-uploaded later.
            WorkflowJson = workflow.WorkflowJson,
            Status = ExecutionState.Pending,
            TotalActions = totalActions
        };

        _db.WorkflowExecutions.Add(execution);
        await _db.SaveChangesAsync();

        _runner.Start(execution.Id, workflow.WorkflowJson);

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