using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace BackendBotStore.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ExecutionController : ControllerBase
{
    private readonly IConfiguration _config;

    public ExecutionController(IConfiguration config) => _config = config;

    // ---------- Request model ----------
    public class ExecuteRequest
    {
        public string DllPath { get; set; } = "";
        public string FunctionName { get; set; } = "";
        public string? ClassName { get; set; }              // optional, full name e.g. "REST_API.RestClient"
        public Dictionary<string, JsonElement>? Inputs { get; set; }
    }

    // ---------- Endpoint ----------
    [HttpPost("execute")]
    public async Task<IActionResult> Execute([FromBody] ExecuteRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DllPath) || string.IsNullOrWhiteSpace(req.FunctionName))
            return BadRequest(new { success = false, error = "DllPath and FunctionName are required." });

        // Only allow DLLs inside a configured folder (see appsettings note below)
        string root = Path.GetFullPath(_config["Execution:AllowedDllRoot"] ?? "");
        string dllFull = Path.GetFullPath(req.DllPath);
        if (string.IsNullOrEmpty(root) ||
            !dllFull.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, error = "DLL path is outside the allowed directory." });

        if (!System.IO.File.Exists(dllFull))
            return NotFound(new { success = false, error = $"DLL not found: {dllFull}" });

        var alc = new DllLoadContext(dllFull);
        try
        {
            Assembly asm = alc.LoadFromAssemblyPath(dllFull);

            // Find the method
            var types = string.IsNullOrWhiteSpace(req.ClassName)
                ? asm.GetExportedTypes()
                : new[] { asm.GetType(req.ClassName, throwOnError: false) }.Where(t => t != null).Cast<Type>().ToArray();

            MethodInfo? method = types
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                .FirstOrDefault(m => m.Name.Equals(req.FunctionName, StringComparison.OrdinalIgnoreCase));

            if (method == null)
                return NotFound(new { success = false, error = $"Public method '{req.FunctionName}' not found." });

            // Map JSON inputs to method parameters by name
            var inputs = new Dictionary<string, JsonElement>(
                req.Inputs ?? new(), StringComparer.OrdinalIgnoreCase);
            var args = new List<object?>();

            foreach (var p in method.GetParameters())
            {
                if (inputs.TryGetValue(p.Name!, out var value))
                {
                    args.Add(value.ValueKind == JsonValueKind.Null
                        ? null
                        : JsonSerializer.Deserialize(value.GetRawText(), p.ParameterType,
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }));
                }
                else if (p.HasDefaultValue)
                {
                    args.Add(p.DefaultValue);
                }
                else
                {
                    return BadRequest(new { success = false, error = $"Missing input '{p.Name}' ({p.ParameterType.Name})." });
                }
            }

            // Invoke
            object? instance = method.IsStatic ? null : Activator.CreateInstance(method.DeclaringType!);
            object? result = method.Invoke(instance, args.ToArray());

            // Await Task / Task<T> if needed
            if (result is Task task)
            {
                await task.ConfigureAwait(false);
                var resultProp = task.GetType().GetProperty("Result");
                result = resultProp != null && resultProp.PropertyType.Name != "VoidTaskResult"
                    ? resultProp.GetValue(task)
                    : null;
            }

            // If the function already returns a JSON string (like the REST API envelope),
            // return it as real JSON instead of an escaped string
            if (result is string s)
            {
                try
                {
                    using var doc = JsonDocument.Parse(s);
                    return Ok(new { success = true, data = doc.RootElement.Clone() });
                }
                catch (JsonException) { /* plain string, fall through */ }
            }

            return Ok(new { success = true, data = result });
        }
        catch (TargetInvocationException ex)   // exception thrown inside the DLL function
        {
            return StatusCode(500, new { success = false, error = ex.InnerException?.Message ?? ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { success = false, error = ex.Message });
        }
        finally
        {
            alc.Unload();
        }
    }

    // ---------- Isolated load context (resolves dependencies from the DLL's folder) ----------
    private sealed class DllLoadContext : AssemblyLoadContext
    {
        private readonly string _folder;

        public DllLoadContext(string dllPath) : base(isCollectible: true)
            => _folder = Path.GetDirectoryName(dllPath)!;

        protected override Assembly? Load(AssemblyName name)
{
    string candidate = Path.Combine(_folder, name.Name + ".dll");
    return System.IO.File.Exists(candidate) ? LoadFromAssemblyPath(candidate) : null;
}
    }
}