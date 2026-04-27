# Frontend - Workflow IA

Aplicación web para administradores y supervisores. Construida con **Angular 19** usando **standalone components** y **lazy loading** (solo carga el código de la pantalla que estás viendo).

## ¿Qué hay en cada carpeta?

```
frontend/
├── src/
│   ├── app/                    ← Todo el código de la aplicación
│   │   ├── core/               ← Servicios globales (uno solo de cada uno en toda la app)
│   │   ├── shared/             ← Componentes reutilizables (se usan en varias pantallas)
│   │   ├── layout/             ← El "esqueleto" de la app (sidebar, topbar)
│   │   ├── pages/              ← Las pantallas (cada feature en su propia carpeta)
│   │   ├── app.component.ts    ← Componente raíz
│   │   ├── app.config.ts       ← Configuración de la app (interceptors, providers)
│   │   └── app.routes.ts       ← Mapa de URLs → pantallas
│   │
│   ├── index.html              ← HTML inicial (donde se monta Angular)
│   ├── main.ts                 ← Punto de entrada del bundle
│   └── styles.scss             ← Estilos globales (colores, tipografía, tokens)
│
├── public/                     ← Assets estáticos (favicon, imágenes)
├── angular.json                ← Config del Angular CLI (build, serve, test)
├── proxy.conf.json             ← Redirige /api a 127.0.0.1:8000 en desarrollo
├── package.json                ← Dependencias y scripts npm
└── tsconfig*.json              ← Configuración de TypeScript
```

## Detalle de cada subcarpeta de `src/app/`

### `core/`
Servicios **globales** que se usan en toda la app y existen en una sola instancia (singletons).

| Archivo | Para qué sirve |
| --- | --- |
| `api.service.ts` | Único punto que llama al backend. Todos los componentes piden datos a través de él. |
| `api.models.ts` | Tipos TypeScript que describen las respuestas del backend (User, Task, Policy, etc.) |
| `auth.guard.ts` | Bloquea pantallas si el usuario no está logueado o no tiene el rol requerido |
| `auth.interceptor.ts` | Agrega automáticamente el token JWT a cada llamada al backend |
| `session.service.ts` | Guarda y lee el usuario actual (en `localStorage`) |
| `toast.service.ts` | Muestra notificaciones tipo "guardado correctamente" |

### `shared/`
Componentes **reutilizables** que pueden aparecer en cualquier pantalla.

| Archivo | Qué es |
| --- | --- |
| `icon.component.ts` | Componente envoltorio para usar íconos SVG |
| `toast-host.component.ts` | El contenedor que muestra los toasts en pantalla |

### `layout/`
El **chrome** de la app: lo que envuelve a todas las pantallas (sidebar, topbar, contenedor central).

- `shell.component.*` - El layout principal cuando ya estás logueado.

### `pages/`
Las **pantallas** de la app, una carpeta por feature. Cada una se carga **bajo demanda** (lazy) cuando navegás a su URL.

| Carpeta | URL | Qué hace |
| --- | --- | --- |
| `login/` | `/login` | Pantalla de inicio de sesión |
| `inbox/` | `/app/inbox` | Bandeja de tareas pendientes del usuario |
| `inbox/` (detail) | `/app/inbox/:taskId` | Detalle de una tarea: completar formulario, subir evidencia |
| `policies/` | `/app/policies` | Listado de políticas de workflow |
| `policies/` (designer) | `/app/policies/:id` | Diseñador visual de una política (nodos, transiciones) |
| `tramites/` | `/app/tramites` | Listado de trámites en curso |
| `tramites/` (detail) | `/app/tramites/:code` | Detalle de un trámite y sus tareas |
| `analytics/` | `/app/analytics` | Resumen del sistema y cuellos de botella |
| `team/` | `/app/team` | Gestión de usuarios (solo admin) |

Cada carpeta de feature contiene **3 archivos**:

- `*.component.ts` - La lógica (clase TypeScript)
- `*.component.html` - El template (vista)
- `*.component.scss` - Los estilos (CSS con preprocesador Sass)

## Cómo correrlo en local

```bash
npm install                # solo la primera vez
npm start                  # arranca en http://localhost:4200
```

`npm start` usa `proxy.conf.json` para que las llamadas a `/api/...` se redirijan automáticamente al backend en `http://127.0.0.1:8000`. Esto evita problemas de CORS en desarrollo.

> Asegurate de tener el backend corriendo en paralelo (`python run.py` en `../backend`).

## Cómo compilar para producción

```bash
npm run build:prod
```

El resultado queda en `dist/frontend/browser/` listo para subir a Nginx, S3 o cualquier servidor de estáticos.

## Comandos útiles

| Comando | Qué hace |
| --- | --- |
| `npm start` | Servidor de desarrollo con auto-reload |
| `npm run build` | Build de desarrollo |
| `npm run build:prod` | Build optimizado para producción |
| `npm test` | Tests unitarios (Karma + Jasmine) |
| `npm run watch` | Build en modo watch (recompila al cambiar archivos) |
