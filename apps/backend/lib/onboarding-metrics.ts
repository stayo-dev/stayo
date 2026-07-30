type OnboardingMetricOptions = {
  startedAt: number;
  payload?: unknown;
  externalCalls?: number;
};

function payloadBytes(payload: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(payload ?? {})).length;
  } catch {
    return 0;
  }
}

export function withOnboardingMetrics<T extends Response>(
  response: T,
  { startedAt, payload, externalCalls = 0 }: OnboardingMetricOptions,
) {
  const durationMs = Math.round(performance.now() - startedAt);
  response.headers.set("x-hms-onboarding-duration-ms", String(durationMs));
  response.headers.set("x-hms-onboarding-payload-bytes", String(payloadBytes(payload)));
  response.headers.set("x-hms-onboarding-external-calls", String(externalCalls));
  response.headers.set("server-timing", `onboarding;dur=${durationMs}`);
  return response;
}
