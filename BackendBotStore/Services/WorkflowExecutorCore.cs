using System.Collections;
using System.Data;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using BackendBotStore.Actions;

namespace BackendBotStore.Services;

// ─────────────────────────────────────────────────────────────
//  Workflow JSON models
// ─────────────────────────────────────────────────────────────

public sealed class WorkflowDefinition
{
    /// <summary>
    /// Package name -> DLL path (paths are filled in by the API before execution).
    /// "Core" is built in and must not be listed here.
    /// </summary>
    public Dictionary<string, string> Packages { get; set; } = new();
    public Dictionary<string, WorkflowVariable> Variables { get; set; } = new();

    [JsonConverter(typeof(LegacyActionsConverter))]
    public List<WorkflowAction> Actions { get; set; } = new();
}

// WorkflowVariable now lives in WorkflowVariable.cs

public sealed class WorkflowAction
{
    /// <summary>Package name (key in "packages"), or "Core" for built-in control actions.</summary>
    public string ClassName { get; set; } = string.Empty;
    public string FunctionName { get; set; } = string.Empty;

    /// <summary>Parameter name -> literal or "{{variable}}"</summary>
    public Dictionary<string, JsonElement> Inputs { get; set; } = new();

    /// <summary>"Response" (or a property name of the result) -> "{{variable}}"</summary>
    public Dictionary<string, string> Outputs { get; set; } = new();

    // ── Core-only ──
    public JsonElement? Condition { get; set; }
    public List<WorkflowAction>? Body  { get; set; }   // ForEach / ForCount / While / TryCatch
    public List<WorkflowAction>? Then  { get; set; }   // If
    public List<WorkflowAction>? Else  { get; set; }   // If
    public List<WorkflowAction>? Catch { get; set; }   // TryCatch
}

/// <summary>Accepts the new array form and the old {"1": {...}, "2": {...}} form.</summary>
public sealed class LegacyActionsConverter : JsonConverter<List<WorkflowAction>>
{
    public override List<WorkflowAction> Read(ref Utf8JsonReader reader, Type t, JsonSerializerOptions o)
    {
        if (reader.TokenType == JsonTokenType.StartObject)
        {
            var dict = JsonSerializer.Deserialize<Dictionary<string, WorkflowAction>>(ref reader, o)!;
            return dict.OrderBy(k => int.TryParse(k.Key, out var n) ? n : int.MaxValue)
                       .ThenBy(k => k.Key, StringComparer.Ordinal)
                       .Select(k => k.Value).ToList();
        }
        return JsonSerializer.Deserialize<List<WorkflowAction>>(ref reader, o)!;
    }

    public override void Write(Utf8JsonWriter w, List<WorkflowAction> v, JsonSerializerOptions o) =>
        JsonSerializer.Serialize(w, v, o);
}

// ─────────────────────────────────────────────────────────────
//  Executor (register as Transient/Scoped – it holds run state)
// ─────────────────────────────────────────────────────────────

public class WorkflowExecutor
{
    public const string CorePackage = "Core";

    private readonly ICoreCatalog _catalog;
    private WorkflowVariableStore _store;
    private VariableActions _variableActions;

    public WorkflowExecutor(ICoreCatalog catalog)
    {
        _catalog = catalog;
        _store = new WorkflowVariableStore(catalog);
        _variableActions = new VariableActions(_store);
    }

    // {{var}}  {{var.Prop}}  {{var[0]}}  {{var['Column Name']}}  {{var.Items[2].Name}}
    private static readonly Regex TemplateRegex = new(
        @"\{\{\s*([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*|\[\d+\]|\['[^']+'\])*)\s*\}\}", RegexOptions.Compiled);

    private static readonly Regex PathTokenRegex =
        new(@"\.([A-Za-z_]\w*)|\[(\d+)\]|\['([^']+)'\]", RegexOptions.Compiled);

    private static readonly Regex IdentifierRegex =
        new(@"^[A-Za-z_]\w*$", RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly Dictionary<string, Assembly> _assemblyCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<Type, object> _instanceCache = new();
    private readonly Dictionary<string, Type> _typeCache = new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, string> Packages { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Read-only view of the run's variables (all writes go through the variable store).</summary>
    public IReadOnlyDictionary<string, WorkflowVariable> Variables => _store.All;
    public List<WorkflowAction> Actions { get; set; } = new();
    public WorkflowAction? CurrentAction { get; set; }
    public string? CurrentActionId { get; private set; }

    /// <summary>
    /// OPTIONAL security guard. Leave null (default) to load each package from the path
    /// given in the workflow JSON.
    /// </summary>
    public string? AllowedPackageRoot { get; set; }

    /// <summary>Safety net against runaway While / ForEach loops.</summary>
    public int MaxLoopIterations { get; set; } = 100_000;

    /// <summary>Checked between actions and loop iterations so a run can be cancelled.</summary>
    public CancellationToken Cancellation { get; set; }

    public List<string> Logs { get; } = new();
    public string? LastError { get; private set; }

    /// <summary>Raw return value of the last package action that ran (used by ExecuteSingleAction).</summary>
    public object? LastActionResult { get; private set; }

    /// <summary>Optional progress callbacks (used to persist per-action status while the run is in flight).</summary>
    public IWorkflowProgressListener? Listener { get; set; }

    private int _sequence;

    /// <summary>What a block of actions tells its parent to do next.</summary>
    private enum Flow { Next, Break, Continue, Return }

    /// <summary>An action failed (already reported to the listener). Caught by TryCatch or the workflow root.</summary>
    private sealed class WorkflowStopException : Exception
    {
        public WorkflowStopException(string message) : base(message) { }
    }

    private static bool IsCore(WorkflowAction a) =>
        a.ClassName.Equals(CorePackage, StringComparison.OrdinalIgnoreCase);

    // ─────────────────────────────────────────────────────────
    //  Whole workflow
    // ─────────────────────────────────────────────────────────

    /// <param name="Workflow">Workflow JSON string.</param>
    /// <param name="inputOverrides">Optional runtime values for variables flagged "input": true.</param>
    public bool ExecuteWorkflow(string Workflow, Dictionary<string, object?>? inputOverrides = null)
    {
        Reset();

        try
        {
            var definition = JsonSerializer.Deserialize<WorkflowDefinition>(Workflow, JsonOptions)
                             ?? throw new InvalidOperationException("Workflow JSON is empty or invalid.");

            // 1. Packages (case-insensitive lookup by package name)
            Packages = new Dictionary<string, string>(
                definition.Packages ?? new(), StringComparer.OrdinalIgnoreCase);

            // 2. Variables: validated against the catalog and coerced to their declared type
            WorkflowVariableInitializer.Initialize(_store, definition.Variables);
            WorkflowVariableInitializer.ApplyInputs(_store, inputOverrides);

            // 3. Actions: validate the whole tree first, then run it
            Actions = definition.Actions ?? new();
            ValidateBlock(Actions, "", inLoop: false);
            ExecuteBlock(Actions, "");          // a top-level Return/Break simply ends the run

            Log("Workflow completed successfully.");
            return true;
        }
        catch (WorkflowStopException ex)
        {
            return Fail(ex.Message);            // already reported per-action via FailAction
        }
        catch (JsonException ex)
        {
            return Fail($"Invalid workflow JSON: {ex.Message}");
        }
        catch (OperationCanceledException)
        {
            return Fail("Workflow was cancelled.");
        }
        catch (Exception ex)
        {
            return Fail($"Workflow failed: {ex.Message}");
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Single action
    // ─────────────────────────────────────────────────────────

    /// <summary>
    /// Runs ONE package action outside a workflow, with the same package loading, {{variable}} resolution,
    /// argument conversion and error handling a workflow run uses. The raw return value is in LastActionResult.
    /// Returns false (see LastError / Logs) when the action cannot be validated or fails.
    /// </summary>
    /// <param name="packageName">Package name, i.e. the ClassName an action has in a workflow.</param>
    /// <param name="dllPath">DLL of that package.</param>
    /// <param name="inputs">Parameter name -> literal or "{{variable}}".</param>
    /// <param name="variables">Variables the inputs refer to (same shape as the workflow's "variables" section).</param>
    public bool ExecuteSingleAction(
        string packageName,
        string dllPath,
        string functionName,
        Dictionary<string, JsonElement>? inputs,
        Dictionary<string, WorkflowVariable>? variables = null)
    {
        Reset();

        try
        {
            if (string.IsNullOrWhiteSpace(packageName) ||
                packageName.Equals(CorePackage, StringComparison.OrdinalIgnoreCase))
                return Fail("Core actions run only inside a workflow.");

            Packages = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [packageName] = dllPath };
            WorkflowVariableInitializer.Initialize(_store, variables);

            var action = new WorkflowAction
            {
                ClassName = packageName,
                FunctionName = functionName,
                Inputs = new Dictionary<string, JsonElement>(inputs ?? new(), StringComparer.OrdinalIgnoreCase)
            };

            Actions = new() { action };
            ValidateBlock(Actions, "", inLoop: false);   // package listed, every {{variable}} defined

            CurrentActionId = "1";
            CurrentAction = action;
            ExecutePackageAction("1", action);

            Log("Action completed successfully.");
            return true;
        }
        catch (WorkflowStopException ex)
        {
            return Fail(ex.Message);
        }
        catch (OperationCanceledException)
        {
            return Fail("Action was cancelled.");
        }
        catch (Exception ex)
        {
            return Fail($"Action failed: {ex.Message}");
        }
    }

    /// <summary>Values of all variables flagged "output": true.</summary>
    public Dictionary<string, object?> GetOutputVariables() =>
        _store.All.Where(kv => kv.Value.Output).ToDictionary(kv => kv.Key, kv => kv.Value.Value);

    // ─────────────────────────────────────────────────────────
    //  Variable evaluation
    // ─────────────────────────────────────────────────────────

    /// <summary>
    /// Returns true when the variable is defined and, if it is an input variable, has a value.
    /// </summary>
    public bool VariableEvaluator(string variableName)
    {
        if (!_store.TryGet(variableName, out var variable))
            return Fail($"Variable '{variableName}' is not defined.");

        if (variable.Input && variable.Value is null)
            return Fail($"Input variable '{variableName}' has no value.");

        return true;
    }

    // ─────────────────────────────────────────────────────────
    //  Block execution
    // ─────────────────────────────────────────────────────────

    /// <param name="prefix">Path prefix for action ids, e.g. "" (top level), "2[3]." (3rd iteration of action 2), "4.then."</param>
    private Flow ExecuteBlock(List<WorkflowAction>? block, string prefix)
    {
        if (block is null) return Flow.Next;

        for (var i = 0; i < block.Count; i++)
        {
            Cancellation.ThrowIfCancellationRequested();

            var id = $"{prefix}{i + 1}";
            CurrentActionId = id;
            CurrentAction = block[i];

            var flow = IsCore(block[i])
                ? ExecuteCore(id, block[i])
                : ExecutePackageAction(id, block[i]);

            if (flow != Flow.Next) return flow;
        }
        return Flow.Next;
    }

    // ─────────────────────────────────────────────────────────
    //  Package (DLL) action
    // ─────────────────────────────────────────────────────────

    private Flow ExecutePackageAction(string id, WorkflowAction action)
    {
        var started = false;
        try
        {
            Log($"Action {id}: {action.ClassName}.{action.FunctionName}");
            Notify(l => l.ActionStarted(id, ++_sequence, action));
            started = true;

            var type = ResolveType(action.ClassName, action.FunctionName);

            var inputs = ResolveInputs(action);
            Notify(l => l.ActionInputsResolved(id, inputs));

            var method = FindMethod(type, action.FunctionName, inputs);
            var instance = method.IsStatic ? null : GetInstance(type);
            var args = BuildArguments(method, inputs);

            var result = UnwrapTask(method.Invoke(instance, args));
            LastActionResult = result;

            var written = MapOutputs(action, result);
            Notify(l => l.ActionCompleted(id, written));

            Log($"Action {id} completed.");
            return Flow.Next;
        }
        catch (TargetInvocationException ex)
        {
            throw FailAction(id, started, $"Action '{id}' threw: {ex.InnerException?.Message ?? ex.Message}");
        }
        catch (WorkflowStopException)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw FailAction(id, started, $"Action '{id}' failed: {ex.Message}");
        }
    }

    /// <summary>Checks the variables an action reads, then resolves every {{...}} in its inputs.</summary>
    private Dictionary<string, object?> ResolveInputs(WorkflowAction action)
    {
        foreach (var name in GetInputVariables(action))
            if (!VariableEvaluator(name))
                throw new InvalidOperationException(LastError ?? $"Variable '{name}' is not usable.");

        var inputs = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, element) in action.Inputs)
            inputs[name] = ResolveValue(ToPlain(element));
        return inputs;
    }

    // ─────────────────────────────────────────────────────────
    //  Core (built-in) actions
    // ─────────────────────────────────────────────────────────

    private Flow ExecuteCore(string id, WorkflowAction a)
    {
        var started = false;
        try
        {
            Log($"Action {id}: Core.{a.FunctionName}");
            Notify(l => l.ActionStarted(id, ++_sequence, a));
            started = true;

            var inputs = ResolveInputs(a);
            Notify(l => l.ActionInputsResolved(id, inputs));

            var fn = a.FunctionName.ToLowerInvariant();
            var flow = Flow.Next;
            object? result = null;
            var producesValue = false;

            switch (fn)
            {
                case "setvariable":
                    result = inputs.GetValueOrDefault("Value");
                    producesValue = true;
                    break;
                case "evaluate":
                    result = Evaluate(Convert.ToString(inputs.GetValueOrDefault("Expression")) ?? "");
                    producesValue = true;
                    break;
                case "if":       flow = ExecuteIf(id, a); break;
                case "variable.create":
                    result = _variableActions.Create(
                        RequiredText(inputs, "Name"),
                        Convert.ToString(inputs.GetValueOrDefault("Type")),
                        inputs.GetValueOrDefault("Value"));
                    producesValue = true;
                    break;
                case "variable.set":
                    result = _variableActions.Set(RequiredText(inputs, "Name"), inputs.GetValueOrDefault("Value"));
                    producesValue = true;
                    break;
                case "variable.convert":
                    result = _variableActions.Convert(
                        inputs.GetValueOrDefault("Value"),
                        RequiredText(inputs, "TargetType"));
                    producesValue = true;
                    break;
                case "foreach":    flow = ExecuteForEach(id, a, inputs); break;
                case "foreachrow": flow = ExecuteForEachRow(id, a, inputs); break;
                case "forcount": flow = ExecuteForCount(id, a, inputs); break;
                case "while":    flow = ExecuteWhile(id, a); break;
                case "trycatch": flow = ExecuteTryCatch(id, a); break;
                case "break":    flow = Flow.Break; break;
                case "continue": flow = Flow.Continue; break;
                case "return":   flow = Flow.Return; break;
                case "fail":
                    throw new InvalidOperationException(
                        Convert.ToString(inputs.GetValueOrDefault("Message")) ?? "Workflow failed.");
                default:
                    // actions added through ICoreCatalog (RegisterAction with a Handler)
                    if (!_catalog.TryGetAction(a.FunctionName, out var info) || info.Handler is null)
                        throw new MissingMethodException($"Core action '{a.FunctionName}' has no implementation.");
                    result = info.Handler(inputs);
                    producesValue = info.Outputs.Count > 0;
                    break;
            }

            var written = producesValue ? MapOutputs(a, result) : new Dictionary<string, object?>();
            Notify(l => l.ActionCompleted(id, written));
            return flow;
        }
        catch (WorkflowStopException ex)
        {
            // a child failed; mark this container action failed too, then bubble up
            if (started) Notify(l => l.ActionFailed(id, ex.Message));
            throw;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw FailAction(id, started, $"Action '{id}' failed: {ex.Message}");
        }
    }

    private static string RequiredText(Dictionary<string, object?> inputs, string key)
    {
        var text = Convert.ToString(inputs.GetValueOrDefault(key), CultureInfo.InvariantCulture);
        return string.IsNullOrWhiteSpace(text)
            ? throw new InvalidOperationException($"Input '{key}' is required.")
            : text.Trim();
    }

    private Flow ExecuteIf(string id, WorkflowAction a)
    {
        var ok = EvaluateCondition(a.Condition!.Value);
        Log($"Action {id}: condition = {ok}");
        return ok ? ExecuteBlock(a.Then, $"{id}.then.") : ExecuteBlock(a.Else, $"{id}.else.");
    }

    /// <summary>Runs one loop iteration. Returns true when the loop must stop; `exit` is the flow to hand to the caller.</summary>
    private bool RunIteration(string id, WorkflowAction a, int n, out Flow exit)
    {
        if (n >= MaxLoopIterations)
            throw new InvalidOperationException($"Loop exceeded MaxLoopIterations ({MaxLoopIterations}).");

        var flow = ExecuteBlock(a.Body, $"{id}[{n}].");
        exit = flow == Flow.Return ? Flow.Return : Flow.Next;   // Break is consumed by the loop
        return flow is Flow.Break or Flow.Return;               // Continue / Next -> keep looping
    }
    /// <summary>Iterates the rows of a DATATABLE; Item is the live DataRow (a ROW variable), Index the 0-based position.</summary>
    private Flow ExecuteForEachRow(string id, WorkflowAction a, Dictionary<string, object?> inputs)
    {
        var raw = VariableValueConverter.Unwrap(inputs.GetValueOrDefault("Table"));

        // A DataTable is used as is (not copied) so edits to Item change the variable's table.
        var table = raw as DataTable
                    ?? VariableValueConverter.Convert(raw, "DATATABLE") as DataTable
                    ?? throw new InvalidOperationException("ForEachRow requires a Table input (DATATABLE).");

        var rows = table.Rows.Cast<DataRow>().ToList();   // snapshot: safe if the body adds/removes rows
        var n = 0;
        foreach (var row in rows)
        {
            if (row.RowState is DataRowState.Deleted or DataRowState.Detached) continue;

            SetOutput(a, "Item", row);
            SetOutput(a, "Index", (long)n);
            if (RunIteration(id, a, n++, out var exit)) return exit;
        }
        return Flow.Next;
    }

    private Flow ExecuteForEach(string id, WorkflowAction a, Dictionary<string, object?> inputs)
    {
        var items = Enumerate(inputs.GetValueOrDefault("Collection"));   // snapshot: safe if the body mutates the source
        var n = 0;
        foreach (var (key, item) in items)
        {
            SetOutput(a, "Item", item);
            SetOutput(a, "Index", (long)n);
            SetOutput(a, "Key", key);
            if (RunIteration(id, a, n++, out var exit)) return exit;
        }
        return Flow.Next;
    }

    private Flow ExecuteForCount(string id, WorkflowAction a, Dictionary<string, object?> inputs)
    {
        long GetNumber(string key, long fallback) =>
            inputs.TryGetValue(key, out var raw) && TryNumber(raw, out var num) ? (long)num : fallback;

        var first = GetNumber("From", 0);
        var last = GetNumber("To", 0);
        var step = GetNumber("Step", 1);
        if (step == 0) throw new InvalidOperationException("ForCount: Step cannot be 0.");

        var n = 0;
        for (var current = first; step > 0 ? current <= last : current >= last; current += step)
        {
            SetOutput(a, "Index", current);
            if (RunIteration(id, a, n++, out var exit)) return exit;
        }
        return Flow.Next;
    }

    private Flow ExecuteWhile(string id, WorkflowAction a)
    {
        var n = 0;
        while (EvaluateCondition(a.Condition!.Value))
            if (RunIteration(id, a, n++, out var exit)) return exit;
        return Flow.Next;
    }

    private Flow ExecuteTryCatch(string id, WorkflowAction a)
    {
        try
        {
            return ExecuteBlock(a.Body, $"{id}.try.");
        }
        catch (WorkflowStopException ex)
        {
            Log($"Action {id}: caught '{ex.Message}'");
            SetOutput(a, "Error", ex.Message);
            return ExecuteBlock(a.Catch, $"{id}.catch.");
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Conditions
    // ─────────────────────────────────────────────────────────

    private bool EvaluateCondition(JsonElement node)
    {
        if (node.ValueKind is JsonValueKind.True or JsonValueKind.False) return node.GetBoolean();
        if (node.ValueKind == JsonValueKind.String) return ToBool(ResolveValue(node.GetString()));   // "{{flag}}"

        if (TryProp(node, "All", out var all)) return all.EnumerateArray().All(EvaluateCondition);
        if (TryProp(node, "Any", out var any)) return any.EnumerateArray().Any(EvaluateCondition);
        if (TryProp(node, "Not", out var negated)) return !EvaluateCondition(negated);

        var left = TryProp(node, "Left", out var l) || TryProp(node, "LeftOperand", out l) ? ResolveValue(ToPlain(l)) : null;
        var right = TryProp(node, "Right", out var r) || TryProp(node, "RightOperand", out r) ? ResolveValue(ToPlain(r)) : null;
        var op = TryProp(node, "Operator", out var o)
            ? o.GetString() ?? ""
            : throw new InvalidOperationException("Condition has no Operator.");

        return op.ToLowerInvariant() switch
        {
            "isnull"         => left is null,
            "isnotnull"      => left is not null,
            "isempty"        => IsEmpty(left),
            "isnotempty"     => !IsEmpty(left),
            "equals"         => AreEqual(left, right),
            "notequals"      => !AreEqual(left, right),
            "greaterthan"    => CompareValues(left, right) > 0,
            "greaterorequal" or "greaterthanorequal" => CompareValues(left, right) >= 0,
            "lessthan"       => CompareValues(left, right) < 0,
            "lessorequal" or "lessthanorequal"       => CompareValues(left, right) <= 0,
            "contains"       => ContainsValue(left, right),
            "notcontains"    => !ContainsValue(left, right),
            "istrue"         => ToBool(left),
            "isfalse"        => !ToBool(left),
            "startswith"     => Stringify(left).StartsWith(Stringify(right), StringComparison.OrdinalIgnoreCase),
            "endswith"       => Stringify(left).EndsWith(Stringify(right), StringComparison.OrdinalIgnoreCase),
            "matches"        => Regex.IsMatch(Stringify(left), Stringify(right)),
            _ => throw new InvalidOperationException($"Unknown operator '{op}'.")
        };
    }

    private static bool TryProp(JsonElement e, string name, out JsonElement value)
    {
        if (e.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in e.EnumerateObject())
            {
                if (p.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = p.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    // internal: also used by the built-in variable-type coercers in CoreCatalog
    internal static bool TryNumber(object? v, out double d)
    {
        d = 0;
        v = VariableValueConverter.Unwrap(v);
        if (v is null or bool) return false;
        if (v is string s) return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d);
        if (v is sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal)
        {
            d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
            return true;
        }
        return false;
    }

    internal static bool ToBool(object? v) => VariableValueConverter.Unwrap(v) switch
    {
        null => false,
        bool b => b,
        string s => s.Equals("true", StringComparison.OrdinalIgnoreCase) || s == "1",
        var other when TryNumber(other, out var d) => d != 0,
        _ => true
    };

    private static bool AreEqual(object? a, object? b)
    {
        if (a is null || b is null) return a is null && b is null;
        if (TryNumber(a, out var x) && TryNumber(b, out var y)) return x == y;
        if (a is bool || b is bool) return ToBool(a) == ToBool(b);
        return string.Equals(Stringify(a), Stringify(b), StringComparison.Ordinal);
    }

    private static int CompareValues(object? a, object? b) =>
        TryNumber(a, out var x) && TryNumber(b, out var y)
            ? x.CompareTo(y)
            : string.Compare(Stringify(a), Stringify(b), StringComparison.Ordinal);

    private static bool IsEmpty(object? v) => VariableValueConverter.Unwrap(v) switch
    {
        null => true,
        string s => s.Length == 0,
        DataTable dt => dt.Rows.Count == 0,
        ICollection c => c.Count == 0,
        IEnumerable e => !e.Cast<object>().Any(),
        _ => false
    };

    private static bool ContainsValue(object? container, object? value) => container switch
    {
        null => false,
        string s => s.Contains(Stringify(value), StringComparison.OrdinalIgnoreCase),
        IDictionary d => d.Keys.Cast<object>().Any(k => AreEqual(k, value)),
        IEnumerable e => e.Cast<object?>().Any(i => AreEqual(i, value)),
        _ => false
    };

    // ─────────────────────────────────────────────────────────
    //  Expressions (Core.Evaluate)
    // ─────────────────────────────────────────────────────────

    // Requires NuGet package DynamicExpresso.Core (sandboxed by default).
    // Variables are exposed by name:  "count + 1",  "price * qty > 100",  "name.ToUpper()"
    private object? Evaluate(string expression)
    {
        if (string.IsNullOrWhiteSpace(expression))
            throw new InvalidOperationException("Evaluate: Expression is empty.");

        var interpreter = new DynamicExpresso.Interpreter();
        foreach (var (name, variable) in _store.All)
        {
            if (!IdentifierRegex.IsMatch(name)) continue;   // names with spaces etc. can't be used in expressions
            interpreter.SetVariable(name, variable.Value, variable.Value?.GetType() ?? typeof(object));
        }
        return interpreter.Eval(expression);
    }

    // ─────────────────────────────────────────────────────────
    //  Collections (ForEach)
    // ─────────────────────────────────────────────────────────

    private static List<(object? Key, object? Item)> Enumerate(object? source)
    {
        var result = new List<(object? Key, object? Item)>();

        switch (source)
        {
            case null:
                break;

            case JsonElement je:
                return Enumerate(ToPlain(je));

            case JsonValue:
                throw new InvalidOperationException("Cannot iterate over a JSON scalar.");

            case JsonObject jo:
                foreach (var (k, v) in jo) result.Add((k, v));
                break;

            case JsonArray ja:
            {
                var j = 0;
                foreach (var v in ja) result.Add((j++, v));
                break;
            }

            case string s when s.TrimStart().StartsWith('[') || s.TrimStart().StartsWith('{'):
                return Enumerate(ToPlain(JsonSerializer.Deserialize<JsonElement>(s)));

            case string:
                throw new InvalidOperationException("Cannot iterate over a plain string.");

            case DataTable dt:
            {
                var n = 0;
                foreach (DataRow row in dt.Rows)
                    result.Add((n++, row));            // Item is a real DataRow (ROW)
                break;
            }

            case IDictionary d:
            {
                foreach (DictionaryEntry entry in d)
                    result.Add((entry.Key, entry.Value));
                break;
            }

            case IEnumerable e:
            {
                var i = 0;
                foreach (var item in e)
                    result.Add((i++, item));
                break;
            }

            default:
                throw new InvalidOperationException($"'{source.GetType().Name}' is not iterable.");
        }

        return result;
    }

    // ─────────────────────────────────────────────────────────
    //  Variable writes
    // ─────────────────────────────────────────────────────────

    /// <summary>Writes a loop/catch output (Item, Index, Key, Error) if the action maps it to a variable.</summary>
    private void SetOutput(WorkflowAction a, string key, object? value)
    {
        if (a.Outputs.TryGetValue(key, out var target))
            AssignVariable(TemplateRegex.Match(target).Groups[1].Value, value);
    }

    /// <summary>Writes a variable; the value is coerced to the variable's declared type.</summary>
    private void AssignVariable(string name, object? value) => _store.Set(name, value);

    // ─────────────────────────────────────────────────────────
    //  Static validation (runs before anything executes)
    // ─────────────────────────────────────────────────────────

    // Names declared by Variable.Create actions seen so far during validation.
    private readonly HashSet<string> _declaredByActions = new(StringComparer.OrdinalIgnoreCase);

    private bool IsKnownVariable(string name) => _store.Exists(name) || _declaredByActions.Contains(name);

    private static string? LiteralInput(WorkflowAction a, string key)
    {
        foreach (var (k, v) in a.Inputs)
            if (k.Equals(key, StringComparison.OrdinalIgnoreCase) && v.ValueKind == JsonValueKind.String)
            {
                var text = v.GetString();
                return text is not null && !TemplateRegex.IsMatch(text) && !string.IsNullOrWhiteSpace(text)
                    ? text.Trim()
                    : null;
            }
        return null;
    }

    private void ValidateBlock(List<WorkflowAction>? block, string prefix, bool inLoop)
    {
        if (block is null) return;

        for (var i = 0; i < block.Count; i++)
        {
            var a = block[i];
            var id = $"{prefix}{i + 1}";

            if (string.IsNullOrWhiteSpace(a.ClassName))
                throw new InvalidOperationException($"Action {id}: ClassName is missing.");
            if (string.IsNullOrWhiteSpace(a.FunctionName))
                throw new InvalidOperationException($"Action {id}: FunctionName is missing.");

            if (!IsCore(a) && !Packages.ContainsKey(a.ClassName))
                throw new InvalidOperationException($"Action {id}: package '{a.ClassName}' is not listed in 'packages'.");

            if (IsCore(a) && !_catalog.Contains(a.FunctionName))
                throw new InvalidOperationException($"Action {id}: unknown Core action '{a.FunctionName}'.");

            foreach (var name in GetInputVariables(a))
                if (!IsKnownVariable(name))
                    throw new InvalidOperationException($"Action {id}: variable '{name}' is not defined.");

            foreach (var target in a.Outputs.Values)
            {
                var m = TemplateRegex.Match(target);
                if (!m.Success || m.Length != target.Length || m.Groups[2].Length > 0)
                    throw new InvalidOperationException(
                        $"Action {id}: output target '{target}' must be of the form {{{{variable}}}}.");
                if (!IsKnownVariable(m.Groups[1].Value))
                    throw new InvalidOperationException(
                        $"Action {id}: output variable '{m.Groups[1].Value}' is not defined.");
            }

            // A literal Variable.Create name makes the variable usable by the actions after it.
            if (IsCore(a) && a.FunctionName.Equals("Variable.Create", StringComparison.OrdinalIgnoreCase)
                && LiteralInput(a, "Name") is { } createdName)
                _declaredByActions.Add(createdName);

            if (!IsCore(a)) continue;

            var fn = a.FunctionName.ToLowerInvariant();
            var isLoop = fn is "foreach" or "foreachrow" or "forcount" or "while";

            if (fn == "foreachrow")
            {
                // Item must be a ROW variable, Index a NUMBER variable
                CheckLoopOutput(id, a, "Item", "ROW");
                CheckLoopOutput(id, a, "Index", "NUMBER");
            }

            if ((fn is "break" or "continue") && !inLoop)
                throw new InvalidOperationException($"Action {id}: '{a.FunctionName}' can only be used inside a loop.");
            if ((fn is "if" or "while") && a.Condition is null)
                throw new InvalidOperationException($"Action {id}: '{a.FunctionName}' requires a Condition.");

            ValidateBlock(a.Body,  $"{id}.body.",  inLoop || isLoop);
            ValidateBlock(a.Then,  $"{id}.then.",  inLoop);
            ValidateBlock(a.Else,  $"{id}.else.",  inLoop);
            ValidateBlock(a.Catch, $"{id}.catch.", inLoop);
        }
    }

    private void CheckLoopOutput(string id, WorkflowAction a, string key, string expectedType)
    {
        if (!a.Outputs.TryGetValue(key, out var target)) return;

        var name = TemplateRegex.Match(target).Groups[1].Value;
        if (_store.TryGet(name, out var variable) &&
            !variable.Type.Equals(expectedType, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Action {id}: '{key}' must be stored in a {expectedType} variable, but '{name}' is {variable.Type}.");
    }

    // ─────────────────────────────────────────────────────────
    //  Package / reflection helpers
    // ─────────────────────────────────────────────────────────

    /// <summary>
    /// The action's ClassName is a PACKAGE NAME. Look it up in Packages to get the DLL path, load that DLL,
    /// and find the single public class that exposes the requested function.
    /// </summary>
    private Type ResolveType(string packageName, string functionName)
    {
        if (string.IsNullOrWhiteSpace(packageName))
            throw new InvalidOperationException("Action has no ClassName (package name).");

        if (string.IsNullOrWhiteSpace(functionName))
            throw new InvalidOperationException("Action has no FunctionName.");

        // Cache by package AND function: different functions in one package may live in different classes.
        var cacheKey = $"{packageName}::{functionName}";
        if (_typeCache.TryGetValue(cacheKey, out var cached))
            return cached;

        if (!Packages.TryGetValue(packageName, out var dllPath))
            throw new InvalidOperationException($"Package '{packageName}' is not listed in the workflow packages.");

        if (string.IsNullOrWhiteSpace(dllPath))
            throw new InvalidOperationException($"Package '{packageName}' has no DLL path.");

        var assembly = LoadAssembly(dllPath);

        Type[] types;
        try
        {
            types = assembly.GetExportedTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            types = ex.Types
                .Where(t => t is not null && t.IsPublic)
                .Cast<Type>()
                .ToArray();
        }

        var matchingTypes = types
            .Where(t => t.IsClass && !t.IsAbstract)
            .Where(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)
                         .Any(m => m.Name.Equals(functionName, StringComparison.OrdinalIgnoreCase)
                                   && !m.ContainsGenericParameters))
            .ToList();

        if (matchingTypes.Count == 0)
            throw new MissingMethodException(
                $"Function '{functionName}' was not found in any public class in package '{packageName}' ({dllPath}).");

        if (matchingTypes.Count > 1)
        {
            var classNames = string.Join(", ", matchingTypes.Select(t => t.FullName));
            throw new InvalidOperationException(
                $"Function '{functionName}' exists in multiple classes in package '{packageName}': {classNames}. " +
                "Please make the function unique.");
        }

        var resolvedType = matchingTypes[0];
        Log($"Package '{packageName}' -> {resolvedType.FullName}.{functionName} ({dllPath})");

        _typeCache[cacheKey] = resolvedType;
        return resolvedType;
    }

    private Assembly LoadAssembly(string dllPath)
    {
        var fullPath = Path.GetFullPath(dllPath, AppContext.BaseDirectory);

        // Optional guard – only enforced when AllowedPackageRoot is configured (currently disabled).
        // if (!string.IsNullOrWhiteSpace(AllowedPackageRoot))
        // {
        //     var root = Path.GetFullPath(AllowedPackageRoot).TrimEnd(Path.DirectorySeparatorChar)
        //                + Path.DirectorySeparatorChar;
        //     if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        //         throw new UnauthorizedAccessException($"Package path '{fullPath}' is outside the allowed folder.");
        // }

        if (!File.Exists(fullPath))
            throw new FileNotFoundException($"Package DLL not found: {fullPath}");

        if (!_assemblyCache.TryGetValue(fullPath, out var assembly))
        {
            assembly = Assembly.LoadFrom(fullPath);
            _assemblyCache[fullPath] = assembly;
        }
        return assembly;
    }

    private object GetInstance(Type type)
    {
        if (!_instanceCache.TryGetValue(type, out var instance))
        {
            instance = Activator.CreateInstance(type)
                       ?? throw new InvalidOperationException($"Could not create an instance of '{type.FullName}'.");
            _instanceCache[type] = instance;
        }
        return instance;
    }

    private static MethodInfo FindMethod(Type type, string functionName, Dictionary<string, object?> inputs)
    {
        var candidates = type
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static)
            .Where(m => m.Name.Equals(functionName, StringComparison.OrdinalIgnoreCase) && !m.ContainsGenericParameters)
            .Where(m => m.GetParameters().All(p => inputs.ContainsKey(p.Name!) || p.HasDefaultValue))
            .OrderByDescending(m => m.GetParameters().Count(p => inputs.ContainsKey(p.Name!)))
            .ToList();

        return candidates.FirstOrDefault()
               ?? throw new MissingMethodException(
                   $"No public method '{functionName}' on '{type.FullName}' matches the supplied inputs ({string.Join(", ", inputs.Keys)}).");
    }

    private static object?[] BuildArguments(MethodInfo method, Dictionary<string, object?> inputs)
    {
        var parameters = method.GetParameters();
        var args = new object?[parameters.Length];

        for (var i = 0; i < parameters.Length; i++)
        {
            var p = parameters[i];
            if (p.ParameterType.IsByRef)
                throw new NotSupportedException($"ref/out parameter '{p.Name}' is not supported.");

            args[i] = inputs.TryGetValue(p.Name!, out var value)
                ? ConvertValue(value, p.ParameterType)
                : p.DefaultValue;
        }
        return args;
    }

    private static object? UnwrapTask(object? result)
    {
        if (result is not Task task) return result;

        task.GetAwaiter().GetResult();

        var taskType = task.GetType();
        if (!taskType.IsGenericType) return null;

        var value = taskType.GetProperty("Result")?.GetValue(task);
        return value?.GetType().FullName == "System.Threading.Tasks.VoidTaskResult" ? null : value;
    }

    private Dictionary<string, object?> MapOutputs(WorkflowAction action, object? result)
    {
        var written = new Dictionary<string, object?>();

        foreach (var (key, target) in action.Outputs)
        {
            var varName = TemplateRegex.Match(target).Groups[1].Value;
            AssignVariable(varName, ExtractOutput(result, key));
            written[varName] = _store.GetValue(varName);
        }

        return written;
    }

    private static object? ExtractOutput(object? result, string key)
    {
        if (key.Equals("Response", StringComparison.OrdinalIgnoreCase) ||
            key.Equals("Result", StringComparison.OrdinalIgnoreCase))
            return result;

        if (result is null)
            throw new InvalidOperationException($"Action returned null; cannot read output '{key}'.");

        if (result is IDictionary dict && dict.Contains(key))
            return dict[key];

        const BindingFlags flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase;
        var prop = result.GetType().GetProperty(key, flags);
        if (prop is not null) return prop.GetValue(result);

        var field = result.GetType().GetField(key, flags);
        if (field is not null) return field.GetValue(result);

        throw new InvalidOperationException($"Output '{key}' not found on result type '{result.GetType().Name}'.");
    }

    // ─────────────────────────────────────────────────────────
    //  Variable / template resolution
    // ─────────────────────────────────────────────────────────

    /// <summary>Names of every variable referenced by the action's inputs and condition (not its child blocks).</summary>
    private static IEnumerable<string> GetInputVariables(WorkflowAction action)
    {
        var texts = action.Inputs.Values.Select(e => e.GetRawText());
        if (action.Condition is { } condition)
            texts = texts.Append(condition.GetRawText());

        return texts
            .SelectMany(t => TemplateRegex.Matches(t).Select(m => m.Groups[1].Value))
            .Distinct();
    }

    private object? ResolveValue(object? value)
    {
        switch (value)
        {
            case string s:
                var whole = TemplateRegex.Match(s);
                if (whole.Success && whole.Length == s.Length)
                    return EvalTemplate(whole);                       // keeps the original type

                return TemplateRegex.Replace(s, m => Stringify(EvalTemplate(m)));

            case Dictionary<string, object?> dict:
                return dict.ToDictionary(kv => kv.Key, kv => ResolveValue(kv.Value));

            case List<object?> list:
                return list.Select(ResolveValue).ToList();

            default:
                return value;
        }
    }

    private object? EvalTemplate(Match m)
    {
        var value = GetVariableValue(m.Groups[1].Value);
        return m.Groups[2].Length == 0 ? value : ResolvePath(value, m.Groups[2].Value);
    }

    private static object? ResolvePath(object? current, string path)
    {
        foreach (Match t in PathTokenRegex.Matches(path))
        {
            if (current is JsonElement je) current = ToPlain(je);
            current = VariableValueConverter.Unwrap(current);
            if (current is null) return null;

            if (t.Groups[2].Success)                                   // [n]
            {
                var idx = int.Parse(t.Groups[2].Value);
                current = current switch
                {
                    DataTable table when idx < table.Rows.Count => table.Rows[idx],
                    DataRow row when idx < row.Table.Columns.Count => row.IsNull(idx) ? null : row[idx],
                    JsonArray array when idx < array.Count => array[idx],
                    IList list when idx < list.Count => list[idx],
                    _ => throw new InvalidOperationException($"Index [{idx}] is out of range or the value is not a list.")
                };
                continue;
            }

            var name = t.Groups[1].Success ? t.Groups[1].Value : t.Groups[3].Value;   // .name or ['name']
            switch (current)
            {
                case DataRow row:
                    var column = row.Table.Columns.Cast<DataColumn>().FirstOrDefault(c =>
                                     string.Equals(c.ColumnName, name, StringComparison.OrdinalIgnoreCase))
                                 ?? throw new InvalidOperationException($"Column '{name}' not found.");
                    current = row.IsNull(column) ? null : row[column];
                    break;

                case DataTable table:
                    current = name.ToLowerInvariant() switch
                    {
                        "count" or "rowcount" => (long)table.Rows.Count,
                        "headers" or "columns" => table.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList(),
                        "rows" => table.Rows.Cast<DataRow>().ToList(),
                        _ => throw new InvalidOperationException($"'{name}' not found on DATATABLE (use Count, Headers, Rows or [index]).")
                    };
                    break;

                case JsonObject obj:
                    var pair = obj.FirstOrDefault(p => string.Equals(p.Key, name, StringComparison.OrdinalIgnoreCase));
                    if (pair.Key is null) throw new InvalidOperationException($"Key '{name}' not found.");
                    current = pair.Value;
                    break;

                case IDictionary d:
                    var key = d.Keys.Cast<object>().FirstOrDefault(k =>
                                  string.Equals(k.ToString(), name, StringComparison.OrdinalIgnoreCase))
                              ?? throw new InvalidOperationException($"Key '{name}' not found.");
                    current = d[key];
                    break;

                default:
                    var prop = current.GetType().GetProperty(name,
                                   BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
                               ?? throw new InvalidOperationException($"'{name}' not found on {current.GetType().Name}.");
                    current = prop.GetValue(current);
                    break;
            }
        }

        // JSON scalars come out as plain values so comparisons and conversions behave
        return VariableValueConverter.Unwrap(current);
    }

    private object? GetVariableValue(string name) =>
        _store.TryGet(name, out var v)
            ? v.Value
            : throw new InvalidOperationException($"Variable '{name}' is not defined.");

    internal static string Stringify(object? value) => VariableValueConverter.Stringify(value);

    // ─────────────────────────────────────────────────────────
    //  Value conversion helpers
    // ─────────────────────────────────────────────────────────

    private static object? Normalize(object? value) =>
        value is JsonElement element ? ToPlain(element) : value;

    private static object? ToPlain(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Array => element.EnumerateArray().Select(ToPlain).ToList(),
        JsonValueKind.Object => element.EnumerateObject()
                                       .ToDictionary(p => p.Name, p => ToPlain(p.Value)),
        _ => null   // Null / Undefined
    };

    private static object? ConvertValue(object? value, Type target)
    {
        if (value is null)
            return target.IsValueType && Nullable.GetUnderlyingType(target) is null
                ? Activator.CreateInstance(target)
                : null;

        if (target.IsInstanceOfType(value))
            return value;

        // e.g. "{{count}}" resolves to a long but the DLL parameter is a string
        if (target == typeof(string))
            return Stringify(value);

        // Typed variable values for DLL parameters
        if (target == typeof(DataTable)) return VariableValueConverter.Convert(value, "DATATABLE");
        if (target == typeof(DataRow)) return VariableValueConverter.Convert(value, "ROW");
        if (target == typeof(JsonNode)) return VariableValueConverter.Convert(value, "JSON");

        // A DataTable / DataRow cannot be serialised directly; use its {headers, rows} / object JSON form
        if (value is DataTable or DataRow) value = VariableValueConverter.Convert(value, "JSON")!;

        // Round-trip through JSON handles long->int, list->List<T>, dict->POCO, etc.
        var json = JsonSerializer.Serialize(value);
        return JsonSerializer.Deserialize(json, target, JsonOptions);
    }

    // ─────────────────────────────────────────────────────────
    //  State / logging
    // ─────────────────────────────────────────────────────────

    private void Reset()
    {
        Packages = new(StringComparer.OrdinalIgnoreCase);
        _store = new WorkflowVariableStore(_catalog);
        _variableActions = new VariableActions(_store);
        Actions = new();
        CurrentAction = null;
        CurrentActionId = null;
        LastError = null;
        LastActionResult = null;
        Logs.Clear();
        _instanceCache.Clear();
        _typeCache.Clear();
        _sequence = 0;
        _declaredByActions.Clear();
    }

    private void Log(string message) => Logs.Add($"{DateTime.UtcNow:O} {message}");

    /// <summary>Listener failures must never break a workflow run.</summary>
    private void Notify(Action<IWorkflowProgressListener> call)
    {
        if (Listener is null) return;
        try { call(Listener); }
        catch (Exception ex) { Log($"WARN: progress listener failed: {ex.Message}"); }
    }

    /// <summary>Reports the failed action to the listener and returns the exception for the caller to throw.</summary>
    private WorkflowStopException FailAction(string actionId, bool started, string message)
    {
        if (started) Notify(l => l.ActionFailed(actionId, message));
        return new WorkflowStopException(message);
    }

    private bool Fail(string message)
    {
        LastError = message;
        Log($"ERROR: {message}");
        return false;
    }
}