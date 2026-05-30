import pdfjsLib from "./pdfjs";

export async function extractTextFromFile(
  blob: Blob,
  fileName: string
): Promise<string> {
  if (
    !fileName.toLowerCase().endsWith(".pdf") &&
    blob.type !== "application/pdf"
  ) {
    throw new Error("Only PDF files are supported for extraction.");
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
          }>;
        }> };
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to extract text from PDF: ${message}`);
  }
}
