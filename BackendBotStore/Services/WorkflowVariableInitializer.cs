using static BackendBotStore.Services.WorkflowVariableStore;
namespace BackendBotStore.Services;

/// <summary>Fills the variable store from the workflow JSON and applies runtime inputs.</summary>
public static class WorkflowVariableInitializer
{
    public static void Initialize(
        WorkflowVariableStore store,
        IReadOnlyDictionary<string, WorkflowVariable>? definitions)
    {
        if (definitions is null) return;

        foreach (var (name, definition) in definitions)
        {
            try
            {
                // Create validates the type against the catalog and coerces the initial value.
                store.Create(name, definition.Type, definition.Value, definition.Input, definition.Output);
            }
            catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
            {
                throw new InvalidOperationException($"Variable '{name}': {ex.Message}", ex);
            }
        }
    }

    /// <summary>Applies runtime values to variables flagged "input": true.</summary>
    public static void ApplyInputs(WorkflowVariableStore store, IReadOnlyDictionary<string, object?>? overrides)
    {
        if (overrides is null) return;

        foreach (var (name, value) in overrides)
        {
            if (!store.TryGet(name, out var variable))
                throw new InvalidOperationException($"Cannot override unknown variable '{name}'.");
            if (!variable.Input)
                throw new InvalidOperationException($"Variable '{name}' is not an input variable.");

            store.Set(name, value);
        }
    }
}

public sealed class VariableActions(WorkflowVariableStore variables)
{
    /// <summary>Declares a variable (re-declaring one with the same name resets it, so it is loop-safe).</summary>
    public object? Create(string name, string? type, object? value)
    {
        var created = variables.Create(name, type, value, replace: true);
        return created.Value;
    }
 
    public object? Set(string name, object? value)
    {
        variables.Set(name, value);
        return variables.GetValue(name);
    }
 
    public object? Convert(object? value, string targetType) =>
        variables.ConvertValue(value, targetType);
}
 