# TalkMe

Chat privado estilo Telegram pensado para un grupo cerrado (familia/amigos),
construido **solo sobre Supabase**: sin servidor propio que mantener vivo.
El frontend (HTML/CSS/JS estático, sin build step) habla directamente con
Supabase para autenticación, datos y tiempo real.

- **Postgres** (Supabase): usuarios, contactos, mensajes — con Row Level
  Security, así que cada quien solo puede leer/escribir lo suyo.
- **Supabase Auth**: login por email + contraseña.
- **Supabase Realtime**: entrega de mensajes y presencia (en línea /
  desconectado) en tiempo real, sin gestionar tú ningún WebSocket.
- **Edge Functions**: registro cerrado con código de invitación, y envío de
  notificaciones **push** al navegador/móvil cuando te llega un mensaje
  (aunque tengas la pestaña cerrada).
- **GitHub Pages**: hosting gratis de los archivos estáticos.

Todo el conjunto cabe en el plan gratuito de Supabase + GitHub Pages: **$0/mes**.

## Cómo funciona la red de contactos

Buscas a alguien por su nombre de usuario y le llega una solicitud. Solo
podéis chatear cuando la otra persona la acepta (o si ya te había pedido a
ti antes, se conecta al instante). Toda esa lógica vive en funciones de
Postgres (`request_contact`, `accept_contact_request`, `send_message`, ver
`supabase/migrations/0001_init.sql`), no en el cliente — así nadie puede
saltársela editando el JavaScript del navegador.

## Puesta en marcha (una sola vez)

### 1. Crear el proyecto en Supabase

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta el contenido de
   `supabase/migrations/0001_init.sql`. Esto crea las tablas, las políticas
   de seguridad (RLS) y las funciones RPC.
3. En **Authentication → Providers → Email**, desactiva *"Allow new users to
   sign up"*. Así nadie puede crear una cuenta saltándose el código de
   invitación llamando directamente a la API de Supabase — solo la Edge
   Function `register` (con la service role) puede crear usuarios.
4. En **Authentication → Providers → Email**, también puedes desactivar la
   confirmación por email si no quieres que cada familiar tenga que
   confirmar su correo (la Edge Function ya crea el usuario con el email
   marcado como confirmado).

### 2. Instalar la CLI de Supabase y desplegar las Edge Functions

```bash
npm install -g supabase
supabase login
supabase link --project-ref TU-PROJECT-REF   # está en la URL del proyecto

# Genera un par de claves VAPID para las notificaciones push
npx web-push generate-vapid-keys

supabase secrets set \
  INVITE_CODE=mi-familia-2026 \
  VAPID_PUBLIC_KEY=xxxx \
  VAPID_PRIVATE_KEY=yyyy \
  VAPID_SUBJECT=mailto:tu-email@ejemplo.com \
  WEBHOOK_SECRET=$(openssl rand -hex 24)

supabase functions deploy register --no-verify-jwt
supabase functions deploy send-push --no-verify-jwt
```

### 3. Conectar el envío automático de push

En el dashboard de Supabase: **Database → Webhooks → Create a new hook**.

- Tabla: `messages`, evento: `Insert`.
- Tipo: *Edge Function* → `send-push`.
- Cabecera HTTP adicional: `x-webhook-secret` = el mismo valor que pusiste
  en `WEBHOOK_SECRET` arriba (así nadie más puede llamar a esa función y
  hacer que envíe pushes falsos).

Cada vez que se inserte un mensaje, Supabase llamará a `send-push`, que
mira las suscripciones push del destinatario y le manda la notificación.

### 4. Publicar en GitHub Pages

El repo trae un workflow (`.github/workflows/pages.yml`) que publica la
carpeta `docs/` automáticamente en cada push a `main`. Solo hace falta
activarlo una vez: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"** (no "Deploy from a branch" — así te ahorras el
desplegable de la carpeta). Al guardar, ve a la pestaña **Actions** del
repo: debería haber (o lanzarse en el próximo push) una ejecución de
"Publicar en GitHub Pages"; cuando termine en verde, tu chat estará en
`https://tu-usuario.github.io/talkme/`. El repo debe ser
público para que Pages funcione en el plan gratuito — no hay ningún secreto
en él (ver "Notas de seguridad" más abajo).

### 5. Configurar la conexión (sin tocar código)

Abre la URL de GitHub Pages tú primero. Como todavía no hay ninguna
configuración guardada, verás un formulario para rellenar:

- **URL del proyecto Supabase** y **anon public key** (Project Settings →
  API).
- **VAPID public key** (la que generaste en el paso 2).
- **Código de invitación** (el mismo `INVITE_CODE` que configuraste como
  secret) — esto es opcional, solo sirve para que venga precargado en el
  enlace que vas a compartir.

Al guardar, la app te da un **enlace único** con todo eso ya incluido.
Ese es el enlace que le mandas a tu familia: al abrirlo, la app se conecta
sola a tu Supabase y les deja directamente en la pantalla de "crear cuenta"
con el código de invitación ya puesto — solo tienen que elegir su usuario,
email y contraseña. Nadie edita archivos ni toca variables de entorno.

Si más adelante quieres volver a coger ese enlace (para invitar a alguien
más), pulsa el icono 🔗 en la barra lateral una vez dentro del chat.

## Probarlo

1. Sigue el paso 5 de arriba y guarda tu propia cuenta con el enlace
   generado.
2. Pulsa el icono 🔔 para activar las notificaciones push (el navegador te
   pedirá permiso una vez).
3. Copia el enlace (🔗) y ábrelo en una ventana de incógnito para simular a
   un familiar; crea una segunda cuenta ahí.
4. Desde la primera cuenta, añade a la segunda por su nombre de usuario.
   Acepta la solicitud desde la otra cuenta.
5. Chatead — los mensajes llegan en tiempo real, y si cierras la pestaña
   del otro, aun así le llega la notificación push al móvil/escritorio.

## Estructura

```
docs/                          Frontend estático (GitHub Pages)
  index.html, style.css, app.js
  sw.js                        Service worker para notificaciones push
supabase/
  migrations/0001_init.sql     Tablas, RLS y funciones RPC
  functions/register/          Edge Function: alta con código de invitación
  functions/send-push/         Edge Function: envía la notificación push
```

No hay ningún archivo de configuración con datos de tu proyecto: la app
guarda la conexión en `localStorage` del navegador tras el primer formulario
(o al abrir un enlace de invitación que ya la trae en la URL).

## Notas de seguridad

- La `anon key`, la URL del proyecto y la `VAPID public key` **no son
  secretos** — Supabase los diseña para ir en el navegador; por eso es
  seguro llevarlos en el enlace de invitación o en `localStorage`. La
  seguridad real la da RLS + las funciones RPC (ver la migración), no
  ocultar esos valores.
- La `service role key` y la `VAPID_PRIVATE_KEY` **nunca** deben ir al
  frontend — solo las usan las Edge Functions, como secrets del lado de
  Supabase (`supabase secrets set`, paso 2). Eso sí sigue siendo un paso
  único en terminal, no algo que gestiones por cada familiar.
- Con "Allow new users to sign up" desactivado, la única puerta de entrada
  es la Edge Function `register`, que exige el código de invitación — el
  mismo código que va precargado en el enlace es el que la función
  comprueba contra el secret `INVITE_CODE`.
- Revisa de vez en cuando los límites gratuitos de Supabase (filas,
  invocaciones de Edge Functions, ancho de banda de Realtime) si el grupo
  familiar crece mucho.
