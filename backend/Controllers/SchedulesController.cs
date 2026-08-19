using backend.Data;
using backend.DTOs;
using backend.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SchedulesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

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

                time = s.Time,

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

                time = s.Time,

                frequency = s.Frequency,

                nextRun = s.NextRun,

                isActive = s.IsActive,

                createdAt = s.CreatedAt,

                modifiedAt = s.ModifiedAt
            })
            .FirstOrDefaultAsync();

        if (schedule == null)
        {
            return NotFound(new
            {
                message = "Schedule not found."
            });
        }

        return Ok(schedule);
    }

    // =========================================================
    // POST: api/Schedules
    // Create schedule
    // =========================================================

    [HttpPost]
    public async Task<IActionResult> CreateSchedule(
        [FromBody] CreateScheduleRequest request)
    {
        // -----------------------------------------------------
        // Validate schedule name
        // -----------------------------------------------------

        if (string.IsNullOrWhiteSpace(request.ScheduleName))
        {
            return BadRequest(new
            {
                message = "Schedule name is required."
            });
        }

        // -----------------------------------------------------
        // Validate ProcessId
        // -----------------------------------------------------

        if (request.ProcessId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "ProcessId is required."
            });
        }

        // -----------------------------------------------------
        // Find process
        // -----------------------------------------------------

        var process = await _context.Process
            .Include(p => p.Department)
            .FirstOrDefaultAsync(p => p.Id == request.ProcessId);

        if (process == null)
        {
            return NotFound(new
            {
                message = "Process not found."
            });
        }

        // -----------------------------------------------------
        // Validate Frequency
        // -----------------------------------------------------

        var frequency = request.Frequency?.Trim();

        if (string.IsNullOrWhiteSpace(frequency))
        {
            return BadRequest(new
            {
                message = "Frequency is required."
            });
        }

        var allowedFrequencies = new[]
        {
            "Once",
            "Daily",
            "Weekly",
            "Monthly"
        };

        if (!allowedFrequencies.Any(
                x => x.Equals(
                    frequency,
                    StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(new
            {
                message =
                    "Invalid frequency. " +
                    "Allowed values are: Once, Daily, Weekly, Monthly."
            });
        }

        // -----------------------------------------------------
        // Validate Time
        // -----------------------------------------------------

        if (request.Time < TimeSpan.Zero ||
            request.Time >= TimeSpan.FromDays(1))
        {
            return BadRequest(new
            {
                message =
                    "Invalid time. Time must be between 00:00 and 23:59:59."
            });
        }

        // -----------------------------------------------------
        // Create entity
        // -----------------------------------------------------

        var schedule = new Schedules
        {
            Id = Guid.NewGuid(),

            ScheduleName = request.ScheduleName.Trim(),

            ProcessId = request.ProcessId,

            Time = request.Time,

            Frequency = frequency,

            NextRun = request.NextRun,

            IsActive = request.IsActive,

            CreatedAt = DateTime.UtcNow,

            ModifiedAt = DateTime.UtcNow
        };

        _context.Schedules.Add(schedule);

        await _context.SaveChangesAsync();

        // -----------------------------------------------------
        // Response
        // -----------------------------------------------------

        return CreatedAtAction(
            nameof(GetSchedule),
            new
            {
                id = schedule.Id
            },
            new
            {
                id = schedule.Id,

                scheduleName = schedule.ScheduleName,

                processId = schedule.ProcessId,

                processName = process.ProcessName,

                departmentId = process.DepartmentId,

                departmentName = process.Department.DepartmentName,

                time = schedule.Time,

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
    public async Task<IActionResult> UpdateSchedule(
        Guid id,
        [FromBody] CreateScheduleRequest request)
    {
        var schedule = await _context.Schedules
            .FirstOrDefaultAsync(s => s.Id == id);

        if (schedule == null)
        {
            return NotFound(new
            {
                message = "Schedule not found."
            });
        }

        // -----------------------------------------------------
        // Validate schedule name
        // -----------------------------------------------------

        if (string.IsNullOrWhiteSpace(request.ScheduleName))
        {
            return BadRequest(new
            {
                message = "Schedule name is required."
            });
        }

        // -----------------------------------------------------
        // Validate ProcessId
        // -----------------------------------------------------

        if (request.ProcessId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "ProcessId is required."
            });
        }

        var process = await _context.Process
            .Include(p => p.Department)
            .FirstOrDefaultAsync(p => p.Id == request.ProcessId);

        if (process == null)
        {
            return NotFound(new
            {
                message = "Process not found."
            });
        }

        // -----------------------------------------------------
        // Validate Frequency
        // -----------------------------------------------------

        var frequency = request.Frequency?.Trim();

        if (string.IsNullOrWhiteSpace(frequency))
        {
            return BadRequest(new
            {
                message = "Frequency is required."
            });
        }

        var allowedFrequencies = new[]
        {
            "Once",
            "Daily",
            "Weekly",
            "Monthly"
        };

        if (!allowedFrequencies.Any(
                x => x.Equals(
                    frequency,
                    StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(new
            {
                message =
                    "Invalid frequency. " +
                    "Allowed values are: Once, Daily, Weekly, Monthly."
            });
        }

        // -----------------------------------------------------
        // Validate Time
        // -----------------------------------------------------

        if (request.Time < TimeSpan.Zero ||
            request.Time >= TimeSpan.FromDays(1))
        {
            return BadRequest(new
            {
                message =
                    "Invalid time. Time must be between 00:00 and 23:59:59."
            });
        }

        // -----------------------------------------------------
        // Update entity
        // -----------------------------------------------------

        schedule.ScheduleName = request.ScheduleName.Trim();

        schedule.ProcessId = request.ProcessId;

        schedule.Time = request.Time;

        schedule.Frequency = frequency;

        schedule.NextRun = request.NextRun;

        schedule.IsActive = request.IsActive;

        schedule.ModifiedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();

        // -----------------------------------------------------
        // Response
        // -----------------------------------------------------

        return Ok(new
        {
            id = schedule.Id,

            scheduleName = schedule.ScheduleName,

            processId = schedule.ProcessId,

            processName = process.ProcessName,

            departmentId = process.DepartmentId,

            departmentName = process.Department.DepartmentName,

            time = schedule.Time,

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
            return NotFound(new
            {
                message = "Schedule not found."
            });
        }

        _context.Schedules.Remove(schedule);

        await _context.SaveChangesAsync();

        return Ok(new
        {
            message = "Schedule deleted successfully.",
            id = id
        });
    }
}
