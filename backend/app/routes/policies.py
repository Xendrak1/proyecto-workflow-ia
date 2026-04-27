from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.db.mongo import get_database
from app.models.policy import (
    Policy,
    PolicyCreate,
    PolicyNode,
    PolicyNodeCreate,
    PolicyNodeUpdate,
    PolicyTransition,
    PolicyTransitionCreate,
    PolicyUpdate,
    PolicyValidationResult,
)
from app.services.common import utc_now
from app.services.policy_service import validate_policy


router = APIRouter()


@router.post("")
async def create_policy(payload: PolicyCreate) -> dict:
    db = get_database()
    document = Policy(
        _id=str(uuid4()),
        name=payload.name,
        description=payload.description,
        procedure_type=payload.procedure_type,
    ).model_dump(by_alias=True)
    await db.policies.insert_one(document)
    return {"message": "Politica creada", "data": document}


@router.get("")
async def list_policies() -> dict:
    db = get_database()
    items = await db.policies.find().to_list(length=100)
    return {"message": "Politicas recuperadas", "data": items}


@router.get("/{policy_id}")
async def get_policy(policy_id: str) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    return {"message": "Politica recuperada", "data": item}


@router.put("/{policy_id}")
async def update_policy(policy_id: str, payload: PolicyUpdate) -> dict:
    db = get_database()
    update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No hay datos para actualizar")
    update_data["updated_at"] = utc_now()
    result = await db.policies.update_one({"_id": policy_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    item = await db.policies.find_one({"_id": policy_id})
    return {"message": "Politica actualizada", "data": item}


@router.delete("/{policy_id}")
async def archive_policy(policy_id: str) -> dict:
    db = get_database()
    result = await db.policies.update_one(
        {"_id": policy_id},
        {"$set": {"status": "archivada", "updated_at": utc_now()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    return {"message": "Politica archivada", "data": {"policy_id": policy_id, "status": "archivada"}}


@router.post("/{policy_id}/nodes")
async def add_node(policy_id: str, payload: PolicyNodeCreate) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    policy = Policy(**item)
    if any(node.code == payload.code for node in policy.nodes):
        raise HTTPException(status_code=400, detail="Ya existe un nodo con ese codigo")
    node = PolicyNode(_id=str(uuid4()), **payload.model_dump())
    policy.nodes.append(node)
    policy.updated_at = utc_now()
    await db.policies.update_one(
        {"_id": policy_id},
        {"$set": {"nodes": [n.model_dump(by_alias=True) for n in policy.nodes], "updated_at": policy.updated_at}},
    )
    return {"message": "Nodo agregado", "data": node.model_dump(by_alias=True)}


@router.put("/{policy_id}/nodes/{node_code}")
async def update_node(policy_id: str, node_code: str, payload: PolicyNodeUpdate) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    policy = Policy(**item)
    node = next((n for n in policy.nodes if n.code == node_code), None)
    if not node:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
    for key, value in update_data.items():
        setattr(node, key, value)
    policy.updated_at = utc_now()
    await db.policies.update_one(
        {"_id": policy_id},
        {"$set": {"nodes": [n.model_dump(by_alias=True) for n in policy.nodes], "updated_at": policy.updated_at}},
    )
    return {"message": "Nodo actualizado", "data": node.model_dump(by_alias=True)}


@router.delete("/{policy_id}/nodes/{node_code}")
async def delete_node(policy_id: str, node_code: str) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    policy = Policy(**item)
    original_len = len(policy.nodes)
    policy.nodes = [node for node in policy.nodes if node.code != node_code]
    if len(policy.nodes) == original_len:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    policy.transitions = [
        transition
        for transition in policy.transitions
        if transition.source_code != node_code and transition.target_code != node_code
    ]
    policy.updated_at = utc_now()
    await db.policies.update_one(
        {"_id": policy_id},
        {
            "$set": {
                "nodes": [n.model_dump(by_alias=True) for n in policy.nodes],
                "transitions": [t.model_dump(by_alias=True) for t in policy.transitions],
                "updated_at": policy.updated_at,
            }
        },
    )
    return {"message": "Nodo eliminado", "data": {"policy_id": policy_id, "node_code": node_code}}


@router.post("/{policy_id}/transitions")
async def add_transition(policy_id: str, payload: PolicyTransitionCreate) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    policy = Policy(**item)
    node_codes = {node.code for node in policy.nodes}
    if payload.source_code not in node_codes or payload.target_code not in node_codes:
        raise HTTPException(status_code=400, detail="Los nodos origen o destino no existen")
    transition = PolicyTransition(_id=str(uuid4()), **payload.model_dump())
    policy.transitions.append(transition)
    policy.updated_at = utc_now()
    await db.policies.update_one(
        {"_id": policy_id},
        {
            "$set": {
                "transitions": [t.model_dump(by_alias=True) for t in policy.transitions],
                "updated_at": policy.updated_at,
            }
        },
    )
    return {"message": "Transicion agregada", "data": transition.model_dump(by_alias=True)}


@router.delete("/{policy_id}/transitions/{transition_id}")
async def delete_transition(policy_id: str, transition_id: str) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    policy = Policy(**item)
    original_len = len(policy.transitions)
    policy.transitions = [transition for transition in policy.transitions if transition.id != transition_id]
    if len(policy.transitions) == original_len:
        raise HTTPException(status_code=404, detail="Transicion no encontrada")
    policy.updated_at = utc_now()
    await db.policies.update_one(
        {"_id": policy_id},
        {
            "$set": {
                "transitions": [t.model_dump(by_alias=True) for t in policy.transitions],
                "updated_at": policy.updated_at,
            }
        },
    )
    return {"message": "Transicion eliminada", "data": {"policy_id": policy_id, "transition_id": transition_id}}


@router.post("/{policy_id}/validate")
async def validate_policy_endpoint(policy_id: str) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    policy = Policy(**item)
    observations = validate_policy(policy)
    result = PolicyValidationResult(valid=not observations, observations=observations)
    if result.valid:
        await db.policies.update_one(
            {"_id": policy_id},
            {"$set": {"status": "validada", "updated_at": utc_now()}},
        )
    return {"message": "Validacion completada", "data": result.model_dump()}


@router.post("/{policy_id}/publish")
async def publish_policy(policy_id: str) -> dict:
    db = get_database()
    item = await db.policies.find_one({"_id": policy_id})
    if not item:
        raise HTTPException(status_code=404, detail="Politica no encontrada")
    if item.get("status") != "validada":
        raise HTTPException(status_code=400, detail="La politica debe estar validada antes de publicarse")
    await db.policies.update_one({"_id": policy_id}, {"$set": {"status": "publicada", "updated_at": utc_now()}})
    return {"message": "Politica publicada", "data": {"policy_id": policy_id, "status": "publicada"}}
