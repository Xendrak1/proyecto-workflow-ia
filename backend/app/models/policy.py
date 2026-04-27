from typing import Literal

from pydantic import BaseModel, Field

from app.models.common import MongoModel


PolicyStatus = Literal["borrador", "validada", "publicada", "archivada"]
NodeType = Literal["actividad", "decision", "inicio", "fin", "fork", "join"]
FieldType = Literal["texto", "numero", "fecha", "lista", "archivo", "imagen", "booleano"]


class FormField(MongoModel):
    key: str
    label: str
    field_type: FieldType
    required: bool = False
    options: list[str] = Field(default_factory=list)


class PolicyNode(MongoModel):
    code: str
    name: str
    node_type: NodeType
    lane: str
    responsible_role: str | None = None
    responsible_department: str | None = None
    form_fields: list[FormField] = Field(default_factory=list)


class PolicyTransition(MongoModel):
    source_code: str
    target_code: str
    condition_label: str | None = None
    transition_type: Literal["secuencial", "alternativa", "iterativa", "paralela"] = "secuencial"


class Policy(MongoModel):
    name: str
    description: str
    procedure_type: str
    version: int = 1
    status: PolicyStatus = "borrador"
    nodes: list[PolicyNode] = Field(default_factory=list)
    transitions: list[PolicyTransition] = Field(default_factory=list)


class PolicyCreate(BaseModel):
    name: str
    description: str
    procedure_type: str


class PolicyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    procedure_type: str | None = None
    version: int | None = None
    status: PolicyStatus | None = None


class PolicyNodeCreate(BaseModel):
    code: str
    name: str
    node_type: NodeType
    lane: str
    responsible_role: str | None = None
    responsible_department: str | None = None
    form_fields: list[FormField] = Field(default_factory=list)


class PolicyNodeUpdate(BaseModel):
    name: str | None = None
    node_type: NodeType | None = None
    lane: str | None = None
    responsible_role: str | None = None
    responsible_department: str | None = None
    form_fields: list[FormField] | None = None


class PolicyTransitionCreate(BaseModel):
    source_code: str
    target_code: str
    condition_label: str | None = None
    transition_type: Literal["secuencial", "alternativa", "iterativa", "paralela"] = "secuencial"


class PolicyValidationResult(BaseModel):
    valid: bool
    observations: list[str] = Field(default_factory=list)
