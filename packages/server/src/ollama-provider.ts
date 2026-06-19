import {
  ClassifyResultSchema,
  type ClassifyRequest,
  type ClassifyResult,
  type Rubric,
} from "@reason/core";

export type { ClassifyRequest };

const CLASSIFIER_SYSTEM_PROMPT = `You are a grading classifier, not a tutor. Given a problem's required insights and a student's stated approach, decide for each insight whether the student's words satisfy it. Judge ONLY against the provided rubric. Do NOT praise, do NOT give hints, do NOT add commentary. If evidence is absent, return "no". Output ONLY valid JSON matching this schema:
{
  "insights": [{ "id": "<insight_id>", "status": "yes|partial|no", "evidence": "<quote or null>" }],
  "matchedWrongApproach": "<wrong_approach_id or null>",
  "claimsOptimal": true|false,
  "confidence": 0.0-1.0
}`;

export interface LLMProvider {
  classify(input: ClassifyRequest, rubric: Rubric): Promise<ClassifyResult>;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No JSON object found in LLM response");
  }
}

function buildClassifyPayload(
  input: ClassifyRequest,
  rubric: Rubric,
): ClassifyRequest {
  return {
    coreAsk: input.coreAsk,
    requiredInsights: rubric.required_insights.map((i) => ({
      id: i.id,
      desc: i.desc,
    })),
    wrongApproaches: rubric.common_wrong_approaches.map((w) => ({
      id: w.id,
      whyWrong: w.why_wrong,
      signals: w.match_signals,
    })),
    history: input.history,
    latestUserMessage: input.latestUserMessage,
  };
}

export class OllamaProvider implements LLMProvider {
  constructor(private config: OllamaConfig) {}

  async classify(
    input: ClassifyRequest,
    rubric: Rubric,
  ): Promise<ClassifyResult> {
    const payload = buildClassifyPayload(input, rubric);
    const userContent = JSON.stringify(payload, null, 2);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.callOllamaChat(userContent);
        return ClassifyResultSchema.parse(result);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `LLM classify attempt ${attempt + 1} failed:`,
          lastError.message,
        );
      }
    }

    throw lastError ?? new Error("LLM classification failed");
  }

  private async callOllamaChat(userContent: string): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/api/chat`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        think: false,
        format: "json",
        options: {
          temperature: 0,
          num_predict: 2048,
        },
        messages: [
          { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string; reasoning?: string };
    };

    const message = data.message;
    const text =
      message?.content?.trim() ||
      message?.reasoning?.trim() ||
      "";

    if (!text) throw new Error("Empty LLM response");

    console.log("[LLM raw]", text.slice(0, 200));
    return extractJson(text);
  }
}
