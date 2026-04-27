from fastapi import APIRouter

from app.models.ai import (
    TaskFormFillAudioRequest,
    TaskFormFillRequest,
    TranscribeAudioRequest,
    WorkflowAudioSuggestionRequest,
    WorkflowSuggestionRequest,
)
from app.services.ai_service import (
    generate_task_form_fill,
    generate_task_form_fill_local,
    generate_task_form_fill_from_audio,
    generate_workflow_suggestion,
    generate_workflow_suggestion_from_audio,
    transcribe_audio_vosk,
)


router = APIRouter()


@router.post("/transcribe-audio")
def transcribe_audio(payload: TranscribeAudioRequest) -> dict:
    result = transcribe_audio_vosk(payload.audio_base64, payload.mime_type)
    return {"transcript": result.transcript, "source": result.source}


@router.post("/workflow-suggestion")
def workflow_suggestion(payload: WorkflowSuggestionRequest) -> dict:
    suggestion = generate_workflow_suggestion(payload)
    return {"message": "Sugerencia generada", "data": suggestion.model_dump()}


@router.post("/workflow-suggestion-audio")
def workflow_suggestion_audio(payload: WorkflowAudioSuggestionRequest) -> dict:
    suggestion = generate_workflow_suggestion_from_audio(payload)
    return {"message": "Sugerencia de audio generada", "data": suggestion.model_dump()}


@router.post("/task-form-fill")
def task_form_fill(payload: TaskFormFillRequest) -> dict:
    suggestion = generate_task_form_fill(payload)
    return {"message": "Formulario completado con IA", "data": suggestion.model_dump()}


@router.post("/task-form-fill-local")
def task_form_fill_local(payload: TaskFormFillRequest) -> dict:
    suggestion = generate_task_form_fill_local(payload)
    return {"message": "Formulario completado desde el texto actual", "data": suggestion.model_dump()}


@router.post("/task-form-fill-audio")
def task_form_fill_audio(payload: TaskFormFillAudioRequest) -> dict:
    suggestion = generate_task_form_fill_from_audio(payload)
    return {"message": "Formulario completado con audio", "data": suggestion.model_dump()}
