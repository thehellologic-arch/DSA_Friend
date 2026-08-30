import {
  ClassifyResultSchema,
  type ClassifyRequest,
  type ClassifyResult,
  type Rubric,
} from "@reason/core";
import type { ClarifyRequest, LLMProvider } from "./ollama-provider.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const CLASSIFIER_SYSTEM_PROMPT = `You are a grading classifier, not a tutor. Given a problem's required insights and a student's stated approach, decide for each insight whether the student's words satisfy it. Judge ONLY against the provided rubric. Do NOT praise, do NOT give hints, do NOT add commentary. If evidence is absent, return "no".

Use the conversation history only as context. "matchedWrongApproach" must classify the latest user message, not an earlier message. If the latest message corrects or rejects a previously wrong approach, return null.

Output ONLY valid JSON matching this schema:
{
  "insights": [{ "id": "<insight_id>", "status": "yes|partial|no", "evidence": "<quote or null>" }],
  "matchedWrongApproach": "<wrong_approach_id or null>",
  "claimsOptimal": true|false,
  "confidence": 0.0-1.0
}`;

const CLARIFICATION_SYSTEM_PROMPT = `You are a concise tutor answering follow-up questions after grading is complete. Explain only the supplied optimal solution, key insight, complexity, examples, and edge cases. Do not re-grade the user or change the verdict. Do not introduce a different solution unless it is already present in the rubric. If the question is unrelated, ask the user to keep questions focused on this problem.`;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

function extractText(data: GeminiResponse): string {
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in Gemini response");
    return JSON.parse(match[0]);
  }
}

function buildClassifyPayload(input: ClassifyRequest, rubric: Rubric) {
  return {
    coreAsk: input.coreAsk,
    requiredInsights: rubric.required_insights.map((insight) => ({
      id: insight.id,
      desc: insight.desc,
    })),
    wrongApproaches: rubric.common_wrong_approaches.map((approach) => ({
      id: approach.id,
      whyWrong: approach.why_wrong,
      signals: approach.match_signals,
    })),
    history: input.history,
    latestUserMessage: input.latestUserMessage,
  };
}

export class GeminiProvider implements LLMProvider {
  constructor(private config: GeminiConfig) {}

  async classify(
    input: ClassifyRequest,
    rubric: Rubric,
  ): Promise<ClassifyResult> {
    const text = await this.generate(
      CLASSIFIER_SYSTEM_PROMPT,
      JSON.stringify(buildClassifyPayload(input, rubric)),
      true,
    );
    return ClassifyResultSchema.parse(extractJson(text));
  }

  async clarify(input: ClarifyRequest, rubric: Rubric): Promise<string> {
    return this.generate(
      CLARIFICATION_SYSTEM_PROMPT,
      JSON.stringify({
        coreAsk: rubric.core_ask,
        optimal: rubric.optimal,
        edgeCases: rubric.edge_cases,
        recentConversation: input.history.slice(-6),
        question: input.question,
      }),
      false,
    );
  }

  private async generate(
    systemPrompt: string,
    userContent: string,
    jsonMode: boolean,
  ): Promise<string> {
    const baseUrl = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    const model = encodeURIComponent(this.config.model);
    const response = await fetch(`${baseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": this.config.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userContent }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${body}`);
    }

    return extractText((await response.json()) as GeminiResponse);
  }
}
