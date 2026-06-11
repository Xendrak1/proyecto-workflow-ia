from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query

from app.db.mongo import get_database
from app.models.document import (
    DocumentPermissionUpdate,
    DocumentRecord,
    DocumentUploadRequest,
    DocumentVersion,
    DocumentVersionUploadRequest,
)
from app.services.audit_service import record_audit
from app.services.document_storage import infer_document_type, store_document_file


router = APIRouter()


@router.get("")
async def list_documents(
    policy_id: str | None = None,
    tramite_code: str | None = None,
    task_id: str | None = None,
    node_code: str | None = None,
) -> dict:
    db = get_database()
    query: dict = {}
    if policy_id:
        query["policy_id"] = policy_id
    if tramite_code:
        query["tramite_code"] = tramite_code
    if task_id:
        query["task_id"] = task_id
    if node_code:
        query["node_code"] = node_code
    items = await db.documents.find(query).sort("updated_at", -1).to_list(length=300)
    return {"message": "Documentos recuperados", "data": items}


@router.post("")
async def create_document(payload: DocumentUploadRequest) -> dict:
    db = get_database()
    policy = await db.policies.find_one({"_id": payload.policy_id})
    if not policy:
        raise HTTPException(status_code=404, detail="Politica asociada no encontrada")

    document_id = str(uuid4())
    stored = store_document_file(
        document_id=document_id,
        version_number=1,
        file_name=payload.file_name,
        file_base64=payload.file_base64,
        content_type=payload.content_type,
    )
    version = DocumentVersion(
        _id=str(uuid4()),
        version_number=1,
        file_name=stored.file_name,
        file_url=stored.file_url,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        checksum_sha256=stored.checksum_sha256,
        storage_provider=stored.storage_provider,  # type: ignore[arg-type]
        storage_bucket=stored.storage_bucket,
        storage_key=stored.storage_key,
        change_summary=payload.change_summary or "Version inicial",
        created_by=payload.actor_name,
    )
    document = DocumentRecord(
        _id=document_id,
        policy_id=payload.policy_id,
        tramite_code=payload.tramite_code,
        task_id=payload.task_id,
        node_code=payload.node_code,
        title=payload.title,
        description=payload.description,
        document_type=payload.document_type
        if payload.document_type != "other"
        else infer_document_type(payload.file_name, payload.content_type),  # type: ignore[arg-type]
        properties=payload.properties,
        permissions=payload.permissions,
        current_version=1,
        versions=[version],
    )
    await db.documents.insert_one(document.model_dump(by_alias=True))
    await record_audit(
        action="document.created",
        actor_name=payload.actor_name,
        policy_id=payload.policy_id,
        tramite_code=payload.tramite_code,
        task_id=payload.task_id,
        document_id=document_id,
        version_number=1,
        summary=f"Documento creado: {payload.title}",
        metadata={"storage_provider": stored.storage_provider, "storage_key": stored.storage_key},
    )
    return {"message": "Documento creado", "data": document.model_dump(by_alias=True)}


@router.get("/{document_id}")
async def get_document(document_id: str) -> dict:
    db = get_database()
    item = await db.documents.find_one({"_id": document_id})
    if not item:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    await record_audit(
        action="document.viewed",
        document_id=document_id,
        policy_id=item.get("policy_id"),
        tramite_code=item.get("tramite_code"),
        task_id=item.get("task_id"),
        summary=f"Documento consultado: {item.get('title', document_id)}",
    )
    return {"message": "Documento recuperado", "data": item}


@router.post("/{document_id}/versions")
async def create_document_version(document_id: str, payload: DocumentVersionUploadRequest) -> dict:
    db = get_database()
    item = await db.documents.find_one({"_id": document_id})
    if not item:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    current = int(item.get("current_version") or 0)
    next_version = current + 1
    stored = store_document_file(
        document_id=document_id,
        version_number=next_version,
        file_name=payload.file_name,
        file_base64=payload.file_base64,
        content_type=payload.content_type,
    )
    version = DocumentVersion(
        _id=str(uuid4()),
        version_number=next_version,
        file_name=stored.file_name,
        file_url=stored.file_url,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        checksum_sha256=stored.checksum_sha256,
        storage_provider=stored.storage_provider,  # type: ignore[arg-type]
        storage_bucket=stored.storage_bucket,
        storage_key=stored.storage_key,
        change_summary=payload.change_summary,
        created_by=payload.actor_name,
    )
    now = datetime.now(timezone.utc)
    await db.documents.update_one(
        {"_id": document_id},
        {
            "$set": {"current_version": next_version, "updated_at": now},
            "$push": {"versions": version.model_dump(by_alias=True)},
        },
    )
    await record_audit(
        action="document.versioned",
        actor_name=payload.actor_name,
        policy_id=item.get("policy_id"),
        tramite_code=item.get("tramite_code"),
        task_id=item.get("task_id"),
        document_id=document_id,
        version_number=next_version,
        summary=f"Nueva version {next_version} para {item.get('title', document_id)}",
        metadata={"storage_provider": stored.storage_provider, "storage_key": stored.storage_key},
    )
    saved = await db.documents.find_one({"_id": document_id})
    return {"message": "Version registrada", "data": saved}


@router.put("/{document_id}/permissions")
async def update_document_permissions(document_id: str, payload: DocumentPermissionUpdate) -> dict:
    db = get_database()
    item = await db.documents.find_one({"_id": document_id})
    if not item:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    permissions = [permission.model_dump() for permission in payload.permissions]
    await db.documents.update_one(
        {"_id": document_id},
        {"$set": {"permissions": permissions, "updated_at": datetime.now(timezone.utc)}},
    )
    await record_audit(
        action="document.permissions.updated",
        actor_name=payload.actor_name,
        policy_id=item.get("policy_id"),
        tramite_code=item.get("tramite_code"),
        task_id=item.get("task_id"),
        document_id=document_id,
        summary=f"Permisos actualizados para {item.get('title', document_id)}",
        metadata={"permissions": permissions},
    )
    saved = await db.documents.find_one({"_id": document_id})
    return {"message": "Permisos actualizados", "data": saved}


@router.get("/{document_id}/audit")
async def get_document_audit(document_id: str, limit: int = Query(default=80, le=200)) -> dict:
    db = get_database()
    items = await db.audit_logs.find({"document_id": document_id}).sort("created_at", -1).to_list(length=limit)
    return {"message": "Auditoria del documento recuperada", "data": items}
