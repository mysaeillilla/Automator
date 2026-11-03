using BackendBotStore.Data;
using BackendBotStore.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// ── CORS (one policy) ──
const string AngularPolicy = "AngularApp";

builder.Services.AddCors(options =>
{
    options.AddPolicy(AngularPolicy, policy =>
        policy.WithOrigins("http://localhost:4200", "https://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod());
});

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ── Workflow engine ──
// Core catalog (singleton), its Package-table synchronizer and startup sync.
// Add your own actions / variable types with: builder.Services.AddCoreContributor<MyExtraCoreItems>();
builder.Services.AddCoreCatalog();

// The executor holds the state of one run (variables, logs), so it must be Transient, never Singleton.
// Its variable store and variable actions are created by the executor itself.
builder.Services.AddTransient<WorkflowExecutor>();
builder.Services.AddSingleton<WorkflowRunner>();

// ── Database ──
var connectionString =
    builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection is missing from appsettings.json");

// Enable JSON serialization for Dictionary and List properties.
var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
dataSourceBuilder.EnableDynamicJson();
var dataSource = dataSourceBuilder.Build();

builder.Services.AddSingleton(dataSource);
builder.Services.AddDbContext<ApplicationDbContext>(options => options.UseNpgsql(dataSource));

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseHttpsRedirection();
app.UseRouting();
app.UseCors(AngularPolicy);
app.UseAuthorization();

app.MapControllers();

app.Run();