using System.Text.Json;
using BackendBotStore.Data;      // <- namespace of your DbContext (rename AppDbContext below to match)
using BackendBotStore.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace BackendBotStore.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WorkflowsController : ControllerBase
{
    private const long MaxBodyBytes = 10 * 1024 * 1024;   // 10 MB

    private readonly ApplicationDbContext _db;

    public WorkflowsController(ApplicationDbContext db) => _db = db;

    /// <summary>
    /// Lists workflows without their JSON body.
    /// ?name=  filters by (partial) name, ?latestOnly=true returns only the most recently uploaded version of each flow.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? name, [FromQuery] bool latestOnly = false)
    {
        var query = _db.Workflows.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(name))
            query = query.Where(w => w.Name.Contains(name));

        // Versions are free-form strings ("1.1.0"), so "latest" means most recently uploaded.
        if (latestOnly)
            query = query.Where(w => w.Id == _db.Workflows.Where(x => x.Name == w.Name).Max(x => x.Id));

        var items = await query
            .OrderBy(w => w.Name)
            .ThenByDescending(w => w.Id)
            .Select(w => new { w.Id, w.Name, w.Version, w.CreatedAt, w.CreatedBy })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>Returns one workflow including its JSON definition.</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var workflow = await _db.Workflows.AsNoTracking().FirstOrDefaultAsync(w => w.Id == id);
        if (workflow is null)
            return NotFound(new { success = false, error = $"Workflow {id} not found." });

        return Ok(new
        {
            workflow.Id,
            workflow.Name,
            workflow.Version,
            workflow.CreatedAt,
            workflow.CreatedBy,
            workflow = JsonSerializer.Deserialize<JsonElement>(workflow.WorkflowJson)
        });
    }

    /// <summary>
    /// Saves a workflow sent as the JSON body. "flow_name" is required;
    /// "version" defaults to "1.0.0". The same flow_name + version cannot be saved twice.
    /// </summary>
    [HttpPost("upload")]
[Consumes("application/json")]
[RequestSizeLimit(MaxBodyBytes)]
public async Task<IActionResult> Upload([FromBody] JsonElement body)
{
    if (!HasActions(body))
        return BadRequest(new
        {
            success = false,
            error = "Body must be a workflow JSON object with an 'Actions' object."
        });

    var name = GetString(body, "flow_name")?.Trim();

    if (string.IsNullOrWhiteSpace(name))
        return BadRequest(new
        {
            success = false,
            error = "'flow_name' is required."
        });

    if (name.Length > 200)
        return BadRequest(new
        {
            success = false,
            error = "'flow_name' must be 200 characters or fewer."
        });

    var version = GetString(body, "version")?.Trim();

    if (string.IsNullOrEmpty(version))
        version = "1.0.0";

    if (version.Length > 50)
        return BadRequest(new
        {
            success = false,
            error = "'version' must be 50 characters or fewer."
        });

    // Check whether the workflow already exists.
    var workflow = await _db.Workflows
        .FirstOrDefaultAsync(w => w.Name == name && w.Version == version);

    if (workflow != null)
    {
        // Update the existing workflow JSON.
        workflow.WorkflowJson = body.GetRawText();

        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            message = "Workflow updated successfully.",
            workflow.Id,
            workflow.Name,
            workflow.Version,
            workflow.WorkflowJson,
            workflow.CreatedAt,
            workflow.CreatedBy
        });
    }

    // Create a new workflow if it does not exist.
    workflow = new Workflow
    {
        Name = name,
        Version = version,
        WorkflowJson = body.GetRawText()
    };

    _db.Workflows.Add(workflow);

    await _db.SaveChangesAsync();

    return CreatedAtAction(nameof(GetById), new { id = workflow.Id }, new
    {
        success = true,
        message = "Workflow created successfully.",
        workflow.Id,
        workflow.Name,
        workflow.Version,
        workflow.CreatedAt,
        workflow.CreatedBy
    });
}
    // ── helpers ──────────────────────────────────────────────

    private static bool HasActions(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return false;

        foreach (var property in root.EnumerateObject())
        {
            if (property.Name.Equals("Actions", StringComparison.OrdinalIgnoreCase) &&
                property.Value.ValueKind == JsonValueKind.Object)
                return true;
        }
        return false;
    }

    /// <summary>Reads a top-level string (or number) property, case-insensitively.</summary>
    private static string? GetString(JsonElement root, string propertyName)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;

        foreach (var property in root.EnumerateObject())
        {
            if (!property.Name.Equals(propertyName, StringComparison.OrdinalIgnoreCase)) continue;

            return property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString(),
                JsonValueKind.Number => property.Value.GetRawText(),
                _ => null
            };
        }
        return null;
    }
}