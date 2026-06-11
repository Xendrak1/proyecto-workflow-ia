from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from fastapi import WebSocket


@dataclass
class Room:
    sockets: set[WebSocket] = field(default_factory=set)
    users: dict[str, dict[str, Any]] = field(default_factory=dict)


class CollaborationHub:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = defaultdict(Room)

    async def connect(self, room_key: str, websocket: WebSocket, user_name: str) -> str:
        await websocket.accept()
        connection_id = str(uuid4())
        room = self.rooms[room_key]
        room.sockets.add(websocket)
        room.users[connection_id] = {"id": connection_id, "name": user_name}
        await self.send(websocket, {"type": "presence.state", "users": list(room.users.values())})
        await self.broadcast(
            room_key,
            {"type": "presence.joined", "user": room.users[connection_id], "users": list(room.users.values())},
            exclude=websocket,
        )
        return connection_id

    async def disconnect(self, room_key: str, websocket: WebSocket, connection_id: str) -> None:
        room = self.rooms.get(room_key)
        if not room:
            return
        room.sockets.discard(websocket)
        user = room.users.pop(connection_id, None)
        if user:
            await self.broadcast(room_key, {"type": "presence.left", "user": user, "users": list(room.users.values())})
        if not room.sockets:
            self.rooms.pop(room_key, None)

    async def send(self, websocket: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await websocket.send_json(payload)
        except Exception:
            return

    async def broadcast(self, room_key: str, payload: dict[str, Any], exclude: WebSocket | None = None) -> None:
        room = self.rooms.get(room_key)
        if not room:
            return
        stale: list[WebSocket] = []
        for websocket in list(room.sockets):
            if websocket is exclude:
                continue
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            room.sockets.discard(websocket)


collaboration_hub = CollaborationHub()
