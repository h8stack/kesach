// Vietnamese-friendly, dependency-free search helpers.
//
// Vietnamese text carries two kinds of diacritics:
//  - tone marks (sắc, huyền, hỏi, ngã, nặng) which have canonical Unicode
//    decompositions (NFD) and can be stripped generically;
//  - letter modifiers: đ and the horn on ơ/ư, which have NO canonical
//    decomposition, so they need an explicit mapping.
// Folding both lets users search "sach" for "sách" (and "tieng viet" for
// "Tiếng Việt"), which is the expected behaviour for Vietnamese search.

const VIETNAMESE_EXTRA_MAP: Record<string, string> = {
  đ: "d",
  Đ: "d",
  ơ: "o",
  Ơ: "o",
  ư: "u",
  Ư: "u",
};

/**
 * Normalize a string for diacritic-insensitive, case-insensitive matching.
 * ASCII input takes a fast path (no normalization/regex work).
 */
export const normalizeSearch = (input: string): string => {
  if (!input) {
    return "";
  }
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7f]/.test(input)) {
    return input.toLowerCase();
  }
  let text = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  text = text.replace(/[đĐơƠưƯ]/g, (char) => VIETNAMESE_EXTRA_MAP[char] || char);
  return text.toLowerCase();
};

export const matchSearch = (haystack: string, normalizedQuery: string) => {
  if (!normalizedQuery) {
    return true;
  }
  return normalizeSearch(haystack).includes(normalizedQuery);
};

const SEARCH_CACHE_LIMIT = 5000;

/**
 * Small cache for normalized haystacks. Keyed by a stable id (book key, note
 * key, collection key...). Keeps repeated keystrokes cheap.
 */
export class SearchTextCache {
  private cache = new Map<string, string>();

  get(id: string, parts: (string | undefined | null)[]): string {
    const cached = this.cache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const text = normalizeSearch(parts.filter(Boolean).join(" "));
    if (this.cache.size >= SEARCH_CACHE_LIMIT) {
      this.cache.clear();
    }
    this.cache.set(id, text);
    return text;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Build a regular expression source string that matches every accented
 * variant of the given (usually tone-less) query. Used to highlight search
 * excerpts where the book text keeps its diacritics.
 */
const LOOSE_CHAR_CLASSES: Record<string, string> = {
  a: "aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ",
  e: "eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ",
  i: "iìíỉĩịIÌÍỈĨỊ",
  o: "oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ",
  u: "uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ",
  y: "yỳýỷỹỵYỲÝỶỸỴ",
  d: "dđDĐ",
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns a regex source that matches the query allowing Vietnamese
 * diacritics and đ/d, ơ/o, ư/u variations. Input should be tone-less to get
 * the widest match; accented input is folded internally.
 */
export const buildAccentTolerantPattern = (query: string): string => {
  const folded = normalizeSearch(query);
  let pattern = "";
  for (const char of folded) {
    if (LOOSE_CHAR_CLASSES[char.toLowerCase()]) {
      pattern += "[" + LOOSE_CHAR_CLASSES[char.toLowerCase()] + "]";
    } else if (/[a-z0-9]/.test(char)) {
      pattern += "[" + char.toLowerCase() + char.toUpperCase() + "]";
    } else {
      pattern += escapeRegExp(char);
    }
  }
  return pattern;
};

export const buildAccentTolerantRegex = (
  query: string,
  flags = "gi"
): RegExp | null => {
  const pattern = buildAccentTolerantPattern(query);
  if (!pattern) {
    return null;
  }
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    console.error("Failed to build accent tolerant regex:", error);
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/* In-book search                                                             */
/* -------------------------------------------------------------------------- */

export interface InBookChapterDoc {
  label?: string;
  href?: string;
  text?: {
    createDocument?: () => Document | Promise<Document>;
    getTextContent?: () =>
      | Promise<{ items?: PdfTextItem[] }>
      | { items?: PdfTextItem[] };
  };
}

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

export interface InBookSearchBlock {
  text: string;
  normalized: string;
  chapterTitle: string;
  chapterDocIndex: number;
  chapterHref: string;
  percentage: number;
  kind: "html" | "pdf";
}

export interface InBookSearchResult {
  excerpt: string;
  cfi: string;
  kind: "html" | "pdf";
  text: string;
  keyword: string;
  chapterTitle: string;
  chapterDocIndex: number;
  chapterHref: string;
  percentage: number;
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "blockquote",
  "pre",
  "section",
  "article",
  "figcaption",
  "dd",
  "dt",
  "caption",
]);

const isBlockElement = (element: Element): boolean =>
  BLOCK_TAGS.has(element.tagName.toLowerCase());

const hasBlockChild = (element: Element): boolean =>
  Array.from(element.children).some(isBlockElement);

const cleanText = (text: string | null | undefined): string =>
  (text || "").replace(/\s+/g, " ").trim();

const collectBlocks = (element: Element, blocks: string[]) => {
  for (const child of Array.from(element.children)) {
    if (isBlockElement(child)) {
      const text = cleanText(child.textContent);
      if (!text) {
        continue;
      }
      if (hasBlockChild(child)) {
        // Containers such as <div><p>…</p></div> should be indexed by their
        // leaf paragraphs, not as one giant block.
        collectBlocks(child, blocks);
      } else {
        blocks.push(text);
      }
    } else {
      // Inline wrappers and non-block containers may still hide paragraphs.
      collectBlocks(child, blocks);
    }
  }
};

/**
 * Extract the leaf text blocks of a chapter document. Search results mirror
 * the engine's paragraph-level excerpts, so one block == one result.
 */
export const collectChapterTextBlocks = (doc: Document): string[] => {
  if (!doc || !doc.body) {
    return [];
  }
  const blocks: string[] = [];
  collectBlocks(doc.body, blocks);
  if (blocks.length === 0) {
    const fallback = cleanText(doc.body.textContent);
    if (fallback) {
      blocks.push(fallback);
    }
  }
  return Array.from(new Set(blocks));
};

/**
 * PDF sections expose normalized text items instead of an HTML document.
 * Group them at the engine's line boundaries so excerpts match doSearch.
 */
export const collectPdfTextBlocks = (items: PdfTextItem[]): string[] => {
  const blocks: string[] = [];
  let current = "";
  for (const item of items || []) {
    current += typeof item?.str === "string" ? item.str : "";
    if (item?.hasEOL) {
      const text = cleanText(current);
      if (text) {
        blocks.push(text);
      }
      current = "";
    }
  }
  const tail = cleanText(current);
  if (tail) {
    blocks.push(tail);
  }
  return Array.from(new Set(blocks));
};

/**
 * Build a normalized block index for a book. Reflowable chapters expose
 * createDocument(), PDF pages expose getTextContent(); both are indexed so
 * in-book search no longer depends on the engine's literal doSearch.
 */
export const buildInBookSearchIndex = async (
  chapterDocs: InBookChapterDoc[]
): Promise<InBookSearchBlock[]> => {
  const blocks: InBookSearchBlock[] = [];
  const total = chapterDocs.length || 1;
  for (let index = 0; index < chapterDocs.length; index++) {
    const chapter = chapterDocs[index];
    const createDocument = chapter?.text?.createDocument;
    const getTextContent = chapter?.text?.getTextContent;
    try {
      let texts: string[] = [];
      let kind: "html" | "pdf" = "html";
      if (typeof createDocument === "function") {
        const doc = await createDocument.call(chapter.text);
        texts = collectChapterTextBlocks(doc);
      } else if (typeof getTextContent === "function") {
        kind = "pdf";
        const content = await getTextContent.call(chapter.text);
        texts = collectPdfTextBlocks(content?.items || []);
      } else {
        continue;
      }
      for (const text of texts) {
        blocks.push({
          text,
          normalized: normalizeSearch(text),
          chapterTitle: chapter.label || "",
          chapterDocIndex: index,
          chapterHref: chapter.href || "",
          percentage: index / total,
          kind,
        });
      }
    } catch (error) {
      console.error("Failed to index chapter for in-book search:", error);
    }
  }
  return blocks;
};

/**
 * Search the pre-built index. The returned objects have the same shape as
 * the engine's doSearch results so navigation/highlighting keeps working.
 */
export const searchInBookIndex = (
  blocks: InBookSearchBlock[],
  query: string
): InBookSearchResult[] => {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return [];
  }
  const regex = buildAccentTolerantRegex(query);
  const results: InBookSearchResult[] = [];
  for (const block of blocks) {
    if (!block.normalized.includes(normalizedQuery)) {
      continue;
    }
    let keyword = query;
    if (regex) {
      const match = block.text.match(regex);
      if (match && match[0]) {
        // Keep the accent spelling that actually exists in the book, otherwise
        // highlightSearchNode cannot find it in the rendered chapter.
        keyword = match[0];
      }
    }
    results.push({
      excerpt: block.text,
      cfi:
        block.kind === "html"
          ? JSON.stringify({
              text: block.text,
              chapterTitle: block.chapterTitle,
              chapterDocIndex: block.chapterDocIndex,
              chapterHref: block.chapterHref,
              count: "search",
              percentage: block.percentage,
              keyword,
            })
          : "",
      kind: block.kind,
      text: block.text,
      keyword,
      chapterTitle: block.chapterTitle,
      chapterDocIndex: block.chapterDocIndex,
      chapterHref: block.chapterHref,
      percentage: block.percentage,
    });
  }
  return results;
};

export { escapeRegExp };
