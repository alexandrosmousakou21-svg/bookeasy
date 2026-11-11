const categoryAliases = [
  ["barber", "barbershop", "barbers", "haircut", "men's haircut", "κουρείο", "κουρεία", "κούρεμα", "κουρέματα", "ανδρικό κούρεμα"],
  ["hair salon", "hairdresser", "κομμωτήριο", "κομμωτήρια", "κομμωτήριο γυναικών"],
  ["nail salon", "nails", "nail art", "manicure", "pedicure", "μανικιούρ", "πεντικιούρ", "τεχνητά νύχια"],
  ["doctor", "doctors", "ιατρός", "ιατροί", "γιατρός", "γιατροί", "ιατρείο", "οδοντίατρος", "δερματολόγος"],
];

export function normalizeDirectoryText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function matchesBusinessQuery(business, query) {
  const normalizedQuery = normalizeDirectoryText(query);
  if (!normalizedQuery) return true;

  const searchableText = normalizeDirectoryText([
    business?.name,
    business?.description,
    business?.address,
    business?.city,
    business?.category,
    ...(business?.service_names || []),
  ].filter(Boolean).join(" "));

  for (const aliases of categoryAliases) {
    const queryAlias = aliases
      .map(normalizeDirectoryText)
      .sort((left, right) => right.length - left.length)
      .find((alias) => normalizedQuery.includes(alias));
    if (!queryAlias) continue;

    const remainingQuery = normalizedQuery.replace(queryAlias, " ").trim();
    const categoryMatches = aliases.some((alias) => searchableText.includes(normalizeDirectoryText(alias)));
    const remainingTermsMatch = remainingQuery
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => searchableText.includes(term));
    return categoryMatches && remainingTermsMatch;
  }

  return normalizedQuery
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => searchableText.includes(term));
}