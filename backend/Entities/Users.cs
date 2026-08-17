using System.ComponentModel.DataAnnotations;

namespace backend.Entities;


public enum Role
{
    
    Admin,
    Developer,
    Creator,

}
public class Users
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public required string UserName { get; set; }
    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    [Required]
    public string PasswordSalt { get; set; } = string.Empty;
 public Role Role { get; set; } = Role.Developer;
     public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime LastActive { get; set; } = DateTime.UtcNow;

    // Navigation property
   // Navigation property
    public ICollection<UserDepartment> UserDepartments { get; set; }
        = new List<UserDepartment>();

         // User -> Processes
    public ICollection<UserProcess> UserProcesses { get; set; }
        = new List<UserProcess>();
    
}
