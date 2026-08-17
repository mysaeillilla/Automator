using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Entities;

public class Process
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public required string ProcessName { get; set; }

    public required string Description { get; set; }

    // Department relationship
    [ForeignKey(nameof(Department))]
    public Guid DepartmentId { get; set; }

    public Departments Department { get; set; } = null!;

    // Users assigned to this process
    public ICollection<UserProcess> UserProcesses { get; set; }
        = new List<UserProcess>();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}