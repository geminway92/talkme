// Invocada por un Database Webhook (Database -> Webhooks) en cada INSERT
// sobre la tabla "messages". Manda una notificación push al destinatario si
// tiene alguna suscripción guardada. Protegida con un secreto compartido
// simple en la cabecera x-webhook-secret para que no cualquiera pueda
// disparar pushes llamando a la URL pública de la función.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get('WEBHOOK_SECRET');
  if (expectedSecret && req.headers.get('x-webhook-secret') !== expectedSecret) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const record = payload?.record;
  if (!record?.to_id || !record?.from_id) {
    return new Response('ignored', { status: 200 });
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) {
    console.error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY como secrets de la función');
    return new Response('missing vapid config', { status: 500 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const [{ data: subs }, { data: sender }] = await Promise.all([
    admin.from('push_subscriptions').select('*').eq('user_id', record.to_id),
    admin.from('profiles').select('username').eq('id', record.from_id).maybeSingle(),
  ]);

  const payloadStr = JSON.stringify({
    title: sender?.username || 'TalkMe',
    body: String(record.body || '').slice(0, 200),
  });

  let sent = 0;
  for (const sub of subs || []) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, payloadStr);
      sent++;
    } catch (err: any) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('Error enviando push:', err.statusCode, err.message);
      }
    }
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
