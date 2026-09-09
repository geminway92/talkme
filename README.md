# TalkMe

Chat sencillo estilo Telegram construido con Node.js, Express y WebSockets.
Cada usuario tiene su propia "red": solo puedes chatear con los contactos que
tú mismo añades por nombre de usuario.

## Características

- Registro e inicio de sesión con contraseña (hash con bcrypt) y JWT.
- Añadir contactos a tu red buscando por nombre de usuario.
- Chat en tiempo real vía WebSockets (biblioteca `ws`).
- Historial de mensajes persistido en `data/db.json`.
- Indicador de presencia (en línea / desconectado).
- Frontend en HTML/CSS/JS sin frameworks ni build step.

## Instalación

```bash
npm install
npm start
```

El servidor arranca en `http://localhost:3000` (o el puerto de la variable
`PORT`).

Opcional: define `JWT_SECRET` en el entorno para producción; si no se
define se usa un valor de desarrollo con un aviso en consola.

## Cómo probarlo

1. Abre `http://localhost:3000` y crea una cuenta (usuario + contraseña).
2. Abre una ventana de incógnito y crea una segunda cuenta.
3. En cada cuenta, usa el campo "Añadir a tu red" para introducir el nombre
   de usuario de la otra cuenta.
4. Selecciona el contacto en la barra lateral y empieza a chatear: los
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
