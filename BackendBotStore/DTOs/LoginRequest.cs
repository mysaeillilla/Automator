using System.ComponentModel.DataAnnotations;
using BackendBotStore.Entities;

namespace BackendBotStore.DTOs;

public class LoginRequest
{
    [Required]
    public string UsernameOrEmail { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}
public class RegisterRequest
{
    [Required]
    public string Name { get; set; } = string.Empty;

    [Required]
    public string Username { get; set; } = string.Empty;

    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(8)]
    public string Password { get; set; } = string.Empty;
}

public class UpdateUserRequest
{
    public string? Name { get; set; }

    public string? Username { get; set; }

    [EmailAddress]
    public string? Email { get; set; }

    [MinLength(8)]
    public string? Password { get; set; }

    public UserRole? Role { get; set; }

    public bool? IsActive { get; set; }
}
public class AuthResponse
{
    public string Token { get; set; } = string.Empty;

    public int UserId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Username { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string Role { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }
}

