namespace backend.DTOs;


public class ExecutionHistoryListDto
{
    public int ExecutionId { get; set; }

    public Guid ProcessId { get; set; }

    public string ProcessName { get; set; } = string.Empty;

    public Guid? TriggeredUserId { get; set; }

    public string? TriggeredUserName { get; set; }

    public DateTime StartTime { get; set; }

    public DateTime? EndTime { get; set; }

    public long? DurationMs { get; set; }

    public string Status { get; set; } = string.Empty;

    public string? Remarks { get; set; }

    public string? ErrorMessage { get; set; }

    public string? TriggerType { get; set; }

    public string? ExecutionMode { get; set; }

    public DateTime CreatedAt { get; set; }
}
