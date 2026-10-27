using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BackendBotStore.Services;

// ─────────────────────────────────────────────────────────────
//  Workflow JSON models
// ─────────────────────────────────────────────────────────────

public sealed class WorkflowDefinition
{
    /// <summary>
    /// Package name -> DLL path (paths are filled in by the API before execution).
    /// An action's "ClassName" is the package name; the class executed inside
    /// that package's DLL is always "Program".
    /// </summary>
    public Dictionary<string, string> Packages { get; set; } = new();
    public Dictionary<string, WorkflowVariable> Variables { get; set; } = new();
    public Dictionary<string, WorkflowAction> Actions { get; set; } = new();
}

public sealed class WorkflowVariable
{
    /// <summary>Plain .NET value (string, long, double, bool, List, Dictionary, or any object set by an action).</summary>
    public object? Value { get; set; }

    /// <summary>Either a string ("STRING") or an object describing columns. Kept raw.</summary>
    public JsonElement Type { get; set; }

    public bool Input { get; set; }
    public bool Output { get; set; }
}

public sealed class WorkflowAction
{
    /// <summary>Package name (key in "packages"). The DLL's entry class is always "Program".</summary>
    public string ClassName { get; set; } = string.Empty;
    public string FunctionName { get; set; } = string.Empty;

    /// <summary>Parameter name -> literal or "{{variable}}"</summary>
    public Dictionary<string, JsonElement> Inputs { get; set; } = new();

    /// <summary>"Response" (or a property name of the result) -> "{{variable}}"</summary>
    public Dictionary<string, string> Outputs { get; set; } = new();
}

// ─────────────────────────────────────────────────────────────
//  Executor (register as Transient/Scoped – it holds run state)
// ─────────────────────────────────────────────────────────────

public class WorkflowExecutor
{
    /// <summary>Name of the class every package DLL exposes.</summary>
    // private const string PackageEntryClass = "Program";

    private static readonly Regex TemplateRegex =
        new(@"\{\{\s*([A-Za-z_]\w*)\s*\}\}", RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly Dictionary<string, Assembly> _assemblyCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<Type, object> _instanceCache = new();
    private readonly Dictionary<string, Type> _typeCache = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, string> Packages { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, WorkflowVariable> Variables { get; set; } = new();
    public Dictionary<string, WorkflowAction> ActionList { get; set; } = new();
    public WorkflowAction? CurrentAction { get; set; }
    public string? CurrentActionId { get; private set; }

    /// <summary>
    /// OPTIONAL security guard. Leave null (default) to load each package from the path
    /// given in the workflow JSON. If set, DLLs outside this folder are refused.
    /// </summary>
    public string? AllowedPackageRoot { get; set; }

    public List<string> Logs { get; } = new();
    public string? LastError { get; private set; }

    /// <summary>Optional progress callbacks (used to persist per-action status while the run is in flight).</summary>
    public IWorkflowProgressListener? Listener { get; set; }

    private int _sequence;

    // ─────────────────────────────────────────────────────────
    //  Variable evaluation
    // ─────────────────────────────────────────────────────────

    /// <summary>
    /// Returns true when the variable is defined and, if it is an input variable, has a value.
    /// </summary>
    public bool VariableEvaluator(string variableName)
    {
        if (!Variables.TryGetValue(variableName, out var variable))
            return Fail($"Variable '{variableName}' is not defined.");

        if (variable.Input && variable.Value is null)
            return Fail($"Input variable '{variableName}' has no value.");

        return true;
    }

    // ─────────────────────────────────────────────────────────
    //  Single action execution
    // ─────────────────────────────────────────────────────────
private Type ResolveType(string packageName, string functionName)
{
    if (string.IsNullOrWhiteSpace(packageName))
        throw new InvalidOperationException(
            "Action has no ClassName (package name).");

    if (string.IsNullOrWhiteSpace(functionName))
        throw new InvalidOperationException(
            "Action has no FunctionName.");

    // Cache by package and function because different functions
    // in the same package may belong to different classes.
    var cacheKey = $"{packageName}::{functionName}";

    if (_typeCache.TryGetValue(cacheKey, out var cached))
        return cached;

    if (!Packages.TryGetValue(packageName, out var dllPath))
        throw new InvalidOperationException(
            $"Package '{packageName}' is not listed in the workflow packages.");

    if (string.IsNullOrWhiteSpace(dllPath))
        throw new InvalidOperationException(
            $"Package '{packageName}' has no DLL path.");

    var assembly = LoadAssembly(dllPath);

    Type[] types;

    try
    {
        types = assembly.GetExportedTypes();
    }
    catch (ReflectionTypeLoadException ex)
    {
        types = ex.Types
            .Where(t => t is not null && t.IsPublic)
            .Cast<Type>()
            .ToArray();
    }

    // Find public classes that contain the requested function.
    var matchingTypes = types
        .Where(t => t.IsClass && !t.IsAbstract)
        .Where(t => t.GetMethods(
                BindingFlags.Public |
                BindingFlags.Instance |
                BindingFlags.Static)
            .Any(m =>
                m.Name.Equals(
                    functionName,
                    StringComparison.OrdinalIgnoreCase)
                && !m.ContainsGenericParameters))
        .ToList();

    if (matchingTypes.Count == 0)
    {
        throw new MissingMethodException(
            $"Function '{functionName}' was not found in any public class " +
            $"in package '{packageName}' ({dllPath}).");
    }

    if (matchingTypes.Count > 1)
    {
        var classNames = string.Join(
            ", ",
            matchingTypes.Select(t => t.FullName));

        throw new InvalidOperationException(
            $"Function '{functionName}' exists in multiple classes " +
            $"in package '{packageName}': {classNames}. " +
            "Please make the function unique or specify the class explicitly.");
    }

    var resolvedType = matchingTypes[0];

    Log(
        $"Package '{packageName}' -> " +
        $"{resolvedType.FullName}.{functionName} ({dllPath})");

    _typeCache[cacheKey] = resolvedType;

    return resolvedType;
}
    public bool ExecuteCurrentAction(string ActionID)
    {
        var started = false;
        try
        {
            if (!ActionList.TryGetValue(ActionID, out var action))
                return Fail($"Action '{ActionID}' not found.");

            CurrentActionId = ActionID;
            CurrentAction = action;

            Log($"Action {ActionID}: {action.ClassName}.{action.FunctionName}");
            Notify(l => l.ActionStarted(ActionID, ++_sequence, action));
            started = true;

            // ClassName is the package name -> load its DLL -> find class "Program"
            // var type = ResolveType(action.ClassName);

            var type = ResolveType(action.ClassName, action.FunctionName);

            // Resolve {{variables}} in inputs
            var inputs = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            foreach (var (name, element) in action.Inputs)
                inputs[name] = ResolveValue(ToPlain(element));

            Notify(l => l.ActionInputsResolved(ActionID, inputs));

            var method = FindMethod(type, action.FunctionName, inputs);
            var instance = method.IsStatic ? null : GetInstance(type);
            var args = BuildArguments(method, inputs);

            var result = UnwrapTask(method.Invoke(instance, args));

            var written = MapOutputs(action, result);
            Notify(l => l.ActionCompleted(ActionID, written));

            Log($"Action {ActionID} completed.");
            return true;
        }
        catch (TargetInvocationException ex)
        {
            return FailAction(ActionID, started, $"Action '{ActionID}' threw: {ex.InnerException?.Message ?? ex.Message}");
        }
        catch (Exception ex)
        {
            return FailAction(ActionID, started, $"Action '{ActionID}' failed: {ex.Message}");
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Whole workflow
    // ─────────────────────────────────────────────────────────

    /// <param name="Workflow">Workflow JSON string.</param>
    /// <param name="inputOverrides">Optional runtime values for variables flagged "input": true.</param>
    public bool ExecuteWorkflow(string Workflow, Dictionary<string, object?>? inputOverrides = null)
    {
        Reset();

        try
        {
            var definition = JsonSerializer.Deserialize<WorkflowDefinition>(Workflow, JsonOptions)
                             ?? throw new InvalidOperationException("Workflow JSON is empty or invalid.");

            // 1. Packages (case-insensitive lookup by package name)
            Packages = new Dictionary<string, string>(
                definition.Packages ?? new(), StringComparer.OrdinalIgnoreCase);

            // 2. Variables
            foreach (var (name, variable) in definition.Variables ?? new())
            {
                variable.Value = Normalize(variable.Value);
                Variables[name] = variable;
            }

            if (inputOverrides is not null)
            {
                foreach (var (name, value) in inputOverrides)
                {
                    if (!Variables.TryGetValue(name, out var v))
                        return Fail($"Cannot override unknown variable '{name}'.");
                    if (!v.Input)
                        return Fail($"Variable '{name}' is not an input variable.");
                    v.Value = Normalize(value);
                }
            }

            // 3. Action list
            ActionList = definition.Actions ?? new();

            // 4. Execute actions in numeric key order
            var orderedIds = ActionList.Keys
                .OrderBy(k => int.TryParse(k, out var n) ? n : int.MaxValue)
                .ThenBy(k => k, StringComparer.Ordinal)
                .ToList();

            foreach (var actionId in orderedIds)
            {
                var action = ActionList[actionId];

                // 4a. Evaluate every variable the action needs
                foreach (var varName in GetInputVariables(action))
                    if (!VariableEvaluator(varName))
                        return false;

                foreach (var target in action.Outputs.Values)
                {
                    var m = TemplateRegex.Match(target);
                    if (!m.Success || m.Length != target.Length)
                        return Fail($"Action '{actionId}': output target '{target}' must be of the form {{{{variable}}}}.");
                    if (!Variables.ContainsKey(m.Groups[1].Value))
                        return Fail($"Action '{actionId}': output variable '{m.Groups[1].Value}' is not defined.");
                }

                // 4b. Execute
                if (!ExecuteCurrentAction(actionId))
                    return false;
            }

            Log("Workflow completed successfully.");
            return true;
        }
        catch (JsonException ex)
        {
            return Fail($"Invalid workflow JSON: {ex.Message}");
        }
        catch (Exception ex)
        {
            return Fail($"Workflow failed: {ex.Message}");
        }
    }

    /// <summary>Values of all variables flagged "output": true.</summary>
    public Dictionary<string, object?> GetOutputVariables() =>
        Variables.Where(kv => kv.Value.Output).ToDictionary(kv => kv.Key, kv => kv.Value.Value);

    // ─────────────────────────────────────────────────────────
    //  Package / reflection helpers
    // ─────────────────────────────────────────────────────────

    /// <summary>
    /// The action's ClassName is a PACKAGE NAME. Look it up in Packages to get the DLL path,
    /// load that DLL, and return its "Program" class.
    /// </summary>
    // private Type ResolveType(string packageName)
    // {
    //     if (string.IsNullOrWhiteSpace(packageName))
    //         throw new InvalidOperationException("Action has no ClassName (package name).");

    //     if (_typeCache.TryGetValue(packageName, out var cached))
    //         return cached;

    //     if (!Packages.TryGetValue(packageName, out var dllPath))
    //         throw new InvalidOperationException(
    //             $"Package '{packageName}' is not listed in the workflow's packages.");

    //     if (string.IsNullOrWhiteSpace(dllPath))
    //         throw new InvalidOperationException(
    //             $"Package '{packageName}' has no DLL path. The path must be provided before execution.");

    //     var assembly = LoadAssembly(dllPath);

    //     var type = FindProgramType(assembly)
    //                ?? throw new InvalidOperationException(
    //                    $"Class '{PackageEntryClass}' not found in package '{packageName}' ({dllPath}).");

    //     Log($"Package '{packageName}' -> {type.FullName} ({dllPath})");
    //     _typeCache[packageName] = type;
    //     return type;
    // }

    // /// <summary>Finds the public "Program" class (with or without a namespace).</summary>
    // private static Type? FindProgramType(Assembly assembly)
    // {
    //     // Global namespace
    //     var type = assembly.GetType(PackageEntryClass, throwOnError: false, ignoreCase: false);
    //     if (type is not null) return type;

    //     static bool IsProgram(Type? t) =>
    //         t is not null && t.IsClass && t.IsPublic && t.Name == PackageEntryClass;

    //     try
    //     {
    //         return assembly.GetExportedTypes().FirstOrDefault(IsProgram);
    //     }
    //     catch (ReflectionTypeLoadException ex)
    //     {
    //         // Some types failed to load (missing dependency); still search the ones that did.
    //         return ex.Types.FirstOrDefault(IsProgram);
    //     }
    // }

    private Assembly LoadAssembly(string dllPath)
    {
        var fullPath = Path.GetFullPath(dllPath, AppContext.BaseDirectory);

        // Optional guard – only enforced when AllowedPackageRoot is configured.
        if (!string.IsNullOrWhiteSpace(AllowedPackageRoot))
        {
            // var root = Path.GetFullPath(AllowedPackageRoot)
            //                .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            // if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            //     throw new UnauthorizedAccessException($"Package path '{fullPath}' is outside the allowed folder.");
        }

        if (!File.Exists(fullPath))
            throw new FileNotFoundException($"Package DLL not found: {fullPath}");

        if (!_assemblyCache.TryGetValue(fullPath, out var assembly))
        {
            assembly = Assembly.LoadFrom(fullPath);
            _assemblyCache[fullPath] = assembly;
        }
        return assembly;
    }

    private object GetInstance(Type type)
    {
        if (!_instanceCache.TryGetValue(type, out var instance))
        {
            instance = Activator.CreateInstance(type)
                       ?? throw new InvalidOperationException($"Could not create an instance of '{type.FullName}'.");
            _instanceCache[type] = instance;
        }
        return instance;
    }

    private static MethodInfo FindMethod(Type type, string functionName, Dictionary<string, object?> inputs)
    {
        var candidates = type
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)
            .Where(m => m.Name == functionName && !m.ContainsGenericParameters)
            .Where(m => m.GetParameters().All(p => inputs.ContainsKey(p.Name!) || p.HasDefaultValue))
            .OrderByDescending(m => m.GetParameters().Count(p => inputs.ContainsKey(p.Name!)))
            .ToList();

        return candidates.FirstOrDefault()
               ?? throw new MissingMethodException(
                   $"No public method '{functionName}' on '{type.FullName}' matches the supplied inputs ({string.Join(", ", inputs.Keys)}).");
    }

    private static object?[] BuildArguments(MethodInfo method, Dictionary<string, object?> inputs)
    {
        var parameters = method.GetParameters();
        var args = new object?[parameters.Length];

        for (var i = 0; i < parameters.Length; i++)
        {
            var p = parameters[i];
            if (p.ParameterType.IsByRef)
                throw new NotSupportedException($"ref/out parameter '{p.Name}' is not supported.");

            args[i] = inputs.TryGetValue(p.Name!, out var value)
                ? ConvertValue(value, p.ParameterType)
                : p.DefaultValue;
        }
        return args;
    }

    private static object? UnwrapTask(object? result)
    {
        if (result is not Task task) return result;

        task.GetAwaiter().GetResult();

        var taskType = task.GetType();
        if (!taskType.IsGenericType) return null;

        var value = taskType.GetProperty("Result")?.GetValue(task);
        return value?.GetType().FullName == "System.Threading.Tasks.VoidTaskResult" ? null : value;
    }

    private Dictionary<string, object?> MapOutputs(WorkflowAction action, object? result)
    {
        var written = new Dictionary<string, object?>();

        foreach (var (key, target) in action.Outputs)
        {
            var varName = TemplateRegex.Match(target).Groups[1].Value;
            if (!Variables.TryGetValue(varName, out var variable))
                throw new InvalidOperationException($"Output variable '{varName}' is not defined.");

            variable.Value = ExtractOutput(result, key);
            written[varName] = variable.Value;
        }

        return written;
    }

    private static object? ExtractOutput(object? result, string key)
    {
        if (key.Equals("Response", StringComparison.OrdinalIgnoreCase) ||
            key.Equals("Result", StringComparison.OrdinalIgnoreCase))
            return result;

        if (result is null)
            throw new InvalidOperationException($"Action returned null; cannot read output '{key}'.");

        if (result is IDictionary dict && dict.Contains(key))
            return dict[key];

        const BindingFlags flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase;
        var prop = result.GetType().GetProperty(key, flags);
        if (prop is not null) return prop.GetValue(result);

        var field = result.GetType().GetField(key, flags);
        if (field is not null) return field.GetValue(result);

        throw new InvalidOperationException($"Output '{key}' not found on result type '{result.GetType().Name}'.");
    }

    // ─────────────────────────────────────────────────────────
    //  Variable / template resolution
    // ─────────────────────────────────────────────────────────

    private static IEnumerable<string> GetInputVariables(WorkflowAction action) =>
        action.Inputs.Values
            .SelectMany(e => TemplateRegex.Matches(e.GetRawText()).Select(m => m.Groups[1].Value))
            .Distinct();

    private object? ResolveValue(object? value)
    {
        switch (value)
        {
            case string s:
                var whole = TemplateRegex.Match(s);
                if (whole.Success && whole.Length == s.Length)
                    return GetVariableValue(whole.Groups[1].Value);   // keeps the original type

                return TemplateRegex.Replace(s, m => Stringify(GetVariableValue(m.Groups[1].Value)));

            case Dictionary<string, object?> dict:
                return dict.ToDictionary(kv => kv.Key, kv => ResolveValue(kv.Value));

            case List<object?> list:
                return list.Select(ResolveValue).ToList();

            default:
                return value;
        }
    }

    private object? GetVariableValue(string name) =>
        Variables.TryGetValue(name, out var v)
            ? v.Value
            : throw new InvalidOperationException($"Variable '{name}' is not defined.");

    private static string Stringify(object? value) => value switch
    {
        null => string.Empty,
        string s => s,
        IConvertible c => c.ToString(CultureInfo.InvariantCulture),
        _ => JsonSerializer.Serialize(value)
    };

    // ─────────────────────────────────────────────────────────
    //  Value conversion helpers
    // ─────────────────────────────────────────────────────────

    private static object? Normalize(object? value) =>
        value is JsonElement element ? ToPlain(element) : value;

    private static object? ToPlain(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Array => element.EnumerateArray().Select(ToPlain).ToList(),
        JsonValueKind.Object => element.EnumerateObject()
                                       .ToDictionary(p => p.Name, p => ToPlain(p.Value)),
        _ => null   // Null / Undefined
    };

    private static object? ConvertValue(object? value, Type target)
    {
        if (value is null)
            return target.IsValueType && Nullable.GetUnderlyingType(target) is null
                ? Activator.CreateInstance(target)
                : null;

        if (target.IsInstanceOfType(value))
            return value;

        // Round-trip through JSON handles long->int, list->List<T>, dict->POCO, etc.
        var json = JsonSerializer.Serialize(value);
        return JsonSerializer.Deserialize(json, target, JsonOptions);
    }

    // ─────────────────────────────────────────────────────────
    //  State / logging
    // ─────────────────────────────────────────────────────────

    private void Reset()
    {
        Packages = new(StringComparer.OrdinalIgnoreCase);
        Variables = new();
        ActionList = new();
        CurrentAction = null;
        CurrentActionId = null;
        LastError = null;
        Logs.Clear();
        _instanceCache.Clear();
        _typeCache.Clear();
        _sequence = 0;
    }

    private void Log(string message) => Logs.Add($"{DateTime.UtcNow:O} {message}");

    /// <summary>Listener failures must never break a workflow run.</summary>
    private void Notify(Action<IWorkflowProgressListener> call)
    {
        if (Listener is null) return;
        try { call(Listener); }
        catch (Exception ex) { Log($"WARN: progress listener failed: {ex.Message}"); }
    }

    private bool FailAction(string actionId, bool started, string message)
    {
        if (started) Notify(l => l.ActionFailed(actionId, message));
        return Fail(message);
    }

    private bool Fail(string message)
    {
        LastError = message;
        Log($"ERROR: {message}");
        return false;
    }
}