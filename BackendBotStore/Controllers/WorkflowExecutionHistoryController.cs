using BackendBotStore.Data;
using BackendBotStore.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WorkflowExecutionHistoryController : ControllerBase
{
     private readonly ApplicationDbContext _context;

    public WorkflowExecutionHistoryController(ApplicationDbContext context)
    {
        _context = context;
    }

    /// <summary>
    /// Lists workflow execution history with optional filters and pagination.
    /// GET: api/WorkflowExecutionHistory
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetExecutionHistory(
        [FromQuery] ExecutionState? status = null,
        [FromQuery] DateTime? fromUtc = null,
        [FromQuery] DateTime? toUtc = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = _context.WorkflowExecutions
            .AsNoTracking()
            .AsQueryable();

        // Filter by execution status.
        if (status.HasValue)
        {
            query = query.Where(x => x.Status == status.Value);
        }

        // Inclusive start date.
        if (fromUtc.HasValue)
        {
            query = query.Where(
                x => x.StartedAtUtc >= fromUtc.Value);
        }

        // Exclusive end date: pass the next day to include a full day.
        if (toUtc.HasValue)
        {
            query = query.Where(
                x => x.StartedAtUtc < toUtc.Value);
        }

        var totalCount = await query.CountAsync();

        var executions = await query
            .OrderByDescending(x => x.StartedAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new
            {
                x.Id,
                x.Status,
                x.TotalActions,
                x.CompletedActions,
                x.FailedActionId,
                x.Error,
                x.StartedAtUtc,
                x.CompletedAtUtc,
                x.DurationMs
            })
            .ToListAsync();

        return Ok(new
        {
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            TotalPages = (int)Math.Ceiling(
                totalCount / (double)pageSize),
            Data = executions
        });
    }

    /// <summary>
    /// Gets complete details of a workflow execution,
    /// including its action execution history.
    /// GET: api/WorkflowExecutionHistory/{id}
    /// </summary>
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetExecutionDetails(Guid id)
    {
        var execution = await _context.WorkflowExecutions
            .AsNoTracking()
            .Include(x => x.Actions)
            .FirstOrDefaultAsync(x => x.Id == id);

        if (execution == null)
        {
            return NotFound(new
            {
                Message = "Workflow execution history not found.",
                ExecutionId = id
            });
        }

        return Ok(new
        {
            execution.Id,
            execution.Status,
            execution.WorkflowJson,
            execution.InputsJson,
            execution.OutputsJson,
            execution.Error,
            execution.FailedActionId,
            execution.LogsJson,
            execution.TotalActions,
            execution.CompletedActions,
            execution.StartedAtUtc,
            execution.CompletedAtUtc,
            execution.DurationMs,

            Actions = execution.Actions
                .OrderBy(a => a.Sequence)
                .Select(a => new
                {
                    a.Id,
                    a.Sequence,
                    a.ActionId,
                    a.ClassName,
                    a.FunctionName,
                    a.Status,
                    a.InputsJson,
                    a.OutputsJson,
                    a.Error,
                    a.StartedAtUtc,
                    a.CompletedAtUtc,
                    a.DurationMs
                })
        });
    }

    /// <summary>
    /// Gets action execution history for a specific workflow run.
    /// GET: api/WorkflowExecutionHistory/{id}/actions
    /// </summary>
    [HttpGet("{id:guid}/actions")]
    public async Task<IActionResult> GetActionHistory(Guid id)
    {
        var exists = await _context.WorkflowExecutions
            .AnyAsync(x => x.Id == id);

        if (!exists)
        {
            return NotFound(new
            {
                Message = "Workflow execution history not found.",
                ExecutionId = id
            });
        }

        var actions = await _context.WorkflowActionExecutions
            .AsNoTracking()
            .Where(x => x.WorkflowExecutionStatusId == id)
            .OrderBy(x => x.Sequence)
            .Select(a => new
            {
                a.Id,
                a.Sequence,
                a.ActionId,
                a.ClassName,
                a.FunctionName,
                a.Status,
                a.InputsJson,
                a.OutputsJson,
                a.Error,
                a.StartedAtUtc,
                a.CompletedAtUtc,
                a.DurationMs
            })
            .ToListAsync();

        return Ok(actions);
    }
    
}
