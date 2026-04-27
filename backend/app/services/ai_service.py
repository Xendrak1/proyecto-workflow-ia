import json
from urllib import error, parse, request

from fastapi import HTTPException

from app.core.config import settings
from app.models.ai import (
    TaskFormFillAudioRequest,
    TaskFormFillRequest,
    TaskFormFillResponse,
    WorkflowAudioSuggestionRequest,
    WorkflowSuggestionRequest,
    WorkflowSuggestionResponse,
)


GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


WORKFLOW_RESPONSE_SCHEMA = {
    "type": "object",
    "required": ["title", "summary", "nodes", "transitions"],
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["code", "name", "node_type", "lane"],
                "properties": {
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                    "node_type": {
                        "type": "string",
                        "enum": ["actividad", "decision", "inicio", "fin", "fork", "join"],
                    },
                    "lane": {"type": "string"},
                    "responsible_role": {"type": "string"},
                    "responsible_department": {"type": "string"},
                },
            },
        },
        "transitions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["source_code", "target_code", "transition_type"],
                "properties": {
                    "source_code": {"type": "string"},
                    "target_code": {"type": "string"},
                    "transition_type": {
                        "type": "string",
                        "enum": ["secuencial", "alternativa", "iterativa", "paralela"],
                    },
                    "condition_label": {"type": "string"},
                },
            },
        },
    },
}

def _build_prompt(payload: WorkflowSuggestionRequest, transcript: str | None = None) -> str:
    context_lines = [
        "Eres un analista de procesos de negocio.",
        "Debes convertir el texto del usuario en un workflow para una organizacion.",
        "Responde solo con JSON valido que cumpla exactamente el esquema solicitado.",
        "No uses markdown. No uses bloques ```json. No agregues texto antes ni despues del JSON.",
        "Devuelve exactamente un objeto JSON con las claves title, summary, nodes y transitions.",
        "Usa nombres y codigos cortos, claros y sin espacios.",
        "Los codigos deben ser alfanumericos, cortos y en mayusculas. Ejemplos: INI, ATC, REVTEC, LEG, FIN.",
        "Mapea areas o departamentos a lanes.",
        "Cada node debe tener una lane coherente con el proceso.",
        "No inventes transiciones que apunten a codigos inexistentes.",
        "Si el flujo menciona decisiones, usa node_type='decision' y transition_type='alternativa' cuando corresponda.",
        "Si no se menciona un inicio o fin explicito, agregalos.",
        "Todos los textos deben quedar en espanol.",
        "Si el prompt es corto o ambiguo, infiere un flujo base razonable segun el contexto disponible.",
        "Si mencionan COTAS, piensa en solicitudes de servicio, revision tecnica, validacion administrativa o legal, ejecucion y cierre.",
        "Si el usuario pide adaptar, intenta conservar nodos, calles o relaciones ya existentes cuando sigan teniendo sentido.",
        "Si el usuario pide reemplazar, puedes proponer un flujo nuevo completo.",
        'Ejemplo de salida valida: {"title":"Flujo de Cotas","summary":"Resumen breve","nodes":[{"code":"INI","name":"Inicio","node_type":"inicio","lane":"Sistema"},{"code":"ATC","name":"Registrar solicitud","node_type":"actividad","lane":"Atencion al Cliente"}],"transitions":[{"source_code":"INI","target_code":"ATC","transition_type":"secuencial"}]}',
    ]
    if payload.policy_name:
        context_lines.append(f"Nombre de la politica: {payload.policy_name}")
    if payload.procedure_type:
        context_lines.append(f"Tipo de tramite: {payload.procedure_type}")
    if payload.policy_description:
        context_lines.append(f"Descripcion base: {payload.policy_description}")
    context_lines.append(f"Prompt del usuario: {payload.prompt}")
    if transcript:
        context_lines.append(f"Transcripcion de audio: {transcript}")
    return "\n".join(context_lines)


def _build_task_fill_prompt(payload: TaskFormFillRequest, transcript: str | None = None) -> str:
    field_lines: list[str] = []
    for field in payload.fields:
        options = f" opciones={', '.join(field.options)}" if field.options else ""
        field_lines.append(
            f"- key={field.key}; label={field.label}; type={field.field_type}; required={field.required};{options}"
        )

    context_lines = [
        "Eres un asistente de workflow que ayuda a un funcionario a llenar formularios.",
        "Debes leer el informe del usuario y completar los campos del formulario con datos razonables y concretos.",
        "Responde solo con JSON valido. No uses markdown ni texto extra.",
        "Devuelve exactamente un objeto con las claves summary, observations y form_data.",
        "En form_data usa exactamente las keys tecnicas recibidas.",
        "Si un dato no aparece, deja cadena vacia para texto/lista/archivo/imagen/fecha, null para numero y false para booleano.",
        "Para campos lista usa solo valores permitidos en options si existen.",
        "Para campos booleano usa true o false.",
        "Para fecha usa formato YYYY-MM-DD si la fecha se puede inferir con suficiente claridad.",
        "observations debe resumir en una o dos frases lo entendido del informe.",
        f"Titulo de tarea: {payload.task_title or 'Sin titulo'}",
        f"Nodo: {payload.node_name or 'Sin nodo'}",
        f"Calle o area: {payload.lane or 'Sin calle'}",
        f"Tipo de tramite: {payload.procedure_type or 'Sin tipo'}",
        f"Solicitante: {payload.applicant_name or 'Sin nombre'}",
        f"Documento: {payload.applicant_document or 'Sin documento'}",
        "Campos del formulario:",
        "\n".join(field_lines) if field_lines else "- Sin campos configurados",
        f"Informe del usuario: {payload.report_text}",
    ]
    if transcript:
        context_lines.append(f"Transcripcion de audio: {transcript}")
    return "\n".join(context_lines)


def _request_gemini(text_prompt: str, inline_audio: dict | None = None, response_schema: dict | None = None) -> dict:
    endpoint = GEMINI_ENDPOINT.format(model=settings.gemini_model)
    url = f"{endpoint}?key={parse.quote(settings.gemini_api_key)}"
    parts: list[dict] = [{"text": text_prompt}]
    if inline_audio:
        parts.append({"inlineData": inline_audio})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": response_schema or WORKFLOW_RESPONSE_SCHEMA,
            "temperature": 0.05,
            "maxOutputTokens": 2048,
        },
    }

    req = request.Request(
        url=url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Gemini devolvio un error: {detail}") from exc
    except error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo contactar a Gemini: {exc.reason}") from exc


def generate_workflow_suggestion(payload: WorkflowSuggestionRequest) -> WorkflowSuggestionResponse:
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini no esta configurado en el backend")
    try:
        raw = _request_gemini(_build_prompt(payload), response_schema=WORKFLOW_RESPONSE_SCHEMA)
    except HTTPException:
        fallback = _fallback_workflow_suggestion(payload)
        fallback.source = "fallback"
        fallback.model = settings.gemini_model
        return fallback

    try:
        parsed = _parse_gemini_candidate(raw)
        parsed.setdefault("source", "gemini")
        parsed.setdefault("model", settings.gemini_model)
        return WorkflowSuggestionResponse.model_validate(parsed)
    except (KeyError, IndexError, json.JSONDecodeError, TypeError, ValueError) as exc:
        fallback = _fallback_workflow_suggestion(payload)
        fallback.source = "fallback"
        fallback.model = settings.gemini_model
        return fallback


def generate_workflow_suggestion_from_audio(payload: WorkflowAudioSuggestionRequest) -> WorkflowSuggestionResponse:
    base_payload = WorkflowSuggestionRequest(
        prompt="Genera una propuesta de workflow a partir del audio del usuario.",
        policy_name=payload.policy_name,
        procedure_type=payload.procedure_type,
        policy_description=payload.policy_description,
    )
    try:
        raw = _request_gemini(
            "\n".join(
                [
                    _build_prompt(base_payload),
                    "Escucha el audio y devuelve un JSON valido.",
                    "Incluye tambien un campo transcript con un resumen o transcripcion corta del audio entendido.",
                ]
            ),
            inline_audio={"mimeType": payload.mime_type, "data": payload.audio_base64},
            response_schema=WORKFLOW_RESPONSE_SCHEMA,
        )
    except HTTPException:
        fallback = _fallback_workflow_suggestion(base_payload)
        fallback.source = "fallback-audio"
        fallback.model = settings.gemini_model
        fallback.transcript = "Gemini no estuvo disponible y se uso una propuesta base desde audio."
        return fallback

    try:
        parsed = _parse_gemini_candidate(raw)
        parsed.setdefault("source", "gemini-audio")
        parsed.setdefault("model", settings.gemini_model)
        if not parsed.get("transcript"):
            parsed["transcript"] = "Audio procesado por Gemini."
        return WorkflowSuggestionResponse.model_validate(parsed)
    except (KeyError, IndexError, json.JSONDecodeError, TypeError, ValueError):
        fallback = _fallback_workflow_suggestion(base_payload)
        fallback.source = "fallback-audio"
        fallback.model = settings.gemini_model
        fallback.transcript = "No se pudo estructurar la respuesta de audio. Se uso una propuesta base."
        return fallback


def generate_task_form_fill(payload: TaskFormFillRequest) -> TaskFormFillResponse:
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini no esta configurado en el backend")
    try:
        raw = _request_gemini(_build_task_fill_prompt(payload), response_schema=None)
    except HTTPException:
        fallback = _fallback_task_form_fill(payload)
        fallback.source = "fallback"
        fallback.model = settings.gemini_model
        return fallback
    try:
        parsed = _parse_gemini_candidate(raw)
        parsed.setdefault("source", "gemini")
        parsed.setdefault("model", settings.gemini_model)
        response = TaskFormFillResponse.model_validate(parsed)
        return _merge_task_fill_with_fallback(response, payload)
    except (KeyError, IndexError, json.JSONDecodeError, TypeError, ValueError):
        fallback = _fallback_task_form_fill(payload)
        fallback.source = "fallback"
        fallback.model = settings.gemini_model
        return fallback


def generate_task_form_fill_from_audio(payload: TaskFormFillAudioRequest) -> TaskFormFillResponse:
    try:
        raw = _request_gemini(
            "\n".join(
                [
                    _build_task_fill_prompt(
                        TaskFormFillRequest(
                            report_text="Completa el formulario a partir del audio del usuario.",
                            task_title=payload.task_title,
                            node_name=payload.node_name,
                            lane=payload.lane,
                            procedure_type=payload.procedure_type,
                            applicant_name=payload.applicant_name,
                            applicant_document=payload.applicant_document,
                            fields=payload.fields,
                        )
                    ),
                    "Escucha el audio y devuelve JSON valido.",
                    "Incluye transcript con una transcripcion o resumen corto del audio entendido.",
                ]
            ),
            inline_audio={"mimeType": payload.mime_type, "data": payload.audio_base64},
            response_schema=None,
        )
    except HTTPException:
        fallback = _fallback_task_form_fill(
            TaskFormFillRequest(
                report_text="Gemini no estuvo disponible. Se genero una propuesta base desde audio.",
                task_title=payload.task_title,
                node_name=payload.node_name,
                lane=payload.lane,
                procedure_type=payload.procedure_type,
                applicant_name=payload.applicant_name,
                applicant_document=payload.applicant_document,
                fields=payload.fields,
            )
        )
        fallback.source = "fallback-audio"
        fallback.model = settings.gemini_model
        fallback.transcript = "Gemini no estuvo disponible y se uso una propuesta base desde audio."
        return fallback
    try:
        parsed = _parse_gemini_candidate(raw)
        parsed.setdefault("source", "gemini-audio")
        parsed.setdefault("model", settings.gemini_model)
        parsed.setdefault("transcript", "Audio procesado por Gemini.")
        response = TaskFormFillResponse.model_validate(parsed)
        return _merge_task_fill_with_fallback(
            response,
            TaskFormFillRequest(
                report_text=response.transcript or payload.task_title or "Audio procesado",
                task_title=payload.task_title,
                node_name=payload.node_name,
                lane=payload.lane,
                procedure_type=payload.procedure_type,
                applicant_name=payload.applicant_name,
                applicant_document=payload.applicant_document,
                fields=payload.fields,
            ),
        )
    except (KeyError, IndexError, json.JSONDecodeError, TypeError, ValueError):
        fallback = _fallback_task_form_fill(
            TaskFormFillRequest(
                report_text="No se pudo estructurar el audio. Se genero una propuesta base.",
                task_title=payload.task_title,
                node_name=payload.node_name,
                lane=payload.lane,
                procedure_type=payload.procedure_type,
                applicant_name=payload.applicant_name,
                applicant_document=payload.applicant_document,
                fields=payload.fields,
            )
        )
        fallback.source = "fallback-audio"
        fallback.model = settings.gemini_model
        fallback.transcript = "No se pudo estructurar la respuesta de audio. Se uso una propuesta base."
        return fallback


def _extract_json_text(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return cleaned[first_brace:last_brace + 1]
    return cleaned


def _parse_gemini_candidate(raw: dict) -> dict:
    candidate = raw["candidates"][0]
    parts = candidate["content"]["parts"]
    if not parts:
        raise ValueError("Gemini no devolvio partes de contenido")

    first_part = parts[0]
    if isinstance(first_part, dict) and isinstance(first_part.get("text"), str):
        return json.loads(_extract_json_text(first_part["text"]))

    if isinstance(first_part, dict):
        return json.loads(_extract_json_text(json.dumps(first_part, ensure_ascii=False)))

    if isinstance(first_part, str):
        return json.loads(_extract_json_text(first_part))

    raise ValueError("Gemini devolvio una estructura no reconocida")


def _fallback_workflow_suggestion(payload: WorkflowSuggestionRequest) -> WorkflowSuggestionResponse:
    prompt_lower = payload.prompt.lower()
    title = payload.policy_name or "Propuesta de flujo"
    if "cotas" in prompt_lower or (payload.policy_name and "cotas" in payload.policy_name.lower()):
        return WorkflowSuggestionResponse(
            source="fallback",
            model=settings.gemini_model,
            title=title,
            summary="Se genero un flujo base para solicitudes de servicio o instalacion en COTAS.",
            nodes=[
                {"code": "INI", "name": "Inicio", "node_type": "inicio", "lane": "Sistema"},
                {
                    "code": "ATC",
                    "name": "Registrar solicitud",
                    "node_type": "actividad",
                    "lane": "Atencion al Cliente",
                    "responsible_role": "funcionario",
                    "responsible_department": "Atencion al Cliente",
                },
                {
                    "code": "TEC",
                    "name": "Revision tecnica",
                    "node_type": "actividad",
                    "lane": "Departamento Tecnico",
                    "responsible_role": "tecnico",
                    "responsible_department": "Departamento Tecnico",
                },
                {
                    "code": "DEC",
                    "name": "Evaluar viabilidad",
                    "node_type": "decision",
                    "lane": "Departamento Tecnico",
                    "responsible_role": "tecnico",
                    "responsible_department": "Departamento Tecnico",
                },
                {
                    "code": "ADM",
                    "name": "Validacion administrativa",
                    "node_type": "actividad",
                    "lane": "Administracion",
                    "responsible_role": "supervisor",
                    "responsible_department": "Administracion",
                },
                {
                    "code": "INS",
                    "name": "Ejecutar instalacion",
                    "node_type": "actividad",
                    "lane": "Operaciones",
                    "responsible_role": "instalador",
                    "responsible_department": "Operaciones",
                },
                {"code": "FIN", "name": "Fin", "node_type": "fin", "lane": "Sistema"},
            ],
            transitions=[
                {"source_code": "INI", "target_code": "ATC", "transition_type": "secuencial"},
                {"source_code": "ATC", "target_code": "TEC", "transition_type": "secuencial"},
                {"source_code": "TEC", "target_code": "DEC", "transition_type": "secuencial"},
                {"source_code": "DEC", "target_code": "ATC", "transition_type": "alternativa", "condition_label": "No viable"},
                {"source_code": "DEC", "target_code": "ADM", "transition_type": "alternativa", "condition_label": "Viable"},
                {"source_code": "ADM", "target_code": "INS", "transition_type": "secuencial"},
                {"source_code": "INS", "target_code": "FIN", "transition_type": "secuencial"},
            ],
        )

    return WorkflowSuggestionResponse(
        source="fallback",
        model=settings.gemini_model,
        title=title,
        summary="Se genero un flujo base a partir del contexto disponible.",
        nodes=[
            {"code": "INI", "name": "Inicio", "node_type": "inicio", "lane": "Sistema"},
            {
                "code": "ATC",
                "name": "Recepcionar solicitud",
                "node_type": "actividad",
                "lane": "Atencion al Cliente",
                "responsible_role": "funcionario",
                "responsible_department": "Atencion al Cliente",
            },
            {
                "code": "REV",
                "name": "Revisar solicitud",
                "node_type": "actividad",
                "lane": "Operacion",
                "responsible_role": "funcionario",
                "responsible_department": "Operacion",
            },
            {
                "code": "FIN",
                "name": "Fin",
                "node_type": "fin",
                "lane": "Sistema",
            },
        ],
        transitions=[
            {"source_code": "INI", "target_code": "ATC", "transition_type": "secuencial"},
            {"source_code": "ATC", "target_code": "REV", "transition_type": "secuencial"},
            {"source_code": "REV", "target_code": "FIN", "transition_type": "secuencial"},
        ],
    )


def _fallback_task_form_fill(payload: TaskFormFillRequest) -> TaskFormFillResponse:
    form_data: dict = {}
    report_lower = payload.report_text.lower()

    for field in payload.fields:
        value: str | int | float | bool | None
        if field.field_type == "booleano":
            value = any(
                token in report_lower
                for token in ["si ", "sí ", "aprobado", "aprobada", "viable", "completo", "completa", "correcto", "correcta"]
            )
        elif field.field_type == "numero":
            value = None
        elif field.field_type == "lista":
            value = ""
            for option in field.options:
                if option.lower() in report_lower:
                    value = option
                    break
        else:
            value = ""
        form_data[field.key] = value

    return TaskFormFillResponse(
        source="fallback",
        model=settings.gemini_model,
        summary="Se genero una propuesta base para no dejar el formulario vacio.",
        observations="La IA no devolvio una estructura perfecta y se preparo un llenado inicial revisable.",
        form_data=form_data,
    )


def _merge_task_fill_with_fallback(response: TaskFormFillResponse, payload: TaskFormFillRequest) -> TaskFormFillResponse:
    fallback = _fallback_task_form_fill(payload)
    merged = dict(fallback.form_data)
    merged.update({key: value for key, value in response.form_data.items() if value not in ("", None)})
    response.form_data = merged
    if not response.observations:
        response.observations = fallback.observations
    if not response.summary:
        response.summary = fallback.summary
    return response
