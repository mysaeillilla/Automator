using System.Diagnostics;
using System.Security.Claims;
using backend.Data;
using backend.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Process = backend.Entities.Process;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProcessController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ProcessController> _logger;

    public ProcessController(
        ApplicationDbContext context,
        IWebHostEnvironment environment,
        IServiceScopeFactory scopeFactory,
        ILogger<ProcessController> logger)
    {
        _context = context;
        _environment = environment;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    [Authorize]
    [HttpGet("my-processes")]
    public async Task<IActionResult> GetMyProcesses()
    {
        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;

        if (string.IsNullOrWhiteSpace(userIdClaim))
        {
            return Unauthorized(new { message = "User ID not found in JWT token." });
        }

        if (!Guid.TryParse(userIdClaim, out Guid userId))
        {
            return Unauthorized(new { message = "Invalid User ID in JWT token." });
        }

        var userExists = await _context.Users.AnyAsync(u => u.Id == userId);

        if (!userExists)
        {
            return NotFound(new { message = "User not found." });
        }

        var processes = await _context.Process
            .Include(p => p.Department)
            .Include(p => p.UserProcesses)
            .Where(p => p.UserProcesses.Any(up => up.UserId == userId))
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
[Authorize]
[HttpDelete("delete-processes")]
public async Task<IActionResult> DeleteProcesses(
    [FromBody] DeleteProcessesRequest request)
{
    if (request == null || request.ProcessIds == null || request.ProcessIds.Count == 0)
    {
        return BadRequest(new
        {
            message = "At least one Process ID is required."
        });
    }

    // Remove duplicate IDs
    var processIds = request.ProcessIds
        .Distinct()
        .ToList();

    // Check which processes exist
    var processes = await _context.Process
        .Where(p => processIds.Contains(p.Id))
        .ToListAsync();

    if (processes.Count == 0)
    {
        return NotFound(new
        {
            message = "No matching processes found."
        });
    }

    // Delete the processes
    _context.Process.RemoveRange(processes);

    await _context.SaveChangesAsync();

    return Ok(new
    {
        message = "Processes deleted successfully.",
        requestedCount = processIds.Count,
        deletedCount = processes.Count,
        deletedProcessIds = processes.Select(p => p.Id)
    });
}




[HttpGet("all")]
public async Task<IActionResult> GetAllProcesses()
{
    var processes = await _context.Process
        .Include(p => p.Department)
        .Include(p => p.UserProcesses)
        .OrderBy(p => p.ProcessName)
        .Select(p => new
        {
            p.Id,
            p.ProcessName,
            p.Description,
            p.processPath,
            p.DepartmentId,
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
        count = processes.Count,
        processes
    });
}


    [HttpGet("department/{departmentId}")]
public async Task<IActionResult> GetProcessesByDepartment(string departmentId)
{

    Console.WriteLine(departmentId);
    
    if (!Guid.TryParse(departmentId, out Guid departmentGuid))
    {
        return BadRequest(new { message = "Invalid department ID." });
    }

    var department = await _context.Departments
        .FirstOrDefaultAsync(d => d.Id == departmentGuid);

    if (department == null)
    {
        return NotFound(new { message = "Department not found." });
    }

    var processes = await _context.Process
        .Include(p => p.UserProcesses)
            .ThenInclude(up => up.User)
        .Where(p => p.DepartmentId == departmentGuid)
        .OrderBy(p => p.ProcessName)
        .Select(p => new
        {
            p.Id,
            p.ProcessName,
            p.Description,
            p.processPath,
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


    [Authorize(Roles = "Admin")]
    [HttpPost]
    public async Task<IActionResult> CreateProcess(CreateProcessDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.DepartmentId))
        {
            return BadRequest(new { message = "DepartmentId is required." });
        }

        if (!Guid.TryParse(dto.DepartmentId, out Guid departmentId))
        {
            return BadRequest(new { message = "Invalid DepartmentId." });
        }

        var department = await _context.Departments
            .FirstOrDefaultAsync(d => d.Id == departmentId);

        if (department == null)
        {
            return NotFound(new { message = "Department not found." });
        }

        var processExists = await _context.Process
            .AnyAsync(p => p.DepartmentId == departmentId && p.ProcessName == dto.ProcessName);

        if (processExists)
        {
            return BadRequest(new { message = "A process with this name already exists in this department." });
        }

        var process = new Process
        {
            ProcessName = dto.ProcessName,
            Description = dto.Description,
            DepartmentId = departmentId,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };

        _context.Process.Add(process);

        var userDepartments = await _context.UserDepartments
            .Where(ud => ud.DepartmentId == departmentId)
            .ToListAsync();

        foreach (var userDepartment in userDepartments)
        {
            var userProcess = new backend.Entities.UserProcess
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

        if (!string.IsNullOrWhiteSpace(dto.DepartmentId))
        {
            if (!Guid.TryParse(dto.DepartmentId, out Guid parsedDepartmentId))
            {
                return BadRequest(new { message = "Invalid DepartmentId." });
            }

            departmentId = parsedDepartmentId;
        }

        if (!string.IsNullOrWhiteSpace(dto.UserId))
        {
            if (!Guid.TryParse(dto.UserId, out Guid parsedUserId))
            {
                return BadRequest(new { message = "Invalid UserId." });
            }

            userId = parsedUserId;
        }

        if (departmentId == null && userId == null)
        {
            return BadRequest(new { message = "DepartmentId or UserId is required." });
        }

        var query = _context.Process
            .Include(p => p.Department)
            .Include(p => p.UserProcesses)
            .AsQueryable();

        if (departmentId.HasValue)
        {
            query = query.Where(p => p.DepartmentId == departmentId.Value);
        }

        if (userId.HasValue)
        {
            query = query.Where(p => p.UserProcesses.Any(up => up.UserId == userId.Value));
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

    [HttpPut("{id:guid}/executable")]
[Authorize(Roles = "Admin")]
[RequestSizeLimit(500_000_000)] // 500 MB
public async Task<IActionResult> UploadExecutable(Guid id, IFormFile file)
{
    if (file == null || file.Length == 0)
    {
        return BadRequest(new
        {
            message = "Please select an executable file."
        });
    }

    // Validate extension
    var extension = Path.GetExtension(file.FileName);

    if (!string.Equals(extension, ".exe", StringComparison.OrdinalIgnoreCase))
    {
        return BadRequest(new
        {
            message = "Only .exe files are allowed."
        });
    }

    // Find process
    var process = await _context.Process
        .FirstOrDefaultAsync(p => p.Id == id);

    if (process == null)
    {
        return NotFound(new
        {
            message = "Process not found."
        });
    }

    // Create upload directory
    var processDirectory = Path.Combine(
        _environment.WebRootPath ?? Path.Combine(_environment.ContentRootPath, "wwwroot"),
        "processes"
    );

    Directory.CreateDirectory(processDirectory);

    // Deterministic filename per process — re-uploading always
    // targets this same file, so there's nothing to clean up and
    // no risk of orphaned files if a delete step fails.
    var fileName = $"{process.Id}.exe";

    var filePath = Path.Combine(
        processDirectory,
        fileName
    );

    var isReupload = System.IO.File.Exists(filePath);

    // Save file — FileMode.Create truncates/overwrites if it
    // already exists, so this handles both first upload and
    // re-upload the same way.
    try
    {
        await using (var stream = new FileStream(
            filePath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None))
        {
            await file.CopyToAsync(stream);
        }
    }
    catch (IOException ex)
    {
        // Most commonly: the exe is currently running and the OS
        // has a lock on it, so it can't be overwritten right now.
        return Conflict(new
        {
            message = "Could not update the executable — it may currently be running or locked.",
            error = ex.Message
        });
    }

    // Update path in DB (unchanged if this was a re-upload, since
    // the filename is deterministic — but keep the assignment for
    // the first-upload case and to bump ModifiedAt regardless).
    process.processPath = $"/processes/{fileName}";
    process.ModifiedAt = DateTime.UtcNow;

    await _context.SaveChangesAsync();

    return Ok(new
    {
        message = isReupload
            ? "Executable updated successfully."
            : "Executable uploaded successfully.",
        processId = process.Id,
        processPath = process.processPath,
        fileName = fileName,
        wasReupload = isReupload
    });
}

    // ==================================================================
    // TRIGGER PROCESS — Windows only, fire-and-forget launch.
    //
    // The request thread does validation + creates the ExecutionHistory
    // row, then returns 202 Accepted immediately. Process.Start() and
    // everything after it runs on a detached background Task using its
    // own DI scope/DbContext (the request-scoped _context is disposed
    // once the response is sent, so it can't be reused there).
    //
    // Client should poll GET history/execution-status or similar to see
    // whether the launch actually succeeded, since that's now unknown
    // at the time this endpoint returns.
    // ==================================================================

    [Authorize]
    [HttpPost("{processId}/trigger")]
    public async Task<IActionResult> TriggerProcess(Guid processId)
    {
        // --------------------------------------------------------
        // 0. This endpoint only works on a Windows host, since it
        //    launches a native .exe directly.
        // --------------------------------------------------------

        if (!OperatingSystem.IsWindows())
        {
            return StatusCode(500, new
            {
                message = "Process execution is only supported when the API is hosted on Windows."
            });
        }

        // --------------------------------------------------------
        // 1. Get User ID from JWT
        // --------------------------------------------------------

        var userIdClaim =
            User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;

        if (string.IsNullOrWhiteSpace(userIdClaim))
        {
            return Unauthorized(new { message = "User ID not found in JWT token." });
        }

        if (!Guid.TryParse(userIdClaim, out Guid userId))
        {
            return Unauthorized(new { message = "Invalid User ID in JWT token." });
        }

        // --------------------------------------------------------
        // 2. Get User
        // --------------------------------------------------------

        var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            return NotFound(new { message = "User not found." });
        }

        // --------------------------------------------------------
        // 3. Get Process and verify assignment
        // --------------------------------------------------------

        var process = await _context.Process
            .Include(p => p.Department)
            .Include(p => p.UserProcesses)
            .FirstOrDefaultAsync(p =>
                p.Id == processId &&
                p.UserProcesses.Any(up => up.UserId == userId));

        if (process == null)
        {
            return NotFound(new
            {
                message = "Process not found or you are not assigned to this process."
            });
        }

        // --------------------------------------------------------
        // 4. Validate EXE path is configured
        // --------------------------------------------------------

        if (string.IsNullOrWhiteSpace(process.processPath))
        {
            return BadRequest(new { message = "No executable is configured for this process." });
        }

        // --------------------------------------------------------
        // 5. Resolve + sandbox-check the physical path.
        //    Fast, synchronous, stays on the request path so bad
        //    config fails immediately instead of after 202.
        // --------------------------------------------------------

        var relativePath = process.processPath
            .TrimStart('/')
            .Replace('/', Path.DirectorySeparatorChar);

        var webRoot = _environment.WebRootPath;

        if (string.IsNullOrWhiteSpace(webRoot))
        {
            webRoot = Path.Combine(_environment.ContentRootPath, "wwwroot");
        }

        var fullWebRoot = Path.GetFullPath(webRoot);
        var exePath = Path.GetFullPath(Path.Combine(webRoot, relativePath));

        if (!exePath.StartsWith(fullWebRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "Invalid executable path." });
        }

        if (!System.IO.File.Exists(exePath))
        {
            return NotFound(new
            {
                message = "Executable file not found.",
                processPath = process.processPath
            });
        }

        // --------------------------------------------------------
        // 6. Create ExecutionHistory row — the only DB write on the
        //    request path. Gives the client an executionId to poll.
        // --------------------------------------------------------

        var execution = new backend.Entities.ExecutionHistory
        {
            ProcessId = process.Id,
            ProcessName = process.ProcessName,
            TriggeredUserId = user.Id,
            TriggeredUserName = user.UserName,
            StartTime = DateTime.UtcNow,
            Status = backend.Entities.ExecutionStatus.Running,
            TriggerType = "Manual",
            ExecutionMode = "Production",
            Remarks = "Process execution queued.",
            CreatedAt = DateTime.UtcNow
        };

        _context.ExecutionHistories.Add(execution);
        await _context.SaveChangesAsync();

        var executionId = execution.ExecutionId;
        var workingDirectory = Path.GetDirectoryName(exePath)!;

        // --------------------------------------------------------
        // 7. Detached fire-and-forget launch.
        //    Deliberately NOT awaited on the request path — the
        //    request returns before this completes. Uses its own
        //    scope/DbContext since _context is disposed once the
        //    response is sent.
        // --------------------------------------------------------

        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var scopedContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = exePath,
                    UseShellExecute = false,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false,
                    CreateNoWindow = true,
                    WorkingDirectory = workingDirectory
                };

                var startedProcess = System.Diagnostics.Process.Start(startInfo);

                if (startedProcess == null)
                {
                    throw new InvalidOperationException("Process.Start returned null.");
                }

                var executionToUpdate = await scopedContext.ExecutionHistories
                    .FirstOrDefaultAsync(e => e.ExecutionId == executionId);

                if (executionToUpdate != null)
                {
                    executionToUpdate.Remarks = "Process executable started successfully.";
                    executionToUpdate.ModifiedAt = DateTime.UtcNow;
                    await scopedContext.SaveChangesAsync();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to launch executable for process {ProcessId} (execution {ExecutionId})",
                    processId, executionId);

                var executionToUpdate = await scopedContext.ExecutionHistories
                    .FirstOrDefaultAsync(e => e.ExecutionId == executionId);

                if (executionToUpdate != null)
                {
                    executionToUpdate.EndTime = DateTime.UtcNow;
                    executionToUpdate.DurationMs =
                        (long)(executionToUpdate.EndTime.Value - executionToUpdate.StartTime).TotalMilliseconds;
                    executionToUpdate.Status = backend.Entities.ExecutionStatus.Failed;
                    executionToUpdate.Remarks = "Process execution failed to start.";
                    executionToUpdate.ErrorMessage = ex.Message;
                    executionToUpdate.ModifiedAt = DateTime.UtcNow;

                    await scopedContext.SaveChangesAsync();
                }
            }
        });

        // --------------------------------------------------------
        // 8. Return immediately — launch outcome isn't known yet.
        //    202 Accepted communicates "queued, not finished" more
        //    accurately than 200 OK.
        // --------------------------------------------------------

        return Accepted(new
        {
            message = "Process trigger accepted; executable is launching.",

            executionId,

            process = new
            {
                process.Id,
                process.ProcessName,
                process.Description,
                process.processPath,
                department = process.Department.DepartmentName
            },

            triggeredBy = new
            {
                user.Id,
                user.UserName
            },

            status = backend.Entities.ExecutionStatus.Running
        });
    }
}