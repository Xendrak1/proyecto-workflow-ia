# Backend - Workflow IA

API REST construida con **FastAPI**. Maneja toda la lógica del sistema: autenticación, políticas de workflow, trámites, tareas, evidencias y la integración con Google Gemini.

## ¿Qué hay en cada carpeta?

```
backend/
├── app/                ← Todo el código de la aplicación
│   ├── core/           ← Configuración (lee variables de entorno)
│   ├── db/             ← Conexión a MongoDB Atlas
│   ├── models/         ← "Forma" de los datos (qué campos tiene un usuario, una tarea, etc.)
│   ├── routes/         ← Endpoints HTTP (las URLs de la API)
│   ├── services/       ← Lógica de negocio (las reglas del sistema)
│   └── main.py         ← Punto de entrada: arma la app FastAPI
│
├── scripts/            ← Scripts de mantenimiento (crear índices, datos de prueba)
├── uploads/            ← Donde se guardan las evidencias subidas (NO va al repo)
├── .env                ← Tus credenciales reales (NO va al repo)
├── .env.example        ← Plantilla de variables de entorno
├── requirements.txt    ← Lista de dependencias de Python
└── run.py              ← Launcher para desarrollo (arranca uvicorn con reload)
```

## Detalle de cada subcarpeta de `app/`

### `core/`
La configuración global. Lee el `.env` y expone un objeto `settings` que el resto del código usa.

### `db/`
Conexión a MongoDB Atlas usando **Motor** (driver async). Define cómo se conecta y se desconecta la app de la base de datos.

### `models/`
Esquemas **Pydantic**. Definen qué forma tienen los datos que entran y salen de la API. Por ejemplo, `user.py` dice que un usuario tiene `email`, `name`, `role`, etc.

| Archivo | Qué describe |
| --- | --- |
| `user.py` | Usuarios y roles |
| `policy.py` | Políticas de workflow (nodos, transiciones, formularios) |
| `tramite.py` | Trámites en curso y sus tareas |
| `analytics.py` | Resúmenes y métricas |
| `ai.py` | Estructuras para sugerencias de IA |
| `common.py` | Tipos compartidos (response wrapper, paginación, etc.) |

### `routes/`
Los **endpoints HTTP**. Cada archivo agrupa las URLs de un dominio y delega la lógica a `services/`.

| Archivo | Prefijo | Qué expone |
| --- | --- | --- |
| `auth.py` | `/api/auth` | Login y emisión de JWT |
| `users.py` | `/api/users` | Gestión de usuarios |
| `policies.py` | `/api/policies` | CRUD de políticas y nodos |
| `tramites.py` | `/api/tramites` | Iniciar y consultar trámites |
| `tasks.py` | `/api/tasks` | Tareas asignadas, completar, subir evidencias |
| `ai.py` | `/api/ai` | Sugerencias de Gemini (workflow + autocompletado) |
| `analytics.py` | `/api/analytics` | Resúmenes y cuellos de botella |

### `services/`
La **lógica de negocio**. Aquí viven las reglas del sistema: cómo se valida una política, cómo avanza un trámite cuando se completa una tarea, cómo se hashea una contraseña, etc.

| Archivo | Responsabilidad |
| --- | --- |
| `security.py` | Hash de contraseñas + JWT (firma y verificación) |
| `policy_service.py` | Crear, validar y publicar políticas |
| `tramite_service.py` | Crear trámites y enrutar tareas según el workflow |
| `ai_service.py` | Llamadas a Google Gemini (texto y audio) |
| `common.py` | Helpers compartidos |

## Cómo correrlo en local

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/Mac

pip install -r requirements.txt

copy .env.example .env          # Windows
# cp .env.example .env          # Linux/Mac

# Editar .env con tus credenciales reales

python run.py
```

La API queda en `http://127.0.0.1:8000`. La documentación interactiva se autogenera en:

- `http://127.0.0.1:8000/docs` - Swagger UI
- `http://127.0.0.1:8000/redoc` - ReDoc

## Endpoints clave

- `GET /health` - Healthcheck (devuelve estado y entorno)
- `POST /api/auth/login` - Login (devuelve JWT)
- `GET /api/tasks` - Lista de tareas del usuario autenticado
- `POST /api/tasks/{id}/complete` - Cierra la tarea y avanza el workflow
- `POST /api/ai/workflow-suggestion` - Pide a Gemini un workflow sugerido a partir de un prompt
- `POST /api/ai/task-form-fill-audio` - Transcribe audio y rellena un formulario

## Scripts de mantenimiento

```bash
python scripts/init_db.py             # Crea índices en MongoDB
python scripts/seed_sample_policy.py  # Inserta una política de ejemplo
```
