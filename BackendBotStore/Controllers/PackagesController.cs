using System.IO.Compression;
using System.Text.Json;
using BackendBotStore.Data;
using BackendBotStore.DTOs;
using BackendBotStore.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PackagesController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IWebHostEnvironment _environment;

    private readonly string _packagesRoot;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public PackagesController(
        ApplicationDbContext context,
        IWebHostEnvironment environment)
    {
        _context = context;
        _environment = environment;

        _packagesRoot = Path.Combine(
            _environment.ContentRootPath,
            "Packages");
    }

    // GET: api/Packages
    [HttpGet]
    public async Task<IActionResult> GetPackages()
    {
        var packages = await _context.Packages
            .AsNoTracking()
            .Include(p => p.Actions)
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.Version,
                p.FilePath,
                p.Dependencies,

                Actions = p.Actions.Select(a => new
                {
                    a.Id,
                    a.PackageId,
                    a.Name,
                    a.Inputs,
                    a.Outputs
                }).ToList()
            })
            .ToListAsync();

        return Ok(packages);
    }

    // POST: api/Packages/upload
    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(100_000_000)]
    public async Task<IActionResult> UploadPackage(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        if (file == null || file.Length == 0)
            return BadRequest("Please upload a ZIP file.");

        if (!string.Equals(
                Path.GetExtension(file.FileName),
                ".zip",
                StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest("Only ZIP files are allowed.");
        }

        var stagingPath = Path.Combine(
            _packagesRoot,
            $".upload-{Guid.NewGuid():N}");

        string? finalPath = null;
        bool packageMoved = false;

        try
        {
            Directory.CreateDirectory(_packagesRoot);
            Directory.CreateDirectory(stagingPath);

            // Extract the ZIP safely into a temporary directory.
            var zipPath = Path.Combine(stagingPath, "upload.zip");

            await using (var stream = System.IO.File.Create(zipPath))
            {
                await file.CopyToAsync(stream, cancellationToken);
            }

            var extractPath = Path.Combine(stagingPath, "extracted");
            ZipFile.ExtractToDirectory(zipPath, extractPath);

            System.IO.File.Delete(zipPath);

            // Locate package.json.
            var jsonFiles = Directory.GetFiles(
                extractPath,
                "package.json",
                SearchOption.AllDirectories);

            if (jsonFiles.Length != 1)
            {
                return BadRequest(
                    "The ZIP must contain exactly one package.json file.");
            }

            var json = await System.IO.File.ReadAllTextAsync(
                jsonFiles[0],
                cancellationToken);

            var dto = JsonSerializer.Deserialize<PackageUploadDto>(
                json,
                JsonOptions);

            if (dto == null ||
                string.IsNullOrWhiteSpace(dto.PackageName) ||
                string.IsNullOrWhiteSpace(dto.Version))
            {
                return BadRequest(
                    "PackageName and Version are required in package.json.");
            }

            // PackageName must be a DLL filename, not a path.
            if (!string.Equals(
                    Path.GetFileName(dto.PackageName),
                    dto.PackageName,
                    StringComparison.Ordinal) ||
                !dto.PackageName.EndsWith(
                    ".dll",
                    StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(
                    "PackageName must be a valid DLL filename, e.g. Excel.dll.");
            }

            if (dto.Actions == null || dto.Actions.Count == 0)
            {
                return BadRequest(
                    "At least one action must be defined in package.json.");
            }

            if (dto.Actions.Any(a =>
                    string.IsNullOrWhiteSpace(a.ActionName)))
            {
                return BadRequest(
                    "Every action must have an ActionName.");
            }

            // Ensure the main DLL exists in the extracted package.
            var mainDll = Directory.GetFiles(
                    extractPath,
                    dto.PackageName,
                    SearchOption.AllDirectories)
                .FirstOrDefault();

            if (mainDll == null)
            {
                return BadRequest(
                    $"Main DLL '{dto.PackageName}' was not found in the ZIP.");
            }

            // Parse the comma-separated dependency DLL names.
            var dependencies = (dto.Dependencies ?? string.Empty)
                .Split(',', StringSplitOptions.TrimEntries |
                            StringSplitOptions.RemoveEmptyEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            foreach (var dependency in dependencies)
            {
                if (!string.Equals(
                        Path.GetFileName(dependency),
                        dependency,
                        StringComparison.Ordinal) ||
                    !dependency.EndsWith(
                        ".dll",
                        StringComparison.OrdinalIgnoreCase))
                {
                    return BadRequest(
                        $"Invalid dependency DLL name: {dependency}");
                }

                var dependencyExists = Directory.GetFiles(
                    extractPath,
                    dependency,
                    SearchOption.AllDirectories).Length > 0;

                if (!dependencyExists)
                {
                    return BadRequest(
                        $"Dependency DLL '{dependency}' was not found in the ZIP.");
                }
            }

            // Package folder uses the DLL name without its extension.
            var packageFolder = Path.GetFileNameWithoutExtension(
                dto.PackageName);

            var packageDirectory = Path.Combine(
                _packagesRoot,
                packageFolder);

            var versionDirectory = Path.Combine(
                packageDirectory,
                dto.Version);

            // Prevent overwriting an existing version.
            var duplicate = await _context.Packages.AnyAsync(
                p => p.Name == packageFolder &&
                     p.Version == dto.Version,
                cancellationToken);

            if (duplicate || Directory.Exists(versionDirectory))
            {
                return Conflict(
                    $"Package '{packageFolder}' version '{dto.Version}' already exists.");
            }

            Directory.CreateDirectory(packageDirectory);

            // Move the extracted package into its permanent location.
            finalPath = versionDirectory;
            Directory.Move(extractPath, finalPath);
            packageMoved = true;

            var package = new Package
            {
                Name = packageFolder,
                Version = dto.Version,
                FilePath = Path.Combine(
                    finalPath,
                    dto.PackageName),
                Dependencies = dependencies,

                Actions = dto.Actions.Select(action =>
                    new PackageAction
                    {
                        Name = action.ActionName,
                        Inputs = action.Inputs ?? new(),
                        Outputs = action.Outputs ?? new()
                    }).ToList()
            };

            _context.Packages.Add(package);

            await _context.SaveChangesAsync(cancellationToken);

            return CreatedAtAction(
                nameof(GetPackages),
                new
                {
                    package.Id
                },
                new
                {
                    package.Id,
                    package.Name,
                    package.Version,
                    package.FilePath,
                    package.Dependencies,
                    Actions = package.Actions.Select(a => new
                    {
                        a.Id,
                        a.Name,
                        a.Inputs,
                        a.Outputs
                    })
                });
        }
        catch (JsonException)
        {
            return BadRequest("package.json contains invalid JSON.");
        }
        catch (InvalidDataException)
        {
            return BadRequest(
                "The uploaded ZIP file is invalid or contains invalid entries.");
        }
        catch (DbUpdateException)
        {
            if (packageMoved && finalPath != null)
                Directory.Delete(finalPath, recursive: true);

            return Conflict(
                "Could not save the package. Check for duplicate records or database constraints.");
        }
        catch (IOException)
        {
            if (packageMoved && finalPath != null &&
                Directory.Exists(finalPath))
            {
                Directory.Delete(finalPath, recursive: true);
            }

            return StatusCode(
                StatusCodes.Status500InternalServerError,
                "An error occurred while storing the package files.");
        }
        finally
        {
            if (Directory.Exists(stagingPath))
            {
                Directory.Delete(stagingPath, recursive: true);
            }
        }
    }
}
