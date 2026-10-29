using BackendBotStore.Data;      // TODO: your DbContext namespace
using BackendBotStore.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Services;

/// <summary>
/// Makes the Packages / PackageActions tables mirror the Core catalog, so GET /api/Packages
/// returns "Core" like any other package and the designer shows its actions.
/// Idempotent: safe to run on every startup and whenever the catalog changes.
/// </summary>
public sealed class CorePackageSynchronizer(ApplicationDbContext db, ICoreCatalog catalog, ILogger<CorePackageSynchronizer> log)
{
    public async Task SyncAsync(CancellationToken ct = default)
    {
        var package = await db.Packages
            .Include(p => p.Actions)
            .FirstOrDefaultAsync(p => p.Name == catalog.PackageName, ct);

        if (package is null)
        {
            package = new Package
            {
                Name = catalog.PackageName,
                Version = catalog.Version,
                FilePath = string.Empty,          // built in: there is no DLL
                Dependencies = [],
                Actions = [],
            };
            db.Packages.Add(package);
        }
        else
        {
            package.Version = catalog.Version;
            package.FilePath = string.Empty;
        }

        var wanted = catalog.Actions.ToDictionary(a => a.Name, StringComparer.OrdinalIgnoreCase);

        // remove actions that are no longer in the catalog
        foreach (var stale in package.Actions.Where(a => !wanted.ContainsKey(a.Name)).ToList())
        {
            package.Actions.Remove(stale);
            db.PackageActions.Remove(stale);
        }

        // add new actions, update changed ones
        foreach (var info in wanted.Values)
        {
            var existing = package.Actions.FirstOrDefault(a =>
                a.Name.Equals(info.Name, StringComparison.OrdinalIgnoreCase));

            if (existing is null)
            {
                package.Actions.Add(new PackageAction
                {
                    Name = info.Name,
                    Inputs = new(info.Inputs),
                    Outputs = new(info.Outputs),
                });
                continue;
            }

            if (SameMap(existing.Inputs, info.Inputs) && SameMap(existing.Outputs, info.Outputs))
                continue;

            existing.Inputs = new(info.Inputs);
            existing.Outputs = new(info.Outputs);
            // dictionary columns (jsonb) are not always change-tracked by reference; force it
            db.Entry(existing).Property(a => a.Inputs).IsModified = true;
            db.Entry(existing).Property(a => a.Outputs).IsModified = true;
        }

        var changes = await db.SaveChangesAsync(ct);
        log.LogInformation("Core package synced ({Actions} actions, {Changes} row changes).", wanted.Count, changes);
    }

    private static bool SameMap(Dictionary<string, string>? a, Dictionary<string, string> b) =>
        a is not null && a.Count == b.Count && a.All(kv => b.TryGetValue(kv.Key, out var v) && v == kv.Value);
}

/// <summary>Syncs once at startup, then again whenever an action / type is registered at runtime.</summary>
public sealed class CorePackageStartupService(
    IServiceScopeFactory scopes,
    ICoreCatalog catalog,
    ILogger<CorePackageStartupService> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        await SyncAsync(ct);
        catalog.Changed += OnChanged;
    }

    public Task StopAsync(CancellationToken ct)
    {
        catalog.Changed -= OnChanged;
        return Task.CompletedTask;
    }

    private void OnChanged() => _ = Task.Run(() => SyncAsync(CancellationToken.None));

    private async Task SyncAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<CorePackageSynchronizer>().SyncAsync(ct);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Could not sync the Core package.");
        }
    }
}

/// <summary>Lets the designer load action metadata (blocks / conditions) and the available variable types.</summary>
[ApiController]
[Route("api/Core")]
public sealed class CoreController(ICoreCatalog catalog) : ControllerBase
{
    [HttpGet("catalog")]
    public IActionResult GetCatalog() => Ok(new
    {
        package = catalog.PackageName,
        version = catalog.Version,
        actions = catalog.Actions,
        variableTypes = catalog.VariableTypes,
    });
}