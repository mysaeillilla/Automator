namespace backend.DTOs;

public class CreateDepartmentDto
{
    public required string DepartmentName { get; set; }

    public required string Description { get; set; }
}


public class UpdateDepartmentDto
{
    public required string DepartmentName { get; set; }

    public required string Description { get; set; }
}