import pdfjsLib from "./pdfjs";
import {
  resolveFileFormat,
  type ExtractMode,
} from "@/lib/files/supported-formats";

async function extractPdfText(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await (
    pdfjsLib as unknown as {
      getDocument: (opts: { data: ArrayBuffer }) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
          }>;
        }>;
      };
    }
  ).getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str || "").join(" ");
    fullText += pageText;
    if (pageNum < pdf.numPages) {
      fullText += `\n--- Page ${pageNum + 1} ---\n`;
    }
  }
  return fullText.trim();
}

async function extractPlainText(blob: Blob): Promise<string> {
  return (await blob.text()).trim();
}

async function extractXlsxText(blob: Blob): Promise<string> {
  const XLSX = await import("xlsx");
  const buffer = await blob.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return parts.join("\n\n").trim();
}

async function extractDocxText(blob: Blob): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = await blob.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

async function extractByMode(blob: Blob, mode: ExtractMode): Promise<string> {
  switch (mode) {
    case "pdf":
      return extractPdfText(blob);
    case "text":
      return extractPlainText(blob);
    case "xlsx":
      return extractXlsxText(blob);
    case "docx":
      return extractDocxText(blob);
    default:
      throw new Error(`Unsupported extract mode: ${String(mode)}`);
  }
}

export async function extractTextFromFile(
  blob: Blob,
  fileName: string
): Promise<string> {
  const format = resolveFileFormat(fileName, blob.type);
  if (!format) {
    throw new Error(
      `Unsupported file type for extraction: ${fileName}. Supported: PDF, CSV, MD, TXT, HTML, XLSX, DOCX.`
    );
  }

  try {
    const text = await extractByMode(blob, format.extractMode);
    if (!text.trim()) {
      throw new Error(`No text could be extracted from ${fileName}.`);
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to extract text from ${fileName}: ${message}`);
  }
}
