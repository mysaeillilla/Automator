using System.Collections;
using System.Data;
using System.Globalization;
using System.Text.Json.Nodes;

namespace BackendBotStore.Services;

/// <summary>
/// The only place a run's variables live. Every write is coerced to the variable's declared type
/// through the type registered in ICoreCatalog, so contributor types (e.g. GUID) work as well as the built-ins.
/// </summary>
public sealed class WorkflowVariableStore
{
    private readonly ICoreCatalog _catalog;

    private readonly Dictionary<string, WorkflowVariable> _variables =
        new(StringComparer.OrdinalIgnoreCase);

    public WorkflowVariableStore(ICoreCatalog catalog) => _catalog = catalog;

    public IReadOnlyDictionary<string, WorkflowVariable> All => _variables;

    public bool Exists(string name) => _variables.ContainsKey(name);

    public bool TryGet(string name, out WorkflowVariable variable) =>
        _variables.TryGetValue(name, out variable!);

    public WorkflowVariable Get(string name) =>
        _variables.TryGetValue(name, out var variable)
            ? variable
            : throw new KeyNotFoundException($"Variable '{name}' is not defined.");

    public object? GetValue(string name) => Get(name).Value;

    public T? GetValue<T>(string name)
    {
        var value = GetValue(name);

        if (value is null) return default;
        if (value is T typed) return typed;

        try
        {
            return (T)System.Convert.ChangeType(value, typeof(T), CultureInfo.InvariantCulture);
        }
        catch (Exception ex) when (ex is InvalidCastException or FormatException or OverflowException)
        {
            throw new InvalidCastException($"Variable '{name}' is not of type {typeof(T).Name}.", ex);
        }
    }

    /// <summary>
    /// Declares a variable. An empty type is inferred from the value.
    /// With replace = true an existing variable is redeclared (so Variable.Create can sit inside a loop).
    /// </summary>
    public WorkflowVariable Create(
        string name, string? type, object? value = null,
        bool input = false, bool output = false, bool replace = false)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Variable name is required.");

        if (!replace && Exists(name))
            throw new InvalidOperationException($"Variable '{name}' already exists.");

        var info = ResolveType(string.IsNullOrWhiteSpace(type) ? InferType(value) : type);

        var variable = new WorkflowVariable
        {
            Name = name.Trim(),
            Type = info.Name,
            Value = CoerceTo(info, value),
            Input = input,
            Output = output
        };

        _variables[variable.Name] = variable;
        return variable;
    }

    /// <summary>Assigns a value, coerced to the variable's type (or to targetType, which then becomes its type).</summary>
    public void Set(string name, object? value, string? targetType = null)
    {
        var variable = Get(name);
        var info = ResolveType(targetType ?? variable.Type);

        variable.Value = CoerceTo(info, value);
        variable.Type = info.Name;
    }

    /// <summary>Changes a variable's type in place, converting its current value.</summary>
    public void Convert(string name, string targetType) =>
        Set(name, Get(name).Value, targetType);

    /// <summary>Converts a value without touching any variable (Variable.Convert action).</summary>
    public object? ConvertValue(object? value, string targetType) =>
        CoerceTo(ResolveType(targetType), value);

    private VariableTypeInfo ResolveType(string? type)
    {
        if (string.IsNullOrWhiteSpace(type) || !_catalog.TryGetVariableType(type.Trim(), out var info))
            throw new InvalidOperationException($"Unsupported variable type: {type}");

        if (info.Internal)
            throw new InvalidOperationException($"'{info.Name}' cannot be used as a variable type.");

        return info;
    }

    private static object? CoerceTo(VariableTypeInfo info, object? value)
    {
        value = VariableValueConverter.Unwrap(value);
        if (value is null) return null;
        return info.Coerce is null ? value : info.Coerce(value);
    }

    /// <summary>Picks the variable type for a runtime value.</summary>
    public static string InferType(object? value) => VariableValueConverter.Unwrap(value) switch
    {
        null => "STRING",
        string => "STRING",
        bool => "BOOLEAN",
        sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal => "NUMBER",
        DataTable => "DATATABLE",
        DataRow => "ROW",
        JsonNode => "JSON",
        System.Text.Json.JsonElement => "JSON",
        IDictionary or IEnumerable => "JSON",
        _ => "JSON"      // any other object is kept as its JSON form
    };
}