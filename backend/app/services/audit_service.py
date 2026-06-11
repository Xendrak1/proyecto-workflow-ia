from uuid import uuid4
import asyncio

from app.core.config import settings
from app.db.mongo import get_database
from app.models.document import AuditAction, AuditLog


def _write_audit_to_dynamodb(item: AuditLog) -> None:
    if not settings.dynamodb_audit_table:
        return
    try:
        import boto3  # type: ignore[import]

        table = boto3.resource("dynamodb", region_name=settings.aws_region).Table(settings.dynamodb_audit_table)
        created = item.created_at.isoformat()
        payload = item.model_dump(mode="json", by_alias=True)
        table.put_item(
            Item={
                "pk": f"AUDIT#{item.policy_id or item.tramite_code or item.document_id or 'GLOBAL'}",
                "sk": f"{created}#{item.id}",
                "gsi1pk": f"ACTION#{item.action}",
                "gsi1sk": created,
                **payload,
            }
        )
    except Exception:
        return


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
    await asyncio.to_thread(_write_audit_to_dynamodb, item)
    return item
