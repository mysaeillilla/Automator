using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Entities;

public class UserProcess
{
    
     [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [ForeignKey(nameof(User))]
    public Guid UserId { get; set; }

    public Users User { get; set; } = null!;


    [ForeignKey(nameof(Process))]
    public Guid ProcessId { get; set; }

    public Process Process { get; set; } = null!;


    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
