import base64
import io
import json
import os
import re
import subprocess
import threading
import zipfile
from urllib import error, parse, request

from fastapi import HTTPException

from app.core.config import settings
from app.models.ai import (
    TaskFormFillAudioRequest,
    TaskFormFillRequest,
    TaskFormFillResponse,
    TranscribeAudioResponse,
    WorkflowAudioSuggestionRequest,
    WorkflowSuggestionRequest,
    WorkflowSuggestionResponse,
)

# ---------------------------------------------------------------------------
# Vosk transcription (offline, free, no API key)
# ---------------------------------------------------------------------------

_VOSK_MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "vosk_model")
_VOSK_MODEL_NAME = "vosk-model-small-es-0.42"
_VOSK_MODEL_URL = f"https://alphacephei.com/vosk/models/{_VOSK_MODEL_NAME}.zip"

_vosk_model_instance = None
_vosk_model_lock = threading.Lock()


def _ensure_vosk_model() -> str:
    model_path = os.path.join(_VOSK_MODEL_DIR, _VOSK_MODEL_NAME)
    if not os.path.isdir(model_path):
        os.makedirs(_VOSK_MODEL_DIR, exist_ok=True)
        zip_path = os.path.join(_VOSK_MODEL_DIR, "model.zip")
        try:
            req = request.Request(_VOSK_MODEL_URL, headers={"User-Agent": "Mozilla/5.0"})
            with request.urlopen(req, timeout=120) as resp, open(zip_path, "wb") as f:
                f.write(resp.read())
            with zipfile.ZipFile(zip_path, "r") as z:
                z.extractall(_VOSK_MODEL_DIR)
        finally:
            if os.path.exists(zip_path):
                os.unlink(zip_path)
    return model_path


def _get_vosk_model():
    global _vosk_model_instance
    if _vosk_model_instance is None:
        with _vosk_model_lock:
            if _vosk_model_instance is None:
                try:
                    from vosk import Model, SetLogLevel  # type: ignore[import]
                    SetLogLevel(-1)
                    _vosk_model_instance = Model(_ensure_vosk_model())
                except ImportError as exc:
                    raise HTTPException(
                        status_code=503,
                        detail="El paquete vosk no está instalado. Ejecuta pip install vosk en el servidor.",
                    ) from exc
    return _vosk_model_instance


def _audio_to_wav_pcm(audio_bytes: bytes) -> bytes:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1", "-loglevel", "quiet"],
            input=audio_bytes,
            capture_output=True,
            timeout=30,
        )
        if not proc.stdout:
            raise HTTPException(
                status_code=422,
                detail="No se pudo convertir el audio. Asegúrate de haber grabado algo con el micrófono.",
            )
        return proc.stdout
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail="ffmpeg no está instalado en el servidor. Ejecuta: sudo apt install ffmpeg",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="El audio tardó demasiado en convertirse.") from exc


def transcribe_audio_vosk(audio_base64: str, mime_type: str) -> TranscribeAudioResponse:
    try:
        from vosk import KaldiRecognizer  # type: ignore[import]
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="El paquete vosk no está instalado. Ejecuta pip install vosk en el servidor.",
        ) from exc

    audio_bytes = base64.b64decode(audio_base64)
    wav_bytes = _audio_to_wav_pcm(audio_bytes)

    model = _get_vosk_model()
    rec = KaldiRecognizer(model, 16000)
    rec.SetWords(False)

    wav_io = io.BytesIO(wav_bytes)
    wav_io.seek(44)  # skip WAV header
    while True:
        chunk = wav_io.read(4000)
        if not chunk:
            break
        rec.AcceptWaveform(chunk)

    result = json.loads(rec.FinalResult())
    transcript = result.get("text", "").strip()

    if not transcript:
        raise HTTPException(
            status_code=422,
            detail="No se reconoció texto en el audio. Habla con claridad y cerca del micrófono.",
        )

    return TranscribeAudioResponse(transcript=transcript, source="vosk")


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
    except HTTPException as exc:
        fallback = _fallback_task_form_fill(payload)
        _mark_task_fill_failure(fallback, exc.detail if hasattr(exc, "detail") else None)
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


def generate_task_form_fill_local(payload: TaskFormFillRequest) -> TaskFormFillResponse:
    fallback = _fallback_task_form_fill(payload)
    fallback.source = "local-heuristic"
    fallback.model = "local-parser"
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
    except HTTPException as exc:
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
        _mark_task_fill_failure(fallback, exc.detail if hasattr(exc, "detail") else None, audio=True)
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


def _mark_task_fill_failure(response: TaskFormFillResponse, detail: str | None, audio: bool = False) -> None:
    quota_exceeded = bool(detail and ("429" in detail or "quota" in detail.lower() or "resource_exhausted" in detail.lower()))
    response.model = settings.gemini_model
    if quota_exceeded:
        response.source = "fallback-quota-audio" if audio else "fallback-quota"
        response.summary = "Gemini alcanzo su cuota temporal y se uso un llenado local revisable."
        response.observations = "Se detecto limite de cuota en Gemini. El sistema completo los datos que pudo inferir localmente."
        if audio:
            response.transcript = "Gemini alcanzo su cuota temporal y no pudo transcribir el audio."
    else:
        response.source = "fallback-audio" if audio else "fallback"
        if audio:
            response.transcript = "Gemini no estuvo disponible y se uso una propuesta base desde audio."


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


# ── Deterministic node classification & observation helpers ──────────────────

_INCIDENT_NODE_KEYWORDS = frozenset([
    "incidente", "accidente", "caida", "caída", "lesion", "lesión",
    "daño", "dano", "averia", "avería", "falla", "fallo",
    "emergencia", "alerta", "novedad", "siniestro",
])

_REVIEW_NODE_KEYWORDS = frozenset([
    "revision", "revisión", "control", "verificacion", "verificación",
    "auditoria", "auditoría", "inspeccion", "inspección", "chequeo",
    "supervision", "supervisión", "monitoreo", "calidad", "qa",
    "conformidad", "evaluacion", "evaluación",
])


def _classify_node(node_name: str, lane: str) -> str:
    """Returns 'incident', 'review', or 'general' based on node/lane keywords."""
    combined = f"{node_name} {lane}".lower()
    if any(kw in combined for kw in _INCIDENT_NODE_KEYWORDS):
        return "incident"
    if any(kw in combined for kw in _REVIEW_NODE_KEYWORDS):
        return "review"
    return "general"


def _build_formal_observation(report_text: str, node_name: str, lane: str) -> str:
    """Convert free-form report text into a formal 2-sentence operational observation.

    Incident/review nodes get a category-specific closing recommendation.
    The workflow flow is never described.
    """
    node_category = _classify_node(node_name, lane)

    _EMPTY_OBS: dict[str, str] = {
        "incident": (
            f"Se registra una novedad en {node_name or 'el nodo de incidentes'}. "
            "Se recomienda dar seguimiento según el procedimiento interno."
        ),
        "review": (
            f"Se registra el resultado de revisión en {node_name or 'el nodo de control'}. "
            "Se adjunta para resolución correspondiente."
        ),
        "general": (
            f"Se registra la actividad en {node_name or 'el proceso'}. "
            "Se procede según el procedimiento vigente."
        ),
    }

    text = report_text.strip()
    if not text:
        return _EMPTY_OBS.get(node_category, _EMPTY_OBS["general"])

    sentence = text[0].upper() + text[1:]
    if sentence[-1] not in ".!?":
        sentence += "."

    _CLOSINGS: dict[str, str] = {
        "incident": "Se recomienda registrar el incidente y dar seguimiento según el procedimiento interno.",
        "review": "Se registran los hallazgos para su revisión y resolución correspondiente.",
        "general": "Se registra la información para continuar con el proceso según el procedimiento vigente.",
    }
    closing = _CLOSINGS.get(node_category, _CLOSINGS["general"])
    return f"{sentence} {closing}"


def _build_contextual_summary(
    report_text: str, node_name: str, lane: str, procedure_type: str | None
) -> str:
    """Build a short, fact-based summary without describing the workflow flow."""
    node_category = _classify_node(node_name, lane)
    context = procedure_type or node_name or "el trámite"
    preview = (report_text[:80].rstrip() + "...") if len(report_text) > 80 else report_text.strip()

    if node_category == "incident":
        return f"Incidente reportado en {node_name or 'el proceso'}: {preview}"
    if node_category == "review":
        return f"Revisión registrada en {node_name or 'el proceso'}: {preview}"
    return f"Informe recibido para {context}."


def _fallback_task_form_fill(payload: TaskFormFillRequest) -> TaskFormFillResponse:
    form_data: dict = {}
    report_lower = payload.report_text.lower()
    node_name = payload.node_name or ""
    lane = payload.lane or ""

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
        elif field.field_type in {"texto", "archivo", "imagen"}:
            value = _infer_textual_field_value(field.key, field.label, payload.report_text, node_name, lane)
        else:
            value = ""
        form_data[field.key] = value

    return TaskFormFillResponse(
        source="fallback",
        model=settings.gemini_model,
        summary=_build_contextual_summary(payload.report_text, node_name, lane, payload.procedure_type),
        observations=_build_formal_observation(payload.report_text, node_name, lane),
        form_data=form_data,
    )


def _infer_textual_field_value(
    field_key: str, field_label: str, report_text: str, node_name: str = "", lane: str = ""
) -> str:
    key = f"{field_key} {field_label}".lower()
    if any(token in key for token in ["observ", "descripcion", "descripción", "detalle", "comentario", "nota"]):
        return _build_formal_observation(report_text, node_name, lane)
    if any(token in key for token in ["telefon", "celular", "movil", "contacto"]):
        return _extract_phone(report_text)
    if any(token in key for token in ["direccion", "domicilio", "ubicacion", "ubicación"]):
        return _extract_address(report_text)
    if "nombre" in key:
        return _extract_name(report_text)
    if "document" in key or "ci" in key or "cedula" in key or "carnet" in key:
        return _extract_document(report_text)
    return ""


def _extract_phone(text: str) -> str:
    labeled = re.search(r"(?:telefono|teléfono|celular|contacto|telf\.?)\s*(?:es|:)?\s*(\+?\d[\d\s-]{6,})", text, re.IGNORECASE)
    if labeled:
        return re.sub(r"[^\d+]", "", labeled.group(1)).strip()
    generic = re.search(r"(\+?\d[\d\s-]{6,}\d)", text)
    if generic:
        return re.sub(r"[^\d+]", "", generic.group(1)).strip()
    return ""


def _extract_address(text: str) -> str:
    patterns = [
        r"(?:domicilio(?: de)?|direccion|dirección|ubicado en|vive en|en la direccion)\s*(?:es|:)?\s*([^.;\n]+)",
        r"((?:avenida|av\.?|calle|zona|barrio|urbanizacion|urbanización)\s+[^.;\n]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip(" ,.-")
    return ""


def _extract_name(text: str) -> str:
    match = re.search(r"(?:cliente|solicitante|senor|señor|senora|señora)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,2})", text)
    if match:
        return match.group(1).strip()
    return ""


def _extract_document(text: str) -> str:
    match = re.search(r"(?:ci|c\.i\.|documento|carnet|cedula|cédula)\s*(?:es|:)?\s*([A-Za-z0-9-]{5,})", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""


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
