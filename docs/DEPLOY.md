# Despliegue en AWS EC2

Esta guia deja la app corriendo en una sola instancia EC2 Ubuntu 24.04 con:

- `nginx` para servir Angular y hacer proxy a `/api`
- `systemd` para mantener vivo FastAPI
- MongoDB Atlas como base de datos externa
- Google Gemini como proveedor de IA

## 1. Datos que debes tener

- IP publica o DNS de la instancia
- Acceso SSH o EC2 Instance Connect
- El repo publicado en GitHub
- Credenciales reales para:
  - `MONGODB_URI`
  - `JWT_SECRET`
  - `GEMINI_API_KEY`

## 2. Abrir puertos en el Security Group

Minimo:

- `22` SSH
- `80` HTTP
- `443` HTTPS si luego agregas certificado

## 3. Entrar al servidor

Con SSH:

```bash
ssh -i /ruta/a/tu-clave.pem ubuntu@TU_IP_PUBLICA
```

O con EC2 Instance Connect desde la consola de AWS.

## 4. Clonar el proyecto

```bash
git clone https://github.com/Xendrak1/proyecto-workflow-ia.git
cd proyecto-workflow-ia
```

## 5. Ejecutar el instalador base

```bash
chmod +x deploy/aws/install-ec2.sh
./deploy/aws/install-ec2.sh
```

Ese script:

- instala Python, `venv`, `nginx`, `git`, `nodejs` y `npm`
- crea el entorno virtual del backend
- instala dependencias Python
- instala dependencias del frontend
- compila Angular en modo produccion
- copia la configuracion de `systemd`
- copia la configuracion de `nginx`

## 6. Crear el `.env` del backend

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Ejemplo base:

```env
APP_NAME=Workflow IA API
APP_ENV=production
APP_PORT=8000
DB_PASSWORD=TU_PASSWORD
MONGODB_URI=mongodb+srv://admin_eduardo:${DB_PASSWORD}@primer-parcial-mongodb.gsonomu.mongodb.net/?appName=primer-parcial-mongodb
MONGODB_DB=workflow_ia
JWT_SECRET=CAMBIA_ESTO_POR_UNA_CLAVE_LARGA
JWT_EXPIRE_MINUTES=1440
GEMINI_API_KEY=TU_API_KEY
GEMINI_MODEL=gemini-2.5-flash
ALLOWED_ORIGINS=http://TU_IP_PUBLICA,http://TU_DOMINIO
```

## 7. Ajustar Nginx

Editar:

```bash
sudo nano /etc/nginx/sites-available/workflow-ia
```

Y reemplazar:

- `SERVER_NAME_PLACEHOLDER`
- `ROOT_PATH_PLACEHOLDER`

Por ejemplo:

- `SERVER_NAME_PLACEHOLDER` -> `_` o tu dominio
- `ROOT_PATH_PLACEHOLDER` -> `/home/ubuntu/proyecto-workflow-ia`

## 8. Habilitar y arrancar servicios

```bash
sudo systemctl daemon-reload
sudo systemctl enable workflow-ia
sudo systemctl restart workflow-ia

sudo ln -sf /etc/nginx/sites-available/workflow-ia /etc/nginx/sites-enabled/workflow-ia
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

## 9. Verificar

Backend:

```bash
curl http://127.0.0.1:8000/health
```

Frontend desde tu PC:

```text
http://TU_IP_PUBLICA
```

API desde tu PC:

```text
http://TU_IP_PUBLICA/health
```

## 10. Actualizar el servidor luego

```bash
cd ~/proyecto-workflow-ia
chmod +x deploy/aws/deploy-from-github.sh
./deploy/aws/deploy-from-github.sh
```

## Logs utiles

```bash
sudo systemctl status workflow-ia
sudo journalctl -u workflow-ia -f
sudo tail -f /var/log/nginx/error.log
```

## Notas

- Las evidencias se guardan localmente en `backend/uploads/`.
- Si luego quieres algo mas robusto, lo natural es mover evidencias a S3.
- Para HTTPS puedes agregar `certbot` despues de confirmar que HTTP funciona bien.
