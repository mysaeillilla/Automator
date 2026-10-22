namespace BackendBotStore.DTOs;

public class PackageUploadDto
{
    public string PackageName { get; set; } = string.Empty;

    public string Version { get; set; } = string.Empty;

    // Comma-separated DLL filenames
    public string Dependencies { get; set; } = string.Empty;

    public List<PackageActionUploadDto> Actions { get; set; } = new();
}

public class PackageActionUploadDto
{
    public string ActionName { get; set; } = string.Empty;

    public Dictionary<string, string> Inputs { get; set; } = new();

    public Dictionary<string, string> Outputs { get; set; } = new();
}