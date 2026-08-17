using System.ComponentModel.DataAnnotations;

namespace backend.Entities;

public class Departments
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public required string DepartmentName { get; set; }
    public required string Description { get; set; }

     public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

      // Navigation property
    public ICollection<UserDepartment> UserDepartments { get; set; }
        = new List<UserDepartment>();

        // Processes belonging to department
    public ICollection<Process> Processes { get; set; }
        = new List<Process>();

}
