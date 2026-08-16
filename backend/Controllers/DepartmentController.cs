using backend.Data;
using backend.DTOs;
using backend.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DepartmentController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public DepartmentController(ApplicationDbContext context)
    {
        _context = context;
    }


    // =========================================================
    // GET ALL DEPARTMENTS
    // =========================================================

    [HttpGet]
    public async Task<IActionResult> GetDepartments()
    {
        var departments = await _context.Departments
            .Select(d => new
            {
                d.Id,
                d.DepartmentName,
                d.Description,
                d.CreatedAt,

                UserCount = d.UserDepartments.Count()
            })
            .OrderBy(d => d.DepartmentName)
            .ToListAsync();

        return Ok(departments);
    }


    // =========================================================
    // GET DEPARTMENT BY ID
    // =========================================================

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetDepartment(Guid id)
    {
        var department = await _context.Departments
            .Include(d => d.UserDepartments)
                .ThenInclude(ud => ud.User)
            .FirstOrDefaultAsync(d => d.Id == id);

        if (department == null)
        {
            return NotFound(new
            {
                message = "Department not found."
            });
        }

        return Ok(new
        {
            department.Id,
            department.DepartmentName,
            department.Description,
            department.CreatedAt,

            Users = department.UserDepartments
                .Select(ud => new
                {
                    ud.User.Id,
                    ud.User.UserName,
                    ud.User.Role,
                    ud.CreatedAt
                })
                .ToList()
        });
    }


    // =========================================================
    // CREATE DEPARTMENT
    // =========================================================

    [HttpPost]
    public async Task<IActionResult> CreateDepartment(
        [FromBody] CreateDepartmentDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.DepartmentName))
        {
            return BadRequest(new
            {
                message = "Department name is required."
            });
        }

        // Check duplicate department
        var existingDepartment = await _context.Departments
            .AnyAsync(d =>
                d.DepartmentName.ToLower() ==
                dto.DepartmentName.ToLower());

        if (existingDepartment)
        {
            return Conflict(new
            {
                message = "A department with this name already exists."
            });
        }


        // ---------------------------------------------------------
        // Find Admin user
        // ---------------------------------------------------------

        var adminUser = await _context.Users
            .FirstOrDefaultAsync(u => u.Role == Role.Admin);

        if (adminUser == null)
        {
            return BadRequest(new
            {
                message = "No Admin user exists. Create an Admin user first."
            });
        }


        // ---------------------------------------------------------
        // Create Department
        // ---------------------------------------------------------

        var department = new Departments
        {
            DepartmentName = dto.DepartmentName.Trim(),
            Description = dto.Description?.Trim() ?? string.Empty
        };

        _context.Departments.Add(department);

        await _context.SaveChangesAsync();


        // ---------------------------------------------------------
        // Automatically add Admin to Department
        // ---------------------------------------------------------

        var userDepartment = new UserDepartment
        {
            UserId = adminUser.Id,
            DepartmentId = department.Id
        };

        _context.UserDepartments.Add(userDepartment);

        await _context.SaveChangesAsync();


        return CreatedAtAction(
            nameof(GetDepartment),
            new { id = department.Id },
            new
            {
                message = "Department created successfully.",
                department = new
                {
                    department.Id,
                    department.DepartmentName,
                    department.Description,
                    department.CreatedAt
                },
                adminUser = new
                {
                    adminUser.Id,
                    adminUser.UserName,
                    adminUser.Role
                }
            });
    }


    // =========================================================
    // UPDATE DEPARTMENT
    // =========================================================

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateDepartment(
        Guid id,
        [FromBody] UpdateDepartmentDto dto)
    {
        var department = await _context.Departments
            .FirstOrDefaultAsync(d => d.Id == id);

        if (department == null)
        {
            return NotFound(new
            {
                message = "Department not found."
            });
        }


        if (string.IsNullOrWhiteSpace(dto.DepartmentName))
        {
            return BadRequest(new
            {
                message = "Department name is required."
            });
        }


        // Check if another department already has this name
        var duplicate = await _context.Departments
            .AnyAsync(d =>
                d.Id != id &&
                d.DepartmentName.ToLower() ==
                dto.DepartmentName.ToLower());

        if (duplicate)
        {
            return Conflict(new
            {
                message = "Another department with this name already exists."
            });
        }


        department.DepartmentName = dto.DepartmentName.Trim();
        department.Description = dto.Description?.Trim() ?? string.Empty;

        await _context.SaveChangesAsync();


        return Ok(new
        {
            message = "Department updated successfully.",
            department = new
            {
                department.Id,
                department.DepartmentName,
                department.Description,
                department.CreatedAt
            }
        });
    }


    // =========================================================
    // DELETE DEPARTMENT
    // =========================================================

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteDepartment(Guid id)
    {
        var department = await _context.Departments
            .FirstOrDefaultAsync(d => d.Id == id);

        if (department == null)
        {
            return NotFound(new
            {
                message = "Department not found."
            });
        }


        // Delete department
        _context.Departments.Remove(department);

        await _context.SaveChangesAsync();


        return Ok(new
        {
            message = "Department deleted successfully."
        });
    }


    // =========================================================
    // ADD USER TO DEPARTMENT
    // =========================================================

    [HttpPost("{departmentId:guid}/users/{userId:guid}")]
    public async Task<IActionResult> AddUserToDepartment(
        Guid departmentId,
        Guid userId)
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


        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }


        // Check existing mapping
        var existingMapping = await _context.UserDepartments
            .AnyAsync(ud =>
                ud.DepartmentId == departmentId &&
                ud.UserId == userId);

        if (existingMapping)
        {
            return Conflict(new
            {
                message = "User is already part of this department."
            });
        }


        var userDepartment = new UserDepartment
        {
            UserId = userId,
            DepartmentId = departmentId
        };

        _context.UserDepartments.Add(userDepartment);

        await _context.SaveChangesAsync();


        return Ok(new
        {
            message = "User added to department successfully.",
            user = new
            {
                user.Id,
                user.UserName,
                user.Role
            },
            department = new
            {
                department.Id,
                department.DepartmentName
            }
        });
    }


    // =========================================================
    // REMOVE USER FROM DEPARTMENT
    // =========================================================

    [HttpDelete("{departmentId:guid}/users/{userId:guid}")]
    public async Task<IActionResult> RemoveUserFromDepartment(
        Guid departmentId,
        Guid userId)
    {
        var mapping = await _context.UserDepartments
            .FirstOrDefaultAsync(ud =>
                ud.DepartmentId == departmentId &&
                ud.UserId == userId);

        if (mapping == null)
        {
            return NotFound(new
            {
                message = "User is not part of this department."
            });
        }


        _context.UserDepartments.Remove(mapping);

        await _context.SaveChangesAsync();


        return Ok(new
        {
            message = "User removed from department successfully."
        });
    }


    // =========================================================
    // GET USERS IN DEPARTMENT
    // =========================================================

    [HttpGet("{departmentId:guid}/users")]
    public async Task<IActionResult> GetDepartmentUsers(
        Guid departmentId)
    {
        var departmentExists = await _context.Departments
            .AnyAsync(d => d.Id == departmentId);

        if (!departmentExists)
        {
            return NotFound(new
            {
                message = "Department not found."
            });
        }


        var users = await _context.UserDepartments
            .Where(ud => ud.DepartmentId == departmentId)
            .Select(ud => new
            {
                ud.User.Id,
                ud.User.UserName,
                ud.User.Role,
                ud.User.CreatedAt,
                ud.User.LastActive
            })
            .ToListAsync();


        return Ok(users);
    }


    // =========================================================
    // GET DEPARTMENTS OF USER
    // =========================================================

    [HttpGet("user/{userId:guid}")]
    public async Task<IActionResult> GetUserDepartments(
        Guid userId)
    {
        var userExists = await _context.Users
            .AnyAsync(u => u.Id == userId);

        if (!userExists)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }


        var departments = await _context.UserDepartments
            .Where(ud => ud.UserId == userId)
            .Select(ud => new
            {
                ud.Department.Id,
                ud.Department.DepartmentName,
                ud.Department.Description,
                ud.Department.CreatedAt
            })
            .ToListAsync();


        return Ok(departments);
    }
}
