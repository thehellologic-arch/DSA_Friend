import {
  ClassifyResultSchema,
  type ApproachEvaluation,
  type ClassifyRequest,
  type ClassifyResult,
  type Rubric,
} from "@reason/core";
import {
  evaluateApproach as runApproachEvaluation,
  type ApproachEvaluationRequest,
  type LlmUsage,
} from "./approach-evaluator.js";

export type { ClassifyRequest };
export type { ApproachEvaluationRequest, LlmUsage };

const CLASSIFIER_SYSTEM_PROMPT = `You are a grading classifier, not a tutor. Given a problem's required insights and a student's stated approach, decide for each insight whether the student's words satisfy it. Judge ONLY against the provided rubric. Do NOT praise, do NOT give hints, do NOT add commentary. If evidence is absent, return "no".

Use the conversation history only as context. "matchedWrongApproach" must classify the latest user message, not an earlier message. If the latest message corrects or rejects a previously wrong approach, return null.

Set "messageKind" from the latest user message only:
- "approach": they describe a solution, algorithm, data structure, complexity, or tradeoff for THIS problem
- "question": they ask what the problem is or request a restatement of the prompt
- "sample_request": they ask for an example, sample input, current number, or test case
- "pushback": they say the last hint/question was unrelated or did not match their approach
- "off_topic": greetings, insults, chit-chat, or questions unrelated to this problem (news, people, other subjects)

If they described an acceptable alternative (not the optimal), set "matchedAcceptableAlternative" to that alternative's id. Do not treat a correct slower method as a wrong approach.

Output ONLY valid JSON matching this schema:
{
  "insights": [{ "id": "<insight_id>", "status": "yes|partial|no", "evidence": "<quote or null>" }],
  "matchedWrongApproach": "<wrong_approach_id or null>",
  "matchedAcceptableAlternative": "<acceptable_id or null>",
  "claimsOptimal": true|false,
  "confidence": 0.0-1.0,
  "messageKind": "approach|question|sample_request|pushback|off_topic"
}`;

const CLARIFICATION_SYSTEM_PROMPT = `You are a concise tutor answering follow-up questions after grading is complete. Explain only the supplied optimal solution, key insight, complexity, examples, and edge cases. Do not re-grade the user. Do not introduce a different solution unless it is already present in the rubric. If the question is unrelated, ask the user to keep questions focused on this problem.`;

export interface ClarifyRequest {
  question: string;
  history: { role: "USER" | "AI"; content: string }[];
}

export interface LLMProvider {
  classify(input: ClassifyRequest, rubric: Rubric): Promise<ClassifyResult>;
  clarify(input: ClarifyRequest, rubric: Rubric): Promise<string>;
  evaluateApproach(
    input: ApproachEvaluationRequest,
  ): Promise<{ evaluation: ApproachEvaluation; usage: LlmUsage }>;
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

function buildClassifyPayload(input: ClassifyRequest, rubric: Rubric) {
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
    acceptableAlternatives: rubric.acceptable_alternatives.map((alt) => ({
      id: alt.id ?? alt.approach,
      approach: alt.approach,
      note: alt.note,
    })),
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
        const { content } = await this.callOllamaChat(
          CLASSIFIER_SYSTEM_PROMPT,
          userContent,
          true,
        );
        const result = extractJson(content);
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
    const { content } = await this.callOllamaChat(
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
    return content;
  }

  async evaluateApproach(
    input: ApproachEvaluationRequest,
  ): Promise<{ evaluation: ApproachEvaluation; usage: LlmUsage }> {
    return runApproachEvaluation(input, (systemPrompt, userContent) =>
      this.callOllamaChat(systemPrompt, userContent, true),
    );
  }

  private async callOllamaChat(
    systemPrompt: string,
    userContent: string,
    jsonMode: boolean,
  ): Promise<{ content: string; usage: LlmUsage }> {
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
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const message = data.message;
    const text =
      message?.content?.trim() ||
      message?.reasoning?.trim() ||
      "";

    if (!text) throw new Error("Empty LLM response");

    const promptTokens =
      typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null;
    const completionTokens =
      typeof data.eval_count === "number" ? data.eval_count : null;
    const usage: LlmUsage = {
      promptTokens,
      completionTokens,
      totalTokens:
        promptTokens !== null && completionTokens !== null
          ? promptTokens + completionTokens
          : null,
    };

    return { content: text, usage };
  }
}
