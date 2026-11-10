import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import "./pageWidget.css";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { Trans } from "react-i18next";
import {
  isFixedLayoutComic,
  isReadingRawPDF,
} from "../../utils/common";
import { isElectron } from "react-device-detect";
import DatabaseService from "../../utils/storage/databaseService";
import Note from "../../models/Note";
import ConfigUtil from "../../utils/file/configUtil";
import { useAppStore } from "../../store/useAppStore";

export interface PageWidgetState {
  isSingle: boolean;
  prevPage: number;
  nextPage: number;
  currentTime: string;
  percentage: string;
  ignoreNextPageChange: boolean;
}

declare var window: any;

const PageWidget = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const currentChapter = useAppStore((s) => s.reader.currentChapter);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const isNavLocked = useAppStore((s) => s.reader.isNavLocked);
  const isSettingLocked = useAppStore((s) => s.reader.isSettingLocked);
  const isDockedRight = useAppStore((s) => s.reader.isDockedRight);
  const backgroundColor = useAppStore((s) => s.reader.backgroundColor);
  const isHideFooter = useAppStore((s) => s.reader.isHideFooter);
  const isHideHeader = useAppStore((s) => s.reader.isHideHeader);
  const isShowPageBorder = useAppStore((s) => s.reader.isShowPageBorder);
  const textOrientation = useAppStore((s) => s.reader.textOrientation);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const isShowBookmark = useAppStore((s) => s.viewArea.isShowBookmark);
  const jumpPosition = useAppStore((s) => s.reader.jumpPosition);
  const handleJumpPosition = useAppStore((s) => s.handleJumpPosition);
  const handleFetchNotes = useAppStore((s) => s.handleFetchNotes);
  const { t } = useTranslation();
  const getFormattedTime = () => {
    const now = new Date();
    return (
      now.getHours().toString().padStart(2, "0") +
      ":" +
      now.getMinutes().toString().padStart(2, "0")
    );
  };

  const [state, setState] = useState<PageWidgetState>({
    isSingle: readerMode !== "double",
    prevPage: 0,
    nextPage: 0,
    currentTime: getFormattedTime(),
    percentage: "",
    ignoreNextPageChange: false,
  });

  const isFirst = useRef<Boolean>(true);
  const timeInterval = useRef<any>(null);
  const ignoreNextPageChange = useRef<boolean>(false);

  const setIgnoreNextPageChange = (value: boolean) => {
    ignoreNextPageChange.current = value;
    setState((prev) => ({ ...prev, ignoreNextPageChange: value }));
  };

  const handlePageNum = async (rendition) => {
    let pageInfo = await rendition.getProgress();
    if (!pageInfo) {
      return;
    }
    if (isReadingRawPDF(currentBook) || isFixedLayoutComic(currentBook)) {
      setState((prev) => ({
        ...prev,
        prevPage: pageInfo.currentPage,
        nextPage: pageInfo.currentPage + 1,
        percentage: pageInfo.percentage,
      }));
      return;
    }
    setState((prev) => ({
      ...prev,
      prevPage: prev.isSingle
        ? pageInfo.currentPage
        : pageInfo.currentPage * 2 - 1,
      nextPage: prev.isSingle ? pageInfo.currentPage : pageInfo.currentPage * 2,
      percentage: pageInfo.percentage,
    }));
  };

  const methodsRef = useRef<any>(null);
  methodsRef.current = {
    handlePageNum,
  };

  // componentDidMount + componentWillUnmount: 每分钟刷新一次时间
  useEffect(() => {
    timeInterval.current = setInterval(() => {
      setState((prev) => ({ ...prev, currentTime: getFormattedTime() }));
    }, 60000);
    return () => {
      if (timeInterval.current) {
        clearInterval(timeInterval.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UNSAFE_componentWillReceiveProps: htmlBook 从无到有，注册 rendition 监听
  const prevHtmlBookRef = useRef(htmlBook);
  useEffect(() => {
    const prevHtmlBook = prevHtmlBookRef.current;
    const nextHtmlBook = htmlBook;
    prevHtmlBookRef.current = nextHtmlBook;
    if (nextHtmlBook && nextHtmlBook !== prevHtmlBook && !prevHtmlBook) {
      const rendition = nextHtmlBook.rendition;
      (async () => {
        await methodsRef.current.handlePageNum(rendition);
        rendition.on("page-changed", async () => {
          await methodsRef.current.handlePageNum(rendition);
          if (ignoreNextPageChange.current) {
            setIgnoreNextPageChange(false);
          } else {
            handleJumpPosition(null);
          }
        });
        rendition.on("annotation-changed", async (chapterDocIndex: number) => {
          let annotationData = rendition.getAnnotationData(chapterDocIndex);
          let notes = await ConfigUtil.getNotesByBookKeyAndTypeWithSort(
            currentBook.key,
            "annotation"
          );
          let note = notes.find(
            (note: Note) => note.chapterIndex === chapterDocIndex
          );
          if (note) {
            note = await DatabaseService.getRecord(note.key, "notes");
            let newNote = {
              ...note,
              range: JSON.stringify(annotationData),
            };
            await DatabaseService.updateRecord(newNote, "notes");
          } else {
            let bookLocation: {
              text: string;
              count: string;
              chapterTitle: string;
              chapterDocIndex: string;
              chapterHref: string;
              percentage: string;
              cfi: string;
              page: string;
              xpath: string;
            } = ConfigService.getObjectConfig(
              currentBook.key,
              "recordLocation",
              {}
            );
            let newNote = new Note(
              currentBook.key,
              bookLocation.chapterTitle,
              chapterDocIndex,
              "",
              JSON.stringify(bookLocation),
              JSON.stringify(annotationData),
              "annotation",
              bookLocation.percentage,
              "annotation",
              []
            );
            await DatabaseService.saveRecord(newNote, "notes");
          }
          handleFetchNotes();
        });
        rendition.on("rendered", async () => {
          await methodsRef.current.handlePageNum(rendition);
        });
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlBook]);

  // UNSAFE_componentWillReceiveProps: readerMode 变化时更新单双页
  const prevReaderModeRef = useRef(readerMode);
  useEffect(() => {
    const prevReaderMode = prevReaderModeRef.current;
    prevReaderModeRef.current = readerMode;
    if (readerMode !== prevReaderMode) {
      setState((prev) => ({
        ...prev,
        isSingle: readerMode !== "double",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerMode]);

  // UNSAFE_componentWillReceiveProps: jumpPosition 变化时忽略下一次翻页
  const prevJumpPositionRef = useRef(jumpPosition);
  useEffect(() => {
    const prevJumpPosition = prevJumpPositionRef.current;
    prevJumpPositionRef.current = jumpPosition;
    if (jumpPosition !== prevJumpPosition && jumpPosition !== null) {
      setIgnoreNextPageChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpPosition]);

  // 从右往左翻页时双页版面镜像，footer 页码位置同步交换
  const isRevertDirection =
    ConfigService.getReaderConfig("revertDirection") === "yes" &&
    textOrientation !== "vertical";
  const isSwappedPage = isRevertDirection && !state.isSingle;
  const leftPage = isSwappedPage ? state.nextPage : state.prevPage;
  const rightPage = isSwappedPage ? state.prevPage : state.nextPage;

  return (
    <>
      <div
        className="background"
        style={{
          color: ConfigService.getReaderConfig("textColor")
            ? ConfigService.getReaderConfig("textColor")
            : "",
          width:
            !isNavLocked && !isSettingLocked && !isDockedRight
              ? "100%"
              : isNavLocked && (isSettingLocked || isDockedRight)
                ? "calc(100% - 600px)"
                : "calc(100% - 300px)",
          left: !isNavLocked ? "0" : "300px",
          right: !isSettingLocked && !isDockedRight ? "0" : "300px",
          backgroundColor: backgroundColor,
          filter: `brightness(${
            ConfigService.getReaderConfig("brightness") || 1
          }) invert(${
            ConfigService.getReaderConfig("isInvert") === "yes" ? 1 : 0
          })`,
        }}
      >
        <div className="header-container">
          {!isHideHeader && currentChapter + "" && (
            <p
              className="header-chapter-name"
              style={
                state.isSingle
                  ? {
                      left: `calc(50vw - 
                      270px)`,
                    }
                  : {}
              }
            >
              {currentChapter}
            </p>
          )}
          {!isHideHeader && currentChapter + "" && !state.isSingle && (
            <p
              className="header-book-name"
              style={
                state.isSingle
                  ? {
                      right: `calc(50vw - 
                      270px)`,
                    }
                  : {}
              }
            >
              {currentBook.name}
            </p>
          )}
          {!isHideHeader && (
            <>
              <span className="footer-time">
                {state.currentTime}
                {state.percentage
                  ? "  " + (parseFloat(state.percentage) * 100).toFixed(2) + "%"
                  : ""}
              </span>
            </>
          )}
        </div>
        <div className="footer-container">
          {!isHideFooter && leftPage > 0 && (
            <p
              className="background-page-left"
              style={
                state.isSingle
                  ? {
                      left: `calc(50vw - 
                      270px)`,
                    }
                  : {}
              }
            >
              <Trans i18nKey="Book/Document page" count={leftPage}>
                Page
                {{
                  count: leftPage,
                }}
              </Trans>
            </p>
          )}
          {!isHideFooter && rightPage > 0 && !state.isSingle && (
            <p className="background-page-right">
              <Trans i18nKey="Book/Document page" count={rightPage}>
                Page
                {{
                  count: rightPage,
                }}
              </Trans>
            </p>
          )}
        </div>
        <>{isShowBookmark ? <div className="bookmark"></div> : null}</>
        {isShowPageBorder && (
          <>
            <div className="page-border"></div>
            <div className="inner-page-border"></div>
            <div className="page-border-header-line"></div>
            <div className="page-border-footer-line"></div>
            {!state.isSingle && (
              <div
                className="page-border-center-line"
                style={
                  textOrientation === "vertical"
                    ? {
                        top: "50%",
                        height: "1px",
                        width: "calc(100% - 30px)",
                        left: "15px",
                        right: "15px",
                      }
                    : {}
                }
              ></div>
            )}
          </>
        )}
      </div>
      {jumpPosition && (
        <div className="jump-return-button-container">
          <button
            className="jump-return-button"
            onClick={async () => {
              if (jumpPosition && htmlBook) {
                setIgnoreNextPageChange(true);
                await htmlBook.rendition.goToPosition(
                  JSON.stringify(jumpPosition)
                );
                handleJumpPosition(null);
              }
            }}
          >
            {t("Return")}
          </button>
        </div>
      )}
    </>
  );
};

export default PageWidget;
