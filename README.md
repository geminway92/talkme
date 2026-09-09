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
3. (Recomendado) En **Authentication → Providers → Email**, desactiva
   *"Confirm email"* — así cualquiera que se registre entra directo, sin
   tener que confirmar un correo. Si lo dejas activado, cada familiar
   tendrá que pulsar el enlace de su email antes de poder entrar.

Con esto ya está: **no hace falta CLI, ni Edge Functions, ni secrets** para
que el chat funcione. El registro (usuario + email + contraseña + código de
invitación) va directo del navegador a Supabase.

### 2. Publicar en GitHub Pages

El repo trae un workflow (`.github/workflows/pages.yml`) que publica la
carpeta `docs/` automáticamente en cada push a `main`. Solo hace falta
activarlo una vez: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"** (no "Deploy from a branch" — así te ahorras el
desplegable de la carpeta). Al guardar, ve a la pestaña **Actions** del
repo: debería haber (o lanzarse en el próximo push) una ejecución de
"Publicar en GitHub Pages"; cuando termine en verde, tu chat estará en
`https://tu-usuario.github.io/talkme/`. El repo debe ser público para que
Pages funcione en el plan gratuito — no hay ningún secreto en él (ver
"Notas de seguridad" más abajo).

### 3. Configurar la conexión (sin tocar código)

Abre la URL de GitHub Pages tú primero. Como todavía no hay ninguna
configuración guardada, verás un formulario para rellenar:

- **URL del proyecto Supabase** y **anon/publishable key** (Project
  Settings → API).
- **Código de invitación**: el que tú quieras (ej. `mi-familia-2026`) —
  se guarda solo en el enlace, no en Supabase; lo comprueba el propio
  navegador al registrarse.

Pulsa **"Probar conexión"** para confirmar que la URL/key son correctas y
que la tabla `profiles` existe (o sea, que el paso 1 se hizo bien) antes de
seguir.

Al guardar, la app te da un **enlace único** con todo eso ya incluido. Ese
es el enlace que le mandas a tu familia: al abrirlo, la app se conecta sola
a tu Supabase y les deja directamente en la pantalla de "crear cuenta" con
el código de invitación ya puesto — solo eligen su usuario, email y
contraseña. Nadie edita archivos ni toca variables de entorno.

Si más adelante quieres volver a coger ese enlace (para invitar a alguien
más) o corregir un dato mal escrito, usa el icono 🔗 o el enlace "⚙️ Cambiar
configuración" dentro de la app.

## Probarlo

1. Sigue el paso 3 de arriba y crea tu propia cuenta con el enlace generado.
2. Copia el enlace (🔗) y ábrelo en una ventana de incógnito para simular a
   un familiar; crea una segunda cuenta ahí.
3. Desde la primera cuenta, añade a la segunda por su nombre de usuario.
   Acepta la solicitud desde la otra cuenta.
4. Chatead — los mensajes llegan en tiempo real mientras ambos estéis con
   la app abierta.

## Notificaciones push (opcional, requiere un paso extra en servidor)

Sin esto, el chat funciona igual — solo que no te avisa si tienes la
pestaña cerrada. Añadirlo requiere Edge Functions porque firmar el
protocolo Web Push exige una clave privada que nunca puede tocar el
navegador; no hay forma de hacerlo con un simple fetch a la base de datos.

Si más adelante lo quieres, el repo ya trae todo lo necesario en
`supabase/functions/register/` (nota: ya no hace falta para el registro,
solo queda como referencia) y `supabase/functions/send-push/`. Resumen del
proceso (con la CLI de Supabase o pegando el código en el editor web de
Edge Functions del dashboard):

1. `npx web-push generate-vapid-keys` para obtener `VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY`.
2. Crea los secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (`mailto:tu-email@...`) y `WEBHOOK_SECRET` (un valor
   aleatorio) en **Edge Functions → Manage secrets**.
3. Despliega la función `send-push` (código en
   `supabase/functions/send-push/index.ts`), sin verificar JWT.
4. **Database → Webhooks** → nuevo hook sobre `messages`/`Insert` → Edge
   Function `send-push` → cabecera `x-webhook-secret` con el valor del
   paso 2.
5. Añade la `VAPID_PUBLIC_KEY` al formulario de configuración de la app
   (o edítalo con "⚙️ Cambiar configuración") — el botón 🔔 aparecerá solo
   cuando haya una clave configurada.

## Estructura

```
docs/                          Frontend estático (GitHub Pages)
  index.html, style.css, app.js
  sw.js                        Service worker para notificaciones push
supabase/
  migrations/0001_init.sql     Tablas, RLS y funciones RPC
  functions/send-push/         Edge Function opcional: notificaciones push
  functions/register/          Ya no se usa (registro va directo); queda
                                de referencia para quien quiera forzar el
                                código de invitación también en servidor
```

No hay ningún archivo de configuración con datos de tu proyecto: la app
guarda la conexión en `localStorage` del navegador tras el primer formulario
(o al abrir un enlace de invitación que ya la trae en la URL).

## Notas de seguridad

- La `anon key`/`publishable key`, la URL del proyecto y la `VAPID public
  key` **no son secretos** — Supabase los diseña para ir en el navegador;
  por eso es seguro llevarlos en el enlace de invitación o en
  `localStorage`. La seguridad real la da RLS + las funciones RPC (ver la
  migración), no ocultar esos valores.
- El código de invitación en esta configuración por defecto se comprueba
  **en el navegador**, no en el servidor: es una barrera para quien reciba
  el enlace por error, no una protección contra alguien técnico que
  inspeccione el JavaScript. La protección real es que solo tu familia
  tiene el enlace con la URL/key de tu proyecto — sin eso, no hay forma de
  conectarse a tu Supabase. Si quieres que el código se valide también en
  servidor, usa la Edge Function `register` (ver más abajo).
- La `service role key` y la `VAPID_PRIVATE_KEY`, si las llegas a usar,
  **nunca** deben ir al frontend — solo las usan las Edge Functions, como
  secrets del lado de Supabase.
- Revisa de vez en cuando los límites gratuitos de Supabase (filas, ancho
  de banda de Realtime) si el grupo familiar crece mucho.
