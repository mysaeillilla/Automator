using BackendBotStore.Services;

namespace BackendBotStore.Actions;

public sealed class VariableActions
{
    public object? Create(
        WorkflowVariableStore variables,
        string name,
        string type,
        object? value)
    {
        variables.Create(name, type, value);

        return variables.GetValue(name);
    }

    public object? Set(
        WorkflowVariableStore variables,
        string name,
        object? value)
    {
        variables.Set(name, value);

        return variables.GetValue(name);
    }

    public object? Convert(
        object? value,
        string targetType)
    {
        return VariableValueConverter.Convert(
            value,
            targetType);
    }
}