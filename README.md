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

### 4. Configurar el frontend

Edita `docs/config.js` con los datos de tu proyecto (**Project Settings →
API**): `SUPABASE_URL`, la `anon` `SUPABASE_ANON_KEY`, y el mismo
`VAPID_PUBLIC_KEY` que generaste antes.

### 5. Publicar en GitHub Pages

Sube los cambios a GitHub y activa Pages: **Settings → Pages → Source:
Deploy from a branch → Branch: `main`, carpeta `/docs`**. En unos minutos
tu chat estará en `https://tu-usuario.github.io/talkme/`.

## Probarlo

1. Abre la URL de GitHub Pages, crea una cuenta (usuario + email +
   contraseña + código de invitación).
2. Pulsa el icono 🔔 para activar las notificaciones push (el navegador te
   pedirá permiso una vez).
3. Repite en una ventana de incógnito con una segunda cuenta.
4. Desde la primera, añade a la segunda por su nombre de usuario. Acepta la
   solicitud desde la otra cuenta.
5. Chatead — los mensajes llegan en tiempo real, y si cierras la pestaña
   del otro, aun así le llega la notificación push al móvil/escritorio.

## Estructura

```
docs/                          Frontend estático (GitHub Pages)
  index.html, style.css, app.js
  sw.js                        Service worker para notificaciones push
  config.js                    URL/claves públicas de tu proyecto Supabase
supabase/
  migrations/0001_init.sql     Tablas, RLS y funciones RPC
  functions/register/          Edge Function: alta con código de invitación
  functions/send-push/         Edge Function: envía la notificación push
```

## Notas de seguridad

- La `anon key` de Supabase es pública por diseño (va en el JS del
  navegador); la seguridad la da RLS + las funciones RPC, no ocultar esa
  clave.
- La `service role key` **nunca** debe ir al frontend — solo la usan las
  Edge Functions, como secret del lado de Supabase.
- Con "Allow new users to sign up" desactivado, la única puerta de entrada
  es la Edge Function `register`, que exige el código de invitación.
- Revisa de vez en cuando los límites gratuitos de Supabase (filas,
  invocaciones de Edge Functions, ancho de banda de Realtime) si el grupo
  familiar crece mucho.
