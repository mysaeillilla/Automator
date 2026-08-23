using System.ComponentModel.DataAnnotations;

namespace backend.DTOs;

public class CreateScheduleRequest
{
    [Required]
    public string ScheduleName { get; set; } = string.Empty;

    [Required]
    public Guid ProcessId { get; set; }

    /// <summary>
    /// Expected format: HH:mm (24-hour), e.g. "14:30"
    /// </summary>
    [Required]
    public string Time { get; set; } = string.Empty;

    [Required]
    public string Frequency { get; set; } = string.Empty;

    /// <summary>
    /// Expected format: dd-MM-yyyy hh:mm tt (e.g. "23-08-2026 05:48 AM")
    /// </summary>
    [Required]
    public string NextRun { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
}