from datetime import datetime, timezone
import base64
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db.mongo import get_database
from app.models.policy import Policy
from app.models.tramite import Evidence, Task, TaskUpdate, Tramite
from app.services.tramite_service import build_next_tasks


router = APIRouter()
uploads_root = Path(__file__).resolve().parents[2] / "uploads" / "evidences"


class EvidenceUploadRequest(BaseModel):
    file_name: str
    file_base64: str
    content_type: str | None = None
    note: str | None = None


@router.get("")
async def list_tasks() -> dict:
    db = get_database()
    items = await db.tasks.find().to_list(length=200)
    return {"message": "Tareas recuperadas", "data": items}


@router.get("/{task_id}")
async def get_task(task_id: str) -> dict:
    db = get_database()
    item = await db.tasks.find_one({"_id": task_id})
    if not item:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    return {"message": "Tarea recuperada", "data": item}


@router.put("/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate) -> dict:
    db = get_database()
    item = await db.tasks.find_one({"_id": task_id})
    if not item:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    task = Task(**item)
    task.form_data = payload.form_data or task.form_data
    task.observations = payload.observations
    if payload.evidences:
        task.evidences = payload.evidences
    if payload.assigned_user_id:
        task.assigned_user_id = payload.assigned_user_id
    if task.status == "pendiente":
        task.status = "en_proceso"
        task.started_at = datetime.now(timezone.utc)
    task.updated_at = datetime.now(timezone.utc)
    await db.tasks.update_one(
        {"_id": task_id},
        {"$set": task.model_dump(by_alias=True)},
    )
    return {"message": "Tarea actualizada", "data": task.model_dump(by_alias=True)}


@router.post("/{task_id}/evidences")
async def upload_evidence(
    task_id: str,
    payload: EvidenceUploadRequest,
) -> dict:
    db = get_database()
    item = await db.tasks.find_one({"_id": task_id})
    if not item:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")

    task = Task(**item)
    safe_name = Path(payload.file_name or "evidencia.bin").name
    task_dir = uploads_root / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    extension = Path(safe_name).suffix
    stored_name = f"{uuid4().hex}{extension}"
    target = task_dir / stored_name
    try:
        content = base64.b64decode(payload.file_base64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Archivo base64 invalido") from exc
    target.write_bytes(content)

    evidence = Evidence(
        _id=str(uuid4()),
        file_name=safe_name,
        file_url=f"/uploads/evidences/{task_id}/{stored_name}",
        note=payload.note,
        content_type=payload.content_type,
        size_bytes=len(content),
    )
    task.evidences.append(evidence)
    task.updated_at = datetime.now(timezone.utc)
    await db.tasks.update_one(
        {"_id": task_id},
        {"$set": {"evidences": [ev.model_dump(by_alias=True) for ev in task.evidences], "updated_at": task.updated_at}},
    )
    return {"message": "Evidencia cargada", "data": evidence.model_dump(by_alias=True)}


@router.post("/{task_id}/complete")
async def complete_task(task_id: str) -> dict:
    db = get_database()
    task_item = await db.tasks.find_one({"_id": task_id})
    if not task_item:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    task = Task(**task_item)
    task.status = "completada"
    task.finished_at = datetime.now(timezone.utc)
    task.updated_at = datetime.now(timezone.utc)
    await db.tasks.update_one({"_id": task_id}, {"$set": task.model_dump(by_alias=True)})

    tramite_item = await db.tramites.find_one({"code": task.tramite_id})
    if not tramite_item:
        raise HTTPException(status_code=404, detail="Tramite asociado no encontrado")
    tramite = Tramite(**tramite_item)

    policy_item = await db.policies.find_one({"_id": task.policy_id})
    if not policy_item:
        raise HTTPException(status_code=404, detail="Politica asociada no encontrada")
    policy = Policy(**policy_item)

    next_tasks = build_next_tasks(tramite, policy, task.node_code, task.form_data)
    inserted_ids: list[str] = []
    if next_tasks:
        await db.tasks.insert_many([next_task.model_dump(by_alias=True) for next_task in next_tasks])
        inserted_ids = [next_task.id or "" for next_task in next_tasks]
        tramite.current_node_code = next_tasks[0].node_code
        tramite.status = "en_proceso"
    else:
        tramite.current_node_code = None
        tramite.status = "completado"

    tramite.history.append(
        {
            "task_id": task.id,
            "node_code": task.node_code,
            "status": task.status,
            "finished_at": task.finished_at,
            "observations": task.observations,
        }
    )
    await db.tramites.update_one(
        {"_id": tramite.id},
        {
            "$set": {
                "current_node_code": tramite.current_node_code,
                "status": tramite.status,
                "history": tramite.history,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    return {
        "message": "Tarea completada y tramite enrutado",
        "data": {
            "task_id": task_id,
            "status": "completada",
            "next_task_ids": inserted_ids,
            "tramite_status": tramite.status,
        },
    }
