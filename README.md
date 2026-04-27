# Proyecto Workflow IA

Base inicial del proyecto del primer parcial.

## Estructura

- `backend/`: API en FastAPI y modelos para MongoDB.

## Base de datos

La conexion a MongoDB Atlas se configura con variables de entorno.

1. Copiar `backend/.env.example` a `backend/.env`
2. Reemplazar `DB_PASSWORD` por la contrasena real del usuario `admin_eduardo`
3. Ejecutar el backend

URI base esperada:

`mongodb+srv://admin_eduardo:${DB_PASSWORD}@primer-parcial-mongodb.gsonomu.mongodb.net/?appName=primer-parcial-mongodb`

## Modulos iniciales

- Seguridad
- Configuracion
- Operacion
- Analitica
