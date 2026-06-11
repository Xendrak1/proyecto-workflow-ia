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

    # Keep a local mirror so the current UI can open files even when S3 is private.
    target = uploads_root / document_id / stored_name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

    stored_provider = "local"
    if provider == "s3" and settings.aws_s3_bucket:
        try:
            import boto3  # type: ignore[import]

            extra_args: dict[str, str] = {}
            if content_type:
                extra_args["ContentType"] = content_type
            s3 = boto3.client("s3", region_name=settings.aws_region)
            s3.put_object(
                Bucket=settings.aws_s3_bucket,
                Key=object_key,
                Body=content,
                **extra_args,
            )
            stored_provider = "s3"
        except Exception:
            stored_provider = "local"

    return StoredFile(
        file_name=safe_name,
        file_url=f"/uploads/{object_key}",
        content_type=content_type,
        size_bytes=len(content),
        checksum_sha256=checksum,
        storage_provider=stored_provider,
        storage_bucket=settings.aws_s3_bucket,
        storage_key=object_key,
    )
