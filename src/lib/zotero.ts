import { loadConfig, updateConfig } from "./config.js";
import type { CslJson, LibraryEntry } from "../types/index.js";
import { generateCiteKey } from "./library.js";

interface ZoteroConfig {
  apiKey: string;
  userId: string;
  defaultLibrary: string;
}

async function getZoteroConfig(): Promise<ZoteroConfig | null> {
  const config = await loadConfig();
  if (!config.zotero?.apiKey || !config.zotero?.userId) {
    return null;
  }
  return {
    apiKey: config.zotero.apiKey,
    userId: config.zotero.userId,
    defaultLibrary: config.zotero.defaultLibrary || `user/${config.zotero.userId}`,
  };
}

/** Set up Zotero API credentials */
export async function setupZoteroAuth(apiKey: string, userId: string, defaultLibrary?: string): Promise<void> {
  await updateConfig({
    zotero: {
      apiKey,
      userId,
      defaultLibrary: defaultLibrary || `group/${userId}`,
    },
  });
  console.log("Zotero credentials saved.");
}

/** Parse a library ID like "group/12345" or "user/12345" */
function parseLibraryId(libraryId: string): { type: "groups" | "users"; id: string } {
  const [type, id] = libraryId.split("/");
  return {
    type: type === "group" ? "groups" : "users",
    id,
  };
}

/** Add an item to a Zotero library */
export async function addToZotero(
  libraryId: string,
  csl: CslJson,
): Promise<string | null> {
  const zConfig = await getZoteroConfig();
  if (!zConfig) {
    return null; // Zotero not configured; local-only mode
  }

  const { type, id } = parseLibraryId(libraryId);
  const url = `https://api.zotero.org/${type}/${id}/items`;

  // Convert CSL-JSON to Zotero item format (simplified)
  const zoteroItem = cslToZoteroItem(csl);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Zotero-API-Key": zConfig.apiKey,
      "Content-Type": "application/json",
      "Zotero-API-Version": "3",
    },
    body: JSON.stringify([zoteroItem]),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Zotero API error: ${resp.status} ${body}`);
    return null;
  }

  const result = await resp.json() as any;
  const successKeys = Object.values(result.successful || {}) as any[];
  return successKeys.length > 0 ? successKeys[0].key : null;
}

/** Fetch all items from a Zotero library as CSL-JSON */
export async function fetchZoteroLibrary(
  libraryId: string,
): Promise<LibraryEntry[]> {
  const zConfig = await getZoteroConfig();
  if (!zConfig) {
    throw new Error("Zotero not configured. Run 'cite auth zotero' first.");
  }

  const { type, id } = parseLibraryId(libraryId);
  const entries: LibraryEntry[] = [];
  let start = 0;
  const limit = 100;

  while (true) {
    const url = `https://api.zotero.org/${type}/${id}/items?format=csljson&limit=${limit}&start=${start}`;
    const resp = await fetch(url, {
      headers: {
        "Zotero-API-Key": zConfig.apiKey,
        "Zotero-API-Version": "3",
      },
    });

    if (!resp.ok) {
      throw new Error(`Zotero API error: ${resp.status}`);
    }

    const data = await resp.json() as any;
    const items: CslJson[] = data.items || data;

    if (!Array.isArray(items) || items.length === 0) break;

    const existingKeys = entries.map((e) => e.key);
    for (const csl of items) {
      const key = generateCiteKey(csl, existingKeys);
      existingKeys.push(key);
      entries.push({
        key,
        csl,
        addedAt: new Date().toISOString(),
        zoteroKey: csl.id?.toString(),
      });
    }

    if (items.length < limit) break;
    start += limit;
  }

  return entries;
}

/** Convert CSL-JSON to a simplified Zotero item */
function cslToZoteroItem(csl: CslJson): Record<string, any> {
  const itemType = mapCslTypeToZotero(csl.type);
  const creators = (csl.author || []).map((a) => ({
    creatorType: "author",
    firstName: a.given || "",
    lastName: a.family || a.literal || "",
  }));

  const item: Record<string, any> = {
    itemType,
    title: csl.title || "",
    creators,
    DOI: csl.DOI || "",
    url: csl.URL || "",
    publicationTitle: csl["container-title"] || "",
    volume: csl.volume || "",
    issue: csl.issue || "",
    pages: csl.page || "",
    abstractNote: csl.abstract || "",
  };

  if (csl.issued?.["date-parts"]?.[0]) {
    const parts = csl.issued["date-parts"][0];
    item.date = parts.join("-");
  }

  return item;
}

function mapCslTypeToZotero(cslType: string): string {
  const map: Record<string, string> = {
    "article-journal": "journalArticle",
    "article": "journalArticle",
    "book": "book",
    "chapter": "bookSection",
    "paper-conference": "conferencePaper",
    "thesis": "thesis",
    "report": "report",
    "webpage": "webpage",
  };
  return map[cslType] || "journalArticle";
}
