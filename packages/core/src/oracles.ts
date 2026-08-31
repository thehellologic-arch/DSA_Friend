import { z } from "zod";

type Oracle = (input: unknown) => unknown;

const oracles: Record<string, Oracle> = {
  two_sum_exists(input) {
    const parsed = z
      .object({ numbers: z.array(z.number()), target: z.number() })
      .parse(input);
    const seen = new Set<number>();
    for (const value of parsed.numbers) {
      if (seen.has(parsed.target - value)) return true;
      seen.add(value);
    }
    return false;
  },
};

export function runOracle(oracleId: string, input: unknown): unknown {
  const oracle = oracles[oracleId];
  if (!oracle) throw new Error(`Unknown validation oracle: ${oracleId}`);
  return oracle(input);
}
