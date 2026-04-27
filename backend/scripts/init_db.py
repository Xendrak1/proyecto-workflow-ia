import asyncio
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.services.security import hash_password


async def main() -> None:
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db]

    await db.users.create_index("email", unique=True)
    await db.policies.create_index([("procedure_type", 1), ("status", 1)])
    await db.tramites.create_index("code", unique=True)
    await db.tasks.create_index([("assigned_user_id", 1), ("status", 1)])
    await db.tasks.create_index([("assigned_role", 1), ("assigned_department", 1), ("status", 1)])

    admin_email = "admin@workflowia.com"
    legacy_email = "admin@workflow-ia.local"

    legacy_admin = await db.users.find_one({"email": legacy_email})
    if legacy_admin:
        await db.users.update_one(
            {"_id": legacy_admin["_id"]},
            {
                "$set": {
                    "email": admin_email,
                    "password_hash": hash_password("Admin12345"),
                    "role": "administrador",
                    "department": "Sistemas",
                    "status": "activo",
                    "subscription_plan": "enterprise",
                }
            },
        )
        print("Admin base migrado a: admin@workflowia.com / Admin12345")

    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one(
            {
                "_id": str(uuid4()),
                "full_name": "Administrador Base",
                "email": admin_email,
                "password_hash": hash_password("Admin12345"),
                "role": "administrador",
                "department": "Sistemas",
                "status": "activo",
                "subscription_plan": "enterprise",
            }
        )
        print("Admin base creado: admin@workflowia.com / Admin12345")
    else:
        await db.users.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "subscription_plan": "enterprise",
                    "role": "administrador",
                    "department": "Sistemas",
                    "status": "activo",
                }
            },
        )
        print("Admin base ya existe")

    print("Indices creados correctamente")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
