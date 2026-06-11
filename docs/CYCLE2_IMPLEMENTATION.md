# Ciclo 2 - Mejoras Implementadas

## Gestion documental

Se agrego un repositorio documental asociado a politicas, tramites, tareas y nodos del workflow.

Capacidades:

- Carga de documentos por tramite.
- Control de versiones por documento.
- Metadatos por documento mediante `properties`.
- Permisos por rol, departamento o usuario.
- Auditoria de creacion, consulta, versionado y cambios de permisos.
- Preparado para mover almacenamiento local a S3.

Endpoints principales:

- `GET /api/documents`
- `POST /api/documents`
- `POST /api/documents/{document_id}/versions`
- `PUT /api/documents/{document_id}/permissions`
- `GET /api/audit`

## Motor inteligente

Se agrego una capa de inteligencia operativa que simula un motor de Deep Learning usando Gemini y heuristicas locales.

Capacidades:

- Prediccion de nodos en riesgo.
- Priorizacion de tareas.
- Deteccion de anomalias por demora u observacion.
- Recomendacion de ruta critica.
- Reportes por prompt para consultas operativas.

Endpoints:

- `GET /api/analytics/routing-intelligence`
- `POST /api/analytics/intelligent-report`

El campo `model_type` devuelve `deep-learning-simulado-gemini` para dejar claro que el prototipo puede migrar a TensorFlow sin cambiar la experiencia de usuario.

## Preparacion AWS

Variables agregadas:

```env
DOCUMENT_STORAGE_PROVIDER=local
AWS_REGION=sa-east-1
AWS_S3_BUCKET=
DYNAMODB_AUDIT_TABLE=
```

Siguiente paso para nube:

1. Crear bucket S3 para documentos.
2. Crear tabla DynamoDB para auditoria si se decide separar auditoria de MongoDB.
3. Crear IAM role o usuario con permisos de `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` y operaciones DynamoDB.
4. Cambiar `DOCUMENT_STORAGE_PROVIDER=s3`.
5. Conectar `document_storage.py` a `boto3`.

En esta version, los archivos siguen guardandose en `backend/uploads/documents`, pero usan `storage_key` compatible con S3.
