// NEXT_PUBLIC_MOCK_ENDPOINTS (PLAN §7): which endpoints the client answers from src/lib/mocks.

export const MOCK_KEYS = [
  "courses",
  "documents",
  "concepts",
  "question",
  "answer",
  "map",
  "next",
] as const;

export type MockKey = (typeof MOCK_KEYS)[number];

/** A comma list of keys. Spaces, case, duplicates and unknown keys are ignored. Empty = real API. */
export function parseMockEndpoints(value: string | undefined): Set<MockKey> {
  const enabled = new Set<MockKey>();
  for (const part of (value ?? "").split(",")) {
    const key = part.trim().toLowerCase();
    if ((MOCK_KEYS as readonly string[]).includes(key))
      enabled.add(key as MockKey);
  }
  return enabled;
}

/** The keys this build mocks. Read as a literal so Next inlines it into the browser bundle. */
export function enabledMockEndpoints(): Set<MockKey> {
  return parseMockEndpoints(process.env.NEXT_PUBLIC_MOCK_ENDPOINTS);
}
