using backend.Data;
using backend.DTOs;
using backend.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SchedulesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    private static readonly string[] AllowedFrequencies =
    {
        "Once",
        "Daily",
        "Weekly",
        "Monthly"
    };

    private static readonly string[] TimeFormats = { @"hh\:mm", @"hh\:mm\:ss" };

    private const string NextRunFormat = "dd-MM-yyyy hh:mm tt";

    public SchedulesController(ApplicationDbContext context)
    {
        _context = context;
    }

    // =========================================================
    // GET: api/Schedules
    // List all schedules
    // =========================================================

    [HttpGet]
    public async Task<IActionResult> GetSchedules()
    {
        var schedules = await _context.Schedules
            .AsNoTracking()
            .Include(s => s.Process)
            .ThenInclude(p => p.Department)
            .OrderBy(s => s.NextRun)
            .Select(s => new
            {
                id = s.Id,
                scheduleName = s.ScheduleName,
                processId = s.ProcessId,
                processName = s.Process.ProcessName,
                departmentId = s.Process.DepartmentId,
                departmentName = s.Process.Department.DepartmentName,
                time = s.Time.ToString(@"hh\:mm"),
                frequency = s.Frequency,
                nextRun = s.NextRun,
                isActive = s.IsActive,
                createdAt = s.CreatedAt,
                modifiedAt = s.ModifiedAt
            })
            .ToListAsync();

        return Ok(schedules);
    }

    // =========================================================
    // GET: api/Schedules/{id}
    // Get one schedule
    // =========================================================

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetSchedule(Guid id)
    {
        var schedule = await _context.Schedules
            .AsNoTracking()
            .Include(s => s.Process)
            .ThenInclude(p => p.Department)
            .Where(s => s.Id == id)
            .Select(s => new
            {
                id = s.Id,
                scheduleName = s.ScheduleName,
                processId = s.ProcessId,
                processName = s.Process.ProcessName,
                departmentId = s.Process.DepartmentId,
                departmentName = s.Process.Department.DepartmentName,
                time = s.Time.ToString(@"hh\:mm"),
                frequency = s.Frequency,
                nextRun = s.NextRun,
                isActive = s.IsActive,
                createdAt = s.CreatedAt,
                modifiedAt = s.ModifiedAt
            })
            .FirstOrDefaultAsync();

        if (schedule == null)
        {
            return NotFound(new { message = "Schedule not found." });
        }

        return Ok(schedule);
    }

    // =========================================================
    // POST: api/Schedules
    // Create schedule
    // =========================================================

    [HttpPost]
    public async Task<IActionResult> CreateSchedule([FromBody] CreateScheduleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ScheduleName))
        {
            return BadRequest(new { message = "Schedule name is required." });
        }

        if (request.ProcessId == Guid.Empty)
        {
            return BadRequest(new { message = "ProcessId is required." });
        }

        var process = await _context.Process
            .Include(p => p.Department)
            .FirstOrDefaultAsync(p => p.Id == request.ProcessId);

        if (process == null)
        {
            return NotFound(new { message = "Process not found." });
        }

        if (!TryValidateFrequency(request.Frequency, out var frequency, out var frequencyError))
        {
            return BadRequest(new { message = frequencyError });
        }

        if (!TryValidateTime(request.Time, out var parsedTime, out var timeError))
        {
            return BadRequest(new { message = timeError });
        }

        if (!TryParseNextRun(request.NextRun, out var parsedNextRun, out var nextRunError))
        {
            return BadRequest(new { message = nextRunError });
        }

        var schedule = new Schedules
        {
            Id = Guid.NewGuid(),
            ScheduleName = request.ScheduleName.Trim(),
            ProcessId = request.ProcessId,
            Time = parsedTime,
            Frequency = frequency,
            NextRun = parsedNextRun,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };

        _context.Schedules.Add(schedule);

        await _context.SaveChangesAsync();

        return CreatedAtAction(
            nameof(GetSchedule),
            new { id = schedule.Id },
            new
            {
                id = schedule.Id,
                scheduleName = schedule.ScheduleName,
                processId = schedule.ProcessId,
                processName = process.ProcessName,
                departmentId = process.DepartmentId,
                departmentName = process.Department.DepartmentName,
                time = schedule.Time.ToString(@"hh\:mm"),
                frequency = schedule.Frequency,
                nextRun = schedule.NextRun,
                isActive = schedule.IsActive,
                createdAt = schedule.CreatedAt,
                modifiedAt = schedule.ModifiedAt
            }
        );
    }

    // =========================================================
    // PUT: api/Schedules/{id}
    // Update schedule
    // =========================================================

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateSchedule(Guid id, [FromBody] CreateScheduleRequest request)
    {
        var schedule = await _context.Schedules
            .FirstOrDefaultAsync(s => s.Id == id);

        if (schedule == null)
        {
            return NotFound(new { message = "Schedule not found." });
        }

        if (string.IsNullOrWhiteSpace(request.ScheduleName))
        {
            return BadRequest(new { message = "Schedule name is required." });
        }

        if (request.ProcessId == Guid.Empty)
        {
            return BadRequest(new { message = "ProcessId is required." });
        }

        var process = await _context.Process
            .Include(p => p.Department)
            .FirstOrDefaultAsync(p => p.Id == request.ProcessId);

        if (process == null)
        {
            return NotFound(new { message = "Process not found." });
        }

        if (!TryValidateFrequency(request.Frequency, out var frequency, out var frequencyError))
        {
            return BadRequest(new { message = frequencyError });
        }

        if (!TryValidateTime(request.Time, out var parsedTime, out var timeError))
        {
            return BadRequest(new { message = timeError });
        }

        if (!TryParseNextRun(request.NextRun, out var parsedNextRun, out var nextRunError))
        {
            return BadRequest(new { message = nextRunError });
        }

        schedule.ScheduleName = request.ScheduleName.Trim();
        schedule.ProcessId = request.ProcessId;
        schedule.Time = parsedTime;
        schedule.Frequency = frequency;
        schedule.NextRun = parsedNextRun;
        schedule.IsActive = request.IsActive;
        schedule.ModifiedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        return Ok(new
        {
            id = schedule.Id,
            scheduleName = schedule.ScheduleName,
            processId = schedule.ProcessId,
            processName = process.ProcessName,
            departmentId = process.DepartmentId,
            departmentName = process.Department.DepartmentName,
            time = schedule.Time.ToString(@"hh\:mm"),
            frequency = schedule.Frequency,
            nextRun = schedule.NextRun,
            isActive = schedule.IsActive,
            createdAt = schedule.CreatedAt,
            modifiedAt = schedule.ModifiedAt
        });
    }

    // =========================================================
    // DELETE: api/Schedules/{id}
    // =========================================================

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteSchedule(Guid id)
    {
        var schedule = await _context.Schedules
            .FirstOrDefaultAsync(s => s.Id == id);

        if (schedule == null)
        {
            return NotFound(new { message = "Schedule not found." });
        }

        _context.Schedules.Remove(schedule);

        await _context.SaveChangesAsync();

        return Ok(new
        {
            message = "Schedule deleted successfully.",
            id = id
        });
    }

    // =========================================================
    // Shared validation helpers
    // =========================================================

    private static bool TryValidateFrequency(string? rawFrequency, out string frequency, out string error)
    {
        frequency = rawFrequency?.Trim() ?? string.Empty;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(frequency))
        {
            error = "Frequency is required.";
            return false;
        }

        var normalizedFrequency = frequency;

        if (!AllowedFrequencies.Any(x => x.Equals(normalizedFrequency, StringComparison.OrdinalIgnoreCase)))
        {
            error = "Invalid frequency. Allowed values are: Once, Daily, Weekly, Monthly.";
            return false;
        }

        return true;
    }

    private static bool TryValidateTime(string? rawTime, out TimeSpan parsedTime, out string error)
    {
        parsedTime = default;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(rawTime))
        {
            error = "Time is required.";
            return false;
        }

        if (!TimeSpan.TryParseExact(
                rawTime.Trim(),
                TimeFormats,
                CultureInfo.InvariantCulture,
                out parsedTime))
        {
            error = "Invalid time format. Expected format: HH:mm (e.g. \"14:30\").";
            return false;
        }

        if (parsedTime < TimeSpan.Zero || parsedTime >= TimeSpan.FromDays(1))
        {
            error = "Invalid time. Time must be between 00:00 and 23:59:59.";
            return false;
        }

        return true;
    }

    private static bool TryParseNextRun(string? rawNextRun, out DateTime parsedNextRun, out string error)
    {
        parsedNextRun = default;
        error = string.Empty;

        if (string.IsNullOrWhiteSpace(rawNextRun))
        {
            error = "NextRun is required.";
            return false;
        }

        if (!DateTime.TryParseExact(
                rawNextRun.Trim(),
                NextRunFormat,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out parsedNextRun))
        {
            error = $"Invalid NextRun format. Expected format: {NextRunFormat} (e.g. \"23-08-2026 05:48 AM\").";
            return false;
        }

        return true;
    }
}