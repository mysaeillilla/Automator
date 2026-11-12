using BackendBotStore.Data;
using BackendBotStore.DTOs;
using BackendBotStore.Entities;
using BackendBotStore.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly TokenService _tokenService;
    private readonly IPasswordHasher<User> _passwordHasher;

    public AuthController(
        ApplicationDbContext context,
        TokenService tokenService,
        IPasswordHasher<User> passwordHasher)
    {
        _context = context;
        _tokenService = tokenService;
        _passwordHasher = passwordHasher;
    }


 // GET: api/User
    [HttpGet]
    public async Task<IActionResult> GetAllUsers()
    {
        var users = await _context.Users
            .AsNoTracking()
            .Select(user => new
            {
                user.Id,
                user.Name,
                user.Username,
                user.Email,
                Role = user.Role.ToString(),
                user.IsActive,
                user.CreatedAt
            })
            .OrderBy(user => user.Id)
            .ToListAsync();

        return Ok(users);
    }

    // PUT: api/User/{id}
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateUser(
        int id,
        [FromBody] UpdateUserRequest request)
    {
        var user = await _context.Users.FindAsync(id);

        if (user == null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        // Update Name
        if (request.Name != null)
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return BadRequest("Name cannot be empty.");

            user.Name = request.Name.Trim();
        }

        // Update Username
        if (request.Username != null)
        {
            if (string.IsNullOrWhiteSpace(request.Username))
                return BadRequest("Username cannot be empty.");

            var username = request.Username.Trim().ToLowerInvariant();

            bool exists = await _context.Users.AnyAsync(x =>
                x.Id != id && x.Username == username);

            if (exists)
                return Conflict("Username already exists.");

            user.Username = username;
        }

        // Update Email
        if (request.Email != null)
        {
            if (string.IsNullOrWhiteSpace(request.Email))
                return BadRequest("Email cannot be empty.");

            var email = request.Email.Trim().ToLowerInvariant();

            bool exists = await _context.Users.AnyAsync(x =>
                x.Id != id && x.Email == email);

            if (exists)
                return Conflict("Email already exists.");

            user.Email = email;
        }

        // Update Password
        if (request.Password != null)
        {
            if (request.Password.Length < 8)
                return BadRequest("Password must contain at least 8 characters.");

            user.PasswordHash = _passwordHasher.HashPassword(
                user,
                request.Password
            );
        }

        // Update Role
        if (request.Role.HasValue)
        {
            if (!Enum.IsDefined(typeof(UserRole), request.Role.Value))
                return BadRequest("Invalid user role.");

            user.Role = request.Role.Value;
        }

        // Update Active Status
        if (request.IsActive.HasValue)
        {
            user.IsActive = request.IsActive.Value;
        }

        await _context.SaveChangesAsync();

        return Ok(new
        {
            message = "User updated successfully.",
            user = new
            {
                user.Id,
                user.Name,
                user.Username,
                user.Email,
                Role = user.Role.ToString(),
                user.IsActive,
                user.CreatedAt
            }
        });
    }
    // REGISTER
    [HttpPost("register")]
    public async Task<IActionResult> Register(
        [FromBody] RegisterRequest request)
    {
        var username = request.Username.Trim().ToLowerInvariant();
        var email = request.Email.Trim().ToLowerInvariant();

        var existingUser = await _context.Users
            .AnyAsync(x =>
                x.Username == username ||
                x.Email == email);

        if (existingUser)
        {
            return Conflict(new
            {
                message = "Username or email already exists."
            });
        }

        var user = new User
        {
            Name = request.Name.Trim(),
            Username = username,
            Email = email,
            Role = UserRole.User,
            IsActive = true
        };

        user.PasswordHash = _passwordHasher.HashPassword(
            user,
            request.Password
        );

        _context.Users.Add(user);

        await _context.SaveChangesAsync();

        return Ok(new
        {
            message = "User registered successfully.",
            userId = user.Id,
            username = user.Username,
            role = user.Role.ToString()
        });
    }

    // LOGIN
    [HttpPost("login")]
    public async Task<IActionResult> Login(
        [FromBody] LoginRequest request)
    {
        var login = request.UsernameOrEmail.Trim().ToLowerInvariant();

        var user = await _context.Users
            .FirstOrDefaultAsync(x =>
                x.Username == login ||
                x.Email == login);

        if (user == null)
        {
            return Unauthorized(new
            {
                message = "Invalid username/email or password."
            });
        }

        if (!user.IsActive)
        {
            return Unauthorized(new
            {
                message = "Your account is inactive."
            });
        }

        var verificationResult = _passwordHasher.VerifyHashedPassword(
            user,
            user.PasswordHash,
            request.Password
        );

        if (verificationResult == PasswordVerificationResult.Failed)
        {
            return Unauthorized(new
            {
                message = "Invalid username/email or password."
            });
        }

        // Upgrade the hash if the password hasher recommends it.
        if (verificationResult ==
            PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = _passwordHasher.HashPassword(
                user,
                request.Password
            );

            await _context.SaveChangesAsync();
        }

        var (token, expiresAt) = _tokenService.GenerateToken(user);

        var response = new AuthResponse
        {
            Token = token,
            UserId = user.Id,
            Name = user.Name,
            Username = user.Username,
            Email = user.Email,
            Role = user.Role.ToString(),
            ExpiresAt = expiresAt
        };

        return Ok(response);
    }
}