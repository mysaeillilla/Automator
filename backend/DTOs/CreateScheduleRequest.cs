using System.ComponentModel.DataAnnotations;

namespace backend.DTOs;

public class CreateScheduleRequest
{
    [Required]
    public string ScheduleName { get; set; } = string.Empty;

    [Required]
    public Guid ProcessId { get; set; }

    [Required]
    public TimeSpan Time { get; set; }

    [Required]
    public string Frequency { get; set; } = string.Empty;

    public DateTime? NextRun { get; set; }

    public bool IsActive { get; set; } = true;
}
