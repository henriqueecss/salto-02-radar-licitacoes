export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeText(text: string): string {
  return cleanText(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
