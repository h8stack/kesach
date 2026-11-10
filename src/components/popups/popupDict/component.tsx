import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./popupDict.css";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import axios from "axios";
import DictHistory from "../../../models/DictHistory";
import { Trans } from "react-i18next";
import {
  getFullTranslationTarget,
  openExternalUrl,
} from "../../../utils/common";
import toast from "react-hot-toast";
import DatabaseService from "../../../utils/storage/databaseService";
import { chatStream } from "../../../utils/request/common";
import { marked } from "marked";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import DictUtil from "../../../utils/file/dictUtil";
import { getBuiltinDictionary } from "../../../utils/plugins/rendererRegistry";
import type { PluginConfig } from "../../../utils/plugins/types";
import {
  executeCustomDictionary,
  isCustomRendererPlugin,
} from "../../../utils/plugins/customPlugin";
import { useAppStore } from "../../../store/useAppStore";

export interface PopupDictProps {
  isDockedRight: boolean;
}

export interface PopupDictState {
  dictText: string;
  word: string;
  prototype: string;
  dictService: string;
  dictTarget: string;

  isAddNew: boolean;

  aiAnswer: string;
  isAiWaiting: boolean;
  isAiStreaming: boolean;
}

const PopupDict = (props: PopupDictProps) => {
  const originalText = useAppStore((s) => s.reader.originalText);
  const originalSentence = useAppStore((s) => s.reader.originalSentence);
  const plugins = useAppStore((s) => s.manager.plugins);
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleOpenMenu = useAppStore((s) => s.handleOpenMenu);
  const handleMenuMode = useAppStore((s) => s.handleMenuMode);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const handlePluginSettingTab = useAppStore((s) => s.handlePluginSettingTab);
  const { t } = useTranslation();
  const [state, setState] = useState<PopupDictState>(() => ({
    dictText: t("Please wait"),
    word: "",
    prototype: "",
    dictService: ConfigService.getReaderConfig("dictService"),
    dictTarget: ConfigService.getReaderConfig("dictTarget") || "",
    isAddNew: false,
    aiAnswer: "",
    isAiWaiting: false,
    isAiStreaming: false,
  }));

  // 与 class 组件的 this.state 语义保持一致：在异步回调中读取最新已提交状态
  const stateRef = useLatest(state);

  const updateState = (partial: Partial<PopupDictState>) => {
    stateRef.current = { ...stateRef.current, ...partial };
    setState(stateRef.current);
  };

  const aiTextAccumulator = useRef<string>("");
  const updateInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startUpdateInterval = () => {
    if (updateInterval.current) {
      clearInterval(updateInterval.current);
    }
    updateInterval.current = setInterval(() => {
      if (aiTextAccumulator.current) {
        updateState({ aiAnswer: aiTextAccumulator.current });
      }
    }, 150);
  };

  const stopUpdateInterval = () => {
    if (updateInterval.current) {
      clearInterval(updateInterval.current);
      updateInterval.current = null;
    }
    if (aiTextAccumulator.current) {
      updateState({ aiAnswer: aiTextAccumulator.current });
    }
  };

  const handleRecordHistory = async (
    text: string,
    sentence: string,
    dictText: string = ""
  ) => {
    let bookKey = currentBook.key;
    let bookLocation = ConfigService.getObjectConfig(
      bookKey,
      "recordLocation",
      {}
    );
    let chapter = bookLocation.chapterTitle || "";
    let bookName = currentBook.name || "";
    let word = new DictHistory(bookKey, text, chapter, sentence);
    await DatabaseService.saveRecord(word, "words");
  };

  const handleDict = async (text: string): Promise<string> => {
    let dictText = "";
    let isFullAnalysis = true;
    try {
      if (
        ConfigService.getReaderConfig("dictService") === "custom-ai-dict-plugin"
      ) {
        updateState({ isAddNew: false });
        let plugin = plugins.find(
          (item) => item.key === "custom-ai-dict-plugin"
        );
        if (!plugin) return "";
        let targetLang =
          stateRef.current.dictTarget ||
          ConfigService.getReaderConfig("dictTarget") ||
          getFullTranslationTarget();
        let systemPrompt =
          ConfigService.getReaderConfig("aiDictPrompt") ||
          KookitConfig.DefaultPrompts.aiDict;
        systemPrompt = systemPrompt.replace("{word}", text);
        systemPrompt = systemPrompt.replace("{to}", targetLang);
        let config: any = plugin.config || {};
        aiTextAccumulator.current = "";
        updateState({ aiAnswer: "", isAiWaiting: true, isAiStreaming: true });
        startUpdateInterval();
        await chatStream(
          config.endpoint,
          config.providerId,
          config.apiKey,
          config.modelId,
          systemPrompt,
          [],
          (result) => {
            if (result && result.done) {
              return;
            }
            if (result && result.text) {
              if (!aiTextAccumulator.current) {
                updateState({ isAiWaiting: false });
              }
              aiTextAccumulator.current += result.text;
            }
          }
        );
        stopUpdateInterval();
        aiTextAccumulator.current = "";
        updateState({
          isAiWaiting: false,
          isAiStreaming: false,
          dictText: " ",
        });
        return "";
      } else if (
        ConfigService.getReaderConfig("dictService") &&
        ConfigService.getReaderConfig("dictService")?.startsWith("dict-")
      ) {
        updateState({ isAddNew: false });
        const plugin = plugins.find(
          (item) => item.key === ConfigService.getReaderConfig("dictService")
        );
        if (!plugin) return "";
        const config: any = plugin.config || {};
        const dictId: string = config.dictId || "";
        if (!dictId) return "";
        dictText = await DictUtil.lookupWord(dictId, text);
      } else if (ConfigService.getReaderConfig("dictService")) {
        let plugin = plugins.find(
          (item) => item.key === ConfigService.getReaderConfig("dictService")
        );
        if (!plugin) return "";
        const builtinDictionary = getBuiltinDictionary(plugin.key);
        const getPluginDictText = builtinDictionary
          ? builtinDictionary
          : isCustomRendererPlugin(plugin)
            ? executeCustomDictionary(plugin)
            : undefined;
        if (!getPluginDictText) return "";
        dictText = await getPluginDictText(
          text,
          "auto",
          stateRef.current.dictTarget || "en",
          axios,
          t,
          plugin.config as PluginConfig
        );
      }

      if (dictText.startsWith("https://")) {
        openExternalUrl(dictText, true, "dict");
        let docs = getIframeDoc(currentBook);
        for (let i = 0; i < docs.length; i++) {
          let doc = docs[i];
          if (!doc) continue;
          doc.getSelection()?.empty();
        }
        return "";
      } else {
        updateState({ dictText: dictText });
      }
      return dictText;
    } catch (error) {
      toast.error(
        t("Error happened") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      console.error(error);
      updateState({
        dictText: t("Error happened"),
        isAiStreaming: false,
      });
      return "";
    }
  };

  const handleLookUp = async (text: string) => {
    let originalText = text.replace(/(\r\n|\n|\r)/gm, "");
    updateState({ word: originalText });
    updateState({ prototype: originalText });
    if (!stateRef.current.dictService) {
      let pluginList = plugins.filter(
        (item) =>
          item.type === "dictionary" && !item.key.startsWith("official-ai-")
      );
      if (pluginList.length > 0) {
        updateState({ dictService: pluginList[0].key });
        ConfigService.setReaderConfig("dictService", pluginList[0].key);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        updateState({ isAddNew: true });
        return;
      }
    }
    const dictText = await handleDict(originalText);
    handleRecordHistory(
      originalText,
      originalSentence || "",
      dictText || ""
    );
  };

  const handleLookUpRef = useLatest(handleLookUp);

  // componentDidMount: 首次查词
  useEffect(() => {
    handleLookUpRef.current(originalText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // UNSAFE_componentWillReceiveProps: originalText 变化时重新查词
  const prevOriginalTextRef = useRef(originalText);
  useEffect(() => {
    const prevOriginalText = prevOriginalTextRef.current;
    prevOriginalTextRef.current = originalText;
    if (originalText !== prevOriginalText) {
      handleLookUpRef.current(originalText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalText]);

  // 清理流式更新的定时器
  useEffect(() => {
    return () => {
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
        updateInterval.current = null;
      }
    };
  }, []);

  // setState 回调的等价实现：词典内容渲染后重新加载音频并绑定链接
  const isInitialDictTextEffect = useRef(true);
  useEffect(() => {
    if (isInitialDictTextEffect.current) {
      isInitialDictTextEffect.current = false;
      return;
    }
    const audioPlayers = document.querySelectorAll("audio.audio-player");
    audioPlayers.forEach((item) => {
      (item as HTMLAudioElement).load();
    });
  }, [state.dictText]);

  const handleChangeDictService = (dictService: string) => {
    updateState({
      dictService: dictService,
      isAddNew: false,
    });
    ConfigService.setReaderConfig("dictService", dictService);
    updateState({
      dictTarget: "en",
    });
    ConfigService.setReaderConfig("dictTarget", "en");
    handleLookUpRef.current(stateRef.current.word);
  };

  const renderDictBox = () => {
    return (
      <div
        className="dict-container"
        style={
          props.isDockedRight
            ? {
                paddingLeft: 15,
                paddingRight: 15,
                height: "calc(100% - 65px)",
                width: "calc(100% - 30px)",
              }
            : { height: "calc(100% - 65px)" }
        }
      >
        <div className="dict-service-container" style={{ zIndex: 1 }}>
          <select
            className="dict-service-selector"
            style={{ margin: 0 }}
            value={state.dictService}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              if (event.target.value === "add-new") {
                handleOpenMenu(false);
                handleMenuMode("");
                handlePluginSettingTab("dictionary");
                handleSetting(true);
                handleSettingMode("plugins");
                return;
              }
              handleChangeDictService(event.target.value);
            }}
          >
            <option
              value={""}
              key={"select"}
              className="add-dialog-shelf-list-option"
            >
              {t("Please select")}
            </option>
            {plugins
              .filter((item) => item.type === "dictionary")
              .map((item) => {
                return (
                  <option
                    value={item.key}
                    key={item.key}
                    className="add-dialog-shelf-list-option"
                  >
                    {t(item.displayName)}
                  </option>
                );
              })}
            <option
              value={"add-new"}
              key={"add-new"}
              className="add-dialog-shelf-list-option"
            >
              {t("Add new plugin")}
            </option>
          </select>
        </div>

        <div
          className="dict-service-container"
          style={
            props.isDockedRight
              ? { top: 65, right: 25, zIndex: 1 }
              : { right: 130, zIndex: 1 }
          }
        >
          <select
            className="dict-service-selector"
            style={{ margin: 0, width: "80px" }}
            value={state.dictTarget}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              updateState({
                dictTarget: event.target.value || "en",
              });
              ConfigService.setReaderConfig("dictTarget", event.target.value);
              handleLookUpRef.current(stateRef.current.word);
            }}
          >
            {plugins.find(
              (item) => item.key === state.dictService
            )?.langList &&
              (
                plugins.find(
                  (item) => item.key === state.dictService
                )?.langList as any[]
              ).map((item) => {
                return (
                  <option
                    value={item.code}
                    key={item.code}
                    className="add-dialog-shelf-list-option"
                    style={{ width: "80px" }}
                  >
                    {t(item["nativeLang"])}
                  </option>
                );
              })}
          </select>
        </div>
        <div
          className="dict-word"
          style={{
            maxWidth: props.isDockedRight ? "150px" : "250px",
          }}
        >
          {state.word}
        </div>
        <div className="dict-original-word">
          <Trans>Prototype</Trans>
          <span>:</span>
          <span>{state.prototype}</span>
        </div>
        {state.isAddNew && (
          <div
            style={{
              marginTop: "50px",
              textAlign: "center",
              fontSize: "17px",
              color: "#2084e8",
            }}
          >
            <span
              style={{
                textDecoration: "underline",
                cursor: "pointer",
                textAlign: "center",
              }}
              onClick={() => {
                handleOpenMenu(false);
                handleMenuMode("");
                handlePluginSettingTab("dictionary");
                handleSetting(true);
                handleSettingMode("plugins");
                return;
              }}
            >
              <Trans>Add new plugin</Trans>
            </span>
          </div>
        )}
        {!state.isAddNew && (
          <div className="dict-text-box">
            {Parser(
              DOMPurify.sanitize(state.dictText + "<address></address>") || " ",
              {
                replace: (_domNode) => {},
              }
            )}
            {(state.isAiWaiting || state.aiAnswer) && (
              <div className="dict-ai-answer-container">
                <div className="dict-ai-answer-title">
                  <span className="icon-idea dict-ai-answer-icon"></span>
                  <Trans>AI Encyclopedia</Trans>
                </div>
                {state.isAiWaiting && !state.aiAnswer ? (
                  <div className="dict-ai-answer-waiting">
                    <span className="icon-loading popup-assistant-loading"></span>
                    <span>{t("Thinking, please wait...")}</span>
                  </div>
                ) : (
                  <div className="dict-ai-answer-content">
                    {Parser(
                      DOMPurify.sanitize(
                        (marked.parse(state.aiAnswer) as string) +
                          "<address></address>"
                      ) || " ",
                      {
                        replace: (_domNode) => {},
                      }
                    )}
                  </div>
                )}
                {!state.isAiWaiting &&
                  !state.isAiStreaming &&
                  state.aiAnswer && (
                    <div className="popup-assist-disclaimer">
                      {t(
                        "AI-generated content is for reference only. Please verify carefully as it does not constitute professional advice."
                      )}
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  return renderDictBox();
};
export default PopupDict;
