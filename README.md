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
- Historial de mensajes persistido en `data/db.json` (escritura atómica).
- Indicador de presencia (en línea / desconectado).
- Frontend en HTML/CSS/JS sin frameworks ni build step.

## Instalación

```bash
npm install
npm start
```

El servidor arranca en `http://localhost:3000` (o el puerto de la variable
`PORT`).

### Variables de entorno recomendadas para uso privado

- `INVITE_CODE`: código que debe introducirse para crear una cuenta. Sin él,
  el registro queda abierto a cualquiera que llegue a la URL — imprescindible
  si vas a exponer el servidor a internet para tu familia.
- `JWT_SECRET`: secreto para firmar las sesiones. Si no lo defines, el
  servidor genera uno automáticamente en `data/jwt-secret.txt` (no se
  versiona) y lo reutiliza entre reinicios; en un despliegue con múltiples
  instancias, define el mismo valor en todas para que las sesiones sean
  válidas en cualquiera.

```bash
INVITE_CODE=mi-familia-2026 JWT_SECRET=$(openssl rand -hex 48) npm start
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
  db.js      Persistencia simple en JSON (usuarios, contactos, mensajes)
  auth.js    Registro/verificación de JWT
public/
  index.html Interfaz (login + chat)
  style.css  Estilos
  app.js     Lógica cliente (fetch API + WebSocket)
data/
  db.json    Base de datos (se crea sola, no se versiona)
```

## Notas de seguridad

Proyecto pensado para aprendizaje/uso personal en una red de confianza. Antes
de exponerlo en internet, considera: usar HTTPS/WSS, limitar intentos de
login, y una base de datos real si esperas más de un puñado de usuarios.
