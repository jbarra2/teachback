import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createFakeTransport, setFakeFailure } from "./fake";
import {
  type Confidence,
  type EvidenceItem,
  normalizeForMatch,
  type SourceChunk,
  verifyEvidence,
} from "./verify-evidence";

const CHUNKS: SourceChunk[] = [
  {
    id: "c1",
    text: "Photosynthesis converts light energy into chemical energy.\nIt happens in the chloroplasts — mostly in the leaves.",
  },
  {
    id: "c2",
    text: "The Calvin cycle uses ATP and NADPH to fix CO2 into sugar.\tIt doesn’t need light directly.",
  },
  {
    id: "c3",
    text: "The membrane is a “fluid mosaic” of lipids and proteins… pores are 2–3 nm wide and ﬁxed in size.",
  },
];

function feedback(evidence: EvidenceItem[], confidence: Confidence = "HIGH") {
  return {
    verdict: "PARTIAL" as const,
    whatCorrect: "You named the inputs.",
    whatMissing: "Say where it happens.",
    evidence,
    confidence,
    outsideNotes: false,
  };
}

const kept = (evidence: EvidenceItem[], chunks = CHUNKS) =>
  verifyEvidence(feedback(evidence), chunks).evidence;

describe("verifyEvidence: which quotes survive", () => {
  it("keeps a quote that appears in its chunk", () => {
    const quote = {
      chunkId: "c1",
      quote: "converts light energy into chemical energy",
    };
    const result = verifyEvidence(feedback([quote]), CHUNKS);
    expect(result.evidence).toEqual([quote]);
    expect(result).toMatchObject({ confidence: "HIGH", unsupported: false });
  });

  it("drops a fabricated quote", () => {
    expect(
      kept([
        { chunkId: "c1", quote: "Photosynthesis happens in the mitochondria." },
      ]),
    ).toEqual([]);
  });

  it("drops a paraphrase of a real sentence", () => {
    expect(
      kept([
        {
          chunkId: "c1",
          quote: "Photosynthesis turns light into chemical energy.",
        },
      ]),
    ).toEqual([]);
  });

  it("drops a quote whose chunkId wasn't provided", () => {
    expect(kept([{ chunkId: "c9", quote: "converts light energy" }])).toEqual(
      [],
    );
  });

  it("drops a real quote cited against the wrong chunk", () => {
    expect(kept([{ chunkId: "c2", quote: "converts light energy" }])).toEqual(
      [],
    );
  });

  it("drops a quote that spans two chunks", () => {
    const spanning = "mostly in the leaves. The Calvin cycle uses ATP";
    expect(kept([{ chunkId: "c1", quote: spanning }])).toEqual([]);
    expect(kept([{ chunkId: "c2", quote: spanning }])).toEqual([]);
  });

  it.each(["", "   ", "\n\t ", " "])("drops an empty quote (%j)", (quote) => {
    expect(kept([{ chunkId: "c1", quote }])).toEqual([]);
  });

  it.each(["energy", "light energy", "  LIGHT\n\t energy  ", "chloroplasts —"])(
    "drops a real quote shorter than three words (%j)",
    (quote) => {
      expect(kept([{ chunkId: "c1", quote }])).toEqual([]);
    },
  );

  it("keeps a real quote of exactly three words", () => {
    const quote = { chunkId: "c1", quote: "light energy into" };
    expect(verifyEvidence(feedback([quote]), CHUNKS)).toMatchObject({
      evidence: [quote],
      confidence: "HIGH",
      unsupported: false,
    });
  });

  it("can't be gamed with one-word quotes: only short quotes means LOW and unsupported", () => {
    const result = verifyEvidence(
      feedback([
        { chunkId: "c1", quote: "the" },
        { chunkId: "c2", quote: "light" },
      ]),
      CHUNKS,
    );
    expect(result).toMatchObject({
      evidence: [],
      confidence: "LOW",
      unsupported: true,
    });
  });

  it("keeps the surviving items in their original order", () => {
    const a = { chunkId: "c2", quote: "fix CO2 into sugar" };
    const b = { chunkId: "c1", quote: "made up words" };
    const c = { chunkId: "c1", quote: "in the chloroplasts" };
    expect(kept([a, b, c])).toEqual([a, c]);
  });
});

describe("verifyEvidence: normalization", () => {
  it("collapses whitespace, newlines and tabs on both sides", () => {
    expect(
      kept([
        { chunkId: "c1", quote: "chemical   energy. It\nhappens" },
        { chunkId: "c2", quote: "into sugar. It doesn’t" },
        { chunkId: "c1", quote: "  light energy into  " },
      ]),
    ).toHaveLength(3);
  });

  it("ignores case", () => {
    expect(
      kept([{ chunkId: "c2", quote: "THE CALVIN CYCLE uses atp" }]),
    ).toHaveLength(1);
  });

  it("straightens smart quotes in either the quote or the note", () => {
    expect(
      kept([
        { chunkId: "c2", quote: "It doesn't need light" },
        { chunkId: "c3", quote: 'a "fluid mosaic" of lipids' },
        { chunkId: "c3", quote: "a «fluid mosaic» of lipids" },
      ]),
    ).toHaveLength(3);
    const straight: SourceChunk[] = [
      { id: "s", text: 'It doesn\'t say "always".' },
    ];
    expect(
      kept([{ chunkId: "s", quote: "doesn’t say “always”" }], straight),
    ).toHaveLength(1);
  });

  it("straightens dashes and minus signs", () => {
    expect(
      kept([
        { chunkId: "c1", quote: "chloroplasts - mostly in" },
        { chunkId: "c1", quote: "chloroplasts – mostly in" },
        { chunkId: "c3", quote: "pores are 2-3 nm" },
        { chunkId: "c3", quote: "pores are 2−3 nm" },
        { chunkId: "c3", quote: "pores are 2‑3 nm" },
      ]),
    ).toHaveLength(5);
  });

  it("folds compatibility characters (NFKC): ligatures, ellipsis, full-width, NBSP", () => {
    expect(
      kept([
        { chunkId: "c3", quote: "fixed in size" },
        { chunkId: "c3", quote: "lipids and proteins... pores" },
        { chunkId: "c2", quote: "ＡＴＰ and NADPH" },
        { chunkId: "c2", quote: "Calvin cycle uses" },
      ]),
    ).toHaveLength(4);
  });

  it("still drops different wording after folding", () => {
    expect(
      kept([
        { chunkId: "c3", quote: "ﬁxed in shape" },
        { chunkId: "c3", quote: "lipids and sugars… pores" },
        { chunkId: "c2", quote: "ＡＤＰ and NADPH" },
        { chunkId: "c1", quote: "chloroplasts — only in the leaves" },
        { chunkId: "c2", quote: "It doesn’t need water directly." },
      ]),
    ).toEqual([]);
  });

  it("normalizeForMatch applies every rule", () => {
    expect(normalizeForMatch(" “The ﬁrst” — it’s\n\tFINE… ")).toBe(
      '"the first" - it\'s fine...',
    );
  });
});

describe("verifyEvidence: confidence and unsupported", () => {
  const real = { chunkId: "c1", quote: "light energy into" };
  const fake = { chunkId: "c1", quote: "dark energy into" };

  it.each<[Confidence, Confidence]>([
    ["HIGH", "MEDIUM"],
    ["MEDIUM", "MEDIUM"],
    ["LOW", "LOW"],
  ])("caps %s at %s when some evidence is dropped", (given, expected) => {
    const result = verifyEvidence(feedback([real, fake], given), CHUNKS);
    expect(result).toMatchObject({ confidence: expected, unsupported: false });
    expect(result.evidence).toEqual([real]);
  });

  it.each<Confidence>(["HIGH", "MEDIUM", "LOW"])(
    "leaves %s alone when nothing is dropped",
    (given) => {
      expect(verifyEvidence(feedback([real], given), CHUNKS)).toMatchObject({
        confidence: given,
        unsupported: false,
      });
    },
  );

  it.each<Confidence>(["HIGH", "MEDIUM", "LOW"])(
    "sets LOW and unsupported when all evidence is dropped (from %s)",
    (given) => {
      expect(
        verifyEvidence(feedback([fake, fake], given), CHUNKS),
      ).toMatchObject({
        evidence: [],
        confidence: "LOW",
        unsupported: true,
      });
    },
  );

  it("treats no evidence at all as unsupported", () => {
    expect(verifyEvidence(feedback([]), CHUNKS)).toMatchObject({
      confidence: "LOW",
      unsupported: true,
    });
  });

  it("treats no chunks at all as unsupported", () => {
    expect(verifyEvidence(feedback([real]), [])).toMatchObject({
      evidence: [],
      unsupported: true,
    });
  });

  it("decides `unsupported` itself, whatever the input says", () => {
    const claimed = { ...feedback([fake]), unsupported: false };
    expect(verifyEvidence(claimed, CHUNKS).unsupported).toBe(true);
    const denied = { ...feedback([real]), unsupported: true };
    expect(verifyEvidence(denied, CHUNKS).unsupported).toBe(false);
  });

  it("passes the other fields through and doesn't mutate its input", () => {
    const input = feedback([real, fake]);
    const snapshot = structuredClone(input);
    const result = verifyEvidence(input, CHUNKS);
    expect(input).toEqual(snapshot);
    expect(result).toMatchObject({
      verdict: "PARTIAL",
      whatCorrect: snapshot.whatCorrect,
      whatMissing: snapshot.whatMissing,
      outsideNotes: false,
    });
  });
});

describe("verifyEvidence: randomized", () => {
  // Seeded, so a failure reproduces: the seed is in the test name.
  const SEED = 0x7e18;
  function mulberry32(seed: number) {
    let s = seed;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NOTES: SourceChunk[] = [
    {
      id: "n1",
      text: "A recursive method calls itself on a smaller version of the same problem. Every recursive method needs a base case, which is answered directly, and a recursive case, which reduces the problem and combines the result. If the base case is never reached the calls never stop and the program runs out of stack space. Each call gets its own stack frame with its own parameters and local variables.",
    },
    {
      id: "n2",
      text: "TCP builds a reliable ordered byte stream on top of IP. The client sends SYN, the server answers with SYN ACK, and the client replies with ACK. The receiver sends cumulative acknowledgements and the sender retransmits after a timeout or three duplicate acknowledgements. Flow control protects the receiver while congestion control protects the network.",
    },
  ];
  // An independent check of "really in the note" for these plain-ASCII notes.
  const plain = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const inNote = (quote: string, chunk: SourceChunk) =>
    plain(chunk.text).includes(plain(quote));

  function makeGenerators(random: () => number) {
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(random() * items.length)];
    const words = (chunk: SourceChunk) => chunk.text.split(/\s+/);
    const slice = (chunk: SourceChunk, min: number, max: number) => {
      const all = words(chunk);
      const length = min + Math.floor(random() * (max - min + 1));
      const start = Math.floor(random() * (all.length - length));
      return all.slice(start, start + length);
    };
    const token = () =>
      Array.from({ length: 6 + Math.floor(random() * 5) }, () =>
        String.fromCharCode(97 + Math.floor(random() * 26)),
      ).join("");
    const vocabulary = [...words(NOTES[0]), ...words(NOTES[1])];

    const fabricated: ((chunk: SourceChunk) => string)[] = [
      // Real words with an invented one spliced in.
      (chunk) => {
        const quote = slice(chunk, 3, 8);
        quote.splice(Math.floor(random() * (quote.length + 1)), 0, token());
        return quote.join(" ");
      },
      // A real phrase with one word replaced by another word from the notes.
      (chunk) => {
        const quote = slice(chunk, 4, 10);
        const i = Math.floor(random() * quote.length);
        quote[i] = pick(
          vocabulary.filter((word) => plain(word) !== plain(quote[i])),
        );
        return quote.join(" ");
      },
      // A real phrase with two neighbouring words swapped.
      (chunk) => {
        const quote = slice(chunk, 4, 10);
        const i = Math.floor(random() * (quote.length - 1));
        [quote[i], quote[i + 1]] = [quote[i + 1], quote[i]];
        return quote.join(" ");
      },
      // A real phrase from the other note.
      (chunk) =>
        slice(NOTES.find((other) => other !== chunk) ?? chunk, 4, 10).join(" "),
    ];

    const disguise = (quote: string) =>
      quote
        .split(" ")
        .map((word) => (random() < 0.3 ? word.toUpperCase() : word))
        .join(pick([" ", "  ", "\n", "\t", " ", " \n "]));

    return { pick, slice, fabricated, disguise };
  }

  it(`200 random fabricated quotes never survive (seed ${SEED})`, () => {
    const random = mulberry32(SEED);
    const { pick, fabricated } = makeGenerators(random);
    for (let n = 0; n < 200; n++) {
      const chunk = pick(NOTES);
      let quote = fabricated[n % fabricated.length](chunk);
      // Regenerate the rare draw that is accidentally real (e.g. a swap of two equal words).
      while (inNote(quote, chunk))
        quote = fabricated[n % fabricated.length](chunk);
      const result = verifyEvidence(
        feedback([{ chunkId: chunk.id, quote }]),
        NOTES,
      );
      expect(result.evidence, `#${n}: ${quote}`).toEqual([]);
      expect(result.unsupported).toBe(true);
    }
  });

  it(`200 random real quotes always survive, however they're spaced or cased (seed ${SEED})`, () => {
    const random = mulberry32(SEED + 1);
    const { pick, slice, disguise } = makeGenerators(random);
    for (let n = 0; n < 200; n++) {
      const chunk = pick(NOTES);
      const quote = disguise(slice(chunk, 3, 12).join(" "));
      const result = verifyEvidence(
        feedback([{ chunkId: chunk.id, quote }]),
        NOTES,
      );
      expect(result.evidence, `#${n}: ${JSON.stringify(quote)}`).toHaveLength(
        1,
      );
      expect(result.unsupported).toBe(false);
    }
  });

  it("drops every real one- and two-word quote in the notes", () => {
    for (const chunk of NOTES) {
      const all = chunk.text.split(/\s+/);
      for (let i = 0; i < all.length; i++) {
        for (const quote of [all[i], all.slice(i, i + 2).join(" ")]) {
          expect(inNote(quote, chunk)).toBe(true);
          expect(
            verifyEvidence(feedback([{ chunkId: chunk.id, quote }]), NOTES)
              .evidence,
            quote,
          ).toEqual([]);
        }
      }
    }
  });
});

// T22 grades with the fake provider in tests, so its two evidence modes must behave as advertised.
describe("verifyEvidence with the fake provider's feedback", () => {
  afterEach(() => {
    setFakeFailure(null);
  });

  const grade = async () => {
    const notes = CHUNKS.map(
      (chunk) => `<chunk id="${chunk.id}" ref="Week 1">${chunk.text}</chunk>`,
    ).join("\n");
    const output = await createFakeTransport()({
      system: "Grade the answer.",
      user: `${notes}\n<student_answer>It makes sugar.</student_answer>`,
      schema: z.unknown(),
      model: "fake",
      task: "evaluateAnswer",
    });
    const graded = z
      .looseObject({
        evidence: z.array(z.object({ chunkId: z.string(), quote: z.string() })),
        confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
      })
      .parse(output);
    return verifyEvidence(graded, CHUNKS);
  };

  it("keeps the fake's normal evidence", async () => {
    const result = await grade();
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.unsupported).toBe(false);
  });

  it("drops all of the fake's fabricated evidence", async () => {
    setFakeFailure("fabricated_evidence");
    expect(await grade()).toMatchObject({
      evidence: [],
      confidence: "LOW",
      unsupported: true,
    });
  });
});
