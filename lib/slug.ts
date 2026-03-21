const GENERIC_SEPARATOR = "-";

export function slugifyName(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_]+/g, GENERIC_SEPARATOR)
    .replace(/-+/g, GENERIC_SEPARATOR)
    .replace(/^-|-$/g, "");
}

export function ensureSlug(input: string, fallback: string) {
  const slug = slugifyName(input);
  return slug.length > 0 ? slug : fallback;
}
