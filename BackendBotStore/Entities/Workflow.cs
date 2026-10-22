using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace BackendBotStore.Entities;

public class Workflow
{
    public int Id { get; set; }

    /// <summary>Groups the versions of one workflow together (Name + Version is unique).</summary>
    public string Name { get; set; } = string.Empty;

    public string Version { get; set; } = "1.1.0";

    /// <summary>The full workflow definition (packages / variables / Actions) as a JSON string.</summary>
    public string WorkflowJson { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Defaults to "Admin" until real users are wired in.</summary>
    public string CreatedBy { get; set; } = "Admin";
}

public class WorkflowConfiguration : IEntityTypeConfiguration<Workflow>
{
    public void Configure(EntityTypeBuilder<Workflow> b)
    {
        b.ToTable("Workflows");
        b.HasKey(x => x.Id);

        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.CreatedBy).HasMaxLength(200).IsRequired().HasDefaultValue("Admin");

        b.HasIndex(x => new { x.Name, x.Version }).IsUnique();
    }
}