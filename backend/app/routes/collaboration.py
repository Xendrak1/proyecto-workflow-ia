from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db.mongo import get_database
from app.services.audit_service import record_audit
from app.services.collaboration import collaboration_hub


router = APIRouter()


def _user_name(websocket: WebSocket) -> str:
    return websocket.query_params.get("user") or "Usuario"


@router.websocket("/ws/policies/{policy_id}")
async def policy_collaboration(websocket: WebSocket, policy_id: str) -> None:
    room_key = f"policy:{policy_id}"
    connection_id = await collaboration_hub.connect(room_key, websocket, _user_name(websocket))
    try:
        while True:
            message: dict[str, Any] = await websocket.receive_json()
            event_type = message.get("type")
            if event_type == "ping":
                await collaboration_hub.send(websocket, {"type": "pong"})
                continue
            if event_type in {"cursor", "policy.changed"}:
                await collaboration_hub.broadcast(
                    room_key,
                    {
                        **message,
                        "policy_id": policy_id,
                        "at": datetime.now(timezone.utc).isoformat(),
                    },
                    exclude=websocket,
                )
    except WebSocketDisconnect:
        await collaboration_hub.disconnect(room_key, websocket, connection_id)
    except Exception:
        await collaboration_hub.disconnect(room_key, websocket, connection_id)


@router.websocket("/ws/documents/{document_id}")
async def document_collaboration(websocket: WebSocket, document_id: str) -> None:
    db = get_database()
    document = await db.documents.find_one({"_id": document_id})
    if not document:
        await websocket.close(code=4404)
        return

    room_key = f"document:{document_id}"
    user_name = _user_name(websocket)
    connection_id = await collaboration_hub.connect(room_key, websocket, user_name)
    await collaboration_hub.send(
        websocket,
        {
            "type": "document.state",
            "document_id": document_id,
            "content": document.get("collaborative_content", ""),
            "revision": int(document.get("collaborative_revision") or 0),
            "updated_by": document.get("collaborative_updated_by"),
            "updated_at": document.get("collaborative_updated_at").isoformat()
            if hasattr(document.get("collaborative_updated_at"), "isoformat")
            else document.get("collaborative_updated_at"),
        },
    )

    try:
        while True:
            message: dict[str, Any] = await websocket.receive_json()
            event_type = message.get("type")
            if event_type == "ping":
                await collaboration_hub.send(websocket, {"type": "pong"})
                continue
            if event_type == "cursor":
                await collaboration_hub.broadcast(room_key, {**message, "document_id": document_id}, exclude=websocket)
                continue
            if event_type != "document.edit":
                continue

            content = str(message.get("content") or "")
            actor_name = str(message.get("actor_name") or user_name)
            current = await db.documents.find_one({"_id": document_id})
            if not current:
                await websocket.close(code=4404)
                return
            revision = int(current.get("collaborative_revision") or 0) + 1
            now = datetime.now(timezone.utc)
            await db.documents.update_one(
                {"_id": document_id},
                {
                    "$set": {
                        "collaborative_content": content,
                        "collaborative_revision": revision,
                        "collaborative_updated_by": actor_name,
                        "collaborative_updated_at": now,
                        "updated_at": now,
                    }
                },
            )
            await record_audit(
                action="document.collaborative_edit",
                actor_name=actor_name,
                policy_id=current.get("policy_id"),
                tramite_code=current.get("tramite_code"),
                task_id=current.get("task_id"),
                document_id=document_id,
                summary=f"Edicion colaborativa en {current.get('title', document_id)}",
                metadata={"revision": revision, "length": len(content)},
            )
            await collaboration_hub.broadcast(
                room_key,
                {
                    "type": "document.edit",
                    "document_id": document_id,
                    "content": content,
                    "revision": revision,
                    "updated_by": actor_name,
                    "updated_at": now.isoformat(),
                },
            )
    except WebSocketDisconnect:
        await collaboration_hub.disconnect(room_key, websocket, connection_id)
    except Exception:
        await collaboration_hub.disconnect(room_key, websocket, connection_id)
