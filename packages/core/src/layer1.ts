import type { ClassifyResult, MessageKind, Rubric } from "./rubric.js";

export function scanWrongApproaches(
  message: string,
  rubric: Rubric,
): string | null {
  const normalized = message.toLowerCase();

  for (const wrong of rubric.common_wrong_approaches) {
    for (const signal of wrong.match_signals) {
      if (normalized.includes(signal.toLowerCase())) {
        return wrong.id;
      }
    }
  }

  return null;
}

export function scanAcceptableAlternatives(
  message: string,
  rubric: Rubric,
): string | null {
  const normalized = message.toLowerCase();

  for (const alt of rubric.acceptable_alternatives) {
    for (const signal of alt.match_signals) {
      if (normalized.includes(signal.toLowerCase())) {
        return alt.id ?? alt.approach;
      }
    }
  }

  return null;
}

export function scanTutorIntent(message: string): MessageKind | null {
  const normalized = message.toLowerCase();

  if (
    /\b(sample input|sample output|test case|current number|give me (an? |the )?(sample|example|input|array|numbers)|provide (the )?(current number|sample|example|input|array|numbers)|show (me )?(a |an |the )?(sample|example|input)|what (is|are) (the )?(input|array|numbers|sample))\b/.test(
      normalized,
    )
  ) {
    return "sample_request";
  }

  if (
    /\b(non[- ]?related|not related|unrelated|doesn't make sense|does not make sense|wrong hint|completely off|not what i (said|meant)|doesn't match|does not match)\b/.test(
      normalized,
    )
  ) {
    return "pushback";
  }

  return null;
}

export function synthesizeWrongApproachClassification(
  rubric: Rubric,
  wrongApproachId: string,
): ClassifyResult {
  return {
    insights: rubric.required_insights.map((insight) => ({
      id: insight.id,
      status: "no" as const,
      evidence: null,
    })),
    matchedWrongApproach: wrongApproachId,
    matchedAcceptableAlternative: null,
    claimsOptimal: false,
    confidence: 1,
    messageKind: "approach",
  };
}

export function synthesizeAcceptableClassification(
  rubric: Rubric,
  alternativeId: string,
): ClassifyResult {
  return {
    insights: rubric.required_insights.map((insight) => ({
      id: insight.id,
      status: "partial" as const,
      evidence: alternativeId,
    })),
    matchedWrongApproach: null,
    matchedAcceptableAlternative: alternativeId,
    claimsOptimal: false,
    confidence: 1,
    messageKind: "approach",
  };
}

export function synthesizeIntentClassification(
  rubric: Rubric,
  messageKind: MessageKind,
): ClassifyResult {
  return {
    insights: rubric.required_insights.map((insight) => ({
      id: insight.id,
      status: "no" as const,
      evidence: null,
    })),
    matchedWrongApproach: null,
    matchedAcceptableAlternative: null,
    claimsOptimal: false,
    confidence: 1,
    messageKind,
  };
}
