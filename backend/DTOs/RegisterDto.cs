using backend.Entities;

namespace backend.DTOs;

public class RegisterDto
{
    public required string UserName { get; set; }

    public Role Role { get; set; } = Role.Developer; // defaults if not provided
    public required string Password { get; set; }
}

public class LoginDto
{
    public required string UserName { get; set; }



    public required string Password { get; set; }
}

public class AuthResponseDto
{
    public required string Token { get; set; }
    public required string UserName { get; set; }
     public string Role { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}

public class UserListDto
{ 
    public required string Id { get; set; }
    public required string UserName { get; set; }
    public required string Role { get; set; }
    public required string CreatedAt { get; set; }
    public required string LastActive { get; set; }
}