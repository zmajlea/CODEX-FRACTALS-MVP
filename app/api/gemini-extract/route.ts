import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getLensPrompt,
  type IntelligenceLensId,
} from "@/lib/intelligence-lenses";
import {
  EVENT_TYPES,
  composeLabel,
  normalizeEventType,
} from "@/lib/temporal/event-types";

const MODEL_NAME = "gemini-2.5-flash";

const EVENT_TYPE_LIST = EVENT_TYPES.join(", ");

const systemPrompt = `You are an expert legal and compliance AI.
Your job is to extract specific milestones, risks, and obligations from the provided document text based on the user's focus context.

LABEL RULES (CRITICAL):
- Do NOT use document filenames or generic document titles as labels.
- Each suggestion MUST include "eventType" and "qualifier" instead of a single title.
- "eventType" MUST be exactly one of: ${EVENT_TYPE_LIST}.
- "qualifier" is a short actionable fragment from the clause (e.g. "$2M Tranche A", "Q3 EBITDA Report").

CRITICAL RULE FOR DATES:
If the category of the object you extract is "Date", you MUST format the "body" field as a strict ISO-8601 YYYY-MM-DD format (e.g., "2026-09-30").
If the document uses fuzzy language like "End of Q3 2026", calculate the most logical calendar date and use that in the "body". You may use the "qualifier" or "explanation" field for the original fuzzy text.

Return the result as a strict JSON array of objects with the following schema:
[{ "eventType": string, "qualifier": string, "category": "Date" | "Warning" | "Obligation" | "Entity", "body": string, "explanation": string }]`;

export type SuggestionCategory =
  | "Date"
  | "Party"
  | "Financial"
  | "Milestone"
  | "Obligation"
  | "WARNING"
  | "Other";

export type ExtractSuggestion = {
  eventType: string;
  qualifier: string;
  exactQuote: string;
  category: SuggestionCategory;
  explanation: string;
  parsedDate: string | null;
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
  eventType?: string;
  qualifier?: string;
  body?: string;
  exactQuote?: string;
  category?: string;
  explanation?: string;
  parsedDate?: string | null;
};

function resolveEventTypeAndQualifier(s: RawSuggestion): {
  eventType: string;
  qualifier: string;
} | null {
  let eventType = normalizeEventType(s.eventType);
  let qualifier = (s.qualifier ?? "").trim();

  if (!eventType && s.title) {
    const sep = s.title.indexOf(" - ");
    if (sep > 0) {
      eventType = normalizeEventType(s.title.slice(0, sep));
      qualifier = qualifier || s.title.slice(sep + 3).trim();
    } else {
      qualifier = qualifier || s.title.trim();
    }
  }

  if (!eventType) eventType = "Decision";
  if (!qualifier) return null;

  return { eventType, qualifier };
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

Extract objects from the document below. Follow your system rules for eventType, qualifier, and Date formatting in the body field.

For non-Date categories, body MUST be an exact substring copied verbatim from the document.
Never use document titles or filenames as qualifier text.

Return ONLY JSON:
{
  "suggestions": [
    {
      "eventType": "Payment Due",
      "qualifier": "$2M Tranche A",
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

    const suggestions = rawSuggestions
      .map((s) => {
        const body = (s.body ?? s.exactQuote ?? "").trim();
        const resolved = resolveEventTypeAndQualifier(s);
        if (
          !resolved ||
          !body ||
          typeof s.explanation !== "string"
        ) {
          return null;
        }

        const { eventType, qualifier } = resolved;
        const category = normalizeCategory(s.category ?? "Other");
        const parsedDate =
          category === "Date"
            ? normalizeIsoDate(body) ??
              normalizeIsoDate(s.parsedDate ?? "") ??
              null
            : s.parsedDate ?? null;

        const label = composeLabel(eventType, qualifier);
        if (label.length > 60) return null;

        return {
          eventType,
          qualifier,
          exactQuote: body,
          category,
          explanation: s.explanation.trim(),
          parsedDate: parsedDate ?? null,
        };
      })
      .filter((s): s is ExtractSuggestion => s !== null);

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
