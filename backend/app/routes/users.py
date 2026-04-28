from uuid import uuid4

from fastapi import APIRouter

from app.db.mongo import get_database
from app.models.common import utc_now
from app.models.user import UserCreate, UserPlanUpdate, UserPublic, UserUpdate, permissions_for_role
from app.services.security import hash_password


router = APIRouter()


@router.post("")
async def create_user(payload: UserCreate) -> dict:
    db = get_database()
    now = utc_now()
    permissions = payload.permissions or permissions_for_role(payload.role)
    document = {
        "_id": str(uuid4()),
        "full_name": payload.full_name,
        "email": payload.email,
        "password_hash": hash_password(payload.password),
        "role": payload.role,
        "department": payload.department,
        "status": "activo",
        "subscription_plan": payload.subscription_plan,
        "permissions": permissions,
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(document)
    return {"message": "Usuario creado", "data": UserPublic(**document).model_dump(by_alias=True)}


@router.get("")
async def list_users() -> dict:
    db = get_database()
    items = await db.users.find().to_list(length=100)
    data = [UserPublic(**item).model_dump(by_alias=True) for item in items]
    return {"message": "Usuarios recuperados", "data": data}


@router.put("/{user_id}/plan")
async def update_user_plan(user_id: str, payload: UserPlanUpdate) -> dict:
    db = get_database()
    result = await db.users.update_one(
        {"_id": user_id},
        {"$set": {"subscription_plan": payload.subscription_plan}},
    )
    if result.matched_count == 0:
        return {"message": "Usuario no encontrado", "data": None}

    item = await db.users.find_one({"_id": user_id})
    return {"message": "Plan actualizado", "data": UserPublic(**item).model_dump(by_alias=True)}


@router.put("/{user_id}")
async def update_user(user_id: str, payload: UserUpdate) -> dict:
    db = get_database()
    item = await db.users.find_one({"_id": user_id})
    if not item:
        return {"message": "Usuario no encontrado", "data": None}

    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    password = updates.pop("password", None)

    if "role" in updates and "permissions" not in updates:
        updates["permissions"] = permissions_for_role(updates["role"])

    if password:
        updates["password_hash"] = hash_password(password)

    if updates:
        updates["updated_at"] = utc_now()
        await db.users.update_one({"_id": user_id}, {"$set": updates})

    refreshed = await db.users.find_one({"_id": user_id})
    return {"message": "Usuario actualizado", "data": UserPublic(**refreshed).model_dump(by_alias=True)}
