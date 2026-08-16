using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using backend.Data;
using backend.DTOs;
using backend.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace backend.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    

    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;

    public AuthController(ApplicationDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }
private const string DateFormat = "dd-MM-yyyy hh:mm tt";

    [HttpGet]
public async Task<ActionResult<List<UserListDto>>> GetUsers()
{
    var users = await _context.Users
        .OrderBy(u => u.UserName)
        .Select(u => new
        {
            u.Id,
            u.UserName,
            u.Role,
            u.CreatedAt,
            u.LastActive
        })
        .ToListAsync();

    var result = users.Select(u => new UserListDto
    {
        Id = u.Id.ToString(),
        UserName = u.UserName,
        Role = u.Role.ToString(),
        CreatedAt = u.CreatedAt.ToString(DateFormat),
        LastActive = u.LastActive.ToString(DateFormat)
    }).ToList();

    return Ok(result);
}
    [HttpPost("register")]
public async Task<ActionResult<AuthResponseDto>> Register(RegisterDto request)
{
    if (string.IsNullOrWhiteSpace(request.UserName) || string.IsNullOrWhiteSpace(request.Password))
    {
        return BadRequest("Username and password are required.");
    }

    bool exists = await _context.Users
        .AnyAsync(u => u.UserName.ToLower() == request.UserName.ToLower());

    if (exists)
    {
        return Conflict("Username already exists.");
    }

    CreatePasswordHash(request.Password, out string hash, out string salt);

    var user = new Users
    {
        UserName = request.UserName,
        PasswordHash = hash,
        PasswordSalt = salt,
        Role = request.Role
    };

    _context.Users.Add(user);
    await _context.SaveChangesAsync();

    var token = CreateToken(user, out DateTime expiresAt);

    return Ok(new AuthResponseDto
    {
        Token = token,
        UserName = user.UserName,
        ExpiresAt = expiresAt
    });
}

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponseDto>> Login(LoginDto request)
    {
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.UserName.ToLower() == request.UserName.ToLower());

        if (user is null)
        {
            return Unauthorized("Invalid username or password.");
        }

        if (!VerifyPasswordHash(request.Password, user.PasswordHash, user.PasswordSalt))
        {
            return Unauthorized("Invalid username or password.");
        }

        user.LastActive = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        var token = CreateToken(user, out DateTime expiresAt);

        return Ok(new AuthResponseDto
        {
            Token = token,
            UserName = user.UserName,
            Role = user.Role.ToString(),
            ExpiresAt = expiresAt
        });
    }

    // ---- Helpers ----

    private static void CreatePasswordHash(string password, out string hash, out string salt)
    {
        using var hmac = new HMACSHA512();
        salt = Convert.ToBase64String(hmac.Key);
        hash = Convert.ToBase64String(
            hmac.ComputeHash(Encoding.UTF8.GetBytes(password))
        );
    }

    private static bool VerifyPasswordHash(string password, string storedHash, string storedSalt)
    {
        byte[] saltBytes = Convert.FromBase64String(storedSalt);
        using var hmac = new HMACSHA512(saltBytes);
        byte[] computedHash = hmac.ComputeHash(Encoding.UTF8.GetBytes(password));
        return CryptographicOperations.FixedTimeEquals(
            computedHash,
            Convert.FromBase64String(storedHash)
        );
    }

    private string CreateToken(Users user, out DateTime expiresAt)
    {
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.UserName),
             new Claim(ClaimTypes.Role, user.Role.ToString())
        };

        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_configuration["Jwt:Key"]!)
        );
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha512Signature);

        expiresAt = DateTime.UtcNow.AddHours(49); // adjust expiry as needed

        var token = new JwtSecurityToken(
            issuer: _configuration["Jwt:Issuer"],
            audience: _configuration["Jwt:Audience"],
            claims: claims,
            expires: expiresAt,
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }



    [HttpDelete("{id:guid}")]
public async Task<IActionResult> DeleteUser(Guid id)
{
    var user = await _context.Users
        .FirstOrDefaultAsync(u => u.Id == id);

    if (user is null)
    {
        return NotFound(new
        {
            message = "User not found."
        });
    }

    if (user.Role == Role.Admin)
    {
        return BadRequest(new
        {
            message = "Admin users cannot be deleted."
        });
    }

    _context.Users.Remove(user);
    await _context.SaveChangesAsync();

    return Ok(new
    {
        message = "User deleted successfully.",
        id = id
    });
}
}
