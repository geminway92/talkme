// Rellena esto con los datos de tu proyecto de Supabase
// (Project Settings -> API). Son valores públicos por diseño: la
// seguridad la da Row Level Security, no mantener esto en secreto.
window.TALKME_CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-KEY',
  // Debe coincidir con el VAPID_PUBLIC_KEY que configures como secret de
  // la función send-push (ver README).
  VAPID_PUBLIC_KEY: 'TU-VAPID-PUBLIC-KEY',
};
