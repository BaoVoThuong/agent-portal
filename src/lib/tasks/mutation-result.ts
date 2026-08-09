export type Warning = {
  code: string;
  message: string;
};

export type MutationResult<T> = {
  data: T;
  warnings: Warning[];
};

export function ok<T>(data: T, warnings: Warning[] = []): MutationResult<T> {
  return { data, warnings };
}

export async function settleSideEffects(
  effects: { code: string; message: string; run: () => Promise<unknown> }[]
): Promise<Warning[]> {
  const results = await Promise.allSettled(effects.map((effect) => effect.run()));
  const warnings: Warning[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const effect = effects[index];
      console.warn(`[side-effect] ${effect.code}`, result.reason);
      warnings.push({ code: effect.code, message: effect.message });
    }
  });
  return warnings;
}
