import * as pdfjsLib from "pdfjs-dist";

if (typeof window !== "undefined") {
  try {
    (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
      `https://unpkg.com/pdfjs-dist@${(pdfjsLib as unknown as { version: string }).version}/build/pdf.worker.min.mjs`;
  } catch {
    // surfaced when extracting
  }
}

export default pdfjsLib;
