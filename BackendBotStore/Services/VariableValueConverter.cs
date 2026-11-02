
using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BackendBotStore.Services;

public static class VariableValueConverter
{
    public static readonly string[] SupportedTypes =
    [
        "STRING",
        "NUMBER",
        "JSON",
        "DATATABLE",
        "ROW",
        "BOOLEAN"
    ];

    public static string NormalizeType(string? type)
    {
        var normalized = type?.Trim().ToUpperInvariant();

        if (normalized is null || !SupportedTypes.Contains(normalized))
            throw new InvalidOperationException(
                $"Unsupported variable type: {type}");

        return normalized;
    }

    public static object? Convert(object? value, string targetType)
    {
        targetType = NormalizeType(targetType);

        if (value is null)
            return null;

        return targetType switch
        {
            "STRING" => ToStringValue(value),
            "NUMBER" => ToNumber(value),
            "JSON" => ToJson(value),
            "DATATABLE" => ToDataTable(value),
            "ROW" => ToDataRow(value),
            "BOOLEAN" => ToBoolean(value),

            _ => throw new InvalidOperationException(
                $"Conversion to {targetType} is not supported.")
        };
    }

    private static string ToStringValue(object value)
    {
        return value switch
        {
            string s => s,
            JsonNode node => node.ToJsonString(),
            JsonElement element => element.GetRawText(),
            DataTable table => JsonSerializer.Serialize(
                DataTableToDictionary(table)),
            DataRow row => JsonSerializer.Serialize(
                DataRowToDictionary(row)),
            bool b => b.ToString(),
            IFormattable f => f.ToString(
                null, CultureInfo.InvariantCulture) ?? "",
            _ => JsonSerializer.Serialize(value)
        };
    }

    private static decimal ToNumber(object value)
    {
        if (value is bool b)
            return b ? 1m : 0m;

        if (value is JsonValue jsonValue)
            value = jsonValue.ToJsonString().Trim('"');

        if (value is JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Number)
                return element.GetDecimal();

            value = element.ToString();
        }

        if (decimal.TryParse(
            System.Convert.ToString(value, CultureInfo.InvariantCulture),
            NumberStyles.Any,
            CultureInfo.InvariantCulture,
            out var result))
        {
            return result;
        }

        throw new InvalidOperationException(
            $"Cannot convert '{value}' to NUMBER.");
    }

    private static JsonNode ToJson(object value)
    {
        if (value is JsonNode node)
            return node.DeepClone();

        if (value is JsonElement element)
            return JsonNode.Parse(element.GetRawText())!;

        if (value is string text)
            return JsonNode.Parse(text)
                ?? throw new InvalidOperationException("Invalid JSON.");

        if (value is DataRow row)
            return JsonSerializer.SerializeToNode(
                DataRowToDictionary(row))!;

        if (value is DataTable table)
            return JsonSerializer.SerializeToNode(
                DataTableToDictionary(table))!;

        return JsonSerializer.SerializeToNode(value)!;
    }

    private static DataTable ToDataTable(object value)
    {
        if (value is DataTable table)
            return table.Copy();

        if (value is JsonElement element)
            value = JsonNode.Parse(element.GetRawText())!;

        if (value is string json)
            value = JsonNode.Parse(json)!;

        if (value is JsonNode node)
        {
            var root = node.AsObject();

            var result = new DataTable();

            var headers = root["headers"]?.AsArray()
                .Select(x => x?.GetValue<string>() ?? "")
                .ToList()
                ?? throw new InvalidOperationException(
                    "DATATABLE requires headers.");

            foreach (var header in headers)
                result.Columns.Add(header, typeof(object));

            if (root["rows"] is JsonArray rows)
            {
                foreach (var item in rows)
                {
                    var row = result.NewRow();

                    foreach (var header in headers)
                        row[header] =
                            item?[header]?.DeepClone() is JsonNode cell
                                ? cell.ToJsonString()
                                : DBNull.Value;

                    result.Rows.Add(row);
                }
            }

            return result;
        }

        throw new InvalidOperationException(
            "Cannot convert the supplied value to DATATABLE.");
    }

    private static DataRow ToDataRow(object value)
    {
        if (value is DataRow row)
            return row;

        if (value is JsonElement element)
            value = JsonNode.Parse(element.GetRawText())!;

        if (value is string json)
            value = JsonNode.Parse(json)!;

        if (value is JsonObject obj)
        {
            var table = new DataTable();

            foreach (var property in obj)
                table.Columns.Add(property.Key, typeof(object));

            var newRow = table.NewRow();

            foreach (var property in obj)
                newRow[property.Key] =
                    property.Value?.ToJsonString() ?? DBNull.Value.ToString();

            table.Rows.Add(newRow);
            return newRow;
        }

        if (value is IDictionary<string, object?> dictionary)
        {
            var table = new DataTable();

            foreach (var key in dictionary.Keys)
                table.Columns.Add(key, typeof(object));

            var newRow = table.NewRow();

            foreach (var item in dictionary)
                newRow[item.Key] = item.Value ?? DBNull.Value;

            table.Rows.Add(newRow);
            return newRow;
        }

        throw new InvalidOperationException(
            "Cannot convert the supplied value to ROW.");
    }

    private static bool ToBoolean(object value)
    {
        if (value is bool b)
            return b;

        if (value is JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.True) return true;
            if (element.ValueKind == JsonValueKind.False) return false;
            value = element.ToString();
        }

        var text = value.ToString()?.Trim();

        if (bool.TryParse(text, out var result))
            return result;

        if (text == "1") return true;
        if (text == "0") return false;

        throw new InvalidOperationException(
            $"Cannot convert '{value}' to BOOLEAN.");
    }

    public static Dictionary<string, object?> DataRowToDictionary(
        DataRow row)
    {
        return row.Table.Columns.Cast<DataColumn>()
            .ToDictionary(
                c => c.ColumnName,
                c => row.IsNull(c) ? null : row[c]);
    }

    public static Dictionary<string, object?> DataTableToDictionary(
        DataTable table)
    {
        return new Dictionary<string, object?>
        {
            ["headers"] = table.Columns.Cast<DataColumn>()
                .Select(c => c.ColumnName).ToList(),

            ["rows"] = table.Rows.Cast<DataRow>()
                .Select(DataRowToDictionary).ToList()
        };
    }
}
