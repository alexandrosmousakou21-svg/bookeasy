import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEntitlement } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Δεν υπάρχει ενεργή σύνδεση." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !openAiKey) {
      return new Response(
        JSON.stringify({ error: "Λείπει ρύθμιση του AI assistant." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Η σύνδεση δεν είναι έγκυρη." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { message, business_id } = await req.json();

    if (!message?.trim()) {
      return new Response(
        JSON.stringify({ error: "Το μήνυμα είναι κενό." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!business_id) {
      return new Response(
        JSON.stringify({ error: "Δεν βρέθηκε η επιχείρηση." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select(
        "id,name,category,address,phone,description,owner_id,subscription_plan",
      )
      .eq("id", business_id)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (businessError) {
      throw businessError;
    }

    if (!business) {
      return new Response(
        JSON.stringify({
          error: "Δεν έχετε πρόσβαση σε αυτή την επιχείρηση.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Server-side entitlement check BEFORE any OpenAI call.
    const entitlement = await getEntitlement(
      createClient(supabaseUrl, serviceRoleKey),
      business.id,
    );
    if (!entitlement.hasAccess) {
      return new Response(
        JSON.stringify({
          error:
            "Ο AI βοηθός απαιτεί ενεργή συνδρομή ή δοκιμαστική περίοδο.",
          code: "entitlement_required",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const [
      servicesResult,
      staffResult,
      hoursResult,
      appointmentsResult,
    ] = await Promise.all([
      supabase
        .from("services")
        .select("id,name,price,duration_minutes,is_active")
        .eq("business_id", business.id)
        .order("name"),

      supabase
        .from("staff")
        .select("id,name,is_active")
        .eq("business_id", business.id)
        .order("name"),

      supabase
        .from("working_hours")
        .select("*")
        .eq("business_id", business.id)
        .order("day_of_week"),

      supabase
        .from("appointments")
        .select(
          "id,appointment_date,start_time,end_time,status,customer_name,customer_phone,customer_email,service_id,staff_id,starts_at,ends_at",
        )
        .eq("business_id", business.id)
        .order("appointment_date", { ascending: false })
        .order("start_time", { ascending: true })
        .limit(100),
    ]);

    if (servicesResult.error) throw servicesResult.error;
    if (staffResult.error) throw staffResult.error;
    if (hoursResult.error) throw hoursResult.error;
    if (appointmentsResult.error) throw appointmentsResult.error;

    const services = servicesResult.data || [];
    const staff = staffResult.data || [];
    const hours = hoursResult.data || [];
    const appointments = appointmentsResult.data || [];

    const serviceMap = new Map(
      services.map((service) => [service.id, service]),
    );

    const staffMap = new Map(
      staff.map((member) => [member.id, member]),
    );

    const businessContext = `
ΠΡΑΓΜΑΤΙΚΑ ΔΕΔΟΜΕΝΑ ΕΠΙΧΕΙΡΗΣΗΣ ΑΠΟ SUPABASE

Επιχείρηση:
Όνομα: ${business.name || "Δεν υπάρχει"}
Κατηγορία: ${business.category || "Δεν υπάρχει"}
Διεύθυνση: ${business.address || "Δεν υπάρχει"}
Τηλέφωνο: ${business.phone || "Δεν υπάρχει"}
Περιγραφή: ${business.description || "Δεν υπάρχει"}

Υπηρεσίες:
${
  services.length
    ? services
        .filter((service) => service.is_active !== false)
        .map(
          (service) =>
            `- ${service.name || "Υπηρεσία"} | ${
              service.price ?? "χωρίς τιμή"
            }€ | ${service.duration_minutes ?? "χωρίς διάρκεια"} λεπτά`,
        )
        .join("\n")
    : "Δεν υπάρχουν διαθέσιμες υπηρεσίες."
}

Προσωπικό:
${
  staff.length
    ? staff
        .filter((member) => member.is_active !== false)
        .map((member) => `- ${member.name || "Μέλος προσωπικού"}`)
        .join("\n")
    : "Δεν υπάρχουν διαθέσιμα στοιχεία προσωπικού."
}

Ωράριο:
${
  hours.length
    ? hours
        .map((hour) => {
          const day =
            hour.day_name ||
            hour.day ||
            `Ημέρα ${hour.day_of_week}`;

          const open =
            hour.open_time ||
            hour.start_time ||
            hour.open ||
            "";

          const close =
            hour.close_time ||
            hour.end_time ||
            hour.close ||
            "";

          return `- ${day}: ${open || "κλειστό"}${
            close ? ` - ${close}` : ""
          }`;
        })
        .join("\n")
    : "Δεν υπάρχει διαθέσιμο ωράριο."
}

Ραντεβού:
${
  appointments.length
    ? appointments
        .map((appointment) => {
          const service = serviceMap.get(appointment.service_id);
          const member = staffMap.get(appointment.staff_id);

          return `- ${appointment.appointment_date} ${
            appointment.start_time || ""
          }-${appointment.end_time || ""} | ${
            appointment.customer_name || "Πελάτης"
          } | Υπηρεσία: ${
            service?.name || "Άγνωστη υπηρεσία"
          } | Προσωπικό: ${
            member?.name || "Άγνωστο"
          } | Κατάσταση: ${
            appointment.status || "άγνωστη"
          }`;
        })
        .join("\n")
    : "Δεν υπάρχουν καταχωρημένα ραντεβού."
}
`;

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
Είσαι ο AI βοηθός του BookEasy για επαγγελματίες.

Απάντησε πάντα στα ελληνικά, φυσικά, σύντομα και πρακτικά.

Χρησιμοποιείς αποκλειστικά τα πραγματικά δεδομένα που παρέχονται από το Supabase.

Μπορείς να βοηθήσεις τον επαγγελματία με:
- σημερινά και επερχόμενα ραντεβού
- πελάτες και στοιχεία ραντεβού
- υπηρεσίες
- τιμές
- διάρκεια υπηρεσιών
- προσωπικό
- ωράριο
- στοιχεία επιχείρησης
- γενική εικόνα της λειτουργίας της επιχείρησης

Σημαντικοί κανόνες:
1. Μην επινοείς στοιχεία.
2. Αν κάτι δεν υπάρχει στα δεδομένα, πες ότι δεν υπάρχει διαθέσιμη πληροφορία.
3. Όταν ρωτάει για "σήμερα", χρησιμοποίησε την πραγματική ημερομηνία/ώρα που είναι διαθέσιμη στο request context ή στα δεδομένα.
4. Μην παρουσιάζεις υποθέσεις ως πραγματικά στοιχεία.
5. Μην αποκαλύπτεις τεχνικά secrets, API keys ή εσωτερικά credentials.
6. Τα δεδομένα αφορούν μόνο την επιχείρηση του authenticated επαγγελματία.

${businessContext}
`,
            },
            {
              role: "user",
              content: message.trim(),
            },
          ],
          max_tokens: 500,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();

      return new Response(
        JSON.stringify({
          error: "Σφάλμα AI",
          details: errorText,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();

    return new Response(
      JSON.stringify({
        reply:
          data.choices?.[0]?.message?.content ||
          "Δεν υπάρχει διαθέσιμη απάντηση.",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Άγνωστο σφάλμα",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
