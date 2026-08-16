using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Entities;

public class UserDepartment
{
     [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [ForeignKey(nameof(User))]
    public Guid UserId { get; set; }

    public Users User { get; set; } = null!;


    [ForeignKey(nameof(Department))]
    public Guid DepartmentId { get; set; }

    public Departments Department { get; set; } = null!;


    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
