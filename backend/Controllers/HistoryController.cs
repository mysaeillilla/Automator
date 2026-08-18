using backend.Data;
using backend.DTOs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HistoryController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public HistoryController(ApplicationDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<ActionResult<PagedExecutionHistoryDto>> GetExecutionHistory(
        int page = 1,
        int pageSize = 10)
    {
        if (page < 1)
            page = 1;

        if (pageSize < 1)
            pageSize = 10;

        if (pageSize > 100)
            pageSize = 100;

        var query = _context.ExecutionHistories
            .AsNoTracking()
            .OrderByDescending(x => x.StartTime);

        var totalCount = await query.CountAsync();

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new ExecutionHistoryListDto
            {
                ExecutionId = x.ExecutionId,
                ProcessId = x.ProcessId,
                ProcessName = x.ProcessName,
                TriggeredUserId = x.TriggeredUserId,
                TriggeredUserName = x.TriggeredUserName,
                StartTime = x.StartTime,
                EndTime = x.EndTime,
                DurationMs = x.DurationMs,
                Status = x.Status,
                Remarks = x.Remarks,
                ErrorMessage = x.ErrorMessage,
                TriggerType = x.TriggerType,
                ExecutionMode = x.ExecutionMode,
                CreatedAt = x.CreatedAt
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(
            totalCount / (double)pageSize
        );

        return Ok(new PagedExecutionHistoryDto
        {
            Items = items,
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            TotalPages = totalPages,
            HasNextPage = page < totalPages,
            HasPreviousPage = page > 1
        });
    }
}
