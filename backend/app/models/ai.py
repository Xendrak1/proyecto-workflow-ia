from typing import Literal

from pydantic import BaseModel, Field


class WorkflowSuggestionRequest(BaseModel):
    prompt: str = Field(min_length=3)
    policy_name: str | None = None
    procedure_type: str | None = None
    policy_description: str | None = None


class WorkflowAudioSuggestionRequest(BaseModel):
    audio_base64: str = Field(min_length=16)
    mime_type: str = Field(default="audio/webm")
    policy_name: str | None = None
    procedure_type: str | None = None
    policy_description: str | None = None


class WorkflowSuggestedNode(BaseModel):
    code: str
    name: str
    node_type: Literal["actividad", "decision", "inicio", "fin", "fork", "join"]
    lane: str
    responsible_role: str | None = None
    responsible_department: str | None = None
    form_fields: list[dict] = Field(default_factory=list)


class WorkflowSuggestedTransition(BaseModel):
    source_code: str
    target_code: str
    transition_type: Literal["secuencial", "alternativa", "iterativa", "paralela"] = "secuencial"
    condition_label: str | None = None


class WorkflowSuggestionResponse(BaseModel):
    source: str = "gemini"
    model: str | None = None
    transcript: str | None = None
    title: str
    summary: str
    nodes: list[WorkflowSuggestedNode] = Field(default_factory=list)
    transitions: list[WorkflowSuggestedTransition] = Field(default_factory=list)


class TaskFormFieldInput(BaseModel):
    key: str
    label: str
    field_type: str
    required: bool = False
    options: list[str] = Field(default_factory=list)


class TaskFormFillRequest(BaseModel):
    report_text: str = Field(min_length=3)
    task_title: str | None = None
    node_name: str | None = None
    lane: str | None = None
    procedure_type: str | None = None
    applicant_name: str | None = None
    applicant_document: str | None = None
    fields: list[TaskFormFieldInput] = Field(default_factory=list)


class TaskFormFillAudioRequest(BaseModel):
    audio_base64: str = Field(min_length=16)
    mime_type: str = Field(default="audio/webm")
    task_title: str | None = None
    node_name: str | None = None
    lane: str | None = None
    procedure_type: str | None = None
    applicant_name: str | None = None
    applicant_document: str | None = None
    fields: list[TaskFormFieldInput] = Field(default_factory=list)


class TaskFormFillResponse(BaseModel):
    source: str = "gemini"
    model: str | None = None
    transcript: str | None = None
    summary: str
    form_data: dict = Field(default_factory=dict)
    observations: str | None = None


class TranscribeAudioRequest(BaseModel):
    audio_base64: str = Field(min_length=16)
    mime_type: str = Field(default="audio/webm")


class TranscribeAudioResponse(BaseModel):
    transcript: str
    source: str = "vosk"
