import { describe, expect, it } from "vitest";
import {
  buildAccentTolerantRegex,
  buildInBookSearchIndex,
  collectChapterTextBlocks,
  matchSearch,
  normalizeSearch,
  SearchTextCache,
  searchInBookIndex,
} from "./searchUtil";

type FakeElement = {
  tagName: string;
  textContent: string;
  children: FakeElement[];
};

const makeElement = (
  tagName: string,
  textContent: string,
  children: FakeElement[] = []
): FakeElement => ({
  tagName,
  textContent,
  children,
});

const makeDoc = (children: FakeElement[], bodyText = "") =>
  ({ body: { children, textContent: bodyText } }) as unknown as Document;

describe("normalizeSearch", () => {
  it("keeps ASCII fast path case-insensitive", () => {
    expect(normalizeSearch("Hello World")).toBe("hello world");
  });

  it("strips Vietnamese tone marks", () => {
    expect(normalizeSearch("Sách")).toBe("sach");
    expect(normalizeSearch("Tiếng Việt")).toBe("tieng viet");
    expect(normalizeSearch("văn học")).toBe("van hoc");
    expect(normalizeSearch("Đường")).toBe("duong");
    expect(normalizeSearch("Ơn")).toBe("on");
    expect(normalizeSearch("Thư")).toBe("thu");
  });

  it("is idempotent", () => {
    const once = normalizeSearch("Tiếng Việt");
    expect(normalizeSearch(once)).toBe(once);
  });

  it("handles empty input", () => {
    expect(normalizeSearch("")).toBe("");
  });
});

describe("matchSearch", () => {
  it("matches tone-less queries against accents", () => {
    expect(matchSearch("Sách", normalizeSearch("sach"))).toBe(true);
    expect(matchSearch("Tiếng Việt", normalizeSearch("tieng viet"))).toBe(
      true
    );
    expect(matchSearch("Đường phố", normalizeSearch("duong"))).toBe(true);
    expect(matchSearch("Sách", normalizeSearch("truyen"))).toBe(false);
  });

  it("matches accented queries against tone-less text", () => {
    expect(matchSearch("sach hay", normalizeSearch("sách"))).toBe(true);
  });
});

describe("buildAccentTolerantRegex", () => {
  it("matches accented text with a tone-less pattern", () => {
    const regex = buildAccentTolerantRegex("sach");
    expect(regex).not.toBeNull();
    expect("Sách hay".match(regex as RegExp)?.[0]).toBe("Sách");
  });

  it("matches đ/d, ơ/o, ư/u variants", () => {
    expect("Đường".match(buildAccentTolerantRegex("duong") as RegExp)?.[0]).toBe(
      "Đường"
    );
    expect("Thư".match(buildAccentTolerantRegex("thu") as RegExp)?.[0]).toBe(
      "Thư"
    );
    expect("Ơn".match(buildAccentTolerantRegex("on") as RegExp)?.[0]).toBe(
      "Ơn"
    );
  });

  it("escapes regex special characters", () => {
    const regex = buildAccentTolerantRegex("a.b") as RegExp;
    expect("a.b".match(regex)?.[0]).toBe("a.b");
    expect("axb".match(regex)).toBeNull();
  });
});

describe("SearchTextCache", () => {
  it("caches normalized haystacks by id", () => {
    const cache = new SearchTextCache();
    const first = cache.get("b1", ["Sách", "Nguyễn Du"]);
    const second = cache.get("b1", ["ignored after cache"]);
    expect(first).toBe("sach nguyen du");
    expect(second).toBe(first);
    cache.clear();
    expect(cache.get("b1", ["Khác"])).toBe("khac");
  });
});

describe("collectChapterTextBlocks", () => {
  it("returns leaf paragraph blocks in document order", () => {
    const doc = makeDoc([
      makeElement("H1", "Chương một"),
      makeElement("P", "Sách hay về tiếng Việt."),
      makeElement("DIV", "Đọc sách", [makeElement("P", "Đọc sách")]),
    ]);
    expect(collectChapterTextBlocks(doc)).toEqual([
      "Chương một",
      "Sách hay về tiếng Việt.",
      "Đọc sách",
    ]);
  });

  it("deduplicates identical paragraphs and falls back to body text", () => {
    expect(
      collectChapterTextBlocks(
        makeDoc([
          makeElement("P", "Sách"),
          makeElement("P", "Sách"),
          makeElement("P", "Hay"),
        ])
      )
    ).toEqual(["Sách", "Hay"]);
    expect(collectChapterTextBlocks(makeDoc([], "Chỉ có text"))).toEqual([
      "Chỉ có text",
    ]);
  });
});

describe("in-book search index", () => {
  const chapterDocs = [
    {
      label: "Chương một",
      href: "c1.xhtml",
      text: {
        createDocument: () =>
          makeDoc([
            makeElement("P", "Sách hay về tiếng Việt."),
            makeElement("P", "Đường phố Hà Nội rất đẹp."),
          ]),
      },
    },
    {
      label: "Chương hai",
      href: "c2.xhtml",
      text: {
        createDocument: async () => makeDoc([makeElement("P", "Đọc sách")]),
      },
    },
    { label: "Cover", href: "cover.xhtml" },
  ];

  it("indexes every chapter that exposes a document", async () => {
    const index = await buildInBookSearchIndex(chapterDocs as any);
    expect(index).toHaveLength(3);
    expect(index[0]).toMatchObject({
      text: "Sách hay về tiếng Việt.",
      normalized: "sach hay ve tieng viet.",
      chapterTitle: "Chương một",
      chapterDocIndex: 0,
      chapterHref: "c1.xhtml",
      percentage: 0,
    });
    expect(index[2]).toMatchObject({
      text: "Đọc sách",
      chapterDocIndex: 1,
      percentage: 1 / 3,
    });
  });

  it("matches tone-less queries and keeps the book's accent spelling", async () => {
    const index = await buildInBookSearchIndex(chapterDocs as any);
    const results = searchInBookIndex(index, "sach");
    expect(results).toHaveLength(2);
    const first = JSON.parse(results[0].cfi);
    expect(first).toMatchObject({
      text: "Sách hay về tiếng Việt.",
      chapterTitle: "Chương một",
      chapterDocIndex: 0,
      chapterHref: "c1.xhtml",
      count: "search",
      percentage: 0,
      keyword: "Sách",
    });
    const second = JSON.parse(results[1].cfi);
    expect(second.keyword).toBe("sách");
    expect(second.chapterDocIndex).toBe(1);
  });

  it("matches đ/duong and returns nothing for absent queries", async () => {
    const index = await buildInBookSearchIndex(chapterDocs as any);
    const results = searchInBookIndex(index, "duong");
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].cfi).keyword).toBe("Đường");
    expect(searchInBookIndex(index, "khong co")).toEqual([]);
  });
});

describe("PDF in-book search index", () => {
  const pdfChapterDocs = [
    {
      label: "0",
      href: "title0",
      text: {
        getTextContent: async () => ({
          items: [
            { str: "Sách PDF Tiếng Việt", hasEOL: false },
            { str: "", hasEOL: true },
            { str: "Sách hay về tiếng Việt.", hasEOL: false },
            { str: " Đường phố Hà Nội", hasEOL: true },
            { str: "Tôi thích đọc sách mỗi ngày.", hasEOL: true },
          ],
        }),
      },
    },
  ];

  it("groups PDF text items at EOL boundaries", async () => {
    const index = await buildInBookSearchIndex(pdfChapterDocs as any);
    expect(index.map((block) => block.text)).toEqual([
      "Sách PDF Tiếng Việt",
      "Sách hay về tiếng Việt. Đường phố Hà Nội",
      "Tôi thích đọc sách mỗi ngày.",
    ]);
    expect(index[0]).toMatchObject({
      kind: "pdf",
      chapterTitle: "0",
      chapterHref: "title0",
      percentage: 0,
    });
  });

  it("returns tone-less PDF matches without a CFI for the caller", async () => {
    const index = await buildInBookSearchIndex(pdfChapterDocs as any);
    const results = searchInBookIndex(index, "sach");
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      kind: "pdf",
      excerpt: "Sách PDF Tiếng Việt",
      keyword: "Sách",
      cfi: "",
      chapterDocIndex: 0,
    });
    expect(results[1].keyword).toBe("Sách");
    expect(results[2].keyword).toBe("sách");

    const duong = searchInBookIndex(index, "duong");
    expect(duong).toHaveLength(1);
    expect(duong[0].keyword).toBe("Đường");
  });
});
