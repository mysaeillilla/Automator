using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;

namespace DataTable;

public class Class1
{

}
 public  class DataTableActions
    {
        private static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            DateParseHandling = DateParseHandling.None,   // keep date-like strings untouched
            NullValueHandling = NullValueHandling.Include,
            Formatting = Formatting.None
        };
 
        private sealed class TableModel
        {
            public List<string> Headers { get; set; } = new List<string>();
            public List<Dictionary<string, object?>> Rows { get; set; } = new List<Dictionary<string, object?>>();
        }
 
        // ------------------------------------------------------------------
        // Declare
        // ------------------------------------------------------------------
 
        /// <summary>Creates an empty table. headersJson e.g. ["Name","Age","City"]</summary>
        public static string CreateTable(string headersJson)
        {
            var table = new TableModel { Headers = ParseHeaders(headersJson) };
            return Save(table);
        }
 
        /// <summary>
        /// Creates a table with initial rows.
        /// rowsJson e.g. [{"Name":"Asha","Age":"30"},{"Name":"Ravi"}]
        /// Missing columns become null; unknown columns throw.
        /// </summary>
        public static string CreateTableWithRows(string headersJson, string rowsJson)
        {
            var table = new TableModel { Headers = ParseHeaders(headersJson) };
 
            var rows = JsonConvert.DeserializeObject<List<Dictionary<string, object?>>>(rowsJson, Settings)
                       ?? throw new ArgumentException("rowsJson must be a JSON array of objects.");
 
            foreach (var row in rows)
                table.Rows.Add(BuildRow(table, row));
 
            return Save(table);
        }
 
        // ------------------------------------------------------------------
        // Rows: insert / delete / update
        // ------------------------------------------------------------------
 
        /// <summary>
        /// Inserts a row. rowIndex = -1 appends; otherwise inserts before that index
        /// (0..RowCount allowed).
        /// </summary>
        public static string InsertRow(string tableJson, string rowJson, int rowIndex = -1)
        {
            var table = Load(tableJson);
            var data = ParseRowObject(rowJson);
            var row = BuildRow(table, data);
 
            if (rowIndex == -1 || rowIndex == table.Rows.Count)
                table.Rows.Add(row);
            else if (rowIndex >= 0 && rowIndex < table.Rows.Count)
                table.Rows.Insert(rowIndex, row);
            else
                throw new ArgumentOutOfRangeException(nameof(rowIndex),
                    $"rowIndex must be -1 or between 0 and {table.Rows.Count}.");
 
            return Save(table);
        }
 
        /// <summary>Deletes the row at the given index.</summary>
        public static string DeleteRow(string tableJson, int rowIndex)
        {
            var table = Load(tableJson);
            CheckRowIndex(table, rowIndex);
            table.Rows.RemoveAt(rowIndex);
            return Save(table);
        }
 
        /// <summary>Deletes every row where columnName equals value.</summary>
        public static string DeleteRowsWhere(string tableJson, string columnName, string value)
        {
            var table = Load(tableJson);
            var col = ResolveColumn(table, columnName);
            table.Rows.RemoveAll(r => CellEquals(r, col, value));
            return Save(table);
        }
 
        /// <summary>Removes all rows but keeps the headers.</summary>
        public static string ClearRows(string tableJson)
        {
            var table = Load(tableJson);
            table.Rows.Clear();
            return Save(table);
        }
 
        /// <summary>Partially updates a row. rowJson e.g. {"Age":"31","City":"Delhi"}</summary>
        public static string UpdateRow(string tableJson, int rowIndex, string rowJson)
        {
            var table = Load(tableJson);
            CheckRowIndex(table, rowIndex);
 
            foreach (var kv in ParseRowObject(rowJson))
                table.Rows[rowIndex][ResolveColumn(table, kv.Key)] = kv.Value;
 
            return Save(table);
        }
 
        // ------------------------------------------------------------------
        // Cells
        // ------------------------------------------------------------------
 
        /// <summary>Sets one cell: row at rowIndex, column columnName.</summary>
        public static string UpdateCell(string tableJson, int rowIndex, string columnName, string value)
        {
            var table = Load(tableJson);
            CheckRowIndex(table, rowIndex);
            table.Rows[rowIndex][ResolveColumn(table, columnName)] = value;
            return Save(table);
        }
 
        /// <summary>
        /// For every row where matchColumn == matchValue, sets targetColumn = newValue.
        /// </summary>
        public static string UpdateCellWhere(string tableJson, string matchColumn, string matchValue,
                                             string targetColumn, string newValue)
        {
            var table = Load(tableJson);
            var match = ResolveColumn(table, matchColumn);
            var target = ResolveColumn(table, targetColumn);
 
            foreach (var row in table.Rows.Where(r => CellEquals(r, match, matchValue)))
                row[target] = newValue;
 
            return Save(table);
        }
 
        /// <summary>Returns a single cell value as a string (empty string if null).</summary>
        public static string GetCell(string tableJson, int rowIndex, string columnName)
        {
            var table = Load(tableJson);
            CheckRowIndex(table, rowIndex);
            var col = ResolveColumn(table, columnName);
            return table.Rows[rowIndex][col]?.ToString() ?? string.Empty;
        }
 
        // ------------------------------------------------------------------
        // Columns
        // ------------------------------------------------------------------
 
        /// <summary>Adds a column; existing rows get defaultValue.</summary>
        public static string AddColumn(string tableJson, string columnName, string? defaultValue = null)
        {
            var table = Load(tableJson);
            if (string.IsNullOrWhiteSpace(columnName))
                throw new ArgumentException("columnName cannot be empty.");
            if (table.Headers.Any(h => string.Equals(h, columnName, StringComparison.OrdinalIgnoreCase)))
                throw new ArgumentException($"Column '{columnName}' already exists.");
 
            table.Headers.Add(columnName);
            foreach (var row in table.Rows)
                row[columnName] = defaultValue;
 
            return Save(table);
        }
 
        /// <summary>Removes a column and its data from every row.</summary>
        public static string RemoveColumn(string tableJson, string columnName)
        {
            var table = Load(tableJson);
            var col = ResolveColumn(table, columnName);
            table.Headers.Remove(col);
            foreach (var row in table.Rows)
                row.Remove(col);
            return Save(table);
        }
 
        /// <summary>Renames a header and re-keys the data in every row.</summary>
        public static string RenameColumn(string tableJson, string oldName, string newName)
        {
            var table = Load(tableJson);
            var old = ResolveColumn(table, oldName);
 
            if (string.IsNullOrWhiteSpace(newName))
                throw new ArgumentException("newName cannot be empty.");
            if (table.Headers.Any(h => string.Equals(h, newName, StringComparison.OrdinalIgnoreCase)
                                       && !string.Equals(h, old, StringComparison.Ordinal)))
                throw new ArgumentException($"Column '{newName}' already exists.");
 
            table.Headers[table.Headers.IndexOf(old)] = newName;
            foreach (var row in table.Rows)
            {
                row.TryGetValue(old, out var v);
                row.Remove(old);
                row[newName] = v;
            }
            return Save(table);
        }
 
        // ------------------------------------------------------------------
        // Read helpers
        // ------------------------------------------------------------------
 
        /// <summary>Returns one row as a JSON object.</summary>
        public static string GetRow(string tableJson, int rowIndex)
        {
            var table = Load(tableJson);
            CheckRowIndex(table, rowIndex);
            return JsonConvert.SerializeObject(table.Rows[rowIndex], Settings);
        }
 
        /// <summary>Returns one column as a JSON array of values.</summary>
        public static string GetColumn(string tableJson, string columnName)
        {
            var table = Load(tableJson);
            var col = ResolveColumn(table, columnName);
            return JsonConvert.SerializeObject(table.Rows.Select(r => r[col]).ToList(), Settings);
        }
 
        /// <summary>Returns the headers as a JSON array.</summary>
        public static string GetHeaders(string tableJson)
        {
            return JsonConvert.SerializeObject(Load(tableJson).Headers, Settings);
        }
 
        public static int GetRowCount(string tableJson) => Load(tableJson).Rows.Count;
 
        /// <summary>Returns all rows (as a JSON array of objects) where columnName == value.</summary>
        public static string FindRows(string tableJson, string columnName, string value)
        {
            var table = Load(tableJson);
            var col = ResolveColumn(table, columnName);
            var hits = table.Rows.Where(r => CellEquals(r, col, value)).ToList();
            return JsonConvert.SerializeObject(hits, Settings);
        }
 
        // ------------------------------------------------------------------
        // Internals
        // ------------------------------------------------------------------
 
        private static TableModel Load(string tableJson)
        {
            if (string.IsNullOrWhiteSpace(tableJson))
                throw new ArgumentException("tableJson is empty.");
 
            var table = JsonConvert.DeserializeObject<TableModel>(tableJson, Settings)
                        ?? throw new ArgumentException("tableJson is not a valid table.");
 
            table.Headers ??= new List<string>();
            table.Rows ??= new List<Dictionary<string, object?>>();
            return table;
        }
 
        /// <summary>Serializes with every row normalised to header order.</summary>
        private static string Save(TableModel table)
        {
            var normalised = new TableModel { Headers = table.Headers };
            foreach (var row in table.Rows)
            {
                var ordered = new Dictionary<string, object?>();
                foreach (var h in table.Headers)
                    ordered[h] = row.TryGetValue(h, out var v) ? v : null;
                normalised.Rows.Add(ordered);
            }
            return JsonConvert.SerializeObject(normalised, Settings);
        }
 
        private static List<string> ParseHeaders(string headersJson)
        {
            var headers = JsonConvert.DeserializeObject<List<string>>(headersJson, Settings)
                          ?? throw new ArgumentException("headersJson must be a JSON array of strings.");
 
            if (headers.Count == 0)
                throw new ArgumentException("At least one header is required.");
            if (headers.Any(string.IsNullOrWhiteSpace))
                throw new ArgumentException("Headers cannot be empty.");
 
            var dup = headers.GroupBy(h => h, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1);
            if (dup != null)
                throw new ArgumentException($"Duplicate header '{dup.Key}'.");
 
            return headers;
        }
 
        private static Dictionary<string, object?> ParseRowObject(string rowJson)
        {
            return JsonConvert.DeserializeObject<Dictionary<string, object?>>(rowJson, Settings)
                   ?? throw new ArgumentException("rowJson must be a JSON object, e.g. {\"Name\":\"Asha\"}.");
        }
 
        private static Dictionary<string, object?> BuildRow(TableModel table, Dictionary<string, object?> data)
        {
            var row = table.Headers.ToDictionary(h => h, h => (object?)null);
            foreach (var kv in data)
                row[ResolveColumn(table, kv.Key)] = kv.Value;
            return row;
        }
 
        private static string ResolveColumn(TableModel table, string columnName)
        {
            var match = table.Headers.FirstOrDefault(h =>
                string.Equals(h, columnName, StringComparison.OrdinalIgnoreCase));
 
            return match ?? throw new ArgumentException(
                $"Column '{columnName}' not found. Available: {string.Join(", ", table.Headers)}.");
        }
 
        private static void CheckRowIndex(TableModel table, int rowIndex)
        {
            if (rowIndex < 0 || rowIndex >= table.Rows.Count)
                throw new ArgumentOutOfRangeException(nameof(rowIndex),
                    $"rowIndex {rowIndex} is out of range (table has {table.Rows.Count} rows).");
        }
 
        private static bool CellEquals(Dictionary<string, object?> row, string column, string value)
        {
            return row.TryGetValue(column, out var v)
                   && string.Equals(v?.ToString() ?? string.Empty, value ?? string.Empty, StringComparison.Ordinal);
        }
    }