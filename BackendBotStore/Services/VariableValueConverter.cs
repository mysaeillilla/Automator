using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BackendBotStore.Services;

/// <summary>
/// The single place that converts values between the built-in variable types
/// (STRING, NUMBER, JSON, DATATABLE, ROW, BOOLEAN). Native .NET types are kept at runtime:
/// string, decimal, JsonNode, DataTable, DataRow, bool.
/// </summary>
public static class VariableValueConverter
{
    public static readonly string[] SupportedTypes =
    [
        "STRING", "NUMBER", "JSON", "DATATABLE", "ROW", "BOOLEAN"
    ];

    public static string NormalizeType(string? type)
    {
        var normalized = type?.Trim().ToUpperInvariant();

        if (normalized is null || !SupportedTypes.Contains(normalized))
            throw new InvalidOperationException($"Unsupported variable type: {type}");

        return normalized;
    }

    public static object? Convert(object? value, string targetType)
    {
        targetType = NormalizeType(targetType);

        value = Unwrap(value);
        if (value is null)
            return null;

        try
        {
            return targetType switch
            {
                "STRING"    => ToStringValue(value),
                "NUMBER"    => ToNumber(value),
                "JSON"      => ToJson(value),
                "DATATABLE" => ToDataTable(value),
                "ROW"       => ToDataRow(value),
                "BOOLEAN"   => ToBoolean(value),
                _ => throw new InvalidOperationException($"Conversion to {targetType} is not supported.")
            };
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception ex) when (ex is JsonException or FormatException or OverflowException
                                      or InvalidCastException or DuplicateNameException
                                      or ArgumentException or NotSupportedException)
        {
            throw new InvalidOperationException(
                $"Cannot convert {value.GetType().Name} to {targetType}: {ex.Message}", ex);
        }
    }

    /// <summary>Text used for {{template}} interpolation and string parameters. Null becomes "".</summary>
    public static string Stringify(object? value) =>
        Unwrap(value) is { } v ? ToStringValue(v) : string.Empty;

    /// <summary>
    /// JSON scalars (JsonElement / JsonValue) become plain .NET scalars (string, long, decimal, double, bool, null).
    /// JSON objects/arrays and every other type are returned unchanged.
    /// </summary>
    public static object? Unwrap(object? value) => value switch
    {
        JsonElement e => UnwrapElement(e),
        JsonValue v   => UnwrapElement(JsonSerializer.SerializeToElement((JsonNode)v)),
        DBNull        => null,
        _             => value
    };

    private static object? UnwrapElement(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l
                              : e.TryGetDecimal(out var m) ? m
                              : e.GetDouble(),
        JsonValueKind.True   => true,
        JsonValueKind.False  => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => e                                  // object / array stay as they are
    };

    // ───────────────────────── STRING ─────────────────────────

    private static string ToStringValue(object value) => value switch
    {
        string s            => s,
        bool b              => b ? "true" : "false",
        JsonNode node       => node.ToJsonString(),
        JsonElement element => element.GetRawText(),
        DataTable table     => JsonSerializer.Serialize(DataTableToDictionary(table)),
        DataRow row         => JsonSerializer.Serialize(DataRowToDictionary(row)),
        DateTime dt         => dt.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset dto  => dto.ToString("O", CultureInfo.InvariantCulture),
        IFormattable f      => f.ToString(null, CultureInfo.InvariantCulture),
        _                   => JsonSerializer.Serialize(value)
    };

    // ───────────────────────── NUMBER ─────────────────────────

    private static decimal ToNumber(object value)
    {
        switch (value)
        {
            case bool b:
                return b ? 1m : 0m;
            case decimal m:
                return m;
            case double or float:
                var d = System.Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d))
                    throw new InvalidOperationException($"Cannot convert '{value}' to NUMBER.");
                return (decimal)d;
            case sbyte or byte or short or ushort or int or uint or long or ulong:
                return System.Convert.ToDecimal(value, CultureInfo.InvariantCulture);
        }

        var text = (value as string ?? System.Convert.ToString(value, CultureInfo.InvariantCulture))?.Trim();

        if (decimal.TryParse(text, NumberStyles.Float | NumberStyles.AllowThousands,
                             CultureInfo.InvariantCulture, out var result))
            return result;

        throw new InvalidOperationException($"Cannot convert '{value}' to NUMBER.");
    }

    // ───────────────────────── BOOLEAN ─────────────────────────

    private static bool ToBoolean(object value)
    {
        switch (value)
        {
            case bool b:
                return b;
            case decimal or double or float or sbyte or byte or short or ushort or int or uint or long or ulong:
                return System.Convert.ToDecimal(value, CultureInfo.InvariantCulture) != 0m;
        }

        var text = value.ToString()?.Trim();

        if (bool.TryParse(text, out var result)) return result;
        if (text == "1") return true;
        if (text == "0") return false;

        throw new InvalidOperationException($"Cannot convert '{value}' to BOOLEAN.");
    }

    // ───────────────────────── JSON ─────────────────────────

    private static JsonNode ToJson(object value)
    {
        if (value is JsonNode node)
            return node.Parent is null ? node : node.DeepClone();

        if (value is string text)
            return ParseJson(text);

        return ToNode(value) ?? throw new InvalidOperationException("Invalid JSON.");
    }

    private static JsonNode ParseJson(string text)
    {
        try
        {
            return JsonNode.Parse(text) ?? throw new InvalidOperationException("JSON value is null.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Invalid JSON text: {ex.Message}", ex);
        }
    }

    /// <summary>Any supported runtime value (plain dictionaries/lists included) as a JsonNode.</summary>
    private static JsonNode? ToNode(object? value) => value switch
    {
        null                => null,
        JsonNode n          => n,
        JsonElement e       => JsonNode.Parse(e.GetRawText()),
        string s            => ParseJson(s),
        DataTable t         => JsonSerializer.SerializeToNode(DataTableToDictionary(t)),
        DataRow r           => JsonSerializer.SerializeToNode(DataRowToDictionary(r)),
        _                   => JsonSerializer.SerializeToNode(value)
    };

    // ───────────────────────── DATATABLE ─────────────────────────

    /// <summary>
    /// Accepts a DataTable (returned as is, not copied), {"headers":[...],"rows":[{...}]}
    /// or a JSON array of objects (headers are the union of the keys).
    /// </summary>
    private static DataTable ToDataTable(object value)
    {
        if (value is DataTable existing)
            return existing;

        var node = ToNode(value) ?? throw new InvalidOperationException("Cannot convert null to DATATABLE.");

        List<string> headers;
        JsonArray? rows;

        if (node is JsonObject root && root["headers"] is JsonArray headerArray)
        {
            headers = headerArray.Select(x => x?.ToString() ?? "").ToList();
            rows = root["rows"] as JsonArray;
        }
        else if (node is JsonArray array)
        {
            headers = new List<string>();
            foreach (var item in array.OfType<JsonObject>())
                foreach (var key in item.Select(p => p.Key))
                    if (!headers.Contains(key)) headers.Add(key);
            rows = array;
        }
        else
        {
            throw new InvalidOperationException(
                "DATATABLE needs {\"headers\": [...], \"rows\": [...]} or an array of objects.");
        }

        var table = new DataTable();
        foreach (var header in headers)
            table.Columns.Add(header, typeof(object));

        if (rows is not null)
        {
            foreach (var item in rows)
            {
                var row = table.NewRow();

                if (item is JsonObject obj)
                {
                    foreach (var header in headers)
                        row[header] = obj.TryGetPropertyValue(header, out var cell)
                            ? NodeToCell(cell) : DBNull.Value;
                }
                else if (item is JsonArray cells)
                {
                    for (var i = 0; i < headers.Count && i < cells.Count; i++)
                        row[i] = NodeToCell(cells[i]);
                }
                else
                {
                    throw new InvalidOperationException("Every DATATABLE row must be an object or an array.");
                }

                table.Rows.Add(row);
            }
        }

        return table;
    }

    // ───────────────────────── ROW ─────────────────────────

    /// <summary>Accepts a DataRow, the first row of a DataTable, or a JSON object / dictionary.</summary>
    private static DataRow ToDataRow(object value)
    {
        if (value is DataRow existing)
            return existing;

        if (value is DataTable source)
            return source.Rows.Count > 0
                ? source.Rows[0]
                : throw new InvalidOperationException("The DataTable has no rows to convert to ROW.");

        if (ToNode(value) is JsonObject obj)
        {
            var table = new DataTable();
            foreach (var property in obj)
                table.Columns.Add(property.Key, typeof(object));

            var newRow = table.NewRow();
            foreach (var property in obj)
                newRow[property.Key] = NodeToCell(property.Value);

            table.Rows.Add(newRow);
            return newRow;
        }

        throw new InvalidOperationException("ROW needs a JSON object, a dictionary or a DataRow.");
    }

    /// <summary>JSON value -> cell value: scalars become real .NET values, objects/arrays stay JsonNode.</summary>
    private static object NodeToCell(JsonNode? node)
    {
        if (node is null) return DBNull.Value;

        return node.GetValueKind() switch
        {
            JsonValueKind.String => node.GetValue<string>(),
            JsonValueKind.True   => true,
            JsonValueKind.False  => false,
            JsonValueKind.Number => node.AsValue().TryGetValue(out long l) ? l
                                  : node.AsValue().TryGetValue(out decimal m) ? m
                                  : node.GetValue<double>(),
            JsonValueKind.Null   => DBNull.Value,
            _                    => node.DeepClone()
        };
    }

    // ───────────────────────── Serialisation helpers ─────────────────────────

    public static Dictionary<string, object?> DataRowToDictionary(DataRow row) =>
        row.Table.Columns.Cast<DataColumn>()
            .ToDictionary(c => c.ColumnName, c => row.IsNull(c) ? null : row[c]);

    public static Dictionary<string, object?> DataTableToDictionary(DataTable table) =>
        new()
        {
            ["headers"] = table.Columns.Cast<DataColumn>().Select(c => c.ColumnName).ToList(),
            ["rows"]    = table.Rows.Cast<DataRow>().Select(DataRowToDictionary).ToList()
        };
}