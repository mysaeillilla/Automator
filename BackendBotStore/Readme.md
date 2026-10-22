Package Upload Json

Use dotnet publish for creating DLL and Packages

```

{
"PackageName": "Excel.dll",
"Version": "1.0.0",
"Dependencies": "ClosedXML.dll,DocumentFormat.OpenXml.dll",
"Actions": [
{
"ActionName": "ReadExcel",
"Inputs": {
"FilePath": "string",
"SheetName": "string"
},
"Outputs": {
"Data": "DataTable"
}
},
{
"ActionName": "WriteExcel",
"Inputs": {
"FilePath": "string",
"Data": "DataTable"
},
"Outputs": {
"Success": "bool"
}
}
]
}
```

Excel read action Json

```
{
"DllPath": "D:\\projects\\BackendBotStore\\Packages\\ExcelOperations\\1.0.0\\ExcelOperations.dll",
"ClassName": "ExcelTools.ExcelReader",
"FunctionName": "ReadExcel",
"Inputs": {
"filePath": "C:\\Users\\Admin\\Downloads\\Runner Allocation plan till 2028.xlsx",
"sheetName": "Runner Allocation",
"headerStartRow": 1,
"skipEmptyRows": true
}
}
```
