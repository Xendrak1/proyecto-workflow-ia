import base64
import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app.core.config import settings


class StoredFile:
    def __init__(
        self,
        *,
        file_name: str,
        file_url: str,
        content_type: str | None,
        size_bytes: int,
        checksum_sha256: str,
        storage_provider: str,
        storage_bucket: str | None,
        storage_key: str,
    ) -> None:
        self.file_name = file_name
        self.file_url = file_url
        self.content_type = content_type
        self.size_bytes = size_bytes
        self.checksum_sha256 = checksum_sha256
        self.storage_provider = storage_provider
        self.storage_bucket = storage_bucket
        self.storage_key = storage_key


uploads_root = Path(__file__).resolve().parents[2] / "uploads" / "documents"


def infer_document_type(file_name: str, content_type: str | None = None) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix in {".doc", ".docx", ".odt"}:
        return "word"
    if suffix in {".xls", ".xlsx", ".csv", ".ods"}:
        return "spreadsheet"
    if suffix == ".pdf":
        return "pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return "image"
    if suffix in {".txt", ".md"} or (content_type or "").startswith("text/"):
        return "text"
    return "other"


def store_document_file(
    *,
    document_id: str,
    version_number: int,
    file_name: str,
    file_base64: str,
    content_type: str | None = None,
) -> StoredFile:
    safe_name = Path(file_name or "documento.bin").name
    try:
        content = base64.b64decode(file_base64)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Archivo base64 invalido") from exc

    checksum = hashlib.sha256(content).hexdigest()
    extension = Path(safe_name).suffix
    stored_name = f"v{version_number}-{uuid4().hex}{extension}"
    object_key = f"documents/{document_id}/{stored_name}"

    provider = settings.document_storage_provider.lower()
    if provider not in {"local", "s3"}:
        provider = "local"

    # S3-ready: while AWS is not configured, persist locally using the same object key.
    # Later this function is the only place that needs a boto3 put_object call.
    target = uploads_root / document_id / stored_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

    return StoredFile(
        file_name=safe_name,
        file_url=f"/uploads/{object_key}",
        content_type=content_type,
        size_bytes=len(content),
        checksum_sha256=checksum,
        storage_provider="s3" if provider == "s3" else "local",
        storage_bucket=settings.aws_s3_bucket,
        storage_key=object_key,
    )
