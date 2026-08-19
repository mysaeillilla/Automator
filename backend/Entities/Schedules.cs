using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Entities;

public class Schedules
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string ScheduleName { get; set; } = string.Empty;

    [Required]
    public Guid ProcessId { get; set; }

    [ForeignKey(nameof(ProcessId))]
    public Process Process { get; set; } = null!;

    // Example: "09:00"
    [Required]
    public TimeSpan Time { get; set; }

    // Daily, Weekly, Monthly, etc.
    [Required]
    public string Frequency { get; set; } = string.Empty;

    public DateTime? NextRun { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
