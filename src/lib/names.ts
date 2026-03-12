// ABOUTME: Shared author name parsing utilities.
// ABOUTME: Handles "Family, Given" and "Given Family" formats.

/** Parse a single name string into given/family parts */
export function parseName(name: string): { given?: string; family?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { family: "" };

  if (trimmed.includes(",")) {
    const [family, given] = trimmed.split(",").map((s) => s.trim());
    return { family, given };
  }

  const parts = trimmed.split(" ");
  const family = parts.pop() || "";
  const given = parts.join(" ") || undefined;
  return { given, family };
}

/** Parse an "and"-delimited author string (BibTeX format) into name parts */
export function parseAuthorString(
  authorStr: string,
): Array<{ given?: string; family?: string }> {
  if (!authorStr) return [];
  return authorStr.split(/\s+and\s+/i).map(parseName);
}
