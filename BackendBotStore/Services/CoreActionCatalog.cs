namespace BackendBotStore.Services;

/// <summary>Describes one built-in "Core" action so the designer can render it and its child blocks.</summary>
public sealed record CoreActionInfo(
    string Name,
    string Description,
    Dictionary<string, string> Inputs,
    Dictionary<string, string> Outputs,
    string[] Blocks,
    bool HasCondition);

/// <summary>
/// Metadata for the actions the executor implements itself (ClassName "Core").
/// They are code, not data: they live here instead of in the Packages / PackageActions tables,
/// so they can never drift from what WorkflowExecutor actually supports.
/// When you add a new Core action, add it here AND to the switch in WorkflowExecutor.ExecuteCore.
/// </summary>
public static class CoreActionCatalog
{
    public const string PackageName = WorkflowExecutor.CorePackage;
    public const string Version = "built-in";

    public static IReadOnlyList<CoreActionInfo> Actions { get; } = new CoreActionInfo[]
    {
        new("SetVariable", "Assigns a value to a variable.",
            new() { ["Value"] = "ANY" },
            new() { ["Response"] = "ANY" },
            Array.Empty<string>(), false),

        new("Evaluate", "Evaluates an expression over the workflow variables, e.g. \"count + 1\".",
            new() { ["Expression"] = "STRING" },
            new() { ["Response"] = "ANY" },
            Array.Empty<string>(), false),

        new("If", "Runs Then when the condition is true, otherwise Else.",
            new(), new(),
            new[] { "Then", "Else" }, true),

        new("ForEach", "Loops over a list, dictionary, data table or JSON array/object.",
            new() { ["Collection"] = "ANY" },
            new() { ["Item"] = "ANY", ["Index"] = "NUMBER", ["Key"] = "ANY" },
            new[] { "Body" }, false),

        new("ForCount", "Loops from From to To (inclusive) by Step.",
            new() { ["From"] = "NUMBER", ["To"] = "NUMBER", ["Step"] = "NUMBER" },
            new() { ["Index"] = "NUMBER" },
            new[] { "Body" }, false),

        new("While", "Repeats Body while the condition is true.",
            new(), new(),
            new[] { "Body" }, true),

        new("Break", "Exits the innermost loop.",
            new(), new(), Array.Empty<string>(), false),

        new("Continue", "Skips to the next iteration of the innermost loop.",
            new(), new(), Array.Empty<string>(), false),

        new("Return", "Stops the workflow successfully.",
            new(), new(), Array.Empty<string>(), false),

        new("TryCatch", "Runs Body; if an action fails, stores the message in Error and runs Catch.",
            new(),
            new() { ["Error"] = "STRING" },
            new[] { "Body", "Catch" }, false),

        new("Fail", "Fails the workflow (or the enclosing TryCatch) with a message.",
            new() { ["Message"] = "STRING" },
            new(), Array.Empty<string>(), false),
    };

    public static bool IsCoreName(string? packageName) =>
        string.Equals(packageName, PackageName, StringComparison.OrdinalIgnoreCase);

    public static bool Contains(string? functionName) =>
        Actions.Any(a => string.Equals(a.Name, functionName, StringComparison.OrdinalIgnoreCase));
}