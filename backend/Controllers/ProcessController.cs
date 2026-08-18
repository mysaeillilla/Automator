using System.Security.Claims;
using backend.Data;
using backend.DTOs;
using backend.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProcessController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public ProcessController(ApplicationDbContext context)
    {
        _context = context;
    }



    [Authorize]
    [HttpGet("my-processes")]
    public async Task<IActionResult> GetMyProcesses()
    {
        // Get UserId from JWT
        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;

        if (string.IsNullOrWhiteSpace(userIdClaim))
        {
            return Unauthorized(new
            {
                message = "User ID not found in JWT token."
            });
        }

        // Convert UserId to Guid
        if (!Guid.TryParse(userIdClaim, out Guid userId))
        {
            return Unauthorized(new
            {
                message = "Invalid User ID in JWT token."
            });
        }

        // Verify user exists
        var userExists = await _context.Users
            .AnyAsync(u => u.Id == userId);

        if (!userExists)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        // Get processes assigned to this user
        var processes = await _context.Process
            .Include(p => p.Department)
            .Include(p => p.UserProcesses)
            .Where(p =>
                p.UserProcesses.Any(up =>
                    up.UserId == userId))
            .OrderBy(p => p.ProcessName)
            .Select(p => new
            {
                p.Id,
                p.ProcessName,
                p.Description,
                p.CreatedAt,
                p.ModifiedAt,

                Department = new
                {
                    p.Department.Id,
                    p.Department.DepartmentName
                },

                UsersCount = p.UserProcesses.Count()
            })
            .ToListAsync();

        return Ok(new
        {
            userId,
            count = processes.Count,
            processes
        });
    }
[HttpGet("department/{departmentId}")]
public async Task<IActionResult> GetProcessesByDepartment(Guid departmentId)
{
    var department = await _context.Departments
        .FirstOrDefaultAsync(d => d.Id == departmentId);

    if (department == null)
    {
        return NotFound(new
        {
            message = "Department not found."
        });
    }

    var processes = await _context.Process
        .Include(p => p.UserProcesses)
            .ThenInclude(up => up.User)
        .Where(p => p.DepartmentId == departmentId)
        .OrderBy(p => p.ProcessName)
        .Select(p => new
        {
            p.Id,
            p.ProcessName,
            p.Description,
            p.CreatedAt,
            p.ModifiedAt,

            Users = p.UserProcesses.Select(up => new
            {
                up.User.Id,
                up.User.UserName,
                up.User.Role
            })
        })
        .ToListAsync();

    return Ok(new
    {
        departmentId = department.Id,
        departmentName = department.DepartmentName,
        processes
    });
}
    [HttpPost]
public async Task<IActionResult> CreateProcess(CreateProcessDto dto)
{
    // Validate DepartmentId
    if (string.IsNullOrWhiteSpace(dto.DepartmentId))
    {
        return BadRequest(new
        {
            message = "DepartmentId is required."
        });
    }

    if (!Guid.TryParse(dto.DepartmentId, out Guid departmentId))
    {
        return BadRequest(new
        {
            message = "Invalid DepartmentId."
        });
    }

    // Check department
    var department = await _context.Departments
        .FirstOrDefaultAsync(d => d.Id == departmentId);

    if (department == null)
    {
        return NotFound(new
        {
            message = "Department not found."
        });
    }

    // Check duplicate process name within department
    var processExists = await _context.Process
        .AnyAsync(p =>
            p.DepartmentId == departmentId &&
            p.ProcessName == dto.ProcessName);

    if (processExists)
    {
        return BadRequest(new
        {
            message = "A process with this name already exists in this department."
        });
    }

    // Create process
    var process = new Process
    {
        ProcessName = dto.ProcessName,
        Description = dto.Description,
        DepartmentId = departmentId,
        CreatedAt = DateTime.UtcNow,
        ModifiedAt = DateTime.UtcNow
    };

    _context.Process.Add(process);

    // Get all users belonging to the department
    var userDepartments = await _context.UserDepartments
        .Where(ud => ud.DepartmentId == departmentId)
        .ToListAsync();

    // Assign all department users to the process
    foreach (var userDepartment in userDepartments)
    {
        var userProcess = new UserProcess
        {
            UserId = userDepartment.UserId,
            Process = process,
            CreatedAt = DateTime.UtcNow
        };

        _context.UserProcess.Add(userProcess);
    }

    await _context.SaveChangesAsync();

    return Ok(new
    {
        message = "Process created successfully.",

        process = new
        {
            process.Id,
            process.ProcessName,
            process.Description,
            process.DepartmentId,
            process.CreatedAt,
            process.ModifiedAt
        },

        usersAssigned = userDepartments.Count
    });
}





   [HttpPost("list")]
public async Task<IActionResult> GetProcesses(ProcessFilterDto dto)
{
    Guid? departmentId = null;
    Guid? userId = null;

    // Convert DepartmentId string to Guid
    if (!string.IsNullOrWhiteSpace(dto.DepartmentId))
    {
        if (!Guid.TryParse(dto.DepartmentId, out Guid parsedDepartmentId))
        {
            return BadRequest(new
            {
                message = "Invalid DepartmentId."
            });
        }

        departmentId = parsedDepartmentId;
    }

    // Convert UserId string to Guid
    if (!string.IsNullOrWhiteSpace(dto.UserId))
    {
        if (!Guid.TryParse(dto.UserId, out Guid parsedUserId))
        {
            return BadRequest(new
            {
                message = "Invalid UserId."
            });
        }

        userId = parsedUserId;
    }

    // At least one ID is required
    if (departmentId == null && userId == null)
    {
        return BadRequest(new
        {
            message = "DepartmentId or UserId is required."
        });
    }

    var query = _context.Process
        .Include(p => p.Department)
        .Include(p => p.UserProcesses)
        .AsQueryable();

    // Filter by department
    if (departmentId.HasValue)
    {
        query = query.Where(p =>
            p.DepartmentId == departmentId.Value);
    }

    // Filter by user
    if (userId.HasValue)
    {
        query = query.Where(p =>
            p.UserProcesses.Any(up =>
                up.UserId == userId.Value));
    }

    var processes = await query
        .OrderBy(p => p.ProcessName)
        .Select(p => new
        {
            p.Id,
            p.ProcessName,
            p.Description,
            p.CreatedAt,
            p.ModifiedAt,

            Department = new
            {
                p.Department.Id,
                p.Department.DepartmentName
            },

            UsersCount = p.UserProcesses.Count()
        })
        .ToListAsync();

    return Ok(processes);
}



[Authorize]
    [HttpPost("{processId}/trigger")]
    public async Task<IActionResult> TriggerProcess(Guid processId)
    {
        // --------------------------------------------------------
        // 1. Get User ID from JWT
        // --------------------------------------------------------

        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;

        if (string.IsNullOrWhiteSpace(userIdClaim))
        {
            return Unauthorized(new
            {
                message = "User ID not found in JWT token."
            });
        }

        if (!Guid.TryParse(userIdClaim, out Guid userId))
        {
            return Unauthorized(new
            {
                message = "Invalid User ID in JWT token."
            });
        }


        // --------------------------------------------------------
        // 2. Get User
        // --------------------------------------------------------

        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }


        // --------------------------------------------------------
        // 3. Get Process and verify assignment
        // --------------------------------------------------------

        var process = await _context.Process
            .Include(p => p.Department)
            .Include(p => p.UserProcesses)
            .FirstOrDefaultAsync(p =>
                p.Id == processId &&
                p.UserProcesses.Any(up =>
                    up.UserId == userId));

        if (process == null)
        {
            return NotFound(new
            {
                message = "Process not found or you are not assigned to this process."
            });
        }


        // --------------------------------------------------------
        // 4. Create ExecutionHistory entry
        // --------------------------------------------------------

        var execution = new ExecutionHistory
        {
            ProcessId = process.Id,

            // Store process name as a historical snapshot
            ProcessName = process.ProcessName,

            TriggeredUserId = user.Id,

            // Store username as a historical snapshot
            TriggeredUserName = user.UserName,

            StartTime = DateTime.UtcNow,

            Status = ExecutionStatus.Running,

            TriggerType = "Manual",

            ExecutionMode = "Production",

            Remarks = "Process execution started.",

            CreatedAt = DateTime.UtcNow
        };

        _context.ExecutionHistories.Add(execution);

        // Save first so ExecutionId is generated
        await _context.SaveChangesAsync();


        // --------------------------------------------------------
        // 5. Execute the process
        // --------------------------------------------------------

        try
        {
            await ExecuteProcess(process);


            // ----------------------------------------------------
            // 6. Mark execution as completed
            // ----------------------------------------------------

            execution.EndTime = DateTime.UtcNow;

            execution.DurationMs =
                (long)(execution.EndTime.Value - execution.StartTime)
                .TotalMilliseconds;

            execution.Status = ExecutionStatus.Completed;

            execution.Remarks =
                "Process executed successfully.";

            execution.ModifiedAt = DateTime.UtcNow;


            await _context.SaveChangesAsync();


            // ----------------------------------------------------
            // 7. Return result
            // ----------------------------------------------------

            return Ok(new
            {
                message = "Process executed successfully.",

                executionId = execution.ExecutionId,

                process = new
                {
                    process.Id,
                    process.ProcessName,
                    process.Description,
                    department = process.Department.DepartmentName
                },

                triggeredBy = new
                {
                    user.Id,
                    user.UserName
                },

                execution = new
                {
                    execution.StartTime,
                    execution.EndTime,
                    execution.DurationMs,
                    execution.Status,
                    execution.Remarks
                }
            });
        }
        catch (Exception ex)
        {
            // ----------------------------------------------------
            // Process failed
            // ----------------------------------------------------

            execution.EndTime = DateTime.UtcNow;

            execution.DurationMs =
                (long)(execution.EndTime.Value - execution.StartTime)
                .TotalMilliseconds;

            execution.Status = ExecutionStatus.Failed;

            execution.Remarks =
                "Process execution failed.";

            execution.ErrorMessage = ex.Message;

            execution.ModifiedAt = DateTime.UtcNow;


            await _context.SaveChangesAsync();


            return StatusCode(500, new
            {
                message = "Process execution failed.",

                executionId = execution.ExecutionId,

                status = execution.Status,

                error = execution.ErrorMessage
            });
        }
    }


    // ============================================================
    // Actual Process Execution
    // ============================================================

    private async Task ExecuteProcess(Process process)
    {
        /*
         * Put your actual process execution logic here.
         *
         * For example:
         *
         * 1. Load workflow
         * 2. Get workflow actions
         * 3. Execute each action
         * 4. Pass output from one action to another
         * 5. Handle failures
         *
         * Example:
         *
         * await _workflowService.ExecuteAsync(process.Id);
         */


        // Temporary simulation
        await Task.Delay(1000);
    }

    
}
