using System.Security.Cryptography;
using System.Text;
using backend.Data;
using backend.Entities;
using backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);


builder.Services.AddCors(options =>
{
    options.AddPolicy("AngularPolicy", policy =>
    {
        policy
            .WithOrigins("http://localhost:4200", "https://localhost:4200")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});
builder.Services.AddControllers();

builder.Services.AddHttpClient<GitHubService>();


// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();






var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Jwt:Key is not configured.");


builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,

            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)
            )
        };
    });


builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(
        builder.Configuration.GetConnectionString("DefaultConnection")));



var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

    bool adminExists = db.Users.Any(u => u.UserName.ToLower() == "admin");

    if (!adminExists)
    {
        using var hmac = new HMACSHA512();
        string salt = Convert.ToBase64String(hmac.Key);
        string hash = Convert.ToBase64String(
            hmac.ComputeHash(Encoding.UTF8.GetBytes("Admin@123"))
        );

        var adminUser = new Users
        {
            UserName = "Admin",
            PasswordHash = hash,
            PasswordSalt = salt,
            Role = Role.Admin
        };

        db.Users.Add(adminUser);
        db.SaveChanges();
    }
}
// app.UseHttpsRedirection();  // 1. redirect HTTP → HTTPS before anything else

app.UseStaticFiles();

app.UseRouting();

app.UseCors("AngularPolicy"); // 2. CORS headers added to every response
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();







app.Run();
