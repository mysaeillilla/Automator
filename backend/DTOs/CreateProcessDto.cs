namespace backend.DTOs;

public class CreateProcessDto
{
    
  public string DepartmentId { get; set; } = string.Empty;

    public required string ProcessName { get; set; }

    public required string Description { get; set; }


}
