from typing import Literal

from pydantic import EmailStr, Field

from app.models.common import MongoModel


UserRole = Literal["administrador", "funcionario", "supervisor", "cliente"]
UserStatus = Literal["activo", "inactivo"]
SubscriptionPlan = Literal["starter", "pro", "enterprise"]
PermissionKey = Literal[
    "nav.inbox",
    "nav.tramites",
    "nav.policies",
    "nav.analytics",
    "nav.team",
    "tramite.create",
    "task.edit",
    "task.complete",
    "task.evidence",
    "policy.create",
    "policy.validate",
    "policy.publish",
    "user.manage",
]

ALL_PERMISSIONS: list[PermissionKey] = [
    "nav.inbox",
    "nav.tramites",
    "nav.policies",
    "nav.analytics",
    "nav.team",
    "tramite.create",
    "task.edit",
    "task.complete",
    "task.evidence",
    "policy.create",
    "policy.validate",
    "policy.publish",
    "user.manage",
]

ROLE_DEFAULT_PERMISSIONS: dict[UserRole, list[PermissionKey]] = {
    "administrador": ALL_PERMISSIONS.copy(),
    "supervisor": [
        "nav.inbox",
        "nav.tramites",
        "nav.policies",
        "nav.analytics",
        "tramite.create",
        "task.edit",
        "task.complete",
        "task.evidence",
        "policy.create",
        "policy.validate",
        "policy.publish",
    ],
    "funcionario": [
        "nav.inbox",
        "nav.tramites",
        "tramite.create",
        "task.edit",
        "task.complete",
        "task.evidence",
    ],
    "cliente": [
        "nav.tramites",
    ],
}


def permissions_for_role(role: UserRole) -> list[PermissionKey]:
    return ROLE_DEFAULT_PERMISSIONS.get(role, []).copy()


class User(MongoModel):
    full_name: str
    email: EmailStr
    password_hash: str
    role: UserRole
    department: str | None = None
    status: UserStatus = "activo"
    subscription_plan: SubscriptionPlan = "starter"
    permissions: list[PermissionKey] = Field(default_factory=list)


class UserCreate(MongoModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: UserRole
    department: str | None = None
    subscription_plan: SubscriptionPlan = "starter"
    permissions: list[PermissionKey] | None = None


class UserPlanUpdate(MongoModel):
    subscription_plan: SubscriptionPlan


class UserUpdate(MongoModel):
    full_name: str | None = None
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=6)
    role: UserRole | None = None
    department: str | None = None
    subscription_plan: SubscriptionPlan | None = None
    status: UserStatus | None = None
    permissions: list[PermissionKey] | None = None


class UserPublic(MongoModel):
    full_name: str
    email: EmailStr
    role: UserRole
    department: str | None = None
    status: UserStatus = "activo"
    subscription_plan: SubscriptionPlan = "starter"
    permissions: list[PermissionKey] = Field(default_factory=list)
