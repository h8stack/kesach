import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import "./searchBox.css";
import {
  ConfigService,
  CollectionUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import {
  buildAccentTolerantRegex,
  buildInBookSearchIndex,
  escapeRegExp,
  normalizeSearch,
  SearchTextCache,
  searchInBookIndex,
  type InBookSearchBlock,
  type InBookSearchResult,
} from "../../utils/file/searchUtil";
import { debounce } from "../../utils/common";
import { useLatest } from "../../utils/hooks/useLatest";
import DatabaseService from "../../utils/storage/databaseService";
import { useAppStore } from "../../store/useAppStore";

export interface SearchBoxProps {
  isNavSearch?: boolean;
  mode?: string;
  width?: string;
  height?: string;

  handleNavSearchState?: (state: string) => void;
  handleSearchList?: (searchList: any) => void;
}

const collectionUtil = new CollectionUtil(ConfigService);
const SEARCH_DEBOUNCE_MS = 200;
const IN_BOOK_INDEX_CACHE_LIMIT = 3;
const inBookSearchIndexCache = new Map<string, InBookSearchBlock[]>();

const getInBookSearchIndex = async (htmlBook: any) => {
  const cacheKey = htmlBook?.key || "current";
  const cached = inBookSearchIndexCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const chapterDocs = htmlBook?.rendition?.chapterDocList;
  if (!Array.isArray(chapterDocs) || chapterDocs.length === 0) {
    return [];
  }
  const index = await buildInBookSearchIndex(chapterDocs);
  if (index.length > 0) {
    if (inBookSearchIndexCache.size >= IN_BOOK_INDEX_CACHE_LIMIT) {
      const oldestKey = inBookSearchIndexCache.keys().next().value;
      if (oldestKey !== undefined) {
        inBookSearchIndexCache.delete(oldestKey);
      }
    }
    inBookSearchIndexCache.set(cacheKey, index);
  }
  return index;
};

/**
 * PDF results need a jump CFI in the engine's `text#page#line` format. Ask the
 * engine once per matched accent spelling, then map its results back to our
 * folded index. HTML results already carry their CFI.
 */
const resolvePdfSearchResults = async (
  htmlBook: any,
  entries: InBookSearchResult[]
) => {
  if (!entries.some((entry) => entry.kind === "pdf")) {
    return entries;
  }
  const engineCache = new Map<string, any[]>();
  const getEngineResults = async (keyword: string) => {
    const cacheKey = keyword.toLowerCase();
    if (!engineCache.has(cacheKey)) {
      const results = await htmlBook.rendition.doSearch(keyword);
      engineCache.set(cacheKey, results || []);
    }
    return engineCache.get(cacheKey) || [];
  };
  const findEngineMatch = (engineResults: any[], entry: InBookSearchResult) => {
    const target = normalizeSearch(entry.text);
    return (
      engineResults.find((item: any) => {
        try {
          const cfi = JSON.parse(item.cfi);
          return (
            normalizeSearch(item.excerpt) === target &&
            Number(cfi.chapterDocIndex) === entry.chapterDocIndex
          );
        } catch (error) {
          return false;
        }
      }) ||
      engineResults.find(
        (item: any) => normalizeSearch(item.excerpt) === target
      )
    );
  };
  const resolved: any[] = [];
  for (const entry of entries) {
    if (entry.kind !== "pdf") {
      resolved.push(entry);
      continue;
    }
    let match = findEngineMatch(await getEngineResults(entry.keyword), entry);
    if (!match) {
      match = findEngineMatch(
        (await htmlBook.rendition.doSearch(entry.text)) || [],
        entry
      );
    }
    if (match) {
      const cfi = JSON.parse(match.cfi);
      // The engine searched the whole block; only the actual occurrence should
      // be highlighted in the rendered PDF.
      cfi.keyword = entry.keyword;
      resolved.push({
        ...match,
        excerpt: entry.text,
        cfi: JSON.stringify(cfi),
      });
    } else {
      // Last-resort location: goToPosition also accepts the block text.
      resolved.push({
        excerpt: entry.text,
        cfi: JSON.stringify({
          text: entry.text,
          chapterTitle: entry.chapterTitle,
          chapterDocIndex: entry.chapterDocIndex,
          chapterHref: entry.chapterHref,
          count: "search",
          percentage: entry.percentage,
          keyword: entry.keyword,
        }),
      });
    }
  }
  return resolved;
};

const SearchBox = (props: SearchBoxProps) => {
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const isNavLocked = useAppStore((s) => s.reader.isNavLocked);
  const isSearch = useAppStore((s) => s.manager.isSearch);
  const isReading = useAppStore((s) => s.book.isReading);
  const tabMode = useAppStore((s) => s.sidebar.mode);
  const books = useAppStore((s) => s.manager.books);
  const notes = useAppStore((s) => s.reader.notes);
  const highlights = useAppStore((s) => s.reader.highlights);
  const handleSearchResults = useAppStore((s) => s.handleSearchResults);
  const handleSearch = useAppStore((s) => s.handleSearch);
  const { t } = useTranslation();
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const isComposingRef = useRef(false);
  const searchCacheRef = useRef(new SearchTextCache());
  const searchTokenRef = useRef(0);
  const allBooksPromiseRef = useRef<Promise<any[]> | null>(null);

  const loadAllBooks = () => {
    if (!allBooksPromiseRef.current) {
      allBooksPromiseRef.current = DatabaseService.getAllRecords("books")
        .then((records) => records || [])
        .catch((error) => {
          console.error("Failed to load books for search:", error);
          return [];
        });
    }
    return allBooksPromiseRef.current;
  };

  useEffect(() => {
    // Invalidate the full-record cache when the library changes; the next
    // search loads records on demand.
    allBooksPromiseRef.current = null;
  }, [books]);

  useEffect(() => {
    // Book/note text can change after import, edit or deletion.
    searchCacheRef.current.clear();
  }, [books, notes, highlights]);

  const collectBooksResults = (normalizedQuery: string, allBooks: any[]) => {
    const cache = searchCacheRef.current;
    const results: any[] = [];
    const deletedBookKeys = ConfigService.getAllListConfig("deletedBooks");
    (allBooks || []).forEach((book: any) => {
      if (!book?.key || deletedBookKeys.includes(book.key)) {
        return;
      }
      const haystack = cache.get(book.key, [
        book.name,
        book.author,
        book.publisher,
        book.identifier,
        book.key,
      ]);
      if (haystack.includes(normalizedQuery)) {
        results.push(book);
      }
    });
    collectionUtil.getCollectionList().forEach((collection) => {
      if (collectionUtil.isCollectionDeleted(collection.key)) return;
      const haystack = cache.get("collection-" + collection.key, [
        collection.name,
      ]);
      if (haystack.includes(normalizedQuery)) {
        results.push({ key: collection.key, name: collection.name });
      }
    });
    return results;
  };

  const collectNoteResults = (normalizedQuery: string) => {
    const cache = searchCacheRef.current;
    const source = tabMode === "note" ? notes : highlights;
    return (source || []).filter((item: any) => {
      const haystack = cache.get(item.key, [
        item.text,
        item.notes,
        item.chapter,
      ]);
      return haystack.includes(normalizedQuery);
    });
  };

  const handleGetSearchResults = async (keyword: string) => {
    const normalizedQuery = normalizeSearch(keyword.trim());
    if (!normalizedQuery) {
      return [];
    }
    if (tabMode === "note" || tabMode === "highlight") {
      return collectNoteResults(normalizedQuery);
    }
    const allBooks = await loadAllBooks();
    return collectBooksResults(normalizedQuery, allBooks);
  };

  const runHeaderSearch = async (keyword: string) => {
    const token = ++searchTokenRef.current;
    const results = await handleGetSearchResults(keyword);
    if (token !== searchTokenRef.current) {
      return;
    }
    handleSearchResults(results as any);
    handleSearch(keyword.trim().length > 0);
  };

  // The debounced callback is created once; route it through a ref so live
  // typing always uses the current tab, book list and store handlers.
  const runHeaderSearchRef = useLatest(runHeaderSearch);

  const debouncedHeaderSearchRef = useRef(
    debounce((keyword: string) => {
      runHeaderSearchRef.current(keyword);
    }, SEARCH_DEBOUNCE_MS)
  );

  useEffect(() => {
    if (props.isNavSearch) {
      let searchBox: any = document.querySelector(".header-search-box");
      searchBox && searchBox.focus();
    }
    return () => {
      debouncedHeaderSearchRef.current.cancel();
    };
  }, []);

  const search = async (q: string) => {
    props.handleNavSearchState?.("searching");
    let searchList: any[] = [];
    const chapterDocs = htmlBook?.rendition?.chapterDocList;
    if (Array.isArray(chapterDocs) && chapterDocs.length > 0) {
      const index = await getInBookSearchIndex(htmlBook);
      const indexedResults = searchInBookIndex(index, q);
      searchList = await resolvePdfSearchResults(htmlBook, indexedResults);
    }
    if (!searchList || searchList.length === 0) {
      // Non-reflowable formats (PDF/comic) or chapters that expose no
      // document fall back to the engine's literal search.
      searchList = await htmlBook.rendition.doSearch(q);
      if (!searchList || searchList.length === 0) {
        // Typed with diacritics but the book text lost them (or vice versa):
        // retry once with the fold-normalized query.
        const folded = normalizeSearch(q);
        if (folded && folded !== q.toLowerCase()) {
          searchList = await htmlBook.rendition.doSearch(folded);
        }
      }
    }
    if (!searchList) {
      searchList = [];
    }
    props.handleNavSearchState?.("pending");
    const regex =
      buildAccentTolerantRegex(q) ||
      new RegExp(escapeRegExp(q), "gi");
    props.handleSearchList?.(
      searchList.map((item: any) => {
        item.excerpt = item.excerpt.replace(
          regex,
          `<span class="content-search-text">$&</span>`
        );
        return item;
      })
    );
    props.handleNavSearchState?.("done");
  };

  const handleMouse = async () => {
    let value = searchBoxRef.current?.value || "";
    if (props.isNavSearch) {
      value && search(value);
    }
    setIsFocused(false);
    if (props.mode === "nav") {
      props.handleNavSearchState?.("searching");
    }
    const keyword = (
      document.querySelector(".header-search-box") as HTMLInputElement
    ).value;
    runHeaderSearch(keyword);
    if (props.mode === "nav") {
      props.handleNavSearchState?.("done");
    }
  };

  const handleKey = async (event: any) => {
    if (event.keyCode !== 13) {
      return;
    }
    let value = searchBoxRef.current?.value || "";
    if (props.isNavSearch || isReading) {
      value && search(value);
    }
    setIsFocused(false);
    if (event && event.keyCode === 13) {
      let keyword = (event.target as HTMLInputElement).value;
      runHeaderSearch(keyword);
      if (props.mode === "nav") {
        props.handleNavSearchState?.("done");
      }
    }
  };

  const handleCancel = () => {
    if (props.isNavSearch) {
      props.handleSearchList?.(null);
      props.handleNavSearchState?.("done");
    }
    debouncedHeaderSearchRef.current.cancel();
    searchTokenRef.current++;
    handleSearch(false);
    (document.querySelector(".header-search-box") as HTMLInputElement).value =
      "";
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        ref={searchBoxRef}
        className="header-search-box"
        onKeyDown={(event) => {
          if (isComposingRef.current) {
            return;
          }
          handleKey(event);
        }}
        onChange={(event) => {
          if (isComposingRef.current) {
            return;
          }
          debouncedHeaderSearchRef.current(event.target.value);
        }}
        onFocus={() => {
          setIsFocused(true);

          if (props.mode === "nav") {
            props.handleNavSearchState?.("focused");
          }
        }}
        placeholder={
          props.isNavSearch || props.mode === "nav"
            ? t("Search in the Book/Document")
            : tabMode === "note"
              ? t("Search my notes")
              : tabMode === "highlight"
                ? t("Search my highlights")
                : t("Search my library")
        }
        style={
          props.mode === "nav"
            ? {
                width: props.width,
                height: props.height,
                paddingRight: "30px",
              }
            : {}
        }
        onCompositionStart={() => {
          isComposingRef.current = true;
          if (props.mode === "nav") {
            props.handleNavSearchState?.("focused");
          }
          if (isNavLocked) {
            return;
          } else {
            ConfigService.setReaderConfig("isTempLocked", "yes");
            ConfigService.setReaderConfig("isNavLocked", "yes");
          }
        }}
        onCompositionEnd={(event) => {
          isComposingRef.current = false;
          if (ConfigService.getReaderConfig("isTempLocked") === "yes") {
            ConfigService.setReaderConfig("isNavLocked", "");
            ConfigService.setReaderConfig("isTempLocked", "");
          }
          debouncedHeaderSearchRef.current(
            (event.target as HTMLInputElement).value
          );
        }}
      />
      {isSearch && !isFocused ? (
        <span
          className="header-search-text"
          onClick={() => {
            handleCancel();
          }}
          style={props.mode === "nav" ? { right: "-9px", top: "14px" } : {}}
        >
          <span className="icon-close theme-color-delete"></span>
        </span>
      ) : (
        <span
          className="header-search-text"
          onClick={() => {
            handleMouse();
          }}
        >
          <span
            className="icon-search header-search-icon"
            style={props.mode === "nav" ? { right: "5px" } : {}}
          ></span>
        </span>
      )}
    </div>
  );
};

export default SearchBox;
