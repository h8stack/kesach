import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import "./header.css";
import SearchBox from "../../components/searchBox";
import ImportLocal from "../../components/importLocal";
import {
  ConfigService,
  CollectionUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import { generateSnapshot } from "../../utils/file/backup";
import { isElectron } from "react-device-detect";
import { upgradeConfig, upgradeStorage } from "../../utils/file/common";
import DatabaseService from "../../utils/storage/databaseService";
import BookUtil from "../../utils/file/bookUtil";
import {
  scanFolderForNewBooks,
  AUTO_IMPORT_FOLDERS_KEY,
} from "../../utils/common";
import { LocalFileManager } from "../../utils/file/localFile";
import { useAppStore } from "../../store/useAppStore";

export interface HeaderProps {
  handleDrag: (isDrag: boolean) => void;
}

const collectionUtil = new CollectionUtil(ConfigService);
declare var window: any;

const Header = (props: HeaderProps) => {
  const isCollapsed = useAppStore((s) => s.sidebar.isCollapsed);
  const currentBook = useAppStore((s) => s.book.currentBook);
  const isSortDisplay = useAppStore((s) => s.manager.isSortDisplay);
  const handleSortDisplay = useAppStore((s) => s.handleSortDisplay);
  const handleLocalFileDialog = useAppStore((s) => s.handleLocalFileDialog);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleAbout = useAppStore((s) => s.handleAbout);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const handleCollectionDetailDialog = useAppStore(
    (s) => s.handleCollectionDetailDialog
  );
  const handleCurrentCollectionKey = useAppStore(
    (s) => s.handleCurrentCollectionKey
  );
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hasRunAutoImportRef = useRef<boolean>(false);

  const autoScanFoldersOnStart = async () => {
    if (!isElectron || hasRunAutoImportRef.current) return;
    hasRunAutoImportRef.current = true;
    try {
      const folders =
        ConfigService.getAllListConfig(AUTO_IMPORT_FOLDERS_KEY) || [];
      if (folders.length === 0) return;
      if (!useAppStore.getState().book.importBookFunc) {
        console.error("Auto import: no import function available");
        return;
      }
      for (const folderPath of folders) {
        await scanFolderForNewBooks(
          folderPath,
          useAppStore.getState().book.importBookFunc
        );
      }
    } catch (error) {
      console.error("Auto import folder scan error:", error);
    }
  };

  const handleOpenLastReadBook = async () => {
    let filePath = "";
    //open book when app start
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      filePath = ipcRenderer.sendSync("check-file-data");
    }
    if (
      ConfigService.getReaderConfig("isOpenBook") === "yes" &&
      !currentBook.key &&
      !filePath
    ) {
      let lastReadBookKey = ConfigService.getAllListConfig("recentBooks")[0];
      if (lastReadBookKey) {
        let collectionKey = collectionUtil.isCollection(lastReadBookKey)
          ? lastReadBookKey
          : collectionUtil.getActiveCollectionByBook(lastReadBookKey)?.key;
        if (collectionKey) {
          let collection = collectionUtil.getCollection(collectionKey);
          if (collection) {
            handleReadingBook(
              collectionUtil.getCollectionAsBook(collection)
            );
            handleCurrentCollectionKey(collectionKey);
            handleCollectionDetailDialog(true);
            return;
          }
        }
        let fullBook = await DatabaseService.getRecord(
          lastReadBookKey,
          "books"
        );
        if (fullBook) {
          handleReadingBook(fullBook);
          BookUtil.redirectBook(fullBook);
        }
      }
    }
  };

  const handleFinishUpgrade = () => {
    handleFetchBooks();
    setTimeout(() => {
      if (useAppStore.getState().sidebar.mode === "home") {
        navigate("/manager/home");
      }
    }, 2000);
  };

  useEffect(() => {
    const registeredIpcHandlers: [string, (...args: any[]) => any][] = [];

    const init = async () => {
      if (isElectron) {
        try {
          await generateSnapshot();
        } catch (error) {
          console.error("Failed to generate snapshot:", error);
        }
        const fs = window.electronAPI.fs;
        const path = window.electronAPI.path;
        const ipcRenderer = window.electronAPI;
        const dirPath = ipcRenderer.sendSync("user-data", "ping");
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(path.join(dirPath, "data", "book"), { recursive: true });
        }

        if (
          ConfigService.getReaderConfig("storageLocation") &&
          !ConfigService.getItem("storageLocation")
        ) {
          ConfigService.setItem(
            "storageLocation",
            ConfigService.getReaderConfig("storageLocation")
          );
        }

        //Check for data update
        //upgrade data from old version
        let res1 = await upgradeStorage(handleFinishUpgrade);
        let res2 = await upgradeConfig();
        if (!res1 || !res2) {
          console.error("upgrade failed");
        }

        const openBookFromLinkHandler = async (config: any) => {
          const book = await DatabaseService.getRecord(config.bookKey, "books");
          if (book) {
            BookUtil.redirectBook(book);
          }
        };
        const openNoteFromLinkHandler = async (config: any) => {
          const note = await DatabaseService.getRecord(config.noteKey, "notes");
          if (!note) return;
          const book = await DatabaseService.getRecord(note.bookKey, "books");
          if (!book) return;
          let bookLocation: any = {};
          try {
            bookLocation = JSON.parse(note.cfi) || {};
          } catch (error) {
            bookLocation.cfi = note.cfi;
            bookLocation.chapterTitle = note.chapter;
          }
          if (bookLocation.fingerprint) {
            bookLocation.chapterDocIndex = bookLocation.page - 1 + "";
            bookLocation.chapterHref = "title" + (bookLocation.page - 1);
          }
          ConfigService.setObjectConfig(
            note.bookKey,
            bookLocation,
            "recordLocation"
          );
          BookUtil.redirectBook(book);
        };
        registeredIpcHandlers.push(
          ["open-book-from-link", openBookFromLinkHandler],
          ["open-note-from-link", openNoteFromLinkHandler]
        );
        for (const [channel, handler] of registeredIpcHandlers) {
          ipcRenderer.on(channel, handler);
        }
      } else {
        await upgradeConfig();
        const status = await LocalFileManager.getPermissionStatus();
        if (
          !ConfigService.getItem("isUseLocal") &&
          LocalFileManager.isSupported()
        ) {
          handleLocalFileDialog(true);
        } else if (
          ConfigService.getItem("isUseLocal") === "yes" &&
          !status.directoryName
        ) {
          handleLocalFileDialog(true);
        } else if (
          ConfigService.getItem("isUseLocal") === "yes" &&
          (status.needsReauthorization || !status.hasAccess)
        ) {
          handleLocalFileDialog(true);
        }
      }
      handleOpenLastReadBook();
      autoScanFoldersOnStart();
    };
    init();

    return () => {
      if (isElectron) {
        const ipcRenderer = window.electronAPI;
        for (const [channel, handler] of registeredIpcHandlers) {
          ipcRenderer.removeListener(channel, handler);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="header"
      style={isCollapsed ? { marginLeft: "40px" } : {}}
    >
      <div
        className="header-search-container"
        style={isCollapsed ? { width: "369px" } : {}}
      >
        <SearchBox />
      </div>
      <div
        className="setting-icon-parrent"
        style={isCollapsed ? { marginLeft: "430px" } : {}}
      >
        <div
          className="setting-icon-container"
          onClick={() => {
            handleSortDisplay(!isSortDisplay);
          }}
          onMouseLeave={() => {
            handleSortDisplay(false);
          }}
          style={{ top: "18px" }}
        >
          <span
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Sort by")}
            data-tooltip-place="left"
          >
            <span className="icon-sort-desc header-sort-icon"></span>
          </span>
        </div>
        <div
          className="setting-icon-container"
          onClick={() => {
            handleSetting(true);
            handleAbout(false);
          }}
          onMouseLeave={() => {
            handleAbout(false);
          }}
          style={{ marginTop: "2px" }}
        >
          <span
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Setting")}
            data-tooltip-place="left"
          >
            <span
              className="icon-setting setting-icon"
              style={{ fontSize: "25px" }}
            ></span>
          </span>
        </div>
      </div>

      <ImportLocal
        {...({
          handleDrag: props.handleDrag,
        } as any)}
      />
    </div>
  );
};

export default Header;
