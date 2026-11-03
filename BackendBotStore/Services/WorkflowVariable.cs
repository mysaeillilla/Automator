namespace BackendBotStore.Services;

public sealed class WorkflowVariable
{
    public string Name { get; set; } = "";
 
    /// <summary>A type name registered in ICoreCatalog (STRING, NUMBER, JSON, DATATABLE, ROW, BOOLEAN, ...).</summary>
    public string Type { get; set; } = "STRING";
 
    /// <summary>
    /// Runtime value in its native .NET form. Straight from the workflow JSON this is a JsonElement,
    /// which the initializer converts to the declared type.
    /// </summary>
    public object? Value { get; set; }
 
    public bool Input { get; set; }
    public bool Output { get; set; }
}
 