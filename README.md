# TalkMe

Chat privado estilo Telegram pensado para un grupo cerrado (familia/amigos),
construido **solo sobre Supabase**: sin servidor propio que mantener vivo.
El frontend (HTML/CSS/JS estático, sin build step) habla directamente con
Supabase para los datos y el tiempo real.

- **Postgres** (Supabase): usuarios, contactos, mensajes.
- **Identidad propia, sin Supabase Auth**: al crear tu cuenta se te da un
  **ID numérico** (como un teléfono) y eliges un **PIN**. Tu nombre es solo
  un alias que puedes cambiar cuando quieras sin que afecte a tus contactos.
- **Supabase Realtime**: entrega de mensajes y presencia (en línea /
  desconectado) en tiempo real, sin gestionar tú ningún WebSocket.
- **GitHub Pages**: hosting gratis de los archivos estáticos.

Todo el conjunto cabe en el plan gratuito de Supabase + GitHub Pages: **$0/mes**.

## ⚠️ Sobre la seguridad de este modelo

Esto es una elección deliberada de simplicidad, no un descuido:

- No hay ninguna sesión "de verdad" verificada por el servidor. El PIN es
  un candado dentro de la propia app, no una credencial que Postgres pueda
  comprobar por su cuenta.
- Como consecuencia, **no hay RLS** (Row Level Security) protegiendo las
  tablas: cualquiera que tenga la `anon key` de tu proyecto (la misma que
  lleva el enlace que compartes con tu familia) podría, técnicamente,
  leer o escribir la base de datos directamente sin pasar por la app.
- La protección real es que **solo tu familia tiene el enlace** con la
  URL/key de tu proyecto. Es apropiado para un grupo de confianza y datos
  sin importancia; no lo uses para nada sensible.

## Cómo funciona la identidad y la red de contactos

- **Crear identidad**: eliges un nombre (alias) y un PIN; la app te genera
  un ID numérico único y te dice cuál es. Guárdalo — es como tu número de
  teléfono: se lo das a quien quieras que te añada.
- **Entrar en otro dispositivo**: con tu ID + tu PIN. El ID se recuerda en
  ese dispositivo (verás una pantalla de "candado" pidiendo solo el PIN la
  próxima vez); si olvidas el PIN no hay recuperación — tendrías que crear
  una identidad nueva y volver a pasar tu (nuevo) ID a tus contactos.
- **Añadir a alguien**: pides su ID (no su nombre, que puede repetirse o
  cambiar) y le llega una solicitud. Solo podéis chatear cuando la acepta
  (o si ya te había pedido a ti antes, se conecta al instante). Esta
  lógica vive en funciones de Postgres (`request_contact`,
  `accept_contact_request`, `send_message`, ver
  `supabase/migrations/0002_no_auth_identity.sql`), no en el cliente.

## Puesta en marcha (una sola vez)

### 1. Crear el proyecto en Supabase

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega y ejecuta el contenido de
   `supabase/migrations/0002_no_auth_identity.sql`. Esto crea las tablas
   (`users`, `contacts`, `contact_requests`, `messages`,
   `push_subscriptions`) y las funciones RPC.

No hace falta tocar nada de **Authentication** — no se usa Supabase Auth.

### 2. Publicar en GitHub Pages

El repo trae un workflow (`.github/workflows/pages.yml`) que publica la
carpeta `docs/` automáticamente en cada push a `main`. Solo hace falta
activarlo una vez: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"** (no "Deploy from a branch" — así te ahorras el
desplegable de la carpeta). Al guardar, ve a la pestaña **Actions** del
repo: debería haber (o lanzarse en el próximo push) una ejecución de
"Publicar en GitHub Pages"; cuando termine en verde, tu chat estará en
`https://tu-usuario.github.io/talkme/`. El repo debe ser público para que
Pages funcione en el plan gratuito — no hay ningún secreto en él.

### 3. Configurar la conexión (sin tocar código)

Abre la URL de GitHub Pages tú primero. Como todavía no hay ninguna
configuración guardada, verás un formulario para rellenar:

- **URL del proyecto Supabase** y **anon/publishable key** (Project
  Settings → API).
- **Código de invitación**: el que tú quieras (ej. `mi-familia-2026`) —
  se guarda solo en el enlace; lo comprueba el propio navegador al crear
  una identidad nueva.

Pulsa **"Probar conexión"** para confirmar que la URL/key son correctas y
que la tabla `users` existe (o sea, que el paso 1 se hizo bien) antes de
seguir.

Al guardar, la app te da un **enlace único** con todo eso ya incluido. Ese
es el enlace que le mandas a tu familia: al abrirlo, la app se conecta sola
a tu Supabase y les deja directamente en la pantalla de "crear identidad"
con el código de invitación ya puesto — solo eligen su nombre y un PIN.
Nadie edita archivos ni toca variables de entorno.

Si más adelante quieres volver a coger ese enlace (para invitar a alguien
más) o corregir un dato mal escrito, usa el icono 🔗 o el enlace "⚙️ Cambiar
configuración" dentro de la app.

## Probarlo

1. Sigue el paso 3 de arriba y crea tu propia identidad con el enlace
   generado. Apunta el ID que te da la app.
2. Copia el enlace (🔗) y ábrelo en una ventana de incógnito para simular a
   un familiar; crea una segunda identidad ahí.
3. Desde la primera cuenta, añade a la segunda por su **ID** (no su
   nombre). Acepta la solicitud desde la otra cuenta.
4. Chatead — los mensajes llegan en tiempo real mientras ambos estéis con
   la app abierta.

## Notificaciones push (opcional, requiere un paso extra en servidor)

Sin esto, el chat funciona igual — solo que no te avisa si tienes la
pestaña cerrada. Añadirlo requiere una Edge Function porque firmar el
protocolo Web Push exige una clave privada que nunca puede tocar el
navegador; no hay forma de hacerlo con un simple fetch a la base de datos.

Si más adelante lo quieres, el repo trae `supabase/functions/send-push/`.
Resumen del proceso (con la CLI de Supabase o pegando el código en el
editor web de Edge Functions del dashboard):

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
docs/                              Frontend estático (GitHub Pages)
  index.html, style.css, app.js
  sw.js                            Service worker para notificaciones push
supabase/
  migrations/0001_init.sql         Versión antigua con Supabase Auth (ya no se usa)
  migrations/0002_no_auth_identity.sql
                                    Esquema actual: identidad por ID+PIN, sin Auth
  functions/send-push/             Edge Function opcional: notificaciones push
  functions/register/              Ya no se usa (era para la versión con Auth)
```

No hay ningún archivo de configuración con datos de tu proyecto: la app
guarda la conexión en `localStorage` del navegador tras el primer formulario
(o al abrir un enlace de invitación que ya la trae en la URL). Tu ID
también se guarda en `localStorage`; el PIN nunca se guarda, se pide cada
vez que abres la app.

## Notas de seguridad (resumen)

- La `anon key`/`publishable key`, la URL del proyecto y la `VAPID public
  key` **no son secretos** — Supabase los diseña para ir en el navegador.
- Sin Supabase Auth ni RLS, la seguridad de este chat depende por completo
  de que el enlace (con la URL/key de tu proyecto) no se difunda más allá
  de tu familia. Ver el aviso al principio de este documento.
- La `service role key` y la `VAPID_PRIVATE_KEY`, si llegas a usar la
  parte opcional de push, **nunca** deben ir al frontend — solo las usa la
  Edge Function, como secrets del lado de Supabase.
- Revisa de vez en cuando los límites gratuitos de Supabase (filas, ancho
  de banda de Realtime) si el grupo familiar crece mucho.
