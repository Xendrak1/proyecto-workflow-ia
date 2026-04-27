from pydantic import BaseModel, Field


class BottleneckResult(BaseModel):
    policy_id: str
    critical_nodes: list[dict] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


class DashboardSummary(BaseModel):
    total_tramites: int
    total_tasks: int
    pending_tasks: int
    completed_tasks: int
