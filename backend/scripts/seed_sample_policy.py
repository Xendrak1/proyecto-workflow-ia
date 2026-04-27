import asyncio
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.models.policy import FormField, Policy, PolicyNode, PolicyTransition


async def main() -> None:
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db]

    existing = await db.policies.find_one({"procedure_type": "instalacion_servicio"})
    if existing:
        print("La politica de ejemplo ya existe")
        client.close()
        return

    policy = Policy(
        _id=str(uuid4()),
        name="Politica de Instalacion de Servicio",
        description="Flujo base para registrar, revisar y ejecutar una instalacion de servicio.",
        procedure_type="instalacion_servicio",
        status="publicada",
        nodes=[
            PolicyNode(_id=str(uuid4()), code="START", name="Inicio", node_type="inicio", lane="Sistema"),
            PolicyNode(
                _id=str(uuid4()),
                code="ATC_REG",
                name="Registrar solicitud",
                node_type="actividad",
                lane="Atencion al Cliente",
                responsible_role="funcionario",
                responsible_department="Atencion al Cliente",
                form_fields=[
                    FormField(_id=str(uuid4()), key="direccion", label="Direccion", field_type="texto", required=True),
                    FormField(_id=str(uuid4()), key="telefono", label="Telefono", field_type="texto", required=True),
                ],
            ),
            PolicyNode(
                _id=str(uuid4()),
                code="REV_TEC",
                name="Revision tecnica",
                node_type="actividad",
                lane="Departamento Tecnico",
                responsible_role="funcionario",
                responsible_department="Tecnico",
                form_fields=[
                    FormField(_id=str(uuid4()), key="decision", label="Decision", field_type="lista", required=True, options=["viable", "no viable"]),
                    FormField(_id=str(uuid4()), key="observacion", label="Observacion", field_type="texto"),
                ],
            ),
            PolicyNode(
                _id=str(uuid4()),
                code="REV_LEG",
                name="Revision legal",
                node_type="actividad",
                lane="Departamento Legal",
                responsible_role="funcionario",
                responsible_department="Legal",
                form_fields=[
                    FormField(_id=str(uuid4()), key="aprobado", label="Aprobado", field_type="booleano", required=True),
                ],
            ),
            PolicyNode(
                _id=str(uuid4()),
                code="INSTALAR",
                name="Ejecutar instalacion",
                node_type="actividad",
                lane="Instalacion",
                responsible_role="funcionario",
                responsible_department="Instalacion",
                form_fields=[
                    FormField(_id=str(uuid4()), key="evidencia", label="Evidencia", field_type="archivo"),
                ],
            ),
            PolicyNode(_id=str(uuid4()), code="END", name="Fin", node_type="fin", lane="Sistema"),
        ],
        transitions=[
            PolicyTransition(_id=str(uuid4()), source_code="START", target_code="ATC_REG"),
            PolicyTransition(_id=str(uuid4()), source_code="ATC_REG", target_code="REV_TEC"),
            PolicyTransition(_id=str(uuid4()), source_code="REV_TEC", target_code="REV_LEG", condition_label="viable", transition_type="alternativa"),
            PolicyTransition(_id=str(uuid4()), source_code="REV_LEG", target_code="INSTALAR"),
            PolicyTransition(_id=str(uuid4()), source_code="INSTALAR", target_code="END"),
        ],
    )

    await db.policies.insert_one(policy.model_dump(by_alias=True))
    print("Politica de ejemplo creada")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
