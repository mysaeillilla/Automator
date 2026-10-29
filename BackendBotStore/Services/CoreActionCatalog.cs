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

    private static readonly string[] ComparisonOperators =
{
    "Equals",
    "NotEquals",
    "GreaterThan",
    "GreaterThanOrEqual",
    "LessThan",
    "LessThanOrEqual",
    "Contains",
    "NotContains",
    "StartsWith",
    "EndsWith",
    "IsEmpty",
    "IsNotEmpty",
    "IsNull",
    "IsNotNull",
    "IsTrue",
    "IsFalse"
};

private static readonly string[] LogicalOperators =
{
    "AND",
    "OR"
};
    public void Contribute(ICoreCatalog catalog)
    {
        // ── Variable types ──
        catalog.RegisterVariableType(new("STRING", "Text.")
        {
            Coerce = v => v as string ?? WorkflowExecutor.Stringify(v)
        });
        catalog.RegisterVariableType(new("NUMBER", "Whole or decimal number.")
        {
            Coerce = v => WorkflowExecutor.TryNumber(v, out var d)
                ? (d % 1 == 0 && Math.Abs(d) < 9e18 ? (object)(long)d : d)
                : throw new InvalidOperationException($"'{v}' is not a number.")
        });
        catalog.RegisterVariableType(new("BOOLEAN", "True or false.")
        {
            Coerce = v => WorkflowExecutor.ToBool(v)
        });
        catalog.RegisterVariableType(new("LIST", "Ordered list of values."));
        catalog.RegisterVariableType(new("DICTIONARY", "Key / value pairs."));
        catalog.RegisterVariableType(new("DATATABLE", "Rows and columns."));
        catalog.RegisterVariableType(new("ANY", "Any value; no coercion."));



        catalog.RegisterAction(
    new CoreActionInfo(
        "If",
        "Runs Then when the condition is true, otherwise Else.",
        new(),
        new(),
        new[] { "Then", "Else" },
        true)
    {
        Category = "ControlFlow",
        ConditionOperators = ComparisonOperators,
        LogicalOperators = LogicalOperators,
        SupportsMultipleConditions = true,
        Properties = new()
        {
            ["LeftOperand"] = "ANY",
            ["Operator"] = "STRING",
            ["RightOperand"] = "ANY"
        }
    });

    catalog.RegisterAction(
    new CoreActionInfo(
        "While",
        "Repeats Body while the condition is true.",
        new(),
        new(),
        new[] { "Body" },
        true)
    {
        Category = "ControlFlow",
        ConditionOperators = ComparisonOperators,
        LogicalOperators = LogicalOperators,
        SupportsMultipleConditions = true,
        Properties = new()
        {
            ["LeftOperand"] = "ANY",
            ["Operator"] = "STRING",
            ["RightOperand"] = "ANY"
        }
    });
        // ── Actions ──
        catalog.RegisterAction(new("SetVariable", "Assigns a value to a variable.",
            new() { ["Value"] = "ANY" },
            new() { ["Response"] = "ANY" },
            Array.Empty<string>(), false));

        catalog.RegisterAction(new("Evaluate", "Evaluates an expression over the workflow variables, e.g. \"count + 1\".",
            new() { ["Expression"] = "STRING" },
            new() { ["Response"] = "ANY" },
            Array.Empty<string>(), false));

   

        catalog.RegisterAction(new("ForEach", "Loops over a list, dictionary, data table or JSON array/object.",
            new() { ["Collection"] = "ANY" },
            new() { ["Item"] = "ANY", ["Index"] = "NUMBER", ["Key"] = "ANY" },
            new[] { "Body" }, false));

        catalog.RegisterAction(new("ForCount", "Loops from From to To (inclusive) by Step.",
            new() { ["From"] = "NUMBER", ["To"] = "NUMBER", ["Step"] = "NUMBER" },
            new() { ["Index"] = "NUMBER" },
            new[] { "Body" }, false));
    //  catalog.RegisterAction(new("If", "Runs Then when the condition is true, otherwise Else.",
    //         new(), new(),
    //         new[] { "Then", "Else" }, true));
    //     catalog.RegisterAction(new("While", "Repeats Body while the condition is true.",
    //         new(), new(),
    //         new[] { "Body" }, true));

        catalog.RegisterAction(new("Break", "Exits the innermost loop.",
            new(), new(), Array.Empty<string>(), false));

        catalog.RegisterAction(new("Continue", "Skips to the next iteration of the innermost loop.",
            new(), new(), Array.Empty<string>(), false));

        catalog.RegisterAction(new("Return", "Stops the workflow successfully.",
            new(), new(), Array.Empty<string>(), false));

        catalog.RegisterAction(new("TryCatch", "Runs Body; if an action fails, stores the message in Error and runs Catch.",
            new(),
            new() { ["Error"] = "STRING" },
            new[] { "Body", "Catch" }, false));

        catalog.RegisterAction(new("Fail", "Fails the workflow (or the enclosing TryCatch) with a message.",
            new() { ["Message"] = "STRING" },
            new(), Array.Empty<string>(), false));
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