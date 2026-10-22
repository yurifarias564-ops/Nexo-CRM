// Endereço e chave pública do Supabase (a chave "anon" é pública por natureza:
// vai para o navegador e só acessa o que as regras de segurança (RLS) permitem).
// Variáveis de ambiente, quando definidas, têm prioridade.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dlakphxtrmqbvtdohuqp.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsYWtwaHh0cm1xYnZ0ZG9odXFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NTQwMTIsImV4cCI6MjEwODIzMDAxMn0.C1NB_zkRKKlIny5vNVNoY7rvBNTvbx3S0rPftg8jKHQ";
