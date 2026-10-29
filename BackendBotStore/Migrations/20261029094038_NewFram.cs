using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BackendBotStore.Migrations
{
    /// <inheritdoc />
    public partial class NewFram : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:hstore", ",,");

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "Packages",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<List<string>>(
                name: "Blocks",
                table: "PackageActions",
                type: "text[]",
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "PackageActions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<List<string>>(
                name: "ConditionOperators",
                table: "PackageActions",
                type: "text[]",
                nullable: false);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "PackageActions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "HasCondition",
                table: "PackageActions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "LogicalOperators",
                table: "PackageActions",
                type: "text[]",
                nullable: false);

            migrationBuilder.AddColumn<Dictionary<string, string>>(
                name: "Properties",
                table: "PackageActions",
                type: "hstore",
                nullable: false);

            migrationBuilder.AddColumn<bool>(
                name: "SupportsMultipleConditions",
                table: "PackageActions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Description",
                table: "Packages");

            migrationBuilder.DropColumn(
                name: "Blocks",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "ConditionOperators",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "HasCondition",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "LogicalOperators",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "Properties",
                table: "PackageActions");

            migrationBuilder.DropColumn(
                name: "SupportsMultipleConditions",
                table: "PackageActions");

            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:hstore", ",,");
        }
    }
}
