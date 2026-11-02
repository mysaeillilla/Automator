
namespace BackendBotStore.Services;

public sealed class WorkflowVariableStore
{
    private readonly Dictionary<string, WorkflowVariable> _variables =
        new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyDictionary<string, WorkflowVariable> All => _variables;

    public void Load(
        Dictionary<string, WorkflowVariable> variables)
    {
        _variables.Clear();

        foreach (var item in variables)
            _variables[item.Key] = item.Value;
    }

    public bool Exists(string name) =>
        _variables.ContainsKey(name);

    public WorkflowVariable Get(string name)
    {
        if (!_variables.TryGetValue(name, out var variable))
            throw new KeyNotFoundException(
                $"Variable '{name}' was not found.");

        return variable;
    }

    public object? GetValue(string name) =>
        Get(name).Value;

    public T? GetValue<T>(string name)
    {
        var value = GetValue(name);

        if (value is null)
            return default;

        if (value is T typed)
            return typed;

        throw new InvalidCastException(
            $"Variable '{name}' is not of type {typeof(T).Name}.");
    }

    public void Create(
        string name,
        string type,
        object? value = null,
        bool input = false,
        bool output = false)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Variable name is required.");

        if (Exists(name))
            throw new InvalidOperationException(
                $"Variable '{name}' already exists.");

        SetNew(name, type, value, input, output);
    }

    public void Set(
        string name,
        object? value,
        string? targetType = null)
    {
        var variable = Get(name);

        var type = VariableValueConverter.NormalizeType(
            targetType ?? variable.Type);

        variable.Value = value is null
            ? null
            : VariableValueConverter.Convert(value, type);

        variable.Type = type;
    }

    public void Convert(
        string name,
        string targetType)
    {
        var variable = Get(name);

        Set(name, variable.Value, targetType);
    }

    private void SetNew(
        string name,
        string type,
        object? value,
        bool input,
        bool output)
    {
        type = VariableValueConverter.NormalizeType(type);

        _variables[name] = new WorkflowVariable
        {
            Name = name,
            Type = type,
            Value = value is null
                ? null
                : VariableValueConverter.Convert(value, type),
            Input = input,
            Output = output
        };
    }

    public static string InferType(object? value)
    {
        return value switch
        {
            null => "STRING",
            string => "STRING",
            bool => "BOOLEAN",
            byte or short or int or long or float or double or decimal
                => "NUMBER",
            System.Data.DataTable => "DATATABLE",
            System.Data.DataRow => "ROW",
            System.Text.Json.Nodes.JsonNode => "JSON",
            System.Text.Json.JsonElement => "JSON",
            _ => throw new InvalidOperationException(
                $"Cannot infer variable type for {value.GetType().Name}.")
        };
    }
}
