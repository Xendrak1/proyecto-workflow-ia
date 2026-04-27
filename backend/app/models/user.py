from typing import Literal

from pydantic import EmailStr, Field

from app.models.common import MongoModel


UserRole = Literal["administrador", "funcionario", "supervisor", "cliente"]
UserStatus = Literal["activo", "inactivo"]
SubscriptionPlan = Literal["starter", "pro", "enterprise"]


class User(MongoModel):
    full_name: str
    email: EmailStr
    password_hash: str
    role: UserRole
    department: str | None = None
    status: UserStatus = "activo"
    subscription_plan: SubscriptionPlan = "starter"


class UserCreate(MongoModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: UserRole
    department: str | None = None
    subscription_plan: SubscriptionPlan = "starter"


class UserPlanUpdate(MongoModel):
    subscription_plan: SubscriptionPlan


class UserPublic(MongoModel):
    full_name: str
    email: EmailStr
    role: UserRole
    department: str | None = None
    status: UserStatus = "activo"
    subscription_plan: SubscriptionPlan = "starter"
