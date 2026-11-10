import Plugin from "../models/Plugin";
import { isElectron } from "react-device-detect";
import CryptoJS from "crypto-js";
import {
  CommonTool,
  ConfigService,
  KookitConfig,
  CollectionUtil,
} from "../assets/lib/kookit-extra-browser.min";
import Book from "../models/Book";
import BookUtil from "./file/bookUtil";
import * as Kookit from "../assets/lib/kookit.min";
import DatabaseService from "./storage/databaseService";
import toast from "react-hot-toast";
import i18n from "../i18n";
import localforage from "localforage";
import { languageCNMap, languageENMap } from "../constants/ttsList";
import { BookHelper } from "../assets/lib/kookit.min";
import { getBuiltinPluginDefinition } from "./plugins/catalog";
declare var window: any;
export const supportedFormats = [
  ".epub",
  ".pdf",
  ".txt",
  ".mobi",
  ".azw3",
  ".azw",
  ".kdz",
  ".htm",
  ".html",
  ".xml",
  ".xhtml",
  ".mhtml",
  ".docx",
  ".doc",
  ".rtf",
  ".md",
  ".fb2",
  ".chm",
  ".cbz",
  ".cbt",
  ".cbr",
  ".cb7",
  ".pptx",
  ".ppt",
  ".xps",
  ".oxps",
  ".djvu",
  ".djv",
  ".ofd",
  ".caj",
];
export interface HighlightValue {
  styleType: string;
  color: string;
}
export const calculateFileMD5 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (isElectron) {
      // Use the file path to compute md5 via streaming, avoid loading the
      // whole file into memory with FileReader.
      const filePath = (file as any).path;
      // Only use disk-path fast path when the file actually exists on disk
      // (file.path may also carry a virtual/cloud path).
      if (
        filePath &&
        window.electronAPI?.crypto?.fileMd5 &&
        window.electronAPI.fs.existsSync(filePath)
      ) {
        window.electronAPI.crypto
          .fileMd5(filePath)
          .then(resolve)
          .catch(() => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const arrayBuffer = event.target?.result as ArrayBuffer;
              resolve(
                window.electronAPI?.crypto.md5(new Uint8Array(arrayBuffer)) ||
                  ""
              );
            };
            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
          });
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          resolve(
            window.electronAPI?.crypto.md5(new Uint8Array(arrayBuffer)) || ""
          );
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
      }
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const wordArray = CryptoJS.lib.WordArray.create(
          new Uint8Array(arrayBuffer) as any
        );
        resolve(CryptoJS.MD5(wordArray).toString());
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    }
  });
};
export const vexPromptAsync = (message, placeholder = "", value = "") => {
  return new Promise((resolve) => {
    window.vex.dialog.buttons.YES.text = i18n.t("Confirm");
    window.vex.dialog.buttons.NO.text = i18n.t("Cancel");
    window.vex.dialog.prompt({
      message,
      placeholder,
      value,
      callback: function (input) {
        resolve(input);
      },
    });
  });
};
export const vexTextareaAsync = (message, value = "") => {
  return new Promise<string | false>((resolve) => {
    window.vex.dialog.buttons.YES.text = i18n.t("Confirm");
    window.vex.dialog.buttons.NO.text = i18n.t("Cancel");
    const textareaHtml = [
      `<div style="margin-bottom:10px">`,
      `<textarea name="vex-textarea" style="width:100%;height:200px;">${value}</textarea>`,
      `</div>`,
    ].join("");
    window.vex.dialog.open({
      unsafeMessage: message ? i18n.t(message).replace(/\n/g, "<br>") : "",
      input: textareaHtml,
      callback: function (data) {
        if (!data) {
          resolve(false);
        } else {
          resolve(data["vex-textarea"] ?? "");
        }
      },
    });
  });
};

export const vexComfirmAsync = (
  message: string,
  confirmText: string = "Confirm",
  cancelText: string = "Cancel"
) => {
  return new Promise((resolve) => {
    window.vex.dialog.buttons.YES.text = i18n.t(confirmText);
    window.vex.dialog.buttons.NO.text = i18n.t(cancelText);
    window.vex.dialog.confirm({
      unsafeMessage: i18n.t(message),
      contentClassName: "custom-confirm-width",
      callback: (value) => {
        if (value) {
          resolve(true);
        } else {
          resolve(false);
        }
      },
    });
  });
};
export const vexOpenAsync = (
  config: Record<string, any>,
  message: string,
  labels?: Record<string, string>,
  tutorialUrl?: string
) => {
  return new Promise<Record<string, any> | false>((resolve) => {
    window.vex.dialog.buttons.YES.text = i18n.t("Confirm");
    window.vex.dialog.buttons.NO.text = i18n.t("Cancel");
    const escapeAttr = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const keys = Object.keys(config).filter((k) => k && k.trim());
    const inputHtml = keys
      .map((key) => {
        const raw = config[key] ?? "";
        let placeholder = "";
        let value = "";
        let inputType = "text";
        if (typeof raw === "string") {
          placeholder = raw.indexOf("[") > -1 ? raw : "";
          value = raw.indexOf("[") === -1 ? raw : "";
        } else if (raw && typeof raw === "object") {
          placeholder = raw.placeholder || "";
          value = raw.value || "";
          inputType = raw.type || "text";
        }
        const displayLabel = labels?.[key] ?? key;
        return [
          `<div style="margin-bottom:10px">`,
          `<label style="display:block;margin-bottom:4px;font-weight:500">${displayLabel}</label>`,
          `<input name="${key}" type="${escapeAttr(
            inputType
          )}" placeholder="${escapeAttr(placeholder)}" value="${escapeAttr(
            value
          )}" style="width:100%" required />`,
          `</div>`,
        ].join("");
      })
      .join("");
    const buttons = [
      window.vex.dialog.buttons.YES,
      window.vex.dialog.buttons.NO,
      ...(tutorialUrl
        ? [
            {
              text: i18n.t("Tutorial"),
              type: "button",
              className: "vex-dialog-button-secondary",
              click: function () {
                openExternalUrl(tutorialUrl!);
              },
            },
          ]
        : []),
    ];
    window.vex.dialog.open({
      unsafeMessage: message ? i18n.t(message).replace(/\n/g, "<br>") : "",
      input: inputHtml,
      buttons,
      callback: function (data) {
        if (!data) {
          resolve(false);
        } else {
          const result: Record<string, any> = {};
          for (const key of keys) {
            result[key] = data[key] ?? "";
          }
          resolve(result);
        }
      },
    });
  });
};

export const vexPasswordInputAsync = (
  message: string,
  confirmMessage?: string,
  isNoOverlay?: boolean
) => {
  return new Promise<string | false>((resolve) => {
    window.vex.dialog.buttons.YES.text = i18n.t("Confirm");
    window.vex.dialog.buttons.NO.text = i18n.t("Cancel");
    const inputHtml = confirmMessage
      ? [
          `<div style="margin-bottom:10px">`,
          `<label style="display:block;margin-bottom:4px;font-weight:500">${i18n.t(message)}</label>`,
          `<input name="vex-pwd" type="password" style="width:100%" required />`,
          `</div>`,
          `<div style="margin-bottom:10px">`,
          `<label style="display:block;margin-bottom:4px;font-weight:500">${i18n.t(confirmMessage)}</label>`,
          `<input name="vex-pwd-confirm" type="password" style="width:100%" required />`,
          `</div>`,
        ].join("")
      : [
          `<div style="margin-bottom:10px">`,
          `<label style="display:block;margin-bottom:4px;font-weight:500">${i18n.t(message)}</label>`,
          `<input name="vex-pwd" type="password" style="width:100%" required />`,
          `</div>`,
        ].join("");
    window.vex.dialog.open({
      input: inputHtml,
      overlayClassName: isNoOverlay ? "no-overlay" : "",
      callback: function (data) {
        if (!data) {
          resolve(false);
          return;
        }
        const pwd: string = data["vex-pwd"] ?? "";
        if (!pwd) {
          resolve(false);
          return;
        }
        if (confirmMessage) {
          const confirm: string = data["vex-pwd-confirm"] ?? "";
          if (pwd !== confirm) {
            resolve(false);
            return;
          }
        }
        resolve(pwd);
      },
    });
  });
};

export const vexSelectAsync = (
  message: string,
  options: { value: string; label: string }[]
) => {
  return new Promise<string | false>((resolve) => {
    window.vex.dialog.buttons.YES.text = i18n.t("Confirm");
    window.vex.dialog.buttons.NO.text = i18n.t("Cancel");
    const optionsHtml = options
      .map((o) => `<option value="${o.value}">${i18n.t(o.label)}</option>`)
      .join("");
    const selectHtml = `<select name="vex-select" style="width:100%;padding:6px">${optionsHtml}</select>`;
    window.vex.dialog.open({
      unsafeMessage: i18n.t(message),
      input: selectHtml,
      callback: function (data) {
        if (!data) {
          resolve(false);
        } else {
          resolve(data["vex-select"] ?? false);
        }
      },
    });
  });
};

export const getFormatFromAudioPath = (audioPath: string) => {
  let format = "mp3";
  if (audioPath.indexOf(".wav") > -1) {
    format = "wav";
  } else if (audioPath.indexOf(".ogg") > -1) {
    format = "ogg";
  } else if (audioPath.indexOf(".flac") > -1) {
    format = "flac";
  } else if (audioPath.indexOf(".aac") > -1) {
    format = "aac";
  }
  return format;
};
/**
 * Returns the file name (no directory) without the last extension from a path or name.
 * Normalizes `/` and `\`, strips trailing separators, and leaves leading-dot names
 * (e.g. `.gitignore`) unchanged when there is no extension segment to remove.
 */
export const getFileNameWithoutExtension = (
  filePathOrName: string,
  fallback = ""
): string => {
  if (filePathOrName == null) {
    return fallback;
  }
  let normalized = String(filePathOrName).trim();
  if (!normalized) {
    return fallback;
  }

  normalized = normalized.replace(/[/\\]+$/, "");

  const lastSlash = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\")
  );
  const baseName =
    lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;

  if (!baseName) {
    return fallback;
  }
  if (baseName === "." || baseName === "..") {
    return baseName;
  }

  const lastDot = baseName.lastIndexOf(".");
  if (lastDot > 0) {
    return baseName.slice(0, lastDot);
  }
  return baseName;
};

export const sleep = (time: number) => {
  return new Promise((resolve) => setTimeout(resolve, time));
};

/** Default interval (ms) for window resize handlers. */
export const RESIZE_THROTTLE_MS = 300;

export function throttle<T extends (...args: any[]) => void>(
  func: T,
  wait: number = RESIZE_THROTTLE_MS
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const invoke = () => {
      lastCall = Date.now();
      func.apply(this, args);
    };

    if (now - lastCall >= wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      invoke();
    } else if (!timeoutId) {
      timeoutId = setTimeout(
        () => {
          timeoutId = null;
          invoke();
        },
        wait - (now - lastCall)
      );
    }
  };
}

/**
 * Trailing-edge debounce with a cancel method, used for live search inputs.
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      func.apply(this, args);
    }, wait);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

export const scrollContents = (chapterTitle: string, chapterHref: string) => {
  let contentBody = document.getElementsByClassName("navigation-body")[0];
  if (!contentBody) return;
  let contentList = contentBody.getElementsByClassName(
    "book-content-title-label"
  );
  let targetContent = Array.from(contentList).filter((item) => {
    item.setAttribute("style", "");
    let dataHref = (item as any).getAttribute("data-href");
    if (chapterHref) {
      return item.textContent === chapterTitle && dataHref === chapterHref;
    } else {
      return item.textContent === chapterTitle;
    }
  });
  if (targetContent.length > 0) {
    contentBody.scrollTo({
      left: 0,
      top: (targetContent[0] as any).offsetTop,
      behavior: "smooth",
    });
    targetContent[0].setAttribute("style", "color:red; font-weight: bold");
  }
};
export const handleFullScreen = () => {
  if (isElectron) {
    if (ConfigService.getReaderConfig("isOpenInMain") === "yes") {
      window.electronAPI.invoke("enter-tab-fullscreen", "ping");
    } else {
      window.electronAPI.invoke("enter-fullscreen", "ping");
    }
  } else {
    const el = document.documentElement as any;
    const requestFS =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    requestFS && requestFS.call(el);
  }
};
export const handleExitFullScreen = () => {
  if (isElectron) {
    if (ConfigService.getReaderConfig("isOpenInMain") === "yes") {
      window.electronAPI.invoke("exit-tab-fullscreen", "ping");
    } else {
      window.electronAPI.invoke("exit-fullscreen", "ping");
    }
  } else {
    const doc = document as any;
    const exitFS =
      doc.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;
    if (exitFS && doc.fullscreenElement) {
      exitFS.call(doc);
    }
  }
};
export const getStorageLocation = () => {
  if (isElectron) {
    return ConfigService.getItem("storageLocation")
      ? ConfigService.getItem("storageLocation")
      : window.electronAPI.sendSync("storage-location", "ping");
  } else {
    return ConfigService.getItem("storageLocation");
  }
};
export const getAllVoices = (pluginList: Plugin[]) => {
  let voiceList: any[] = [];
  for (
    let index = 0;
    index < pluginList.filter((item) => item.type === "voice").length;
    index++
  ) {
    const plugin = pluginList.filter((item) => item.type === "voice")[index];
    voiceList.push(...(plugin.voiceList as any[]));
  }
  return voiceList;
};
export const reloadManager = () => {
  if (isElectron) {
    window.electronAPI.invoke("reload-main", "ping");
  } else {
    window.location.reload();
  }
};
export const openExternalUrl = (
  url: string,
  isPlugin: boolean = false,
  type: string = "link"
) => {
  isElectron
    ? ConfigService.getReaderConfig("isUseBuiltIn") === "yes" || isPlugin
      ? window.electronAPI.invoke("open-url", { url, type })
      : window.electronAPI.shell.openExternal(url)
    : window.open(url);
};
export const getPageWidth = (
  readerMode: string,
  scale: string,
  margin: number,
  isNavLocked: boolean,
  isSettingLocked: boolean,
  isFitPage: boolean = false
) => {
  // 页间距与 kookit 渲染引擎的 getSectionGap 保持一致：
  // 未设置时取 min(60, 宽度/12)，只能取偶数
  const getPageGapValue = (width: number) => {
    const saved = parseInt(ConfigService.getReaderConfig("pageGap") || "");
    let value = isNaN(saved) ? Math.min(60, Math.floor(width / 12)) : saved;
    value = value % 2 === 0 ? value : value - 1;
    return Math.max(value, 0);
  };
  const findValidMultiple = (limit: number) => {
    let multiple = limit - (limit % 2);

    while (multiple >= 0) {
      const gap = getPageGapValue(multiple);
      if (multiple - gap >= 4 && ((multiple - gap) / 2) % 2 === 0) {
        return multiple;
      }
      multiple -= 2;
    }

    return limit;
  };
  if (isFitPage && (readerMode === "scroll" || readerMode === "single")) {
    // 固定左右侧边栏时，页面只在剩余可用区域内铺满，避免被侧边栏遮挡
    const panelWidth = 300;
    let pageWidth =
      document.body.clientWidth -
      106 -
      (isNavLocked ? panelWidth : 0) -
      (isSettingLocked ? panelWidth : 0);
    let pageOffset = 50 + (isNavLocked ? panelWidth : 0) + "px";
    return {
      pageOffset,
      pageWidth: pageWidth + "px",
    };
  }

  //缩放过高时按窗口宽度封顶
  if (
    document.body.clientWidth * 0.6 * Math.abs(parseFloat(scale)) >
    document.body.clientWidth
  ) {
    let pageWidth = document.body.clientWidth - 106;
    let pageOffset = 50 + "px";
    return {
      pageOffset,
      pageWidth: pageWidth + "px",
    };
  }

  let pageOffset = "";
  let pageWidth = 0;
  if (readerMode === "scroll" || readerMode === "single") {
    //页面宽度以 scale=1 的默认宽度（视口宽度 * 0.6）为基准等比例缩放，
    //使预设百分比与实际显示宽度成正比，避免低百分比时出现过窄页面
    let preWidth =
      document.body.clientWidth * 0.6 * Math.abs(parseFloat(scale)) -
      (isNavLocked ? 300 : 0) -
      (isSettingLocked ? 300 : 0);
    let width = findValidMultiple(preWidth);
    pageOffset = `calc(50vw + ${isNavLocked ? 150 : 0}px - ${
      isSettingLocked ? 150 : 0
    }px - ${width / 2}px)`;
    pageWidth = width;
  } else if (readerMode === "double") {
    let width = findValidMultiple(
      document.body.clientWidth -
        2 * margin -
        80 -
        (isNavLocked ? 300 : 0) -
        (isSettingLocked ? 300 : 0)
    );
    pageOffset = `calc(50vw + ${isNavLocked ? 150 : 0}px - ${
      isSettingLocked ? 150 : 0
    }px - ${width / 2}px)`;
    pageWidth = width;
  }
  if (pageWidth > document.body.clientWidth) {
    pageWidth = document.body.clientWidth - 106;
    pageOffset = 50 + "px";
  }
  return {
    pageOffset,
    pageWidth: pageWidth + "px",
  };
};
export const loadFontData = async () => {
  try {
    if (!window.queryLocalFonts) return [];
    const availableFonts = await window.queryLocalFonts();
    return availableFonts.map((font: any) => {
      return {
        label: font.fullName,
        value: `"${font.fullName}", "${font.postscriptName}", "${font.family}"`,
      };
    });
  } catch (error) {
    console.error(error);
  }
};

export const preCacheAllBooks = async (bookList: Book[]) => {
  for (let index = 0; index < bookList.length; index++) {
    const selectedBook = bookList[index];
    if (selectedBook.format === "PDF" || isFixedLayoutBook(selectedBook)) {
      continue;
    }
    if (
      await BookUtil.isBookExist(
        "cache-" + selectedBook.key,
        "zip",
        selectedBook.path
      )
    ) {
      continue;
    }

    let result: any = await BookUtil.fetchBook(
      selectedBook.key,
      selectedBook.format.toLowerCase(),
      true,
      selectedBook.path
    );
    let rendition = BookHelper.getRendition(
      result,
      {
        format: selectedBook.format,
        readerMode: "",
        charset: selectedBook.charset,
        animation: ConfigService.getReaderConfig("animation") || "none",
        convertChinese: ConfigService.getReaderConfig("convertChinese"),
        bookLayout: ConfigService.getReaderConfig("bookLayout") || "",
        textRules: getTextRules(selectedBook.key),
        codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
        fullTranslationMode: "no",
        textOrientation: ConfigService.getReaderConfig("textOrientation"),
        parserRegex: "",
        isDarkMode: "no",
        isMobile: "no",
        password: getPdfPassword(selectedBook),
        isScannedPDF:
          selectedBook.description.indexOf("scanned") > -1 ? "yes" : "no",
        isKeepPDFBackground: "no",
        pageGap: ConfigService.getReaderConfig("pageGap"),
      },
      Kookit
    );
    let cache = await rendition.preCache(result);
    if (cache !== "err" || cache) {
      await BookUtil.addBook("cache-" + selectedBook.key, "zip", cache);
      toast.dismiss("add-book");
    }
  }
};
export const handleContextMenu = (id: string, isInput: boolean = false) => {
  if (!isElectron) return;
  if (!window.electronAPI?.clipboard) return "";
  const clipboard = window.electronAPI.clipboard;
  const text = clipboard.readText();
  // fill the text into the box
  if (!isInput) {
    let textarea = document.getElementById(id) as HTMLTextAreaElement;
    textarea.value = text;
    textarea.textContent = text;
    triggerReactChange(id, text);
  } else {
    document.getElementById(id)?.setAttribute("value", text);
    triggerReactChange(id, text);
  }
};
function triggerReactChange(id: string, value: string) {
  const element: any = document.getElementById(id);
  if (!element) return;

  // 设置值
  element.value = value;

  // 创建合成事件对象
  const syntheticEvent = {
    target: {
      id: id,
      value: value,
    },
    currentTarget: {
      value: value,
    },
    preventDefault: () => {},
    stopPropagation: () => {},
  };

  // 获取 React 实例
  const reactPropKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  const reactInstance = reactPropKey ? element[reactPropKey] : null;

  // 调用 onChange 处理函数
  if (reactInstance && reactInstance.onChange) {
    reactInstance.onChange(syntheticEvent);
  }
}
export const getFullTranslationTarget = (): string => {
  const langCode =
    ConfigService.getReaderConfig("fullTranslationTarget") ||
    ConfigService.getReaderConfig("lang") ||
    "zhCN";
  return KookitConfig.ConvertLangMap[langCode];
};
export const getDefaultTransTarget = (langList) => {
  //reverse key and value
  let langMap = {};
  for (let key in langList) {
    langMap[langList[key]] = key;
  }

  const lang = ConfigService.getReaderConfig("lang") || "vi";
  const langKeys = Object.keys(langMap);
  let langTarget = langKeys.find((key) =>
    key.includes(KookitConfig.ConvertLangMap[lang])
  );
  return langMap[langTarget || "English"];
};
export const formatTimestamp = (timestamp) => {
  if (!timestamp) return "";

  const date = new Date(timestamp);
  // return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  return date.toLocaleDateString();
};
export const formatDateToDay = (value?: string): string => {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return String(value);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};
export const checkMissingBook = async () => {
  if (!isElectron) return;
  var fs = window.electronAPI.fs;
  var path = window.electronAPI.path;
  let bookList = (await BookUtil.getBookList()) as Book[];
  for (let index = 0; index < bookList.length; index++) {
    const book = bookList[index];
    let fileName = book.key + "." + book.format.toLowerCase();
    let expectedPath = path.join(getStorageLocation() || "", `book`, fileName);
    if (fs.existsSync(expectedPath)) {
      continue;
    }
    // create folder if not exists
    if (!fs.existsSync(path.join(getStorageLocation() || "", "book"))) {
      fs.mkdirSync(path.join(getStorageLocation() || "", "book"), {
        recursive: true,
      });
    }
    if (book.path && fs.existsSync(book.path)) {
      fs.copyFileSync(book.path, expectedPath);
    }
  }
};
export const getPdfPassword = (book: Book) => {
  if (book.format !== "PDF" || !book?.description) return "";
  // 匹配形如 protected PDF: #password# 的内容
  const match = book.description.match(/protected PDF: #(.+?)#/);
  return match ? match[1] : "";
};
export const compareVersions = (version1: string, version2: string) => {
  // Split strings by '.' and convert segments to numbers
  const parts1 = version1.split(".").map(Number);
  const parts2 = version2.split(".").map(Number);

  // Determine the maximum length to handle unequal segment counts
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    // Use 0 for missing segments in shorter versions
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) {
      return 1; // version1 is greater
    }
    if (part1 < part2) {
      return -1; // version2 is greater
    }
  }

  return 0; // Versions are equal
};
export const clearAllData = async () => {
  let deviceUuid = "";
  if (!isElectron) {
    deviceUuid = ConfigService.getItem("fingerPrint") || "";
  }
  localStorage.clear();
  sessionStorage.clear();
  if (deviceUuid && !isElectron) {
    ConfigService.setItem("fingerPrint", deviceUuid);
  }
  //clear all indexed db data

  if (isElectron) {
    let storageLocation = getStorageLocation();
    const fs = window.electronAPI.fs;
    let databaseList = CommonTool.databaseList;
    for (let i = 0; i < databaseList.length; i++) {
      await window.electronAPI.invoke("close-database", {
        dbName: databaseList[i],
        storagePath: getStorageLocation(),
      });
    }
    if (fs.existsSync(storageLocation)) {
      fs.rmSync(storageLocation, { recursive: true, force: true });
    }
    const ipcRenderer = window.electronAPI;
    ipcRenderer.invoke("clear-all-data", {});
  }
  await localforage.clear();
};
export const detectLocalLanguage = (text: string): string => {
  const chinesePattern = /[\u4e00-\u9fff\u3000-\u303f\uf900-\ufaff]/g;
  const japanesePattern = /[\u3040-\u309f\u30a0-\u30ff]/g;
  const koreanPattern = /[\uac00-\ud7af\u1100-\u11ff]/g;

  const chineseCount = (text.match(chinesePattern) || []).length;
  const japaneseCount = (text.match(japanesePattern) || []).length;
  const koreanCount = (text.match(koreanPattern) || []).length;

  const cjkTotal = chineseCount + japaneseCount + koreanCount;
  if (cjkTotal / text.length <= 0.3) return "en";

  if (chineseCount >= japaneseCount && chineseCount >= koreanCount) return "zh";
  if (japaneseCount >= chineseCount && japaneseCount >= koreanCount)
    return "ja";
  return "ko";
};
export interface TextRule {
  id: string;
  type: "replace" | "delete";
  pattern: string;
  replacement?: string;
  matchType: "regex" | "plain";
  scope: "all" | "book";
  bookKey?: string;
  bookName?: string;
}

export const getTextRules = (bookKey?: string): TextRule[] => {
  const ruleList: string[] =
    ConfigService.getAllListConfig("textRuleList") || [];
  return ruleList
    .map((id) => ConfigService.getObjectConfig(id, "textRules", null))
    .filter((rule): rule is TextRule => {
      if (!rule) return false;
      if (rule.scope === "all") return true;
      return !!bookKey && rule.bookKey === bookKey;
    });
};

export const getParserRegex = (extension: string, bookKey?: string) => {
  let parserRegex = "";
  if (extension.toLowerCase().endsWith("txt")) {
    let defaultTxtParser = "Default parser";
    // Per-book parser overrides the global setting
    if (bookKey) {
      const rule = ConfigService.getObjectConfig(bookKey, "bookRules", {});
      if (rule?.defaultTxtParser) {
        defaultTxtParser = rule.defaultTxtParser;
      }
    }
    //历史bug，部分parser的取值为null
    let txtParsers: any[] = [
      ...Object.values(ConfigService.getAllObjectConfig("txtParsers")).filter(
        (parser) => parser
      ),
      ...KookitConfig.ContentRegxConfig,
    ];
    let txtParser = txtParsers.find(
      (parser) => parser && parser.value === defaultTxtParser
    );
    if (txtParser) {
      parserRegex = txtParser.regex;
    }
  }
  return parserRegex;
};
export const parseColorInput = (input: string): string | null => {
  const trimmed = input.trim();
  // Hex format: #rgb or #rrggbb
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return (
      "#" +
      trimmed
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
        .toLowerCase()
    );
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  // rgb/rgba format
  const match = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/
  );
  if (match) {
    return (
      "#" +
      [match[1], match[2], match[3]]
        .map((v) =>
          Math.max(0, Math.min(255, parseInt(v, 10)))
            .toString(16)
            .padStart(2, "0")
        )
        .join("")
    );
  }
  return null;
};

export const normalizePickerColor = (
  color: string | undefined,
  fallback: string
): string => {
  if (!color) {
    return fallback;
  }

  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return `#${hex.toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      return `#${hex
        .split("")
        .map((item) => item + item)
        .join("")
        .toLowerCase()}`;
    }
    return fallback;
  }

  const match = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/
  );
  if (!match) {
    return fallback;
  }

  return `#${[match[1], match[2], match[3]]
    .map((item) => {
      const value = Math.max(0, Math.min(255, parseInt(item, 10)));
      return value.toString(16).padStart(2, "0");
    })
    .join("")}`;
};
export const splitSentences = (text: string, maxLength?: number) => {
  const lang = detectLocalLanguage(text);
  const resolvedMaxLength = maxLength ?? (lang === "en" ? 150 : 50);

  const segmenter = new (Intl as any).Segmenter(lang, {
    granularity: "sentence",
  });
  const segments = segmenter.segment(text);

  const sentences = Array.from(segments).map((s: any) => s.segment);
  const trimmed = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.trim() !== "");
  const splitLongSentence = (sentence: string): string[] => {
    if (sentence.length <= resolvedMaxLength) return [sentence];

    // Try splitting by common punctuation marks (Chinese and Western)
    // Avoid lookbehind (?<=) which is unsupported on low-version iOS Safari
    const rawParts = sentence.split(/([,，;；:：、…])/);
    const parts = [] as string[];
    for (let i = 0; i < rawParts.length; i += 2) {
      const merged = (rawParts[i] + (rawParts[i + 1] ?? "")).trim();
      if (merged.length > 0) {
        parts.push(merged);
      }
    }

    if (parts.length > 1) {
      // Greedily merge parts to minimize the number of resulting chunks
      const result: string[] = [];
      let current = "";
      for (const part of parts) {
        const candidate = current ? current + part : part;
        if (candidate.length <= resolvedMaxLength) {
          current = candidate;
        } else {
          if (current) result.push(current);
          // If a single part already exceeds maxLength, keep it as-is
          current = part;
        }
      }
      if (current) result.push(current);
      return result;
    }

    // No punctuation found, keep the sentence as-is
    return [sentence];
  };

  return trimmed
    .flatMap(splitLongSentence)
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
};
export const trimSpecialCharacters = (text: string) => {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
};
export const checkReachPageEnd = (
  nodeIndex: number,
  nodeList: {
    text: string;
    voiceName: string;
    voiceEngine: string;
  }[],
  visibleTextList: string[],
  currentBook: Book
) => {
  if (visibleTextList.length === 0) return true;
  if (
    ConfigService.getAllListConfig("multiRoleVoiceBooks").includes(
      currentBook?.key
    )
  ) {
    if (
      visibleTextList[visibleTextList.length - 1].indexOf("“") > -1 ||
      visibleTextList[visibleTextList.length - 1].indexOf('"') > -1
    ) {
      return visibleTextList[visibleTextList.length - 1].endsWith(
        nodeList[nodeIndex].text
      );
    } else {
      return (
        visibleTextList[visibleTextList.length - 1] === nodeList[nodeIndex].text
      );
    }
  }
  let nodeTextList = nodeList.map((node) => node.text);
  let lastMatchIndex = findLastMatchIndex(nodeTextList, visibleTextList);
  return lastMatchIndex === nodeIndex;
};
export const findLastMatchIndex = (a: string[], b: string[]) => {
  let lastMatchIndex = -1;
  let aIndex = 0;

  for (let i = 0; i < b.length; i++) {
    // 从当前 aIndex 开始在 a 中查找 b[i]
    for (let j = aIndex; j < a.length; j++) {
      if (a[j].trim() === b[i].trim()) {
        lastMatchIndex = j;
        aIndex = j + 1;
        break;
      }
    }
    // 如果没找到，继续查找下一个 b 元素
  }

  return lastMatchIndex;
};
export const langToName = (lang: string) => {
  let regionCode = lang.split("-")[1];
  let langCode = lang.split("-")[0];
  if (!languageENMap["languages"][langCode]) {
    return lang;
  }
  if ((ConfigService.getReaderConfig("lang") || "").startsWith("zh")) {
    return (
      languageCNMap["languages"][langCode] +
      (regionCode && languageCNMap["territories"][regionCode]
        ? " (" + languageCNMap["territories"][regionCode] + ")"
        : "")
    );
  } else {
    return (
      languageENMap["languages"][langCode] +
      (regionCode && languageENMap["territories"][regionCode]
        ? " (" + languageENMap["territories"][regionCode] + ")"
        : "")
    );
  }
};
// Old name → new hex color mapping for config migration
const LEGACY_COLOR_MAP: Record<string, string> = {
  blue: "#0179CA",
  green: "#008F91",
  red: "#F16464",
  purple: "#6867D1",
};

export function migrateConfig(): void {
  const current = ConfigService.getReaderConfig("themeColor");
  if (current && LEGACY_COLOR_MAP[current]) {
    ConfigService.setReaderConfig("themeColor", LEGACY_COLOR_MAP[current]);
  }
  const isUseLocal = ConfigService.getReaderConfig("isUseLocal");
  if (isUseLocal) {
    ConfigService.setItem("isUseLocal", isUseLocal);
    ConfigService.setReaderConfig("isUseLocal", "");
  }
}
export const BRUSH_COLORS = [
  "#E53131",
  "#F08C00",
  "#F5C400",
  "#1FA861",
  "#1B8CF0",
  "#6C5CE7",
  "#E54394",
  "#2C2C2C",
];

export const BRUSH_WIDTHS = [2, 4, 8, 14];
export const ERASER_WIDTH_MIN = 6;
export const ERASER_WIDTH_MAX = 60;
export const ERASER_WIDTH_STEP = 2;
export const ERASER_WIDTH_DEFAULT = 24;
export const HIGHLIGHTER_COLORS = [
  "#FFE54C",
  "#6FFB6B",
  "#FF8AD1",
  "#FFB05C",
  "#6CF2FF",
  "#C9A3FF",
  "#FF8A8A",
  "#7AB5FF",
];
export const HIGHLIGHTER_WIDTHS = [4, 8, 14, 20];
export const SHAPE_TYPES = ["rect", "circle", "ellipse", "line", "arrow"];
export const TEXT_SIZE_MIN = 12;
export const TEXT_SIZE_MAX = 72;
export const TEXT_SIZE_STEP = 1;
export const TEXT_COLORS = [
  "#E53131",
  "#F08C00",
  "#F5C400",
  "#1FA861",
  "#1B8CF0",
  "#6C5CE7",
  "#E54394",
  "#2C2C2C",
];
export const getDefaultOcrEngine = (currentBook: any) => {
  const engine = ConfigService.getReaderConfig(
    currentBook.description.indexOf("scanned") > -1
      ? "scannedOcrEngine"
      : "textOcrEngine"
  );
  if (engine) return engine;
  if (currentBook.description.indexOf("scanned") > -1) {
    return "paddle";
  } else {
    return "system-ocr";
  }
};
export const getOcrLangList = (engine: string) => {
  const pluginDefinition = getBuiltinPluginDefinition(engine);
  if (pluginDefinition?.type === "ocr") {
    const langList = pluginDefinition.langList;
    if (Array.isArray(langList)) {
      if (langList.length <= 1) {
        return [];
      }
      return langList.map((item) => ({
        label: item.nativeLang || item.lang,
        value: item.code,
        lang: item.code,
      }));
    }
    if (
      Object.keys(langList).length <= 1 &&
      !pluginDefinition.defaultConfig.language
    ) {
      return [];
    }
    return Object.entries(langList).map(([value, label]) => ({
      label: String(label),
      value,
      lang: value,
    }));
  }
  let list: any[];
  if (engine === "system-ocr") {
    list = [
      {
        label: "Auto",
        value: "auto",
        lang: "auto",
      },
    ];
  } else {
    list = [];
  }
  return list;
};
export const getDefaultOcrLang = (engine: string, currentBook: any) => {
  const pluginDefinition = getBuiltinPluginDefinition(engine);
  if (pluginDefinition?.type === "ocr") {
    const pluginLangList = getOcrLangList(engine);
    if (pluginLangList.length === 0) {
      return "";
    }
    const lang = ConfigService.getReaderConfig(
      currentBook.description.indexOf("scanned") > -1
        ? "scannedOcrLang"
        : "textOcrLang"
    );
    if (lang && pluginLangList.some((item) => item.value === lang)) {
      return lang;
    }
    return "";
  }
  const lang = ConfigService.getReaderConfig(
    currentBook.description.indexOf("scanned") > -1
      ? "scannedOcrLang"
      : "textOcrLang"
  );
  if (lang) return lang;
  if (engine === "system-ocr") {
    return "auto";
  }
};
export const CONTEXT_MENU_WIDTH = 200;
export const CONTEXT_MENU_ITEM_HEIGHT = 33;
export const CONTEXT_MENU_PADDING = 5;
export const CONTEXT_MENU_MARGIN = 8;
export const SUBMENU_GAP = 195; // 子菜单相对主菜单的水平偏移（约等于主菜单宽度）

export interface Viewport {
  width: number;
  height: number;
}

export function estimateMenuHeight(itemCount: number): number {
  return itemCount * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING * 2;
}

// 将菜单左上角 (left, top) 校正到视口内，菜单宽 menuWidth 高 menuHeight。
export function clampMenuPosition(
  left: number,
  top: number,
  menuWidth: number,
  menuHeight: number,
  viewport?: Viewport
): { left: number; top: number } {
  const vw = viewport || {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const clampedLeft = Math.max(
    CONTEXT_MENU_MARGIN,
    Math.min(left, vw.width - menuWidth - CONTEXT_MENU_MARGIN)
  );
  const clampedTop = Math.max(
    CONTEXT_MENU_MARGIN,
    Math.min(top, vw.height - menuHeight - CONTEXT_MENU_MARGIN)
  );
  return { left: clampedLeft, top: clampedTop };
}

// 定位子菜单：默认与触发项顶部对齐并向下展开；下方空间不足时向上展开，
// 让子菜单底部与触发项底部对齐，避免两者之间留下空隙，
// 否则鼠标从触发项移入子菜单时会先离开菜单区域导致菜单被关闭。
export function getSubmenuPosition(
  left: number,
  triggerTop: number,
  triggerHeight: number,
  menuWidth: number,
  menuHeight: number,
  viewport?: Viewport
): { left: number; top: number } {
  const vh = (viewport || {
    width: window.innerWidth,
    height: window.innerHeight,
  }).height;
  const top =
    triggerTop + menuHeight + CONTEXT_MENU_MARGIN > vh
      ? triggerTop + triggerHeight - menuHeight
      : triggerTop;
  return clampMenuPosition(left, top, menuWidth, menuHeight, viewport);
}

// 子菜单(宽 subWidth)从 anchorLeft 处向右(先叠 SUBMENU_GAP)展开是否会超右缘。
// 若超界应改为向左展开。
export function shouldSubmenuOpenLeft(
  anchorLeft: number,
  subWidth: number,
  viewport?: Viewport
): boolean {
  const vw = viewport || {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  return anchorLeft + SUBMENU_GAP + subWidth + CONTEXT_MENU_MARGIN > vw.width;
}

export const AUTO_IMPORT_FOLDERS_KEY = "autoImportFolders";

export interface BookPathIndex {
  existingPaths: Set<string>;
  sizeSet: Set<number>;
}

export const getBookPathIndex = async (): Promise<BookPathIndex> => {
  const existingPaths = new Set<string>();
  const sizeSet = new Set<number>();
  const bookListResult = await window.electronAPI.invoke(
    "custom-database-command",
    {
      query: `SELECT path, size FROM books`,
      dbName: "books",
      storagePath: ConfigService.getItem("storageLocation"),
      executeType: "all",
    }
  );
  (bookListResult || []).forEach((item: any) => {
    if (item.path) existingPaths.add(item.path);
    if (item.size != null) sizeSet.add(item.size);
  });
  return { existingPaths, sizeSet };
};

export const collectSupportedFiles = (
  fs: any,
  path: any,
  dirPath: string
): string[] => {
  let files: string[] = [];
  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory && !stat.isFile) {
        files = files.concat(collectSupportedFiles(fs, path, fullPath));
      } else if (stat.isFile) {
        const ext = path.extname(item).toLowerCase();
        if (supportedFormats.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  return files;
};

// Lightweight dedup: only read db size/path, no file read, no md5.
// A path match means already imported; a size match against any book in
// the library also counts as already imported, regardless of path.
export const scanFolderForNewBooks = async (
  folderPath: string,
  importFile: (file: any) => Promise<void>,
  index?: BookPathIndex
): Promise<number> => {
  const fs = window.electronAPI.fs;
  const path = window.electronAPI.path;
  const { existingPaths, sizeSet } = index || (await getBookPathIndex());
  const files = collectSupportedFiles(fs, path, folderPath);
  let imported = 0;
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile) continue;
      if (existingPaths.has(filePath)) continue;
      if (sizeSet.has(stat.size)) {
        continue;
      }
      const buffer = await fs.promises.readFile(filePath);
      const arraybuffer = new Uint8Array(buffer).buffer;
      const blob = new Blob([arraybuffer]);
      const file: any = new File([blob], fileName);
      file.path = filePath;
      await importFile(file);
      existingPaths.add(filePath);
      imported++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(
        i18n.t("Import failed") + ": " + fileName + " - " + errorMessage
      );
      console.error(`Error processing file ${filePath}:`, error);
    }
  }
  return imported;
};

export const getTarEntries = async (
  filePath: string
): Promise<{ entryPath: string; size: number; fileName: string }[]> => {
  if (!isElectron) {
    throw new Error("getTarEntries is only supported in Electron");
  }
  return await window.electronAPI.invoke("list-tar-file", { filePath });
};
export const getZipEntries = async (
  filePath: string
): Promise<{ entryPath: string; size: number; fileName: string }[]> => {
  if (!isElectron) {
    throw new Error("getZipEntries is only supported in Electron");
  }
  return await window.electronAPI.invoke("list-zip-file", { filePath });
};
export const clearComicTemp = () => {
  try {
    const fs = window.electronAPI.fs;
    const path = window.electronAPI.path;
    const base = path.join(path.dirname(getStorageLocation() || ""), "comic");
    if (fs.existsSync(base)) {
      fs.rmSync(base, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("clear comic temp error", e);
  }
};
const readArchiveBuffer = async (
  channel: string,
  entryPath: string,
  filePath: string
): Promise<ArrayBuffer> => {
  const extracted: string[] = await window.electronAPI.invoke(channel, {
    filePath,
    entries: [entryPath],
  });
  const extractedPath =
    Array.isArray(extracted) && extracted.length > 0 ? extracted[0] : "";
  if (!extractedPath) {
    throw new Error("Failed to extract archive entry");
  }
  const fs = window.electronAPI.fs;
  const buf: Buffer = fs.readFileSync(extractedPath);
  const arrayBuffer = new ArrayBuffer(buf.byteLength);
  new Uint8Array(arrayBuffer).set(buf);
  return arrayBuffer;
};
export const getTarBuffer = async (
  entryPath: string,
  filePath: string
): Promise<ArrayBuffer> => {
  if (!isElectron) {
    throw new Error("getTarBuffer is only supported in Electron");
  }
  return readArchiveBuffer("untar-file", entryPath, filePath);
};
export const getZipBuffer = async (
  entryPath: string,
  filePath: string
): Promise<ArrayBuffer> => {
  if (!isElectron) {
    throw new Error("getZipBuffer is only supported in Electron");
  }
  return readArchiveBuffer("unzip-file", entryPath, filePath);
};
export const isReadingAidMode = (format: string, bookKey: string) => {
  let isReadingRawPDF =
    format === "PDF" &&
    !ConfigService.getAllListConfig("convertPDFBooks").includes(bookKey);
  return (
    (ConfigService.getReaderConfig("isParagraphMode") === "yes" ||
      ConfigService.getReaderConfig("isSpeedReading") === "yes" ||
      ConfigService.getReaderConfig("isReadingRuler") === "yes") &&
    !isReadingRawPDF
  );
};
// OCR 配置指纹：把引擎/语言等 OCR 配置做到缓存 key 里，
// 切换 OCR 引擎或语言后旧缓存自动失效，不再命中旧结果
const sanitizeOcrConfigValue = (value: unknown): string => {
  const str = String(value ?? "").trim();
  return str ? str.replace(/[^A-Za-z0-9_-]/g, "-") : "default";
};

export const getOcrConfigKey = (ocrConfig?: {
  ocrEngine?: string;
  ocrLang?: string;
}): string => {
  if (ocrConfig && (ocrConfig.ocrEngine || ocrConfig.ocrLang)) {
    return (
      sanitizeOcrConfigValue(ocrConfig.ocrEngine) +
      "_" +
      sanitizeOcrConfigValue(ocrConfig.ocrLang)
    );
  }
  // 兜底：阅读器按当前 OCR 配置推导指纹
  return ["scannedOcrEngine", "scannedOcrLang", "textOcrEngine", "textOcrLang"]
    .map((key) => sanitizeOcrConfigValue(ConfigService.getReaderConfig(key)))
    .join("_");
};

export const getOcrCachePath = (
  bookKey: string,
  chapterDocIndex: string,
  ocrConfig?: { ocrEngine?: string; ocrLang?: string }
): string => {
  const electron = window.electronAPI;
  const dirPath = electron.sendSync("user-data", "ping");
  const ocrDir = electron.path.join(dirPath, "ocr");
  if (!electron.fs.existsSync(ocrDir)) {
    electron.fs.mkdirSync(ocrDir, { recursive: true });
  }
  return electron.path.join(
    ocrDir,
    bookKey + "_" + chapterDocIndex + "_" + getOcrConfigKey(ocrConfig) + ".json"
  );
};
export const clearOcrCache = (bookKey: string) => {
  if (!isElectron || !window.electronAPI || !window.electronAPI.fs) {
    return;
  }
  try {
    const electron = window.electronAPI;
    const dirPath = electron.sendSync("user-data", "ping");
    const ocrDir = electron.path.join(dirPath, "ocr");
    if (!electron.fs.existsSync(ocrDir)) {
      return;
    }
    const files = electron.fs.readdirSync(ocrDir);
    files.forEach((fileName: string) => {
      if (fileName.startsWith(bookKey + "_")) {
        electron.fs.unlinkSync(electron.path.join(ocrDir, fileName));
      }
    });
  } catch (error) {
    console.error("Failed to clear ocr cache:", error);
  }
};
export const isReadingRawPDF = (book: Book) => {
  return (
    book.format === "PDF" &&
    !ConfigService.getAllListConfig("convertPDFBooks").includes(book.key)
  );
};
export const isFixedLayoutComic = (book: Book) => {
  return (
    (book.format === "EPUB" ||
      book.format === "MOBI" ||
      book.format === "AZW3" ||
      book.format === "AZW") &&
    book.layout === "pre-paginated"
  );
};
// PDF（原始版式）、漫画（CB 系列）、PPTX/PPT、XPS、OXPS、DjVu、OFD 共用多 iframe 分页结构
export const isPaginatedBook = (book: Book) => {
  return (
    isReadingRawPDF(book) ||
    book.format.startsWith("CB") ||
    book.format === "PPTX" ||
    book.format === "PPT" ||
    book.format === "XPS" ||
    book.format === "OXPS" ||
    book.format === "DJVU" ||
    book.format === "DJV" ||
    book.format === "OFD" ||
    isFixedLayoutComic(book)
  );
};
// PPTX/PPT/XPS/OXPS/DjVu/OFD 复用漫画结构渲染，暂不支持笔记和高亮
export const isFixedLayoutBook = (book: Book) => {
  return (
    book.format === "PPTX" ||
    book.format === "PPT" ||
    book.format === "XPS" ||
    book.format === "OXPS" ||
    book.format === "DJVU" ||
    book.format === "DJV" ||
    book.format === "OFD" ||
    isFixedLayoutComic(book)
  );
};
export const getOcrCache = (
  bookKey: string,
  chapterDocIndex: string,
  ocrConfig: { ocrEngine?: string; ocrLang?: string }
) => {
  if (!isElectron || !window.electronAPI || !window.electronAPI.fs) {
    return null;
  }
  let cache = null;
  if (isElectron && window.electronAPI && window.electronAPI.fs) {
    try {
      const cachePath = getOcrCachePath(bookKey, chapterDocIndex, ocrConfig);
      const fs = window.electronAPI.fs;
      if (fs.existsSync(cachePath)) {
        cache = JSON.parse(fs.readFileSync(cachePath, "utf-8")) || {};
      }
    } catch (error) {
      console.error("Failed to load ocr cache:", error);
    }
  }
  return cache;
};

export const isRateLimitedResult = (text: string): boolean => {
  if (!text) {
    return false;
  }
  return (
    text.includes("You have reached the daily limit") ||
    text.includes("您已达到今日使用上限")
  );
};

export const saveOcrCache = (
  bookKey: string,
  chapterDocIndex: string,
  cache: { src?: string; text?: string },
  ocrConfig: { ocrEngine: string; ocrLang?: string }
) => {
  if (!isElectron || !window.electronAPI || !window.electronAPI.fs) {
    return;
  }
  if (isRateLimitedResult((cache && (cache.text || cache.src)) || "")) {
    return;
  }
  try {
    const cachePath = getOcrCachePath(bookKey, chapterDocIndex, ocrConfig);
    window.electronAPI.fs.writeFileSync(
      cachePath,
      JSON.stringify(cache),
      "utf-8"
    );
  } catch (error) {
    console.error("Failed to save ocr cache:", error);
  }
};
export const removeCollectionToTrash = (collectionKey: string) => {
  const collectionUtil = new CollectionUtil(ConfigService);
  const collection = collectionUtil.getCollection(collectionKey);
  if (collection) {
    collection.books.forEach((bookKey) => {
      if (collectionUtil.isCollection(bookKey)) {
        removeCollectionToTrash(bookKey);
        return;
      }
      ConfigService.setListConfig(bookKey, "deletedBooks");
      ConfigService.deleteListConfig(bookKey, "favoriteBooks");
    });
  }
  collectionUtil.dissolveCollection(collectionKey);
};

export const getCoverTheme = (format: string) => {
  switch (format) {
    case "PDF":
      return "rgba(55, 170, 81, 0.7)";
    case "TXT":
      return "rgba(251, 191, 16,1)";
    case "EPUB":
      return "rgba(33, 165, 241,1)";
    case "MOBI":
      return "rgba(255, 108, 110,1)";
    case "AZW3":
    case "AZW":
      return " #ff9900";
    case "MD":
      return "#5e7fff";
    case "FB2":
      return "#0063b1";
    case "CHM":
      return "#8e6fce";
    case "DOCX":
    case "DOC":
      return " #118CD9";
    case "RTF":
      return "#0F766E";
    case "CBT":
    case "CBZ":
    case "CB7":
    case "CBR":
      return "#00b6c2";
    case "PPTX":
    case "PPT":
      return "#C43E1C";
    case "XPS":
    case "OXPS":
      return "#744DA9";
    case "DJVU":
    case "DJV":
      return "#003366";
    case "OFD":
      return "#C2185B";
    default:
      return "#118CD9";
  }
};
