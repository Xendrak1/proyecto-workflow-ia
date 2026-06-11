from fastapi import APIRouter, Query

from app.db.mongo import get_database


router = APIRouter()


@router.get("")
async def list_audit_logs(
    policy_id: str | None = None,
    tramite_code: str | None = None,
    document_id: str | None = None,
    action: str | None = None,
    limit: int = Query(default=100, le=300),
) -> dict:
    db = get_database()
    query: dict = {}
    if policy_id:
        query["policy_id"] = policy_id
    if tramite_code:
        query["tramite_code"] = tramite_code
    if document_id:
        query["document_id"] = document_id
    if action:
        query["action"] = action
    items = await db.audit_logs.find(query).sort("created_at", -1).to_list(length=limit)
    return {"message": "Eventos de auditoria recuperados", "data": items}
