import asyncio
import csv
import json
from datetime import datetime, timezone
from io import StringIO
from urllib import parse, request, error

from fastapi import APIRouter, Query, Response

from app.db.mongo import get_database
from app.core.config import settings


router = APIRouter()


def _fallback_bottleneck_insight(critical_nodes: list[dict]) -> tuple[str, list[str]]:
    if not critical_nodes:
        return (
            "No se detectaron cuellos de botella importantes en este momento.",
            [
                "Mantener monitoreo continuo por nodo y departamento.",
                "Revisar periódicamente tareas observadas para evitar reprocesos.",
            ],
        )

    hottest = critical_nodes[0]
    summary = (
        f"El mayor foco de carga está en el nodo {hottest.get('_id', 'desconocido')}, "
        f"con {hottest.get('pending', 0)} tareas pendientes y {hottest.get('observed', 0)} observadas."
    )
    actions = [
        "Redistribuir temporalmente trabajo en el nodo más cargado.",
        "Revisar si faltan reglas o formularios que estén frenando la atención.",
        "Comparar el tiempo de atención entre nodos previos y posteriores para detectar reprocesos.",
    ]
    return summary, actions


def _generate_bottleneck_ai(critical_nodes: list[dict]) -> tuple[str, list[str], str]:
    if not settings.gemini_api_key:
        summary, actions = _fallback_bottleneck_insight(critical_nodes)
        return summary, actions, "fallback"

    prompt = "\n".join(
        [
            "Eres un analista operativo de workflows.",
            "Analiza los siguientes nodos criticos y responde SOLO con JSON valido.",
            'Devuelve un objeto con las claves "summary" y "actions".',
            'summary debe ser un texto breve en espanol.',
            'actions debe ser un arreglo de 2 a 4 recomendaciones concretas en espanol.',
            f"Datos: {json.dumps(critical_nodes, ensure_ascii=False)}",
        ]
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 700,
        },
    }
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent?key={parse.quote(settings.gemini_api_key)}"
    req = request.Request(
        url=endpoint,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            raw = json.loads(response.read().decode("utf-8"))
        text = raw["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(text[text.find("{"): text.rfind("}") + 1])
        summary = data.get("summary") or _fallback_bottleneck_insight(critical_nodes)[0]
        actions = data.get("actions") or _fallback_bottleneck_insight(critical_nodes)[1]
        return summary, actions, "gemini"
    except (error.HTTPError, error.URLError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        summary, actions = _fallback_bottleneck_insight(critical_nodes)
        return summary, actions, "fallback"


@router.get("/summary")
async def summary() -> dict:
    db = get_database()
    total_tramites = await db.tramites.count_documents({})
    total_tasks = await db.tasks.count_documents({})
    pending_tasks = await db.tasks.count_documents({"status": "pendiente"})
    completed_tasks = await db.tasks.count_documents({"status": "completada"})
    return {
        "message": "Resumen recuperado",
        "data": {
            "total_tramites": total_tramites,
            "total_tasks": total_tasks,
            "pending_tasks": pending_tasks,
            "completed_tasks": completed_tasks,
        },
    }


@router.get("/bottlenecks")
async def bottlenecks() -> dict:
    db = get_database()
    pipeline = [
        {
            "$group": {
                "_id": "$node_code",
                "total": {"$sum": 1},
                "pending": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "pendiente"]}, 1, 0]
                    }
                },
                "observed": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "observada"]}, 1, 0]
                    }
                },
            }
        },
        {"$sort": {"total": -1}},
        {"$limit": 5},
    ]
    critical_nodes = await db.tasks.aggregate(pipeline).to_list(length=5)
    summary, actions, source = await asyncio.to_thread(_generate_bottleneck_ai, critical_nodes)
    return {
        "message": "Analisis de cuellos de botella generado",
        "data": {
            "critical_nodes": critical_nodes,
            "recommendations": actions,
            "ai_summary": summary,
            "ai_source": source,
        },
    }


@router.get("/policies/{policy_id}")
async def analytics_by_policy(policy_id: str) -> dict:
    db = get_database()
    total_tramites = await db.tramites.count_documents({"policy_id": policy_id})
    total_tasks = await db.tasks.count_documents({"policy_id": policy_id})
    completed_tasks = await db.tasks.count_documents({"policy_id": policy_id, "status": "completada"})
    observed_tasks = await db.tasks.count_documents({"policy_id": policy_id, "status": "observada"})
    return {
        "message": "Analitica por politica recuperada",
        "data": {
            "policy_id": policy_id,
            "total_tramites": total_tramites,
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "observed_tasks": observed_tasks,
        },
    }


@router.get("/report")
async def export_report(format: str = Query(default="json", pattern="^(json|csv)$")) -> Response:
    db = get_database()
    tramites = await db.tramites.find().to_list(length=500)
    tasks = await db.tasks.find().to_list(length=1000)
    policies = await db.policies.find().to_list(length=200)

    total_tramites = len(tramites)
    total_tasks = len(tasks)
    pending_tasks = sum(1 for task in tasks if task.get("status") == "pendiente")
    completed_tasks = sum(1 for task in tasks if task.get("status") == "completada")

    procedure_mix: dict[str, int] = {}
    for tramite in tramites:
        procedure = tramite.get("procedure_type") or "sin_tipo"
        procedure_mix[procedure] = procedure_mix.get(procedure, 0) + 1

    department_load: dict[str, dict] = {}
    for task in tasks:
        department = task.get("assigned_department") or "Sin asignar"
        bucket = department_load.setdefault(
            department,
            {"department": department, "total": 0, "pendientes": 0, "en_proceso": 0, "completadas": 0},
        )
        bucket["total"] += 1
        if task.get("status") == "pendiente":
            bucket["pendientes"] += 1
        elif task.get("status") == "en_proceso":
            bucket["en_proceso"] += 1
        elif task.get("status") == "completada":
            bucket["completadas"] += 1

    critical_nodes = await db.tasks.aggregate(
        [
            {
                "$group": {
                    "_id": "$node_code",
                    "total": {"$sum": 1},
                    "pending": {"$sum": {"$cond": [{"$eq": ["$status", "pendiente"]}, 1, 0]}},
                    "observed": {"$sum": {"$cond": [{"$eq": ["$status", "observada"]}, 1, 0]}},
                }
            },
            {"$sort": {"total": -1}},
            {"$limit": 5},
        ]
    ).to_list(length=5)
    ai_summary, recommendations, ai_source = await asyncio.to_thread(_generate_bottleneck_ai, critical_nodes)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_tramites": total_tramites,
            "total_tasks": total_tasks,
            "pending_tasks": pending_tasks,
            "completed_tasks": completed_tasks,
        },
        "procedures": [{"procedure_type": key, "count": value} for key, value in sorted(procedure_mix.items())],
        "departments": list(department_load.values()),
        "critical_nodes": critical_nodes,
        "recommendations": recommendations,
        "ai_summary": ai_summary,
        "ai_source": ai_source,
        "policies": [
            {
                "policy_id": policy.get("_id"),
                "name": policy.get("name"),
                "status": policy.get("status"),
                "procedure_type": policy.get("procedure_type"),
                "version": policy.get("version"),
            }
            for policy in policies
        ],
    }

    if format == "json":
        return Response(
            content=json.dumps(payload, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="workflow-report.json"'},
        )

    csv_buffer = StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(["section", "key", "value", "extra_1", "extra_2"])
    for key, value in payload["summary"].items():
        writer.writerow(["summary", key, value, "", ""])
    for item in payload["procedures"]:
        writer.writerow(["procedure", item["procedure_type"], item["count"], "", ""])
    for item in payload["departments"]:
        writer.writerow(["department", item["department"], item["total"], item["pendientes"], item["completadas"]])
    for item in payload["critical_nodes"]:
        writer.writerow(["critical_node", item.get("_id"), item.get("total"), item.get("pending"), item.get("observed")])
    for item in payload["policies"]:
        writer.writerow(["policy", item["name"], item["status"], item["procedure_type"], item["version"]])
    writer.writerow(["ai_summary", ai_source, ai_summary, "", ""])
    for recommendation in recommendations:
        writer.writerow(["recommendation", recommendation, "", "", ""])

    return Response(
        content=csv_buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="workflow-report.csv"'},
    )
