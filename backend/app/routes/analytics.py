import asyncio
import csv
import json
from datetime import datetime, timezone
from io import StringIO
from urllib import parse, request, error

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from app.db.mongo import get_database
from app.core.config import settings
from app.services.audit_service import record_audit


router = APIRouter()


class IntelligentReportRequest(BaseModel):
    prompt: str = Field(min_length=3)
    date_from: str | None = None
    date_to: str | None = None
    actor_name: str | None = None


def _risk_level(score: int) -> str:
    if score >= 75:
        return "alto"
    if score >= 45:
        return "medio"
    return "bajo"


def _task_age_hours(task: dict) -> float:
    created = task.get("created_at")
    if not created:
        return 0
    if isinstance(created, str):
        try:
            created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            return 0
    else:
        created_dt = created
    if created_dt.tzinfo is None:
        created_dt = created_dt.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - created_dt).total_seconds() / 3600)


def _build_intelligence_snapshot(tasks: list[dict], tramites: list[dict], policies: list[dict]) -> dict:
    node_names: dict[str, dict] = {}
    transition_counts: dict[str, int] = {}
    for policy in policies:
        nodes = policy.get("nodes", [])
        for node in nodes:
            node_names[node.get("code")] = {
                "name": node.get("name"),
                "lane": node.get("lane"),
                "policy": policy.get("name"),
            }
        for transition in policy.get("transitions", []):
            key = f"{transition.get('source_code')}->{transition.get('target_code')}"
            transition_counts[key] = transition_counts.get(key, 0) + 1

    pending_by_node: dict[str, dict] = {}
    priorities: list[dict] = []
    anomalies: list[dict] = []
    for task in tasks:
        node = task.get("node_code") or "SIN_NODO"
        age_hours = _task_age_hours(task)
        bucket = pending_by_node.setdefault(
            node,
            {"node_code": node, "pending": 0, "observed": 0, "max_age_hours": 0.0, "meta": node_names.get(node)},
        )
        if task.get("status") in {"pendiente", "en_proceso"}:
            bucket["pending"] += 1
        if task.get("status") == "observada":
            bucket["observed"] += 1
        bucket["max_age_hours"] = max(bucket["max_age_hours"], round(age_hours, 1))

        score = min(100, int(age_hours * 2) + (35 if task.get("status") == "observada" else 0))
        if task.get("status") in {"pendiente", "en_proceso", "observada"}:
            priorities.append(
                {
                    "task_id": task.get("_id"),
                    "tramite_id": task.get("tramite_id"),
                    "node_code": node,
                    "title": task.get("title"),
                    "risk_score": score,
                    "risk_level": _risk_level(score),
                    "recommended_action": "Atender de inmediato" if score >= 75 else "Monitorear y priorizar en la bandeja",
                }
            )
        if age_hours >= 48 or task.get("status") == "observada":
            anomalies.append(
                {
                    "kind": "demora" if age_hours >= 48 else "observacion",
                    "task_id": task.get("_id"),
                    "node_code": node,
                    "detail": f"Tarea con {round(age_hours, 1)} horas de antiguedad y estado {task.get('status')}.",
                }
            )

    nodes = sorted(pending_by_node.values(), key=lambda item: (item["pending"] + item["observed"], item["max_age_hours"]), reverse=True)
    best_route = [
        {
            "node_code": item["node_code"],
            "node_name": (item.get("meta") or {}).get("name") or item["node_code"],
            "lane": (item.get("meta") or {}).get("lane") or "Sin calle",
            "reason": "Nodo critico por acumulacion; conviene reforzar recursos o automatizar validaciones.",
        }
        for item in nodes[:5]
    ]
    return {
        "model_type": "deep-learning-simulado-gemini",
        "total_tramites": len(tramites),
        "total_tasks": len(tasks),
        "risk_nodes": nodes[:8],
        "priority_recommendations": sorted(priorities, key=lambda item: item["risk_score"], reverse=True)[:10],
        "anomalies": anomalies[:10],
        "best_route_recommendation": best_route,
        "transition_patterns": transition_counts,
    }


def _generate_report_with_ai(prompt: str, snapshot: dict) -> tuple[dict, str]:
    fallback = {
        "title": "Reporte inteligente operativo",
        "summary": (
            f"Se analizaron {snapshot['total_tramites']} tramites y {snapshot['total_tasks']} tareas. "
            "El reporte prioriza riesgo de demora, carga por nodo y anomalias operativas."
        ),
        "query_plan": [
            "Filtrar tramites y tareas segun el periodo solicitado.",
            "Agrupar por nodo, departamento y estado.",
            "Priorizar tareas antiguas u observadas.",
            "Generar recomendaciones de intervencion.",
        ],
        "recommendations": [
            "Atender primero las tareas con riesgo alto.",
            "Revisar nodos con observaciones repetidas.",
            "Reasignar capacidad temporalmente en las calles con mayor cola.",
        ],
        "filters_detected": {"prompt": prompt},
    }
    if not settings.gemini_api_key:
        return fallback, "fallback"
    ai_prompt = "\n".join(
        [
            "Eres un analista BI de procesos y debes generar un reporte operacional.",
            "El usuario puede pedir filtros por fecha, cliente, tramite, estado o nodo.",
            "Responde SOLO JSON valido con title, summary, query_plan, recommendations y filters_detected.",
            "No inventes datos fuera del snapshot.",
            f"Solicitud del usuario: {prompt}",
            f"Snapshot: {json.dumps(snapshot, ensure_ascii=False, default=str)}",
        ]
    )
    body = {
        "contents": [{"parts": [{"text": ai_prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.15,
            "maxOutputTokens": 1200,
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
        with request.urlopen(req, timeout=35) as response:
            raw = json.loads(response.read().decode("utf-8"))
        text = raw["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text[text.find("{"): text.rfind("}") + 1]), "gemini"
    except (error.HTTPError, error.URLError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return fallback, "fallback"


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


@router.get("/routing-intelligence")
async def routing_intelligence() -> dict:
    db = get_database()
    tasks = await db.tasks.find().to_list(length=1000)
    tramites = await db.tramites.find().to_list(length=500)
    policies = await db.policies.find().to_list(length=200)
    snapshot = _build_intelligence_snapshot(tasks, tramites, policies)
    await record_audit(
        action="routing.predicted",
        summary="Motor inteligente calculo ruta, riesgos, prioridades y anomalias.",
        metadata={
            "model_type": snapshot["model_type"],
            "risk_nodes": len(snapshot["risk_nodes"]),
            "anomalies": len(snapshot["anomalies"]),
        },
    )
    return {"message": "Prediccion inteligente generada", "data": snapshot}


@router.post("/intelligent-report")
async def intelligent_report(payload: IntelligentReportRequest) -> dict:
    db = get_database()
    tasks = await db.tasks.find().to_list(length=1000)
    tramites = await db.tramites.find().to_list(length=500)
    policies = await db.policies.find().to_list(length=200)
    snapshot = _build_intelligence_snapshot(tasks, tramites, policies)
    report, source = await asyncio.to_thread(_generate_report_with_ai, payload.prompt, snapshot)
    report_payload = {
        **report,
        "source": source,
        "model_type": snapshot["model_type"],
        "date_from": payload.date_from,
        "date_to": payload.date_to,
        "snapshot": snapshot,
    }
    await record_audit(
        action="report.generated",
        actor_name=payload.actor_name,
        summary=f"Reporte inteligente generado: {report_payload.get('title', 'sin titulo')}",
        metadata={"prompt": payload.prompt, "source": source, "date_from": payload.date_from, "date_to": payload.date_to},
    )
    return {"message": "Reporte inteligente generado", "data": report_payload}
