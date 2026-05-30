import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getLensPrompt,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";

const MODEL_NAME = "gemini-2.5-flash";

export type SuggestionCategory =
  | "Date"
  | "Party"
  | "Financial"
  | "Milestone"
  | "Obligation"
  | "WARNING"
  | "Other";

export type ExtractSuggestion = {
  title: string;
  exactQuote: string;
  category: SuggestionCategory;
  explanation: string;
  parsedDate?: string | null;
};

type ExtractRequestBody = {
  text: string;
  context?: string;
  lensId?: IntelligenceLensId;
  options?: string[];
};

type ExtractResponseBody = {
  suggestions: ExtractSuggestion[];
  lensId?: IntelligenceLensId;
};

const VALID_CATEGORIES: SuggestionCategory[] = [
  "Date",
  "Party",
  "Financial",
  "Milestone",
  "Obligation",
  "WARNING",
  "Other",
];

function getClient() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_GENAI_API_KEY");
  return new GoogleGenerativeAI(apiKey);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExtractRequestBody;
    const text = (body.text || "").toString();
    const lensId = (body.lensId || "compliance") as IntelligenceLensId;
    const options = Array.isArray(body.options)
      ? body.options.map((o) => o.toString())
      : [];

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Missing or empty `text` field." },
        { status: 400 }
      );
    }

    const lensContext = getLensPrompt(lensId, body.context);
    const genAI = getClient();
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: { responseMimeType: "application/json" },
    });

    const optionsLine =
      options.length > 0
        ? `The user is specifically interested in: ${options.join(", ")}.`
        : "Scan for Dates, Parties, Financials, Milestones, Obligations, WARNINGs, and other material facts.";

    const prompt = `
You are the Fractals Temporal Extraction Engine inside a secure vault inspector.

Active intelligence lens instructions:
${lensContext}

${optionsLine}

Propose SUGGESTED OBJECTS from the document. Each object must include:
- title: short descriptive title
- exactQuote: EXACT substring copied verbatim from the document (no ellipses, no edits)
- category: one of Date | Party | Financial | Milestone | Obligation | WARNING | Other
- explanation: why this matters
- parsedDate: ISO date YYYY-MM-DD when category is Date or when a clear deadline exists; otherwise null

Return ONLY JSON:
{
  "suggestions": [
    {
      "title": "...",
      "exactQuote": "...",
      "category": "Date",
      "explanation": "...",
      "parsedDate": "2026-01-15"
    }
  ]
}

Constraints:
- exactQuote MUST be a substring of the document text
- Prefer high-signal items (max ~20)
- WARNING category for regulatory/risk/penalty items when using the risk lens

----- BEGIN DOCUMENT -----
${text}
----- END DOCUMENT -----
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const candidateText = result.response.text();
    let parsed: ExtractResponseBody;
    try {
      parsed = JSON.parse(candidateText) as ExtractResponseBody;
    } catch {
      return NextResponse.json(
        { error: "Model returned non-JSON response.", raw: candidateText },
        { status: 502 }
      );
    }

    if (!parsed?.suggestions || !Array.isArray(parsed.suggestions)) {
      return NextResponse.json(
        { error: "Invalid model JSON: missing suggestions array." },
        { status: 502 }
      );
    }

    const suggestions: ExtractSuggestion[] = parsed.suggestions
      .filter(
        (s) =>
          s &&
          typeof s.title === "string" &&
          typeof s.exactQuote === "string" &&
          typeof s.explanation === "string"
      )
      .map((s) => ({
        title: s.title.trim(),
        exactQuote: s.exactQuote,
        category: VALID_CATEGORIES.includes(s.category as SuggestionCategory)
          ? (s.category as SuggestionCategory)
          : "Other",
        explanation: s.explanation.trim(),
        parsedDate: s.parsedDate ?? null,
      }));

    return NextResponse.json<ExtractResponseBody>({ suggestions, lensId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message.includes("GOOGLE_GENAI_API_KEY")) {
      return NextResponse.json(
        { error: "Server is not configured with GOOGLE_GENAI_API_KEY." },
        { status: 500 }
      );
    }
    console.error("gemini-extract error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
