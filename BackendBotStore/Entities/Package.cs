namespace BackendBotStore.Entities;

public class Package
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Version { get; set; } = "1.0.0";

    public string FilePath { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    // Package dependencies
    public List<string> Dependencies { get; set; } = new();

    // Package actions and their metadata
    public ICollection<PackageAction> Actions { get; set; }
        = new List<PackageAction>();
}