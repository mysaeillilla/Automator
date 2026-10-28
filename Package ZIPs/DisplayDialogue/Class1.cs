using System;
using System.Data;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;


namespace DisplayDialogue;



    /// <summary>What kind of content the notification window should render.</summary>
    public enum NotificationType
    {
        String,
        Json,
        DataTable,
        Row
    }
 
    /// <summary>
    /// Displays a notification window for a string, JSON text, DataTable or DataRow.
    /// All calls block until the window is closed (or the optional auto-close fires),
    /// and run on their own STA thread so they are safe to call from any host
    /// (console apps, services, RPA bots, etc.).
    /// </summary>
    public  class NotificationWindow
    {
        // ---------- Public API ----------
 
        public  void ShowString(string message, string title = "Notification",
            int width = 600, int height = 400, int autoCloseSeconds = 0)
            => Show(NotificationType.String, message, title, width, height, autoCloseSeconds);
 
        public  void ShowJson(string json, string title = "JSON",
            int width = 700, int height = 500, int autoCloseSeconds = 0)
            => Show(NotificationType.Json, json, title, width, height, autoCloseSeconds);
 
        public  void ShowDataTable(DataTable table, string title = "Data Table",
            int width = 900, int height = 500, int autoCloseSeconds = 0)
            => Show(NotificationType.DataTable, table, title, width, height, autoCloseSeconds);
 
        public  void ShowRow(DataRow row, string title = "Row",
            int width = 500, int height = 450, int autoCloseSeconds = 0)
            => Show(NotificationType.Row, row, title, width, height, autoCloseSeconds);
 
        /// <summary>Generic entry point: pick the type and pass the matching content.</summary>
        public  void Show(NotificationType type, object content, string title = "Notification",
            int width = 700, int height = 450, int autoCloseSeconds = 0)
        {
            if (content == null) throw new ArgumentNullException(nameof(content));
 
            Exception error = null;
            var thread = new Thread(() =>
            {
                try
                {
                    Application.EnableVisualStyles();
                    using (var form = BuildForm(type, content, title, width, height, autoCloseSeconds))
                    {
                        form.ShowDialog();
                    }
                }
                catch (Exception ex) { error = ex; }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join();
 
            if (error != null) throw error;
        }
 
        // ---------- Form construction ----------
 
        private  Form BuildForm(NotificationType type, object content, string title,
            int width, int height, int autoCloseSeconds)
        {
            Control body;
            string copyText;
 
            switch (type)
            {
                case NotificationType.String:
                    copyText = Convert.ToString(content) ?? string.Empty;
                    body = BuildTextBox(copyText, monospace: false);
                    break;
 
                case NotificationType.Json:
                    copyText = FormatJson(Convert.ToString(content) ?? string.Empty);
                    body = BuildTextBox(copyText, monospace: true);
                    break;
 
                case NotificationType.DataTable:
                    var table = content as DataTable
                        ?? throw new ArgumentException("Content must be a DataTable.", nameof(content));
                    copyText = TableToText(table);
                    body = BuildGrid(table);
                    break;
 
                case NotificationType.Row:
                    var row = content as DataRow
                        ?? throw new ArgumentException("Content must be a DataRow.", nameof(content));
                    var rowView = RowToKeyValueTable(row);
                    copyText = TableToText(rowView);
                    body = BuildGrid(rowView);
                    break;
 
                default:
                    throw new ArgumentOutOfRangeException(nameof(type));
            }
 
            var form = new Form
            {
                Text = title,
                Size = new Size(width, height),
                StartPosition = FormStartPosition.CenterScreen,
                TopMost = true,
                MinimizeBox = false,
                ShowInTaskbar = true,
                Font = new Font("Segoe UI", 9f)
            };
 
            // Bottom button bar
            var buttons = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                FlowDirection = FlowDirection.RightToLeft,
                Height = 42,
                Padding = new Padding(8, 6, 8, 6)
            };
 
            var closeBtn = new Button { Text = "Close", Width = 90, DialogResult = DialogResult.OK };
            var copyBtn = new Button { Text = "Copy", Width = 90 };
            copyBtn.Click += (s, e) =>
            {
                try { Clipboard.SetText(copyText); copyBtn.Text = "Copied"; }
                catch { copyBtn.Text = "Copy failed"; }
            };
 
            buttons.Controls.Add(closeBtn);
            buttons.Controls.Add(copyBtn);
 
            body.Dock = DockStyle.Fill;
            form.Controls.Add(body);
            form.Controls.Add(buttons);
            form.AcceptButton = closeBtn;
            form.CancelButton = closeBtn;
 
            // Optional auto-close
            if (autoCloseSeconds > 0)
            {
                var timer = new System.Windows.Forms.Timer { Interval = autoCloseSeconds * 1000 };
                timer.Tick += (s, e) => { timer.Stop(); form.Close(); };
                form.Shown += (s, e) => timer.Start();
                form.FormClosed += (s, e) => timer.Dispose();
            }
 
            return form;
        }
 
        private  TextBox BuildTextBox(string text, bool monospace)
        {
            return new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Both,
                WordWrap = !monospace,
                Text = text.Replace("\r\n", "\n").Replace("\n", Environment.NewLine),
                Font = monospace ? new Font("Consolas", 10f) : new Font("Segoe UI", 10f),
                BackColor = SystemColors.Window,
                BorderStyle = BorderStyle.None
            };
        }
 
        private  DataGridView BuildGrid(DataTable table)
        {
            var grid = new DataGridView
            {
                DataSource = table,
                ReadOnly = true,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                RowHeadersVisible = false,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.AllCells,
                BackgroundColor = SystemColors.Window,
                BorderStyle = BorderStyle.None,
                ClipboardCopyMode = DataGridViewClipboardCopyMode.EnableWithAutoHeaderText
            };
            grid.ColumnHeadersDefaultCellStyle.Font = new Font(grid.Font, FontStyle.Bold);
            return grid;
        }
 
        // ---------- Helpers ----------
 
        /// <summary>Pretty-prints JSON; falls back to the raw text if it isn't valid JSON.</summary>
        private  string FormatJson(string json)
        {
            try
            {
                using (var doc = JsonDocument.Parse(json))
                {
                    return JsonSerializer.Serialize(doc.RootElement,
                        new JsonSerializerOptions { WriteIndented = true });
                }
            }
            catch (JsonException)
            {
                return json; // not valid JSON - show as-is
            }
        }
 
        /// <summary>Turns a DataRow into a two-column (Column / Value) table.</summary>
        private  DataTable RowToKeyValueTable(DataRow row)
        {
            var result = new DataTable();
            result.Columns.Add("Column", typeof(string));
            result.Columns.Add("Value", typeof(string));
 
            foreach (DataColumn col in row.Table.Columns)
            {
                var value = row[col];
                result.Rows.Add(col.ColumnName, value == DBNull.Value ? "" : Convert.ToString(value));
            }
            return result;
        }
 
        /// <summary>Tab-separated text of a DataTable (header + rows) for the Copy button.</summary>
        private  string TableToText(DataTable table)
        {
            var sb = new StringBuilder();
            sb.AppendLine(string.Join("\t", table.Columns.Cast<DataColumn>().Select(c => c.ColumnName)));
            foreach (DataRow r in table.Rows)
            {
                sb.AppendLine(string.Join("\t", r.ItemArray.Select(v =>
                    v == null || v == DBNull.Value ? "" : Convert.ToString(v))));
            }
            return sb.ToString();
        }
    }
