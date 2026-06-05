export type ExtractMode = "pdf" | "text" | "xlsx" | "docx";

export type PreviewMode = "pdf" | "text";

export type SupportedFormat = {
  extensions: string[];
  mimeTypes: string[];
  extractMode: ExtractMode;
  previewMode: PreviewMode;
  label: string;
};

export const SUPPORTED_FORMATS: SupportedFormat[] = [
  {
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    extractMode: "pdf",
    previewMode: "pdf",
    label: "PDF",
  },
  {
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown", "text/x-markdown"],
    extractMode: "text",
    previewMode: "text",
    label: "Markdown",
  },
  {
    extensions: [".csv"],
    mimeTypes: ["text/csv", "application/csv"],
    extractMode: "text",
    previewMode: "text",
    label: "CSV",
  },
  {
    extensions: [".txt"],
    mimeTypes: ["text/plain"],
    extractMode: "text",
    previewMode: "text",
    label: "Text",
  },
  {
    extensions: [".html", ".htm"],
    mimeTypes: ["text/html"],
    extractMode: "text",
    previewMode: "text",
    label: "HTML",
  },
  {
    extensions: [".xlsx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    extractMode: "xlsx",
    previewMode: "text",
    label: "Excel",
  },
  {
    extensions: [".docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extractMode: "docx",
    previewMode: "text",
    label: "Word",
  },
];

export const ACCEPT_FILE_TYPES = SUPPORTED_FORMATS.flatMap((f) => f.extensions)
  .filter((ext, i, arr) => arr.indexOf(ext) === i)
  .join(",");

const SKIP_EXTENSIONS = new Set([".bak", ".lock"]);

export function shouldSkipFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (fileName.startsWith("~$") || lower.includes(".~lock") || lower.endsWith("#")) {
    return true;
  }
  const ext = lower.slice(lower.lastIndexOf("."));
  return SKIP_EXTENSIONS.has(ext);
}

export function getExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}

export function getFormatForFileName(
  fileName: string
): SupportedFormat | null {
  const ext = getExtension(fileName);
  return SUPPORTED_FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}

export function getFormatForMime(mime: string | null | undefined): SupportedFormat | null {
  if (!mime) return null;
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    SUPPORTED_FORMATS.find((f) =>
      f.mimeTypes.some((m) => m === normalized)
    ) ?? null
  );
}

export function resolveFileFormat(
  fileName: string,
  mimeType?: string | null
): SupportedFormat | null {
  return getFormatForFileName(fileName) ?? getFormatForMime(mimeType);
}

export function isSupportedUpload(file: File): boolean {
  if (shouldSkipFileName(file.name)) return false;
  return resolveFileFormat(file.name, file.type) !== null;
}

export function isExtractable(fileName: string, mimeType?: string | null): boolean {
  return resolveFileFormat(fileName, mimeType) !== null;
}
