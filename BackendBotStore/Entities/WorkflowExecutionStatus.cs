using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BackendBotStore.Entities;

public enum ExecutionState
{
    Pending = 0,
    Running = 1,
    Succeeded = 2,
    Failed = 3,
    Skipped = 4
}

/// <summary>One row per call to POST api/WorkflowExecution/execute.</summary>
public class WorkflowExecutionStatus
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The full workflow definition that was submitted.</summary>
    public string WorkflowJson { get; set; } = string.Empty;

    /// <summary>The "inputs" overrides sent with the request (JSON), if any.</summary>
    public string? InputsJson { get; set; }

    /// <summary>Variables flagged "output": true after the run (JSON).</summary>
    public string? OutputsJson { get; set; }

    public ExecutionState Status { get; set; } = ExecutionState.Pending;

    /// <summary>WorkflowExecutor.LastError when the run fails.</summary>
    public string? Error { get; set; }

    /// <summary>Key of the action that failed (e.g. "1").</summary>
    public string? FailedActionId { get; set; }

    /// <summary>WorkflowExecutor.Logs serialized as a JSON array.</summary>
    public string? LogsJson { get; set; }

    public int TotalActions { get; set; }
    public int CompletedActions { get; set; }

    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }
    public long? DurationMs { get; set; }

    public ICollection<WorkflowActionExecutionStatus> Actions { get; set; } = new List<WorkflowActionExecutionStatus>();
}

/// <summary>One row per action executed inside a workflow run.</summary>
public class WorkflowActionExecutionStatus
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid WorkflowExecutionStatusId { get; set; }
    public WorkflowExecutionStatus WorkflowExecution { get; set; } = null!;

    /// <summary>Position in the run (1-based, follows numeric key order).</summary>
    public int Sequence { get; set; }

    /// <summary>Key in the workflow's "Actions" object (e.g. "1").</summary>
    public string ActionId { get; set; } = string.Empty;

    public string ClassName { get; set; } = string.Empty;
    public string FunctionName { get; set; } = string.Empty;

    public ExecutionState Status { get; set; } = ExecutionState.Pending;

    /// <summary>Inputs after {{variable}} resolution (JSON). Mask secrets before saving.</summary>
    public string? InputsJson { get; set; }

    /// <summary>Values written to output variables by this action (JSON).</summary>
    public string? OutputsJson { get; set; }

    public string? Error { get; set; }

    public DateTime? StartedAtUtc { get; set; }
    public DateTime? CompletedAtUtc { get; set; }
    public long? DurationMs { get; set; }
}

// ─────────────────────────────────────────────────────────────
//  EF Core mapping – picked up by
//  modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly)
//  and add DbSet<> properties for both entities on your DbContext.
// ─────────────────────────────────────────────────────────────

public class WorkflowExecutionStatusConfiguration : IEntityTypeConfiguration<WorkflowExecutionStatus>
{
    public void Configure(EntityTypeBuilder<WorkflowExecutionStatus> b)
    {
        b.ToTable("WorkflowExecutions");
        b.HasKey(x => x.Id);

        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        b.Property(x => x.FailedActionId).HasMaxLength(100);

        b.HasIndex(x => x.Status);
        b.HasIndex(x => x.StartedAtUtc);

        b.HasMany(x => x.Actions)
         .WithOne(x => x.WorkflowExecution)
         .HasForeignKey(x => x.WorkflowExecutionStatusId)
         .OnDelete(DeleteBehavior.Cascade);
    }
}

public class WorkflowActionExecutionStatusConfiguration : IEntityTypeConfiguration<WorkflowActionExecutionStatus>
{
    public void Configure(EntityTypeBuilder<WorkflowActionExecutionStatus> b)
    {
        b.ToTable("WorkflowActionExecutions");
        b.HasKey(x => x.Id);

        b.Property(x => x.ActionId).HasMaxLength(100).IsRequired();
        b.Property(x => x.ClassName).HasMaxLength(300).IsRequired();
        b.Property(x => x.FunctionName).HasMaxLength(200).IsRequired();
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);

        b.HasIndex(x => new { x.WorkflowExecutionStatusId, x.Sequence }).IsUnique();
    }
}