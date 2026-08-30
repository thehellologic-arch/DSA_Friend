import {
  ClassifyResultSchema,
  type ClassifyRequest,
  type ClassifyResult,
  type Rubric,
} from "@reason/core";

export type { ClassifyRequest };

const CLASSIFIER_SYSTEM_PROMPT = `You are a grading classifier, not a tutor. Given a problem's required insights and a student's stated approach, decide for each insight whether the student's words satisfy it. Judge ONLY against the provided rubric. Do NOT praise, do NOT give hints, do NOT add commentary. If evidence is absent, return "no".

Use the conversation history only as context. "matchedWrongApproach" must classify the latest user message, not an earlier message. If the latest message corrects or rejects a previously wrong approach, return null.

Output ONLY valid JSON matching this schema:
{
  "insights": [{ "id": "<insight_id>", "status": "yes|partial|no", "evidence": "<quote or null>" }],
  "matchedWrongApproach": "<wrong_approach_id or null>",
  "claimsOptimal": true|false,
  "confidence": 0.0-1.0
}`;

const CLARIFICATION_SYSTEM_PROMPT = `You are a concise tutor answering follow-up questions after grading is complete. Explain only the supplied optimal solution, key insight, complexity, examples, and edge cases. Do not re-grade the user. Do not introduce a different solution unless it is already present in the rubric. If the question is unrelated, ask the user to keep questions focused on this problem.`;

export interface ClarifyRequest {
  question: string;
  history: { role: "USER" | "AI"; content: string }[];
}

export interface LLMProvider {
  classify(input: ClassifyRequest, rubric: Rubric): Promise<ClassifyResult>;
  clarify(input: ClarifyRequest, rubric: Rubric): Promise<string>;
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
        const text = await this.callOllamaChat(
          CLASSIFIER_SYSTEM_PROMPT,
          userContent,
          true,
        );
        const result = extractJson(text);
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

  async clarify(input: ClarifyRequest, rubric: Rubric): Promise<string> {
    return this.callOllamaChat(
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

  private async callOllamaChat(
    systemPrompt: string,
    userContent: string,
    jsonMode: boolean,
  ): Promise<string> {
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
        ...(jsonMode ? { format: "json" } : {}),
        options: {
          temperature: 0,
          num_predict: 2048,
        },
        messages: [
          { role: "system", content: systemPrompt },
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
    return text;
  }
}
