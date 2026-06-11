from uuid import uuid4

from app.db.mongo import get_database
from app.models.document import AuditAction, AuditLog


async def record_audit(
    *,
    action: AuditAction,
    summary: str,
    actor_name: str | None = None,
    policy_id: str | None = None,
    tramite_code: str | None = None,
    task_id: str | None = None,
    document_id: str | None = None,
    version_number: int | None = None,
    metadata: dict | None = None,
) -> AuditLog:
    db = get_database()
    item = AuditLog(
        _id=str(uuid4()),
        action=action,
        actor_name=actor_name,
        policy_id=policy_id,
        tramite_code=tramite_code,
        task_id=task_id,
        document_id=document_id,
        version_number=version_number,
        summary=summary,
        metadata=metadata or {},
    )
    await db.audit_logs.insert_one(item.model_dump(by_alias=True))
    return item
