import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import "./importLocal.css";
import BookModel from "../../models/Book";
import { Trans } from "react-i18next";
import Dropzone from "react-dropzone";
import JSZip from "jszip";
import * as Kookit from "../../assets/lib/kookit.min";
import { isElectron } from "react-device-detect";
import BookUtil from "../../utils/file/bookUtil";
import toast from "react-hot-toast";
import {
  CommonTool,
  ConfigService,
} from "../../assets/lib/kookit-extra-browser.min";
import CoverUtil from "../../utils/file/coverUtil";
import {
  calculateFileMD5,
  clearComicTemp,
  getTextRules,
  isFixedLayoutBook,
  supportedFormats,
  throttle,
} from "../../utils/common";
import DatabaseService from "../../utils/storage/databaseService";
import { BookHelper } from "../../assets/lib/kookit.min";
import { convertCajToPdf, isCajFormat } from "../../utils/file/cajUtil";
import {
  buildImportRecords,
  importNoteRecords,
} from "../../utils/file/importData";
import { useAppStore } from "../../store/useAppStore";

export interface ImportLocalProps {
  handleDrag: (isDrag: boolean) => void;
}

export interface ImportLocalState {
  isOpenFile: boolean;
  isMoreOptionsVisible: boolean;
  width: number;
}

// Convert supportedFormats to react-dropzone v14+ accept format
// Key is MIME type, value is array of file extensions
const supportedFormatsAccept = supportedFormats.reduce<
  Record<string, string[]>
>((obj, ext) => {
  const extension = ext.replace(".", "");
  // CAJ and OFD have no widely registered MIME type, so the picker needs one from here.
  const mimeType = CommonTool.getMimeType(extension);
  if (mimeType) {
    if (!obj[mimeType]) obj[mimeType] = [];
    obj[mimeType].push(ext);
  }
  return obj;
}, {});
declare var window: any;
let clickFilePath = "";
// Comic 封面规则与 kookit comic-book.js 保持一致：取自然排序后的第一张图片
const COMIC_IMAGE_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".tif",
  ".tiff",
  ".jfif",
  ".jpe",
  ".heic",
  ".heif",
  ".avif",
];
const getComicImageExt = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() || "png";
  return ext === "jpg" ? "jpeg" : ext;
};

const ImportLocal = (props: ImportLocalProps) => {
  const books = useAppStore((s) => s.manager.books);
  const isCollapsed = useAppStore((s) => s.sidebar.isCollapsed);
  const deletedBooks = useAppStore((s) => s.manager.deletedBooks);
  const mode = useAppStore((s) => s.sidebar.mode);
  const shelfTitle = useAppStore((s) => s.sidebar.shelfTitle);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const handleAutoImportDialog = useAppStore((s) => s.handleAutoImportDialog);
  const handleImportBookFunc = useAppStore((s) => s.handleImportBookFunc);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setStateObj] = useState<ImportLocalState>(() => ({
    isOpenFile: false,
    width: document.body.clientWidth,
    isMoreOptionsVisible: false,
  }));
  const stateRef = useRef<ImportLocalState>(state);
  const setState = (
    patch:
      | Partial<ImportLocalState>
      | ((prev: ImportLocalState) => Partial<ImportLocalState>)
  ) => {
    const prev = stateRef.current;
    const partial =
      typeof patch === "function"
        ? (patch as (prev: ImportLocalState) => Partial<ImportLocalState>)(
            prev
          )
        : patch;
    const next = { ...prev, ...partial };
    stateRef.current = next;
    setStateObj(next);
  };
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const getMd5WithBrowserRef = useRef<((file: File) => Promise<void>) | null>(
    null
  );
  const handleFilePathRef = useRef<
    ((filePath: string) => Promise<void>) | null
  >(null);

  useEffect(() => {
    let focusHandler: (() => void) | null = null;
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      if (!ConfigService.getItem("storageLocation")) {
        ConfigService.setItem(
          "storageLocation",
          ipcRenderer.sendSync("storage-location", "ping")
        );
      }

      const filePath = ipcRenderer.sendSync("get-file-data");
      if (filePath && filePath !== ".") {
        handleFilePathRef.current?.(filePath);
      }
      focusHandler = () => {
        const _filePath = ipcRenderer.sendSync("get-file-data");
        if (_filePath && _filePath !== ".") {
          handleFilePathRef.current?.(_filePath);
        }
      };
      window.addEventListener("focus", focusHandler, false);

    }
    resizeHandlerRef.current = throttle(() => {
      setState({ width: document.body.clientWidth });
    });
    const resizeHandler = resizeHandlerRef.current;
    window.addEventListener("resize", resizeHandler);
    handleImportBookFunc((file: File) =>
      getMd5WithBrowserRef.current!(file)
    );

    return () => {
      if (focusHandler) {
        window.removeEventListener("focus", focusHandler);
        focusHandler = null;
      }
      if (resizeHandlerRef.current) {
        window.removeEventListener("resize", resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
    };
  }, []);
  const handleFilePath = async (filePath: string) => {
    clickFilePath = filePath;
    const fileName = window.electronAPI.path.basename(filePath);
    const stat = window.electronAPI.fs.statSync(filePath);
    const tempFile = new File([], fileName);
    tempFile.path = filePath;
    Object.defineProperty(tempFile, "size", {
      value: stat.size,
      writable: true,
      configurable: true,
    });
    let md5 = await calculateFileMD5(tempFile);

    let repeatBook: BookModel | null = await BookUtil.getBookByMd5(md5);
    if (repeatBook) {
      handleJump(repeatBook);
      return;
    }

    const fileTemp = new File([], fileName);
    fileTemp.path = filePath;
    Object.defineProperty(fileTemp, "size", {
      value: stat.size,
      writable: true,
      configurable: true,
    });

    setState({ isOpenFile: true });
    await getMd5WithBrowser(fileTemp);
  };
  handleFilePathRef.current = handleFilePath;
  const handleJump = (book: BookModel) => {
    ConfigService.setItem("tempBook", JSON.stringify(book));
    BookUtil.redirectBook(book);
    navigate("/manager/home");
  };
  const handleAddBook = (
    book: BookModel,
    buffer: ArrayBuffer,
    sourcePath?: string,
    isConverted = false
  ) => {
    return new Promise<void>(async (resolve) => {
      toast.loading(
        t("Importing") + ": " + book.name.substring(0, 50),
        {
          id: "add-book",
        }
      );
      let isImportPath =
        ConfigService.getReaderConfig("isImportPath") === "yes";
      // A converted book has no readable source file, so its PDF always has to
      // be written into the library; opening it in place is not an option.
      const isPreventAdd =
        !isConverted && ConfigService.getReaderConfig("isPreventAdd") === "yes";
      if (isElectron && isImportPath) {
        const fs = window.electronAPI.fs;
        if (!book.path || !fs.existsSync(book.path)) {
          isImportPath = false;
        }
      }
      if (stateRef.current.isOpenFile) {
        if (isPreventAdd) {
          //ignore

          await CoverUtil.addCover(book);
          //ignore
        } else {
          await BookUtil.addBook(
            book.key,
            book.format.toLowerCase(),
            buffer,
            sourcePath
          );
          await CoverUtil.addCover(book);
        }
        if (isPreventAdd) {
          handleJump(book);
          setState({ isOpenFile: false });
          toast.dismiss("add-book");
          return resolve();
        }
      } else {
        if (!isImportPath) {
          await BookUtil.addBook(
            book.key,
            book.format.toLowerCase(),
            buffer,
            sourcePath
          );
        }

        await CoverUtil.addCover(book);
      }

      handleReadingBook(book);
      ConfigService.setListConfig(book.key, "recentBooks");
      DatabaseService.saveRecord(book, "books")
        .then(() => {
          handleFetchBooks();
          if (mode === "shelf") {
            ConfigService.setMapConfig(
              shelfTitle,
              book.key,
              "shelfList"
            );
          }
          toast.success(
            t("Addition successful") +
              ": " +
              book.name.substring(0, 50),
            {
              id: "add-book",
            }
          );
          setTimeout(() => {
            stateRef.current.isOpenFile && handleJump(book);
            if (
              ConfigService.getReaderConfig("isOpenInMain") === "yes" &&
              stateRef.current.isOpenFile
            ) {
              setState({ isOpenFile: false });
              return;
            }
            setState({ isOpenFile: false });
            navigate("/manager/home");
          }, 100);
          return resolve();
        })
        .catch((error) => {
          console.error(error, book.name);
          toast.error(
            t("Import failed") + ": " + book.name.substring(0, 50),
            {
              duration: 4000,
              id: "add-book",
            }
          );
          return resolve();
        });
    });
  };

  const getMd5WithBrowser = async (file: File) => {
    return new Promise<void>(async (resolve) => {
      const md5 = await calculateFileMD5(file);
      if (!md5) {
        console.error("md5 error", file.name);
        toast.error(t("Import failed") + ": " + file.name, {
          duration: 4000,
        });
        return resolve();
      } else {
        try {
          await handleBook(file, md5);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          toast.error(errorMessage);
          console.error(error);
        }

        return resolve();
      }
    });
  };

  getMd5WithBrowserRef.current = getMd5WithBrowser;

  const handleBook = (file: File, md5: string) => {
    let extension = (file.name as string)
      .split(".")
      .reverse()[0]
      .toLocaleLowerCase();
    let bookName = file.name.substr(0, file.name.length - extension.length - 1);
    return new Promise<void>(async (resolve) => {
      let isRepeat = false;
      let repeatBook: BookModel | null = await BookUtil.getBookByMd5(md5);
      if (repeatBook) {
        isRepeat = true;
        if (books && books.length > 0) {
          books.forEach((item) => {
            if (item.key === repeatBook!.key) {
              toast.error(t("Duplicate book"));
              return resolve();
            }
          });
        }
        if (deletedBooks && deletedBooks.length > 0) {
          deletedBooks.forEach((item) => {
            if (item.key === repeatBook!.key) {
              toast.error(t("Duplicate book in trash bin"));
              return resolve();
            }
          });
        }
        return resolve();
      }
      if (!isRepeat) {
        // Pick the first candidate path that actually exists on disk.
        // There are two candidates:
        // 1. file.path - real disk path for drag & drop / dialog import,
        //    but a virtual cloud path for cloud import;
        // 2. clickFilePath - path captured when opening a book by click.
        const fs = isElectron ? window.electronAPI.fs : null;
        const candidates = [file.path, clickFilePath];
        let sourcePath = "";
        for (const candidate of candidates) {
          if (isElectron && candidate && fs.existsSync(candidate)) {
            sourcePath = candidate;
            break;
          }
        }
        // Path only used for the database record, never for file IO.
        // Keeps the original path (or URL) when it can't be verified on disk,
        // falling back to the original file name, so book.path is never empty.
        const recordPath = sourcePath || file.path || file.name;
        if (sourcePath) {
          try {
            if (
              extension.toUpperCase() === "CBZ" ||
              extension.toUpperCase() === "CBT"
            ) {
              await handleComicImport(
                file,
                bookName,
                extension,
                md5,
                sourcePath,
                resolve
              );
              return;
            }
            const content = window.electronAPI.fs.readFileSync(sourcePath);
            const file_content = content.buffer as ArrayBuffer;
            const realSize = content.byteLength;
            await processBookContent(
              bookName,
              extension,
              md5,
              file_content,
              file.size || realSize,
              sourcePath,
              recordPath,
              resolve
            );
          } catch (error) {
            console.error(error, bookName);
            toast.error(t("Import failed") + ": " + bookName, {
              duration: 4000,
            });
            return resolve();
          }
          return;
        }
        let reader = new FileReader();
        reader.onload = async (event) => {
          if (!event.target) {
            console.error("e.target error", bookName);
            toast.error(t("Import failed") + ": " + bookName, {
              duration: 4000,
            });
            return resolve();
          }
          const file_content = event.target.result as ArrayBuffer;
          await processBookContent(
            bookName,
            extension,
            md5,
            file_content,
            file.size,
            sourcePath,
            recordPath,
            resolve
          );
        };
        reader.onerror = () => {
          console.error("reader error", bookName);
          toast.error(t("Import failed") + ": " + bookName, {
            duration: 4000,
          });
          return resolve();
        };
        reader.readAsArrayBuffer(file);
      }
    });
  };

  const handleComicImport = async (
    file: File,
    bookName: string,
    extension: string,
    md5: string,
    sourcePath: string,
    resolve: (value: void) => void
  ) => {
    try {
      if (!isElectron) {
        toast.error(t("Import failed") + ": " + bookName, {
          duration: 4000,
        });
        return resolve();
      }
      const ipcRenderer = window.electronAPI;
      const fs = window.electronAPI.fs;
      const isZip = extension.toUpperCase() === "CBZ";
      // 只读取归档索引，不解压完整文件
      const entryList: {
        entryPath: string;
        size: number;
        fileName: string;
      }[] = await ipcRenderer.invoke(
        isZip ? "list-zip-file" : "list-tar-file",
        { filePath: sourcePath }
      );
      const images = entryList
        .filter((entry) =>
          COMIC_IMAGE_EXTS.some((ext) =>
            entry.entryPath.toLowerCase().endsWith(ext)
          )
        )
        .sort((a, b) =>
          a.entryPath.localeCompare(b.entryPath, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
      if (images.length === 0) {
        throw new Error(t("No image found in archive"));
      }
      const coverEntry = images[0].entryPath;
      const extracted: string[] = await ipcRenderer.invoke(
        isZip ? "unzip-file" : "untar-file",
        { filePath: sourcePath, entries: [coverEntry] }
      );
      const extractedPath =
        Array.isArray(extracted) && extracted.length > 0 ? extracted[0] : "";
      if (!extractedPath || !fs.existsSync(extractedPath)) {
        throw new Error(t("Extract cover failed"));
      }
      const buf = fs.readFileSync(extractedPath);
      clearComicTemp();
      const cover = `data:image/${getComicImageExt(
        coverEntry
      )};base64,${CommonTool.arrayBufferToBase64(buf)}`;
      const stat = fs.statSync(sourcePath);
      const key = new Date().getTime() + "" + Math.floor(Math.random() * 1000);
      const book = new BookModel(
        key,
        bookName,
        "",
        "",
        md5,
        cover,
        extension.toUpperCase(),
        "",
        stat.size || file.size || 0,
        images.length,
        sourcePath,
        ""
      );
      await handleAddBook(book, new ArrayBuffer(0), sourcePath);
      return resolve();
    } catch (error) {
      console.error(error, bookName);
      toast.error(t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return resolve();
    }
  };

  const processBookContent = async (
    bookName: string,
    extension: string,
    md5: string,
    file_content: ArrayBuffer,
    fileSize: number,
    filePath: string,
    recordPath: string,
    resolve: (value: void) => void
  ) => {
    if (extension === "kdz") {
      return await handleKdzBook(
        bookName,
        file_content,
        recordPath,
        resolve
      );
    }
    await importBookSource(
      bookName,
      extension,
      md5,
      file_content,
      fileSize,
      filePath,
      recordPath,
      false
    );
    return resolve();
  };

  // 解析 kdz 图书包：解包出书籍源文件走正常导入链路，随后导入包内笔记/高亮/生词
  const handleKdzBook = async (
    bookName: string,
    file_content: ArrayBuffer,
    _recordPath: string,
    resolve: (value: void) => void
  ) => {
    try {
      const zip = await JSZip.loadAsync(file_content);
      const innerEntry = Object.entries(zip.files).find(([name, file]) => {
        if (file.dir) return false;
        const innerExt = name.split(".").pop()?.toLowerCase();
        return (
          innerExt && innerExt !== "kdz" && supportedFormats.includes(`.${innerExt}`)
        );
      });
      if (!innerEntry) {
        throw new Error("Invalid kdz package");
      }
      const innerEntryName = innerEntry[0];
      const innerName = innerEntryName.split("/").pop() || innerEntryName;
      const innerExt = innerName.split(".").pop()?.toLowerCase() || "";
      const innerBuffer = await innerEntry[1].async("arraybuffer");
      const innerMd5 = await calculateFileMD5(
        new File([innerBuffer], innerName)
      );
      if (!innerMd5) {
        throw new Error("Md5 error: " + innerName);
      }
      const repeatBook: BookModel | null = await BookUtil.getBookByMd5(innerMd5);
      if (repeatBook) {
        toast.error(t("Duplicate book"));
        return resolve();
      }
      const innerBookName = innerName.substring(
        0,
        innerName.length - innerExt.length - 1
      );
      // 先校验包内笔记/高亮/生词数据，避免书籍已入库但数据损坏的半导入状态
      const records = await parseKdzRecords(zip);
      const innerBook = await importBookSource(
        innerBookName,
        innerExt,
        innerMd5,
        innerBuffer,
        innerBuffer.byteLength,
        // 书籍源文件在包内，磁盘上无可引用的原始路径，
        // 处理方式与 CAJ 转换后的 PDF 一致，必须写入书库
        "",
        "",
        false
      );
      if (!innerBook || !innerBook.key) {
        return resolve();
      }
      if (records.length > 0) {
        const preparedRecords = buildImportRecords(records);
        if (!preparedRecords) {
          console.error("Invalid data in kdz package: " + bookName);
          toast.error(t("Invalid data"));
          return resolve();
        }
        const result = await importNoteRecords(preparedRecords, {
          targetBookKey: (innerBook as BookModel).key,
        });
        if (result === "failed") {
          toast.error(t("Failed to import"));
          return resolve();
        }
        const { imported, skipped } = result as {
          imported: number;
          skipped: number;
        };
        toast.success(
          t(
            "Imported {{imported}} records, skipped {{skipped}} existing records",
            { imported, skipped }
          )
        );
      }
      return resolve();
    } catch (error) {
      console.error(error, bookName);
      toast.error(t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return resolve();
    }
  };

  // 解析 kdz 包内的 notes.json / highlights.json / words.json
  const parseKdzRecords = async (zip: JSZip): Promise<any[]> => {
    const jsonNames = ["notes.json", "highlights.json", "words.json"];
    const rawRecords: any[] = [];
    for (const jsonName of jsonNames) {
      const entry = zip.file(jsonName);
      if (!entry) {
        continue;
      }
      const content = await entry.async("string");
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        throw new Error("Invalid data in kdz package: " + jsonName);
      }
      rawRecords.push(...parsed);
    }
    return rawRecords;
  };

  // 从文件内容生成书籍元数据并入库（原 processBookContent 的核心逻辑）
  const importBookSource = async (
    bookName: string,
    extension: string,
    md5: string,
    file_content: ArrayBuffer,
    fileSize: number,
    filePath: string,
    recordPath: string,
    isConverted = false
  ): Promise<BookModel | null> => {
    let result: BookModel;
    try {
      if (isCajFormat(extension)) {
        toast.loading(
          t("Converting to PDF") + ": " + bookName.substring(0, 50),
          { id: "add-book" }
        );
        const reportProgress = throttle((fraction: number) => {
          toast.loading(
            t("Converting to PDF") +
              " (" +
              Math.round(fraction * 100) +
              "%)" +
              ": " +
              bookName.substring(0, 50),
            { id: "add-book" }
          );
        }, 500);
        file_content = await convertCajToPdf(file_content, reportProgress);
        // Everything downstream handles the converted bytes as a regular PDF
        // import; the original .caj is not referenced again.
        extension = "pdf";
        fileSize = file_content.byteLength;
        filePath = "";
        recordPath = "";
        isConverted = true;
      }
      let rendition = BookHelper.getRendition(
        file_content,
        {
          format: extension.toUpperCase(),
          readerMode: "",
          charset: "",
          animation: ConfigService.getReaderConfig("animation") || "none",
          convertChinese: ConfigService.getReaderConfig("convertChinese"),
          bookLayout: ConfigService.getReaderConfig("bookLayout"),
          textRules: getTextRules(),
          codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
          fullTranslationMode: "no",
          textOrientation: ConfigService.getReaderConfig("textOrientation"),
          parserRegex: "",
          isDarkMode: "no",
          isMobile: "no",
          password: "",
          isScannedPDF: "no",
          isKeepPDFBackground: "no",
        },
        Kookit
      );
      result = await BookHelper.generateBook(
        bookName,
        extension,
        md5,
        fileSize,
        recordPath,
        file_content,
        rendition
      );

      if (
        ConfigService.getReaderConfig("isPrecacheBook") === "yes" &&
        extension !== "pdf" &&
        !isFixedLayoutBook(result)
      ) {
        let cache = await rendition.preCache(file_content);
        if (cache !== "err" || cache) {
          await BookUtil.addBook("cache-" + result.key, "zip", cache);
        }
      }
    } catch (error) {
      console.error(error, bookName);
      toast.error(t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return null;
    }

    clickFilePath = "";

    // get metadata failed
    if (!result || !result.key) {
      console.error("get metadata failed", bookName);
      toast.error(t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return null;
    }
    await handleAddBook(
      result as BookModel,
      file_content as ArrayBuffer,
      filePath,
      isConverted
    );

    return result as BookModel;
  };

  const toggleMoreOptions = () => {
    setState((prevState) => ({
      isMoreOptionsVisible: !prevState.isMoreOptionsVisible,
    }));
  };

  // Handle auto import folder
  const handleAutoImport = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the Dropzone
    setState({ isMoreOptionsVisible: false });
    handleAutoImportDialog(true);
  };

  const render = () => {
    return (
      <Dropzone
        onDrop={async (acceptedFiles) => {
          props.handleDrag(false);
          for (let item of acceptedFiles) {
            if (isElectron && window.electronAPI.getPathForFile) {
              // Electron 32+ removed File.path and react-dropzone only fills
              // in a relative name, so resolve the real disk path via webUtils
              item.path = window.electronAPI.getPathForFile(item);
            }
            await getMd5WithBrowser(item);
          }
        }}
        accept={supportedFormatsAccept}
        multiple={true}
      >
        {({ getRootProps, getInputProps }) => (
          <div
            className="import-from-local"
            {...getRootProps()}
            style={
              isCollapsed && document.body.clientWidth < 950
                ? { width: "42px" }
                : {}
            }
          >
            {isCollapsed && stateRef.current.width < 950 ? null : (
              <div
                className="more-import-option"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering the Dropzone
                  toggleMoreOptions();
                }}
              >
                <span className="dropdown-triangle"></span>
                {stateRef.current.isMoreOptionsVisible && (
                  <div
                    className="more-options-dropdown"
                    onMouseLeave={toggleMoreOptions}
                    style={
                      stateRef.current.width < 950
                        ? {
                            bottom: "calc(100% + 5px)",
                            top: "unset",
                            right: "unset",
                            left: "-110px",
                          }
                        : {}
                    }
                  >
                    <div
                      className="more-option-item"
                      onClick={async (event) => {
                        event.stopPropagation(); // Prevent triggering the Dropzone
                        //select folder from local
                        if (isElectron) {
                          const ipcRenderer = window.electronAPI;
                          const newPath =
                            await ipcRenderer.invoke("select-path");
                          if (!newPath) {
                            return;
                          }
                          //get all files in the folder
                          const fs = window.electronAPI.fs;
                          const path = window.electronAPI.path;
                          const getAllFiles = (dirPath: string): string[] => {
                            let files: string[] = [];

                            try {
                              const items = fs.readdirSync(dirPath);

                              for (const item of items) {
                                const fullPath = path.join(dirPath, item);
                                const stat = fs.statSync(fullPath);

                                if (stat.isDirectory) {
                                  // Recursively get files from subdirectories
                                  files = files.concat(getAllFiles(fullPath));
                                } else if (stat.isFile) {
                                  // Check if file has supported format
                                  const ext = path
                                    .extname(item)
                                    .toLowerCase()
                                    .substring(1);
                                  if (supportedFormats.includes(`.${ext}`)) {
                                    files.push(fullPath);
                                  }
                                }
                              }
                            } catch (error) {
                              const errorMessage =
                                error instanceof Error
                                  ? error.message
                                  : String(error);
                              toast.error(errorMessage);
                              console.error(
                                `Error reading directory ${dirPath}:`,
                                error
                              );
                            }

                            return files;
                          };

                          // Get all supported book files
                          const allFiles = getAllFiles(newPath);
                          // Process each file
                          for (const filePath of allFiles) {
                            try {
                              const path = window.electronAPI.path;
                              const fileName = path.basename(filePath);

                              let file = new File([], fileName);
                              file.path = filePath;

                              await getMd5WithBrowser(file);
                            } catch (error) {
                              const errorMessage =
                                error instanceof Error
                                  ? error.message
                                  : String(error);
                              toast.error(errorMessage);
                              console.error(
                                `Error processing file ${filePath}:`,
                                error
                              );
                            }
                          }
                          setState({
                            isMoreOptionsVisible: false,
                          });
                        }
                      }}
                    >
                      <span className="more-option-text">
                        <Trans>Import folder</Trans>
                      </span>
                      {!isElectron && (
                        <input
                          type="file"
                          {...({
                            webkitdirectory: "",
                            mozdirectory: "",
                            directory: "",
                          } as React.InputHTMLAttributes<HTMLInputElement>)}
                          multiple
                          style={{
                            position: "absolute",
                            width: "100%",
                            height: "45px",
                            opacity: 0,
                            marginLeft: "-20px",
                            cursor: "pointer",
                          }}
                          onChange={async (e) => {
                            const files = e.target.files;
                            if (!files || files.length === 0) {
                              return;
                            }
                            for (let item of files) {
                              if (
                                !supportedFormats.find((format) =>
                                  item.name.toLowerCase().endsWith(format)
                                )
                              ) {
                                continue;
                              }
                              await getMd5WithBrowser(item);
                            }
                            toggleMoreOptions();
                          }}
                        ></input>
                      )}
                    </div>
                                                                                {isElectron && (
                      <div
                        className="more-option-item"
                        onClick={handleAutoImport}
                      >
                        <span className="more-option-text">
                          <Trans>Auto import folder</Trans>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="animation-mask-local"></div>
            {isCollapsed && stateRef.current.width < 950 ? (
              <span
                className="icon-folder"
                style={{ fontSize: "15px", fontWeight: 500 }}
              ></span>
            ) : (
              <span>
                <Trans>Import</Trans>
              </span>
            )}

            {!isElectron ? (
              <input
                type="file"
                id="import-book-box"
                className="import-book-box"
                name="file"
                {...getInputProps()}
              />
            ) : (
              <div
                className="import-book-box"
                onClick={async () => {
                  const ipcRenderer = window.electronAPI;
                  let filePaths = await ipcRenderer.invoke(
                    "select-book",
                    "ping"
                  );
                  for (let filePath of filePaths) {
                    try {
                      const path = window.electronAPI.path;
                      let file = new File([], path.basename(filePath));
                      file.path = filePath;

                      await getMd5WithBrowser(file);
                    } catch (error) {
                      const errorMessage =
                        error instanceof Error ? error.message : String(error);
                      toast.error(errorMessage);
                      console.error(
                        `Error processing file ${filePath}:`,
                        error
                      );
                    }
                  }
                }}
              ></div>
            )}
          </div>
        )}
      </Dropzone>
    );
  };

  return render();
};

export default ImportLocal;
