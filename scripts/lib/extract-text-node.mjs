import { readFileSync } from "fs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

const SKIP_EXT = new Set([".bak", ".lock"]);

const FORMATS = [
  { ext: ".pdf", mode: "pdf" },
  { ext: ".md", mode: "text" },
  { ext: ".markdown", mode: "text" },
  { ext: ".csv", mode: "text" },
  { ext: ".txt", mode: "text" },
  { ext: ".html", mode: "text" },
  { ext: ".htm", mode: "text" },
  { ext: ".xlsx", mode: "xlsx" },
  { ext: ".docx", mode: "docx" },
];

export function shouldSkipFileName(fileName) {
  const lower = fileName.toLowerCase();
  if (fileName.startsWith("~$") || lower.includes(".~lock") || lower.endsWith("#")) {
    return true;
  }
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return true;
  return SKIP_EXT.has(lower.slice(dot));
}

export function getFormatForFileName(fileName) {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot === -1 ? "" : lower.slice(dot);
  return FORMATS.find((f) => f.ext === ext) ?? null;
}

function mimeForFileName(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "text/plain";
}

export function mimeForFile(fileName) {
  return mimeForFileName(fileName);
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result.text ?? "").trim();
  } finally {
    await parser.destroy();
  }
}

async function extractXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return parts.join("\n\n").trim();
}

async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? "").trim();
}

export async function extractTextFromPath(filePath, fileName) {
  const format = getFormatForFileName(fileName);
  if (!format) {
    throw new Error(`Unsupported file type: ${fileName}`);
  }
  const buffer = readFileSync(filePath);
  let text = "";
  switch (format.mode) {
    case "pdf":
      text = await extractPdf(buffer);
      break;
    case "text":
      text = buffer.toString("utf8").trim();
      break;
    case "xlsx":
      text = await extractXlsx(buffer);
      break;
    case "docx":
      text = await extractDocx(buffer);
      break;
    default:
      throw new Error(`Unknown mode for ${fileName}`);
  }
  if (!text) throw new Error(`No text extracted from ${fileName}`);
  return text;
}
