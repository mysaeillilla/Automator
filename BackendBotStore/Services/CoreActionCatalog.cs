using System.Text.Json.Serialization;

namespace BackendBotStore.Services;

// ─────────────────────────────────────────────────────────────
//  Definitions
// ─────────────────────────────────────────────────────────────

/// <summary>Describes one built-in "Core" action so the designer can render it and its child blocks.</summary>
public sealed record CoreActionInfo(
    string Name,
    string Description,
    Dictionary<string, string> Inputs,
    Dictionary<string, string> Outputs,
    string[] Blocks,
    bool HasCondition)
{
    [JsonIgnore]
    public Func<IReadOnlyDictionary<string, object?>, object?>? Handler
        { get; init; }

    public string Category { get; init; } = "General";

    public string[] ConditionOperators { get; init; }
        = Array.Empty<string>();

    public string[] LogicalOperators { get; init; }
        = Array.Empty<string>();

    public bool SupportsMultipleConditions { get; init; }

    public Dictionary<string, string> Properties { get; init; }
        = new();
}
/// <summary>A variable type the workflow designer offers and the executor understands.</summary>
public sealed record VariableTypeInfo(string Name, string Description)
{
    /// <summary>Optional coercion applied whenever a value is written to a variable of this type (null values skip it).</summary>
    [JsonIgnore]
    public Func<object?, object?>? Coerce { get; init; }

    /// <summary>Internal types (ANY) are used in action signatures only: not offered to the designer, not usable for variables.</summary>
    public bool Internal { get; init; }

    /// <summary>Sample value shown by the designer when a variable of this type is created.</summary>
    public string? Example { get; init; }

    /// <summary>True when the value is typed as JSON text (JSON / DATATABLE / ROW), so the designer uses a multi-line box.</summary>
    public bool Structured { get; init; }
}

// ─────────────────────────────────────────────────────────────
//  Service contract
// ─────────────────────────────────────────────────────────────

public interface ICoreCatalog
{
    string PackageName { get; }
    string Version { get; }

    IReadOnlyList<CoreActionInfo> Actions { get; }
    IReadOnlyList<VariableTypeInfo> VariableTypes { get; }

    bool IsCoreName(string? packageName);
    bool Contains(string? functionName);
    bool TryGetAction(string? name, out CoreActionInfo action);
    bool TryGetVariableType(string? name, out VariableTypeInfo type);

    /// <summary>Adds a Core action, or replaces the one with the same name.</summary>
    void RegisterAction(CoreActionInfo action);

    /// <summary>Adds a variable type, or replaces the one with the same name.</summary>
    void RegisterVariableType(VariableTypeInfo type);

    /// <summary>Raised after the catalog changes, so the Package tables can be re-synced.</summary>
    event Action? Changed;
}

/// <summary>
/// Implement this to add Core actions / variable types without touching existing code,
/// then register it with services.AddCoreContributor&lt;T&gt;().
/// </summary>
public interface ICoreCatalogContributor
{
    void Contribute(ICoreCatalog catalog);
}

// ─────────────────────────────────────────────────────────────
//  Implementation (singleton, thread-safe)
// ─────────────────────────────────────────────────────────────

public sealed class CoreCatalog : ICoreCatalog
{
    private readonly object _gate = new();
    private readonly Dictionary<string, CoreActionInfo> _actions = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, VariableTypeInfo> _types = new(StringComparer.OrdinalIgnoreCase);
    private CoreActionInfo[] _actionSnapshot = Array.Empty<CoreActionInfo>();
    private VariableTypeInfo[] _typeSnapshot = Array.Empty<VariableTypeInfo>();

    public string PackageName => WorkflowExecutor.CorePackage;
    public string Version => "built-in";

    public event Action? Changed;

    public CoreCatalog(IEnumerable<ICoreCatalogContributor> contributors)
    {
        // Built-ins first, so contributors can extend or override them.
        new BuiltInCoreContributor().Contribute(this);
        foreach (var contributor in contributors)
            contributor.Contribute(this);

            
    }

    public IReadOnlyList<CoreActionInfo> Actions { get { lock (_gate) return _actionSnapshot; } }
    public IReadOnlyList<VariableTypeInfo> VariableTypes { get { lock (_gate) return _typeSnapshot; } }

    public bool IsCoreName(string? packageName) =>
        string.Equals(packageName, PackageName, StringComparison.OrdinalIgnoreCase);

    public bool Contains(string? functionName) =>
        !string.IsNullOrWhiteSpace(functionName) && TryGetAction(functionName, out _);

    public bool TryGetAction(string? name, out CoreActionInfo action)
    {
        lock (_gate)
        {
            if (name is not null && _actions.TryGetValue(name, out var found)) { action = found; return true; }
        }
        action = null!;
        return false;
    }

    public bool TryGetVariableType(string? name, out VariableTypeInfo type)
    {
        lock (_gate)
        {
            if (name is not null && _types.TryGetValue(name, out var found)) { type = found; return true; }
        }
        type = null!;
        return false;
    }

    public void RegisterAction(CoreActionInfo action)
    {
        if (string.IsNullOrWhiteSpace(action.Name))
            throw new ArgumentException("Core action name is required.", nameof(action));

        lock (_gate)
        {
            _actions[action.Name] = action;
            _actionSnapshot = _actions.Values.ToArray();
        }
        Changed?.Invoke();
    }

    public void RegisterVariableType(VariableTypeInfo type)
    {
        if (string.IsNullOrWhiteSpace(type.Name))
            throw new ArgumentException("Variable type name is required.", nameof(type));

        lock (_gate)
        {
            var normalized = type with { Name = type.Name.ToUpperInvariant() };
            _types[normalized.Name] = normalized;
            _typeSnapshot = _types.Values.ToArray();
        }
        Changed?.Invoke();
    }
}

// ─────────────────────────────────────────────────────────────
//  Built-ins (what used to be the static CoreActionCatalog)
// ─────────────────────────────────────────────────────────────

internal sealed class BuiltInCoreContributor : ICoreCatalogContributor
{
    // Must match the operators handled by WorkflowExecutor.EvaluateCondition.
    private static readonly string[] ComparisonOperators =
    {
        "Equals", "NotEquals",
        "GreaterThan", "GreaterThanOrEqual",
        "LessThan", "LessThanOrEqual",
        "Contains", "NotContains", "StartsWith", "EndsWith", "Matches",
        "IsEmpty", "IsNotEmpty", "IsNull", "IsNotNull",
        "IsTrue", "IsFalse"
    };

    private static readonly string[] LogicalOperators = { "AND", "OR" };

    private static Dictionary<string, string> ConditionProperties() => new()
    {
        ["Left"] = "ANY",
        ["Operator"] = "STRING",
        ["Right"] = "ANY"
    };

    public void Contribute(ICoreCatalog catalog)
    {
        // ── Variable types (all conversion logic lives in VariableValueConverter) ──
        foreach (var (name, description, example, structured) in new[]
        {
            ("STRING",    "Text.",                              "Hello",                                            false),
            ("NUMBER",    "Integer or decimal number.",         "125.50",                                           false),
            ("BOOLEAN",   "True or false.",                     "true",                                             false),
            ("JSON",      "JSON object or array.",              "{\"name\": \"Saeil\", \"tags\": [1, 2, 3]}",       true),
            ("DATATABLE", "Table containing rows and columns.", "[{\"name\": \"Saeil\", \"age\": 34}]",             true),
            ("ROW",       "Single row of a DataTable.",         "{\"name\": \"Saeil\", \"age\": 34}",               true),
        })
        {
            var typeName = name;
            catalog.RegisterVariableType(new(typeName, description)
            {
                Example = example,
                Structured = structured,
                Coerce = v => VariableValueConverter.Convert(v, typeName)
            });
        }

        // Wildcard for action inputs / outputs only; never offered as a variable type.
        catalog.RegisterVariableType(new("ANY", "Any runtime value.") { Internal = true });

        // ── Variable actions ──
        catalog.RegisterAction(new("Variable.Create", "Creates a new workflow variable (re-running it resets the variable).",
            new() { ["Name"] = "STRING", ["Type"] = "STRING", ["Value"] = "ANY" },
            new() { ["Result"] = "ANY" },
            Array.Empty<string>(), false)
        { Category = "Variables" });

        catalog.RegisterAction(new("Variable.Set", "Assigns a value to an existing variable.",
            new() { ["Name"] = "STRING", ["Value"] = "ANY" },
            new() { ["Result"] = "ANY" },
            Array.Empty<string>(), false)
        { Category = "Variables" });

        catalog.RegisterAction(new("Variable.Convert", "Converts a value to the specified variable type.",
            new() { ["Value"] = "ANY", ["TargetType"] = "STRING" },
            new() { ["Result"] = "ANY" },
            Array.Empty<string>(), false)
        { Category = "Variables" });

        catalog.RegisterAction(new("SetVariable", "Assigns a value to a variable.",
            new() { ["Value"] = "ANY" },
            new() { ["Response"] = "ANY" },
            Array.Empty<string>(), false)
        { Category = "Variables" });

        catalog.RegisterAction(new("Evaluate", "Evaluates an expression over the workflow variables, e.g. \"count + 1\".",
            new() { ["Expression"] = "STRING" },
            new() { ["Response"] = "ANY" },
            Array.Empty<string>(), false)
        { Category = "Variables" });

        // ── Control flow ──
        catalog.RegisterAction(new("If", "Runs Then when the condition is true, otherwise Else.",
            new(), new(), new[] { "Then", "Else" }, true)
        {
            Category = "ControlFlow",
            ConditionOperators = ComparisonOperators,
            LogicalOperators = LogicalOperators,
            SupportsMultipleConditions = true,
            Properties = ConditionProperties()
        });

        catalog.RegisterAction(new("While", "Repeats Body while the condition is true.",
            new(), new(), new[] { "Body" }, true)
        {
            Category = "ControlFlow",
            ConditionOperators = ComparisonOperators,
            LogicalOperators = LogicalOperators,
            SupportsMultipleConditions = true,
            Properties = ConditionProperties()
        });

        catalog.RegisterAction(new("ForEach", "Loops over a list, dictionary, DataTable or JSON array/object. Over a DataTable, Item is a ROW.",
            new() { ["Collection"] = "ANY" },
            new() { ["Item"] = "ANY", ["Index"] = "NUMBER", ["Key"] = "ANY" },
            new[] { "Body" }, false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("ForEachRow", "Iterates through each row of a DataTable. Item is a ROW variable.",
            new() { ["Table"] = "DATATABLE" },
            new() { ["Item"] = "ROW", ["Index"] = "NUMBER" },
            new[] { "Body" }, false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("ForCount", "Loops from From to To (inclusive) by Step.",
            new() { ["From"] = "NUMBER", ["To"] = "NUMBER", ["Step"] = "NUMBER" },
            new() { ["Index"] = "NUMBER" },
            new[] { "Body" }, false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("Break", "Exits the innermost loop.",
            new(), new(), Array.Empty<string>(), false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("Continue", "Skips to the next iteration of the innermost loop.",
            new(), new(), Array.Empty<string>(), false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("Return", "Stops the workflow successfully.",
            new(), new(), Array.Empty<string>(), false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("TryCatch", "Runs Body; if an action fails, stores the message in Error and runs Catch.",
            new(), new() { ["Error"] = "STRING" },
            new[] { "Body", "Catch" }, false)
        { Category = "ControlFlow" });

        catalog.RegisterAction(new("Fail", "Fails the workflow (or the enclosing TryCatch) with a message.",
            new() { ["Message"] = "STRING" },
            new(), Array.Empty<string>(), false)
        { Category = "ControlFlow" });
    }
}

// ─────────────────────────────────────────────────────────────
//  DI registration
// ─────────────────────────────────────────────────────────────

public static class CoreCatalogServiceCollectionExtensions
{
    /// <summary>Registers the catalog, the Package-table synchronizer and its startup service.</summary>
    public static IServiceCollection AddCoreCatalog(this IServiceCollection services)
    {
        services.AddSingleton<ICoreCatalog>(sp =>
            new CoreCatalog(sp.GetServices<ICoreCatalogContributor>()));
        services.AddScoped<CorePackageSynchronizer>();
        services.AddHostedService<CorePackageStartupService>();
        return services;
    }

    /// <summary>Adds a contributor that registers extra Core actions / variable types.</summary>
    public static IServiceCollection AddCoreContributor<T>(this IServiceCollection services)
        where T : class, ICoreCatalogContributor =>
        services.AddSingleton<ICoreCatalogContributor, T>();
}