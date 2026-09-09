// Registro con código de invitación. Se ejecuta con la service role para
// poder crear el usuario de Auth directamente (los altas públicas están
// desactivadas en el proyecto de Supabase; ver README). El cliente, tras
// una respuesta ok, hace signInWithPassword() para obtener su sesión.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const username = String(body.username || '').trim();
  const inviteCode = String(body.inviteCode || '');

  if (!email || !password || password.length < 4 || !username || username.length < 3) {
    return json({ error: 'Email, usuario (min 3) y contraseña (min 4) son obligatorios' }, 400);
  }

  const requiredInvite = Deno.env.get('INVITE_CODE');
  if (requiredInvite && inviteCode !== requiredInvite) {
    return json({ error: 'Código de invitación incorrecto' }, 403);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existingProfile) return json({ error: 'Ese usuario ya existe' }, 409);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    const msg = createError?.message.includes('already registered')
      ? 'Ese email ya está registrado'
      : createError?.message || 'No se pudo crear el usuario';
    return json({ error: msg }, 400);
  }

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: created.user.id, username });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: 'Ese usuario ya existe' }, 409);
  }

  return json({ ok: true });
});
