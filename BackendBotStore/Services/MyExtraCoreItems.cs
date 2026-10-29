namespace BackendBotStore.Services;

public sealed class MyExtraCoreItems : ICoreCatalogContributor
{
    public void Contribute(ICoreCatalog c)
    {
        c.RegisterVariableType(new("GUID", "Unique id") { Coerce = v => Guid.Parse(v!.ToString()!).ToString() });
        c.RegisterAction(new("ToUpper", "Upper-cases text.",
            new() { ["Text"] = "STRING" }, new() { ["Response"] = "STRING" }, [], false)
            { Handler = i => i["Text"]?.ToString()?.ToUpperInvariant() });
    }
}