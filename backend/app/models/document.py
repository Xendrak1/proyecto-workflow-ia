from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.common import MongoModel


DocumentType = Literal["word", "spreadsheet", "pdf", "image", "text", "other"]
StorageProvider = Literal["local", "s3"]
AuditAction = Literal[
    "document.created",
    "document.versioned",
    "document.viewed",
    "document.permissions.updated",
    "report.generated",
    "routing.predicted",
]


class DocumentVersion(MongoModel):
    version_number: int
    file_name: str
    file_url: str | None = None
    content_type: str | None = None
    size_bytes: int = 0
    checksum_sha256: str
    storage_provider: StorageProvider = "local"
    storage_bucket: str | None = None
    storage_key: str
    change_summary: str | None = None
    created_by: str | None = None


class DocumentPermission(BaseModel):
    subject_type: Literal["role", "department", "user"] = "role"
    subject: str
    can_view: bool = True
    can_upload: bool = False
    can_version: bool = False
    can_delete: bool = False


class DocumentRecord(MongoModel):
    policy_id: str
    tramite_code: str | None = None
    task_id: str | None = None
    node_code: str | None = None
    title: str
    document_type: DocumentType = "other"
    description: str | None = None
    properties: dict = Field(default_factory=dict)
    permissions: list[DocumentPermission] = Field(default_factory=list)
    current_version: int = 1
    versions: list[DocumentVersion] = Field(default_factory=list)
    locked_by: str | None = None
    locked_at: datetime | None = None


class DocumentUploadRequest(BaseModel):
    policy_id: str
    tramite_code: str | None = None
    task_id: str | None = None
    node_code: str | None = None
    title: str
    description: str | None = None
    document_type: DocumentType = "other"
    properties: dict = Field(default_factory=dict)
    permissions: list[DocumentPermission] = Field(default_factory=list)
    file_name: str
    file_base64: str
    content_type: str | None = None
    change_summary: str | None = None
    actor_name: str | None = None


class DocumentVersionUploadRequest(BaseModel):
    file_name: str
    file_base64: str
    content_type: str | None = None
    change_summary: str | None = None
    actor_name: str | None = None


class DocumentPermissionUpdate(BaseModel):
    permissions: list[DocumentPermission] = Field(default_factory=list)
    actor_name: str | None = None


class AuditLog(MongoModel):
    action: AuditAction
    actor_name: str | None = None
    policy_id: str | None = None
    tramite_code: str | None = None
    task_id: str | None = None
    document_id: str | None = None
    version_number: int | None = None
    summary: str
    metadata: dict = Field(default_factory=dict)
