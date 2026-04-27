from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.common import MongoModel


TramiteStatus = Literal["registrado", "en_proceso", "observado", "completado", "rechazado"]
TaskStatus = Literal["pendiente", "en_proceso", "observada", "completada", "vencida"]


class Evidence(MongoModel):
    file_name: str
    file_url: str | None = None
    note: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None


class Task(MongoModel):
    tramite_id: str
    policy_id: str
    node_code: str
    title: str
    assigned_role: str | None = None
    assigned_department: str | None = None
    assigned_user_id: str | None = None
    status: TaskStatus = "pendiente"
    form_data: dict = Field(default_factory=dict)
    evidences: list[Evidence] = Field(default_factory=list)
    observations: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class Tramite(MongoModel):
    code: str
    applicant_name: str
    applicant_document: str
    procedure_type: str
    policy_id: str
    policy_version: int
    status: TramiteStatus = "registrado"
    current_node_code: str | None = None
    history: list[dict] = Field(default_factory=list)


class TramiteCreate(BaseModel):
    applicant_name: str
    applicant_document: str
    procedure_type: str


class TaskUpdate(BaseModel):
    form_data: dict = Field(default_factory=dict)
    observations: str | None = None
    evidences: list[Evidence] = Field(default_factory=list)
    assigned_user_id: str | None = None
