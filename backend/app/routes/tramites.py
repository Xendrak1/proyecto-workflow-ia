from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.db.mongo import get_database
from app.models.policy import Policy
from app.models.tramite import Tramite, TramiteCreate
from app.services.tramite_service import build_first_task


router = APIRouter()


@router.post("")
async def create_tramite(payload: TramiteCreate) -> dict:
    db = get_database()
    policy_item = await db.policies.find_one({"procedure_type": payload.procedure_type, "status": "publicada"})
    if not policy_item:
        raise HTTPException(status_code=400, detail="No existe politica publicada para este tramite")

    policy = Policy(**policy_item)
    tramite = Tramite(
        _id=str(uuid4()),
        code=f"TRM-{uuid4().hex[:8].upper()}",
        applicant_name=payload.applicant_name,
        applicant_document=payload.applicant_document,
        procedure_type=payload.procedure_type,
        policy_id=policy.id or "",
        policy_version=policy.version,
    )
    tramite_doc = tramite.model_dump(by_alias=True)
    await db.tramites.insert_one(tramite_doc)

    first_task = build_first_task(tramite, policy)
    if first_task:
        await db.tasks.insert_one(first_task.model_dump(by_alias=True))
        tramite_doc["current_node_code"] = first_task.node_code
        tramite_doc["status"] = "en_proceso"
        await db.tramites.update_one(
            {"_id": tramite_doc["_id"]},
            {"$set": {"current_node_code": first_task.node_code, "status": "en_proceso"}},
        )

    saved = await db.tramites.find_one({"_id": tramite_doc["_id"]})
    return {"message": "Tramite registrado", "data": saved}


@router.get("")
async def list_tramites() -> dict:
    db = get_database()
    items = await db.tramites.find().to_list(length=200)
    return {"message": "Tramites recuperados", "data": items}


@router.get("/{tramite_code}")
async def get_tramite(tramite_code: str) -> dict:
    db = get_database()
    item = await db.tramites.find_one({"code": tramite_code})
    if not item:
        raise HTTPException(status_code=404, detail="Tramite no encontrado")
    return {"message": "Tramite recuperado", "data": item}


@router.get("/{tramite_code}/tasks")
async def get_tramite_tasks(tramite_code: str) -> dict:
    db = get_database()
    items = await db.tasks.find({"tramite_id": tramite_code}).to_list(length=200)
    return {"message": "Tareas del tramite recuperadas", "data": items}
