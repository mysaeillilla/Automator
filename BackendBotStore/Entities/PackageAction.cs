namespace BackendBotStore.Entities;

public class PackageAction
{
    public int Id { get; set; }

    public int PackageId { get; set; }

    public string Name { get; set; } = string.Empty;

    public Dictionary<string, string> Inputs { get; set; } = new();

    public Dictionary<string, string> Outputs { get; set; } = new();

    public Package Package { get; set; } = null!;
}