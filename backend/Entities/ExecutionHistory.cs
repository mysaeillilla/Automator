using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace backend.Entities;



public class ExecutionHistory
{
    
     // Auto-incrementing execution ID
    [Key]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public int ExecutionId { get; set; }


    // =========================
    // Process Information
    // =========================

    // Foreign key to Process
    [Required]
    public Guid ProcessId { get; set; }

    // Snapshot of process name at execution time
    [Required]
    [MaxLength(200)]
    public string ProcessName { get; set; } = string.Empty;

    public Process? Process { get; set; }


    // =========================
    // Trigger Information
    // =========================

    // User who triggered the execution
    public Guid? TriggeredUserId { get; set; }

    public Users? TriggeredUser { get; set; }

    // Snapshot of username at execution time
    [MaxLength(150)]
    public string? TriggeredUserName { get; set; }


    // =========================
    // Execution Timing
    // =========================

    [Required]
    public DateTime StartTime { get; set; }

    public DateTime? EndTime { get; set; }

    // Optional: calculated execution duration
    public long? DurationMs { get; set; }


    // =========================
    // Execution Status
    // =========================

    [Required]
    [MaxLength(50)]
    public string Status { get; set; } = "Running";


    // =========================
    // Execution Details
    // =========================

    [MaxLength(2000)]
    public string? Remarks { get; set; }

    [MaxLength(2000)]
    public string? ErrorMessage { get; set; }


    // =========================
    // Additional Information
    // =========================

    [MaxLength(100)]
    public string? TriggerType { get; set; }

    // Example:
    // Manual
    // Schedule
    // API
    // System

    [MaxLength(100)]
    public string? ExecutionMode { get; set; }

    // Example:
    // Production
    // Test


    // =========================
    // Audit
    // =========================

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? ModifiedAt { get; set; }
}
