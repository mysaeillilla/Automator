using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BackendBotStore.Migrations
{
    /// <inheritdoc />
    public partial class CreatedIcons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ActionIcon",
                table: "Packages",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "PackageIcon",
                table: "PackageActions",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ActionIcon",
                table: "Packages");

            migrationBuilder.DropColumn(
                name: "PackageIcon",
                table: "PackageActions");
        }
    }
}
