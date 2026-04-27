# Workflow IA

Sistema de gestión de trámites con flujo de trabajo configurable y asistente de IA (Google Gemini) para sugerencias de políticas y autocompletado de formularios por dictado de voz.

## ¿Qué hay en este repositorio?

Tres componentes que trabajan juntos:

```
proyecto-workflow-ia/
│
├── backend/      ← La API: recibe peticiones y habla con la base de datos
├── frontend/     ← La web (vista de admin/supervisor en el navegador)
│
└── (la app móvil vive en otro repo:
    https://github.com/Xendrak1/workflow_ia_mobile )
```

| Componente | Tecnología | Para qué sirve |
| --- | --- | --- |
| `backend/` | FastAPI (Python) + MongoDB Atlas | Atiende todas las llamadas a la API. Guarda usuarios, políticas, trámites, tareas y evidencias. |
| `frontend/` | Angular 19 | Web para administradores y supervisores: diseñar políticas, ver el flujo, monitorear cuellos de botella. |
| App móvil | Flutter | Para los funcionarios en campo: ver sus tareas, completar formularios, subir evidencias, dictar por voz. |

## Stack tecnológico

- **Backend**: FastAPI · Uvicorn · Motor (Mongo async) · Pydantic v2 · JWT · Google Gemini API
- **Frontend**: Angular 19 (standalone components, lazy loading)
- **Base de datos**: MongoDB Atlas (cloud, sin instalación local)
- **IA**: Google Gemini 2.x (sugerencias de workflow + transcripción de audio)
- **Despliegue**: AWS EC2 (Ubuntu 24.04 + Nginx + systemd)

## Cómo correrlo en tu PC (desarrollo)

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # En Windows
pip install -r requirements.txt
copy .env.example .env           # y editá el .env con tus credenciales
python run.py                    # arranca en http://127.0.0.1:8000
```

Más detalle: `backend/README.md`

### 2. Frontend

```bash
cd frontend
npm install
npm start                        # arranca en http://localhost:4200
```

El `proxy.conf.json` redirige automáticamente las llamadas a `/api` hacia `http://127.0.0.1:8000`, así no hay problemas de CORS.

Más detalle: `frontend/README.md`

### 3. App móvil

Repo separado: `workflow_ia_mobile`. Por defecto apunta a `http://10.0.2.2:8000/api` (alias del emulador Android al backend local).

Para apuntarla al servidor de producción:

```bash
flutter run --dart-define=API_BASE=http://<ip-del-servidor>/api
```

## Variables de entorno (backend)

Crear `backend/.env` a partir de `backend/.env.example`:

| Variable | Para qué |
| --- | --- |
| `APP_NAME` | Nombre que aparece en los logs y el `/health` |
| `APP_ENV` | `development` o `production` |
| `APP_PORT` | Puerto donde escucha Uvicorn (8000 por defecto) |
| `DB_PASSWORD` | Contraseña del usuario `admin_eduardo` en Mongo Atlas |
| `MONGODB_URI` | Connection string de Mongo Atlas (usa `${DB_PASSWORD}`) |
| `MONGODB_DB` | Nombre de la base de datos |
| `JWT_SECRET` | Clave para firmar tokens (poner una larga y aleatoria en producción) |
| `JWT_EXPIRE_MINUTES` | Cuánto dura un token tras el login |
| `GEMINI_API_KEY` | API key de Google AI Studio para las funciones de IA |

## Despliegue en AWS

Ver [docs/DEPLOY.md](docs/DEPLOY.md). Resumen de la arquitectura:

```
Internet ──(HTTP 80)──► Nginx (en EC2 Ubuntu 24.04)
                          │
                          ├─► Sirve estáticos del frontend (dist/)
                          │
                          └─► proxy_pass /api/* ──► Uvicorn (127.0.0.1:8000)
                                                       │
                                                       ├─► MongoDB Atlas
                                                       └─► Google Gemini API
```

## Roles y permisos

| Rol | Qué puede hacer |
| --- | --- |
| `administrador` | Todo: usuarios, políticas, trámites, analytics |
| `supervisor` | Diseñar y validar políticas, ver analytics |
| `funcionario` | Ver tareas asignadas, completar formularios, subir evidencias |

## Licencia

Proyecto académico (Primer Parcial - UAGRM/FICCT).
