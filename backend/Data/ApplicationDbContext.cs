using backend.Entities;
using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : DbContext(options)
{
    
public DbSet<Schedules> Schedules { get; set; }
public DbSet<ExecutionHistory> ExecutionHistories { get; set; }
     public DbSet<Users> Users => Set<Users>();
 public DbSet<Departments> Departments { get; set; }
 public DbSet<Process> Process { get; set; }
 public DbSet<UserProcess> UserProcess { get; set; }
public DbSet<GitHubConnection> GitHubConnections => Set<GitHubConnection>();
    public DbSet<UserDepartment> UserDepartments { get; set; }
    public DbSet<GitHubRepositoryRecord> GitHubRepositories  { get; set; }
      protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
modelBuilder.Entity<Process>()
    .HasOne(p => p.Department)
    .WithMany(d => d.Processes)
    .HasForeignKey(p => p.DepartmentId)
    .OnDelete(DeleteBehavior.Cascade);


// ------------------------------------
// User -> Department
// Many-to-Many through UserDepartment
// ------------------------------------
  modelBuilder.Entity<GitHubConnection>(entity =>
    {
        entity.HasIndex(e => e.UserId).IsUnique();
        entity.HasOne(e => e.User)
              .WithOne()
              .HasForeignKey<GitHubConnection>(e => e.UserId)
              .OnDelete(DeleteBehavior.Cascade);
    });
modelBuilder.Entity<UserDepartment>()
    .HasOne(ud => ud.User)
    .WithMany(u => u.UserDepartments)
    .HasForeignKey(ud => ud.UserId)
    .OnDelete(DeleteBehavior.Cascade);

modelBuilder.Entity<UserDepartment>()
    .HasOne(ud => ud.Department)
    .WithMany(d => d.UserDepartments)
    .HasForeignKey(ud => ud.DepartmentId)
    .OnDelete(DeleteBehavior.Cascade);


// ------------------------------------
// User -> Process
// Many-to-Many through UserProcess
// ------------------------------------

modelBuilder.Entity<UserProcess>()
    .HasOne(up => up.User)
    .WithMany(u => u.UserProcesses)
    .HasForeignKey(up => up.UserId)
    .OnDelete(DeleteBehavior.Cascade);

modelBuilder.Entity<UserProcess>()
    .HasOne(up => up.Process)
    .WithMany(p => p.UserProcesses)
    .HasForeignKey(up => up.ProcessId)
    .OnDelete(DeleteBehavior.Cascade);


// ------------------------------------
// Prevent duplicate relationships
// ------------------------------------

modelBuilder.Entity<UserDepartment>()
    .HasIndex(x => new
    {
        x.UserId,
        x.DepartmentId
    })
    .IsUnique();

modelBuilder.Entity<UserProcess>()
    .HasIndex(x => new
    {
        x.UserId,
        x.ProcessId
    })
    .IsUnique();
      modelBuilder.Entity<Users>()
            .HasIndex(u => u.UserName)
            .IsUnique();

            modelBuilder.Entity<UserDepartment>()
        .HasOne(x => x.User)
        .WithMany(x => x.UserDepartments)
        .HasForeignKey(x => x.UserId)
        .OnDelete(DeleteBehavior.Cascade);

    modelBuilder.Entity<UserDepartment>()
        .HasOne(x => x.Department)
        .WithMany(x => x.UserDepartments)
        .HasForeignKey(x => x.DepartmentId)
        .OnDelete(DeleteBehavior.Cascade);
modelBuilder.Entity<Schedules>()
    .HasOne(s => s.Process)
    .WithMany(p => p.Schedules)
    .HasForeignKey(s => s.ProcessId)
    .OnDelete(DeleteBehavior.Cascade);


    modelBuilder.Entity<Process>()
    .HasOne(p => p.Department)
    .WithMany(d => d.Processes)
    .HasForeignKey(p => p.DepartmentId)
    .OnDelete(DeleteBehavior.Cascade);



    modelBuilder.Entity<UserDepartment>()
        .HasIndex(x => new
        {
            x.UserId,
            x.DepartmentId
        })
        .IsUnique();

    }

    
    }
