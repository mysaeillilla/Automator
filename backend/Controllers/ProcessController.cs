using backend.Data;
using backend.DTOs;
using backend.Entities;
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
}
