export function supabaseErrorMessage(error) {
  const code = String(error?.code || error?.error?.code || "").toUpperCase();
  const status = Number(error?.status || error?.context?.status || error?.error?.status || 0);
  const name = String(error?.name || "");
  const message = String(error?.message || error?.error_description || "").toLowerCase();

  if (code === "23P01") return "Η ώρα έχει ήδη κρατηθεί. Επιλέξτε άλλη διαθέσιμη ώρα.";
  if (code === "BK001") return "Η υπηρεσία ή ο επαγγελματίας δεν είναι πλέον διαθέσιμος. Ανανεώστε και επιλέξτε ξανά.";
  if (code === "BK002") return "Η επιλεγμένη ώρα είναι εκτός ωραρίου λειτουργίας.";
  if (code === "BK003") return "Τα στοιχεία ημερομηνίας ή διάρκειας δεν είναι έγκυρα. Ελέγξτε την επιλογή σας.";
  if (code === "BK004") return "Δεν μπορείτε να επιλέξετε ημερομηνία που έχει περάσει.";
  if (code === "BK005") return "Το ακυρωμένο ή ολοκληρωμένο ραντεβού δεν μπορεί να αλλάξει.";
  if (code === "BK006") return "Η επιλεγμένη ώρα συμπίπτει με διάλειμμα ή ημέρα αργίας. Επιλέξτε άλλη ώρα.";
  if (code === "23505") return "Η καταχώρηση υπάρχει ήδη. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.";

  if (code === "PGRST202" || /could not find the function|schema cache/.test(message)) {
    return "Η λειτουργία αποθήκευσης δεν είναι διαθέσιμη στη βάση. Απαιτείται ενημέρωση της βάσης από τον διαχειριστή.";
  }
  if (code === "42501" || status === 403 || /permission denied|not allowed/.test(message)) {
    return "Δεν έχετε δικαίωμα να κάνετε αυτή την αλλαγή. Ελέγξτε ότι είστε συνδεδεμένοι στον σωστό επαγγελματικό λογαριασμό.";
  }
  if (
    status === 401 ||
    ["PGRST301", "SESSION_NOT_FOUND", "REFRESH_TOKEN_NOT_FOUND", "INVALID_GRANT"].includes(code) ||
    /session.*expired|refresh token.*not found/.test(message)
  ) {
    return "Η σύνδεσή σας έληξε. Συνδεθείτε ξανά και επαναλάβετε την ενέργεια.";
  }
  if (code === "EMAIL_NOT_CONFIRMED") return "Επιβεβαιώστε πρώτα τη διεύθυνση email σας.";
  if (
    status === 408 || code === "57014" || name === "AbortError" ||
    /timed? ?out|timeout|aborted/.test(message)
  ) {
    return "Η ενέργεια άργησε να ολοκληρωθεί. Ελέγξτε αν αποθηκεύτηκε πριν δοκιμάσετε ξανά.";
  }
  if (code.startsWith("22") || code.startsWith("23")) {
    return "Κάποια στοιχεία δεν είναι έγκυρα ή δεν συμφωνούν με τους κανόνες της βάσης. Ελέγξτε τα και δοκιμάστε ξανά.";
  }
  if (
    name === "TypeError" ||
    /failed to fetch|network error|load failed|network request failed|offline/.test(message)
  ) {
    return "Δεν ήταν δυνατή η επικοινωνία με τον διακομιστή. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.";
  }
  if (status >= 500) return "Ο διακομιστής αντιμετωπίζει προσωρινό πρόβλημα. Δοκιμάστε ξανά αργότερα.";
  return "Δεν ήταν δυνατή η ολοκλήρωση της ενέργειας λόγω προβλήματος στη βάση δεδομένων. Δοκιμάστε ξανά.";
}