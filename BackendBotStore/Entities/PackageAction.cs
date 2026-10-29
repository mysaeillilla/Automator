namespace BackendBotStore.Entities;

public class PackageAction
{
    public int Id { get; set; }

    public int PackageId { get; set; }

    // Basic metadata
    public string Name { get; set; } = string.Empty;
    public string PackageIcon { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public string Category { get; set; } = "General";

    // Input and output variable definitions
    public Dictionary<string, string> Inputs { get; set; } = new();

    public Dictionary<string, string> Outputs { get; set; } = new();

    // Workflow designer metadata
    public List<string> Blocks { get; set; } = new();

    public bool HasCondition { get; set; }

    // Supported comparison operators for conditional actions
    public List<string> ConditionOperators { get; set; } = new();

    // Supported logical operators, such as AND and OR
    public List<string> LogicalOperators { get; set; } = new();

    // Whether multiple conditions can be configured
    public bool SupportsMultipleConditions { get; set; }

    // Optional configuration for frontend rendering
    public Dictionary<string, string> Properties { get; set; } = new();

    // Package relationship
    public Package Package { get; set; } = null!;
}