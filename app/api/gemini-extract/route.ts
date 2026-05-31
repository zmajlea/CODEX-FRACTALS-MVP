import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getLensPrompt,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";

const MODEL_NAME = "gemini-2.5-flash";

const systemPrompt = `You are an expert legal and compliance AI.
Your job is to extract specific milestones, risks, and obligations from the provided document text based on the user's focus context.

CRITICAL RULE FOR DATES:
If the category of the object you extract is "Date", you MUST format the "body" field as a strict ISO-8601 YYYY-MM-DD format (e.g., "2026-09-30"). 
If the document uses fuzzy language like "End of Q3 2026", calculate the most logical calendar date and use that in the "body". You may use the "title" or "explanation" field to put the original fuzzy text (e.g., Title: "Q3 Reporting Deadline").

Return the result as a strict JSON array of objects with the following schema:
[{ "title": string, "category": "Date" | "Warning" | "Obligation" | "Entity", "body": string, "explanation": string }]`;

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

function getClient() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_GENAI_API_KEY");
  return new GoogleGenerativeAI(apiKey);
}

function normalizeCategory(category: string): SuggestionCategory {
  const normalized: Record<string, SuggestionCategory> = {
    Date: "Date",
    Warning: "WARNING",
    WARNING: "WARNING",
    Obligation: "Obligation",
    Entity: "Party",
    Party: "Party",
    Financial: "Financial",
    Milestone: "Milestone",
    Other: "Other",
  };
  return normalized[category] ?? "Other";
}

function normalizeIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

type RawSuggestion = {
  title?: string;
  body?: string;
  exactQuote?: string;
  category?: string;
  explanation?: string;
  parsedDate?: string | null;
};

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
      systemInstruction: systemPrompt,
      generationConfig: { responseMimeType: "application/json" },
    });

    const optionsLine =
      options.length > 0
        ? `The user is specifically interested in: ${options.join(", ")}.`
        : "Scan for dates, obligations, warnings, entities, and other material facts.";

    const prompt = `
Active intelligence lens instructions:
${lensContext}

${optionsLine}

Extract objects from the document below. Follow your system rules for Date formatting in the body field.

For non-Date categories, body MUST be an exact substring copied verbatim from the document.

Return ONLY JSON:
{
  "suggestions": [
    {
      "title": "...",
      "category": "Date",
      "body": "2026-09-30",
      "explanation": "..."
    }
  ]
}

Prefer high-signal items (max ~20).

----- BEGIN DOCUMENT -----
${text}
----- END DOCUMENT -----
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const candidateText = result.response.text();
    let rawSuggestions: RawSuggestion[];
    try {
      const parsedJson = JSON.parse(candidateText) as
        | RawSuggestion[]
        | { suggestions?: RawSuggestion[] };
      rawSuggestions = Array.isArray(parsedJson)
        ? parsedJson
        : parsedJson.suggestions ?? [];
    } catch {
      return NextResponse.json(
        { error: "Model returned non-JSON response.", raw: candidateText },
        { status: 502 }
      );
    }

    if (!Array.isArray(rawSuggestions)) {
      return NextResponse.json(
        { error: "Invalid model JSON: missing suggestions array." },
        { status: 502 }
      );
    }

    const suggestions: ExtractSuggestion[] = rawSuggestions
      .filter((s) => {
        const body = s.body ?? s.exactQuote;
        return (
          s &&
          typeof s.title === "string" &&
          typeof body === "string" &&
          typeof s.explanation === "string"
        );
      })
      .map((s) => {
        const body = (s.body ?? s.exactQuote ?? "").trim();
        const category = normalizeCategory(s.category ?? "Other");
        const parsedDate =
          category === "Date"
            ? normalizeIsoDate(body) ?? normalizeIsoDate(s.parsedDate ?? "") ?? null
            : s.parsedDate ?? null;

        return {
          title: s.title!.trim(),
          exactQuote: body,
          category,
          explanation: s.explanation!.trim(),
          parsedDate,
        };
      });

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
