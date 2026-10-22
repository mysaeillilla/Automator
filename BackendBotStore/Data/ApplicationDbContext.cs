using BackendBotStore.Entities;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Data;

public class ApplicationDbContext(
    DbContextOptions<ApplicationDbContext> options)
    : DbContext(options)
{
public DbSet<Package> Packages => Set<Package>();

public DbSet<PackageAction> PackageActions => Set<PackageAction>();
   public DbSet<WorkflowExecutionStatus> WorkflowExecutions => Set<WorkflowExecutionStatus>();
   public DbSet<Workflow> Workflows => Set<Workflow>();
   public DbSet<WorkflowActionExecutionStatus> WorkflowActionExecutions => Set<WorkflowActionExecutionStatus>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Package>(entity =>
        {
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Name)
                .IsRequired();

            entity.Property(p => p.Version)
                .IsRequired();

            entity.Property(p => p.FilePath)
                .IsRequired();

            entity.Property(p => p.Dependencies)
                .HasColumnType("jsonb");
        });

        modelBuilder.Entity<PackageAction>(entity =>
        {
            entity.HasKey(a => a.Id);

            entity.Property(a => a.Inputs)
                .HasColumnType("jsonb");

            entity.Property(a => a.Outputs)
                .HasColumnType("jsonb");

            entity.HasOne(a => a.Package)
                .WithMany(p => p.Actions)
                .HasForeignKey(a => a.PackageId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Package>()
    .Property(p => p.Dependencies)
    .HasColumnType("jsonb");

modelBuilder.Entity<PackageAction>()
    .Property(a => a.Inputs)
    .HasColumnType("jsonb");

modelBuilder.Entity<PackageAction>()
    .Property(a => a.Outputs)
    .HasColumnType("jsonb");

modelBuilder.Entity<PackageAction>()
    .HasOne(a => a.Package)
    .WithMany(p => p.Actions)
    .HasForeignKey(a => a.PackageId)
    .OnDelete(DeleteBehavior.Cascade);
    }
}
