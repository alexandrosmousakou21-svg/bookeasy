Deno.serve(async (req) => {
  try {
    const { message, business } = await req.json();

    if (!message?.trim()) {
      return new Response(
        JSON.stringify({ error: "Το μήνυμα είναι κενό." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const businessContext = business
      ? `
Στοιχεία επιχείρησης:
Όνομα: ${business.name || "Δεν υπάρχει"}
Κατηγορία: ${business.category || "Δεν υπάρχει"}
Διεύθυνση: ${business.address || "Δεν υπάρχει"}
Τηλέφωνο: ${business.phone || "Δεν υπάρχει"}
Περιγραφή: ${business.description || "Δεν υπάρχει"}

Υπηρεσίες:
${(business.services || [])
  .map(
    (service) =>
      `- ${service.name || "Υπηρεσία"}: ${service.price ?? "-"}€, διάρκεια ${
        service.duration_minutes ?? "-"
      } λεπτά`,
  )
  .join("\n") || "Δεν υπάρχουν διαθέσιμες υπηρεσίες."}

Ωράριο:
${
  (business.hours || [])
    .map((hour) => `- ${hour.day || ""}: ${hour.open || ""} - ${hour.close || ""}`)
    .join("\n") || "Δεν υπάρχει διαθέσιμο ωράριο."
}
`
      : "";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Είσαι ο AI βοηθός του BookEasy.

Απάντησε πάντα στα ελληνικά, σύντομα, φυσικά και ευγενικά.

Αν υπάρχουν στοιχεία συγκεκριμένης επιχείρησης, χρησιμοποίησέ τα για να απαντήσεις σε ερωτήσεις σχετικά με:
- υπηρεσίες
- τιμές
- διάρκεια υπηρεσιών
- ωράριο
- διεύθυνση
- τηλέφωνο
- γενικές πληροφορίες της επιχείρησης

Μην επινοείς πληροφορίες που δεν υπάρχουν στα στοιχεία.
Αν δεν γνωρίζεις κάτι, πες ξεκάθαρα ότι δεν υπάρχει διαθέσιμη πληροφορία.

${businessContext}
`,
          },
          {
            role: "user",
            content: message.trim(),
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      return new Response(
        JSON.stringify({
          error: "Σφάλμα AI",
          details: errorText,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Άγνωστο σφάλμα",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
