from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from app.db.mongo import get_database
from app.services.security import create_access_token, verify_password


router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
async def login(payload: LoginRequest) -> dict:
    db = get_database()
    user = await db.users.find_one({"email": payload.email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales invalidas")

    token = create_access_token(subject=str(user["_id"]), role=user["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["role"],
        "email": user["email"],
        "full_name": user["full_name"],
        "subscription_plan": user.get("subscription_plan", "starter"),
        "user_id": str(user["_id"]),
        "department": user.get("department"),
    }
