using backend.Entities;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : DbContext(options)
{
    


     public DbSet<Users> Users => Set<Users>();
 public DbSet<Departments> Departments { get; set; }

    public DbSet<UserDepartment> UserDepartments { get; set; }
      protected override void OnModelCreating(ModelBuilder modelBuilder)
    {

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

    modelBuilder.Entity<UserDepartment>()
        .HasIndex(x => new
        {
            x.UserId,
            x.DepartmentId
        })
        .IsUnique();

    }

    
    }
