import {
  ClassifyResultSchema,
  type ClassifyRequest,
  type ClassifyResult,
  type Rubric,
} from "@reason/core";
import type { ClarifyRequest, LLMProvider } from "./ollama-provider.js";

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

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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

export class OpenAIProvider implements LLMProvider {
  constructor(private config: OpenAIConfig) {}

  async classify(
    input: ClassifyRequest,
    rubric: Rubric,
  ): Promise<ClassifyResult> {
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.config.apiKey,
          "Ocp-Apim-Subscription-Key": this.config.apiKey,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: 1024,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify(buildClassifyPayload(input, rubric)),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty OpenAI response");

    return ClassifyResultSchema.parse(JSON.parse(content));
  }

  async clarify(input: ClarifyRequest, rubric: Rubric): Promise<string> {
    const response = await fetch(
      `${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.config.apiKey,
          "Ocp-Apim-Subscription-Key": this.config.apiKey,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0,
          max_tokens: 1024,
          messages: [
            { role: "system", content: CLARIFICATION_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                coreAsk: rubric.core_ask,
                optimal: rubric.optimal,
                edgeCases: rubric.edge_cases,
                recentConversation: input.history.slice(-6),
                question: input.question,
              }),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty OpenAI clarification response");
    return content;
  }
}
