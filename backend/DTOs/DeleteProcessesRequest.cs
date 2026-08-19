namespace backend.DTOs;

public class DeleteProcessesRequest
{
    public List<Guid> ProcessIds { get; set; } = new();
}