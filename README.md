# TalkMe

Chat privado estilo Telegram construido con Node.js, Express y WebSockets,
pensado para un grupo cerrado (familia/amigos) y no para uso público masivo.
Cada usuario tiene su propia "red": solo puedes chatear con contactos que
hayan aceptado mutuamente tu solicitud.

## Características

- Registro cerrado mediante código de invitación (`INVITE_CODE`) e inicio de
  sesión con contraseña (hash con bcrypt) y JWT.
- Solicitudes de contacto con aceptación mutua: buscas a alguien por su
  usuario, le llega una notificación en tiempo real y solo os podéis
  escribir cuando ambos aceptáis (si el otro ya te había pedido a ti, se
  conecta al instante).
- Chat en tiempo real vía WebSockets (biblioteca `ws`).
- Historial de mensajes persistido en **PostgreSQL** (funciona con el tier
  gratuito de Supabase), para que nada se pierda si el servidor se
  reinicia o se duerme por inactividad.
- Indicador de presencia (en línea / desconectado).
- Frontend en HTML/CSS/JS sin frameworks ni build step.

## Instalación

1. Crea un proyecto gratis en [Supabase](https://supabase.com) (o cualquier
   Postgres gestionado: Neon, Render Postgres, etc.).
2. Copia la cadena de conexión (en Supabase: *Project Settings → Database →
   Connection string → URI*; si tu red bloquea IPv6 usa el "Session pooler").
3. Copia `.env.example` a `.env` y rellena `DATABASE_URL`, `INVITE_CODE` y,
   opcionalmente, `JWT_SECRET`.

```bash
cp .env.example .env
npm install
npm start
```

El servidor crea las tablas automáticamente la primera vez que arranca. Por
defecto escucha en `http://localhost:3000` (o el puerto de `PORT`).

### Variables de entorno

- `DATABASE_URL` **(obligatoria)**: cadena de conexión Postgres.
- `INVITE_CODE`: código que debe introducirse para crear una cuenta. Sin él,
  el registro queda abierto a cualquiera que llegue a la URL — imprescindible
  si vas a exponer el servidor a internet para tu familia.
- `JWT_SECRET`: secreto para firmar las sesiones. Si no lo defines, el
  servidor genera uno automáticamente y lo guarda en la base de datos (tabla
  `settings`), así que sobrevive a reinicios sin que tengas que hacer nada.

```bash
DATABASE_URL=postgresql://... INVITE_CODE=mi-familia-2026 npm start
```

## Cómo probarlo

1. Abre `http://localhost:3000` y crea una cuenta (usuario + contraseña +
   código de invitación).
2. Abre una ventana de incógnito y crea una segunda cuenta con el mismo
   código de invitación.
3. Desde la primera cuenta, usa "Añadir a tu red" con el nombre de la
   segunda. Le llegará como "Solicitud recibida".
4. Desde la segunda cuenta, pulsa ✓ para aceptar. A partir de ahí ambas
   cuentas ven al otro en "Tu red".
5. Selecciona el contacto en la barra lateral y empieza a chatear: los
   mensajes se entregan en tiempo real mientras ambos estén conectados, y
   quedan guardados para cuando el otro se conecte.

## Estructura

```
server/
  index.js   Servidor Express + WebSocket, rutas REST
  db.js      Acceso a PostgreSQL (usuarios, contactos, mensajes, settings)
  auth.js    Registro/verificación de JWT
public/
  index.html Interfaz (login + chat)
  style.css  Estilos
  app.js     Lógica cliente (fetch API + WebSocket)
render.yaml  Plantilla de despliegue para Render
```

## Desplegar gratis en Render

1. Sube el repo a GitHub (ya lo tienes) y crea la base de datos en Supabase
   como se explica arriba.
2. En [Render](https://render.com), *New → Web Service*, conecta el repo.
   Render detecta `render.yaml` automáticamente (build: `npm install`,
   start: `npm start`, plan `free`).
3. En la pestaña *Environment* del servicio, define `DATABASE_URL` e
   `INVITE_CODE` (y `JWT_SECRET` si quieres fijarlo tú).
4. Despliega. La URL pública de Render sirve tanto el frontend como el
   WebSocket (`wss://tu-app.onrender.com/ws`), sin configuración extra.

Ten en cuenta que en el plan free, Render duerme el servicio tras ~15 min sin
tráfico: la primera visita tras la pausa tarda unos segundos en despertar y
cualquier WebSocket abierto en ese momento se corta, pero como los mensajes
ya viven en Postgres no se pierde nada — simplemente hay que reconectar (el
cliente ya reintenta la conexión automáticamente).

## Notas de seguridad

Proyecto pensado para aprendizaje/uso personal en una red de confianza. Antes
de exponerlo más ampliamente, considera: HTTPS/WSS (Render ya lo da por
defecto), limitar intentos de login, y revisar los límites gratuitos de
Supabase/Render si el grupo crece mucho.
