import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleProfessionalAi } from "../_shared/professionalAi.ts";

Deno.serve((req) =>
  handleProfessionalAi(req, {
    env: (name) => Deno.env.get(name),
    createClient,
    fetch: (input, init) => fetch(input, init as RequestInit),
  })
);
