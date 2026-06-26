// Mentions are stored inline in a comment body as markdown-like tokens:
//   @[Display Name](email@domain)
// Parsing them server-side makes the server the source of truth for who was
// mentioned — we never trust a client-supplied list.
const MENTION_TOKEN = /@\[[^\]]+\]\(([^()\s]+@[^()\s]+)\)/g;

export function parseMentions(body: string): string[] {
  const emails = new Set<string>();
  for (const match of body.matchAll(MENTION_TOKEN)) {
    emails.add(match[1].trim());
  }
  return [...emails];
}
