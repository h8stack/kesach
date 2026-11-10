import { useTranslation } from "react-i18next";
import { useEffect, useReducer, useRef, useState } from "react";
import { Trans } from "react-i18next";
import { speedList } from "../../constants/dropdownList";
import {
  ConfigService,
  HighlightUtil,
  KookitConfig,
} from "../../assets/lib/kookit-extra-browser.min";
import {
  checkReachPageEnd,
  getAllVoices,
  getFormatFromAudioPath,
  isReadingRawPDF,
  langToName,
  sleep,
  splitSentences,
} from "../../utils/common";
import { isElectron } from "react-device-detect";
import toast from "react-hot-toast";
import TTSUtil from "../../utils/reader/ttsUtil";
import { getTextRules } from "../../utils/common";
import "./textToSpeech.css";
import SwitchRow from "../readerSettings/switchRow";
import { Howl } from "howler";
import { useAppStore } from "../../store/useAppStore";

export interface TextToSpeechState {
  isAudioOn: boolean;
  isPaused: boolean;
  currentIndex: number;
  voiceLocale: string;
  languageList: string[];
  voiceList: any;
}

declare var window: any;
const TextToSpeech = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const isReading = useAppStore((s) => s.book.isReading);
  const plugins = useAppStore((s) => s.manager.plugins);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const speechStartText = useAppStore((s) => s.reader.speechStartText);
  const isSpeechAutoStart = useAppStore((s) => s.reader.isSpeechAutoStart);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const handlePluginSettingTab = useAppStore((s) => s.handlePluginSettingTab);
  const handleSpeechStartText = useAppStore((s) => s.handleSpeechStartText);
  const handleSpeechAutoStart = useAppStore((s) => s.handleSpeechAutoStart);
  const { t } = useTranslation();
  const [state, setStateObj] = useState<TextToSpeechState>(() => ({
    isAudioOn: false,
    isPaused: false,
    currentIndex: 0,
    languageList: [],
    voiceList: {},
    voiceLocale:
      ConfigService.getReaderConfig("voiceLocale") || navigator.language,
  }));
  const stateRef = useRef<TextToSpeechState>(state);
  const setState = (
    patch:
      | Partial<TextToSpeechState>
      | ((prev: TextToSpeechState) => Partial<TextToSpeechState>)
  ) => {
    const prev = stateRef.current;
    const partial =
      typeof patch === "function"
        ? (patch as (prev: TextToSpeechState) => Partial<TextToSpeechState>)(
            prev
          )
        : patch;
    const next = { ...prev, ...partial };
    stateRef.current = next;
    setStateObj(next);
  };
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const nodeListRef = useRef<
    {
      text: string;
      voiceName: string;
      voiceEngine: string;
    }[]
  >([]);
  const customVoicesRef = useRef<any>([]);
  const voicesRef = useRef<any>([]);
  const nativeVoicesRef = useRef<any>([]);
  const previewPlayerRef = useRef<Howl | null>(null);
  const highlightUtilRef = useRef<any>(null);
  if (!highlightUtilRef.current) {
    highlightUtilRef.current = new HighlightUtil(ConfigService);
  }
  const speechIntervalRef = useRef<number | undefined>(undefined);
  const prevPluginsRef = useRef(plugins);
  const prevIsSpeechAutoStartRef = useRef(isSpeechAutoStart);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      window.speechSynthesis && window.speechSynthesis.cancel();
      setState({ isAudioOn: false });
      nodeListRef.current = [];
      const setSpeech = () => {
        return new Promise<any[]>((resolve) => {
          let synth = window.speechSynthesis;
          if (synth) {
            speechIntervalRef.current = window.setInterval(() => {
              if (synth.getVoices().length !== 0) {
                let voices = synth.getVoices();
                resolve(
                  voices.map((item: any) => {
                    item.displayName = item.name;
                    item.locale = item.lang;
                    item.plugin = "system";
                    return item;
                  })
                );
                if (speechIntervalRef.current !== undefined) {
                  clearInterval(speechIntervalRef.current);
                  speechIntervalRef.current = undefined;
                }
              }
            }, 10);
          }
        });
      };
      nativeVoicesRef.current = await setSpeech();
      if (!isMounted) return;
      if (isElectron) {
        customVoicesRef.current = TTSUtil.getVoiceList(plugins);
        voicesRef.current = [
          ...nativeVoicesRef.current,
          ...customVoicesRef.current,
        ];
      } else {
        // Custom voice plugins execute Node scripts in the main process, so
        // only system voices are available in the browser build. Reset any
        // desktop-only voice that was persisted in the shared config.
        customVoicesRef.current = [];
        voicesRef.current = [...nativeVoicesRef.current];
        const currentVoiceName = ConfigService.getReaderConfig("voiceName");
        const currentEngine = ConfigService.getReaderConfig("voiceEngine");
        const currentVoice = voicesRef.current.find(
          (item: any) => item.name === currentVoiceName
        );
        if (currentEngine && currentEngine !== "system") {
          ConfigService.setReaderConfig("voiceEngine", "system");
        }
        if (!currentVoice && voicesRef.current.length > 0) {
          ConfigService.setReaderConfig("voiceName", voicesRef.current[0].name);
          ConfigService.setReaderConfig("voiceEngine", "system");
        }
      }
      handleVoiceLocaleList();
      if (
        voicesRef.current.length === 0 &&
        getAllVoices(plugins).length === 0
      ) {
        return;
      }
      if (voicesRef.current.length > 0) {
        let voiceName = ConfigService.getReaderConfig("voiceName");
        let voiceEngine = ConfigService.getReaderConfig("voiceEngine");
        let voiceIndex = parseInt(ConfigService.getReaderConfig("voiceIndex"));

        if (
          !voiceName &&
          ConfigService.getReaderConfig("voiceIndex") &&
          !isNaN(voiceIndex)
        ) {
          ConfigService.setReaderConfig(
            "voiceName",
            voicesRef.current[voiceIndex]
              ? voicesRef.current[voiceIndex].name
              : voicesRef.current[0].name
          );
        }
        if (!voiceEngine && voiceName) {
          let voice = voicesRef.current.find(
            (item: any) => item.name === voiceName
          );
          if (voice && voice.plugin) {
            ConfigService.setReaderConfig("voiceEngine", voice.plugin);
          } else {
            ConfigService.setReaderConfig("voiceEngine", "system");
          }
        }
        if (!voiceName && !voiceEngine && voicesRef.current.length > 0) {
          let defaultVoice = voicesRef.current[0];
          ConfigService.setReaderConfig("voiceName", defaultVoice.name);
          ConfigService.setReaderConfig(
            "voiceEngine",
            defaultVoice.plugin || "system"
          );
        }
      }
    };
    init();
    return () => {
      isMounted = false;
      if (speechIntervalRef.current !== undefined) {
        clearInterval(speechIntervalRef.current);
        speechIntervalRef.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    //plugin更新后重新获取语音列表
    if (prevPluginsRef.current !== plugins) {
      prevPluginsRef.current = plugins;
      customVoicesRef.current = TTSUtil.getVoiceList(plugins);
      voicesRef.current = [
        ...nativeVoicesRef.current,
        ...customVoicesRef.current,
      ];
      handleVoiceLocaleList();
    }
  }, [plugins]);

  useEffect(() => {
    if (isSpeechAutoStart && !prevIsSpeechAutoStartRef.current) {
      handleSpeechAutoStartRequest();
    }
    prevIsSpeechAutoStartRef.current = isSpeechAutoStart;
  }, [isSpeechAutoStart]);

  useEffect(() => {
    return () => {
      stopPreviewAudio();
    };
  }, []);
  const clearSpeechStartState = () => {
    if (speechStartText) {
      handleSpeechStartText("");
    }
    if (isSpeechAutoStart) {
      handleSpeechAutoStart(false);
    }
  };
  const getSpeechStartIndex = (nodeTextList: string[]) => {
    if (!speechStartText) return -1;

    return nodeTextList.findIndex((item) => {
      return item.includes(speechStartText) || speechStartText.includes(item);
    });
  };
  const handleSpeechAutoStartRequest = async () => {
    if (stateRef.current.isAudioOn) {
      await handleStop();
    }
    handleStartAudio();
  };
  const stopPreviewAudio = () => {
    window.speechSynthesis && window.speechSynthesis.cancel();
    if (previewPlayerRef.current) {
      previewPlayerRef.current.stop();
      previewPlayerRef.current.unload();
      previewPlayerRef.current = null;
    }
  };
  const getPreviewText = (voice: any) => {
    const voiceCode =
      voice?.locale ||
      voice?.lang ||
      voice?.language ||
      stateRef.current.voiceLocale ||
      navigator.language ||
      "en";
    const normalizedCode = voiceCode.toLowerCase().split("-")[0];
    const speech =
      KookitConfig.SpeechList.find((item) => item.code === normalizedCode) ||
      KookitConfig.SpeechList[0];
    return speech.example;
  };
  const getVoiceByNameAndEngine = (voiceName: string, voiceEngine: string) => {
    return voicesRef.current.find(
      (item: any) => item.name === voiceName && item.plugin === voiceEngine
    );
  };
  const handlePreviewVoice = async (voiceName: string, voiceEngine: string) => {
    if (!voiceName) {
      toast(t("Please select"));
      return;
    }
    const engine = voiceEngine || "system";
    const voice = getVoiceByNameAndEngine(voiceName, engine);
    if (!voice) {
      toast.error(t("Audio loading failed, stopped playback"));
      return;
    }
    const previewText = getPreviewText(voice);
    const speed = parseFloat(ConfigService.getReaderConfig("voiceSpeed")) || 1;

    stopPreviewAudio();

    if (engine === "system") {
      const msg = new SpeechSynthesisUtterance();
      msg.text = previewText;
      msg.voice =
        nativeVoicesRef.current.find((item: any) => item.name === voiceName) ||
        nativeVoicesRef.current[0];
      msg.rate = speed;
      msg.onerror = () => {
        toast.error(t("Audio loading failed, stopped playback"));
      };
      window.speechSynthesis && window.speechSynthesis.speak(msg);
      return;
    }


    const plugin = plugins.find((item) => item.key === engine);
    if (!plugin) {
      toast.error(t("Audio loading failed, stopped playback"));
      return;
    }
    const pluginVoice = (plugin.voiceList as any[]).find(
      (item) => item.name === voiceName
    );
    if (!pluginVoice) {
      toast.error(t("Audio loading failed, stopped playback"));
      return;
    }
    const audioPath = await TTSUtil.getAudioPath(
      previewText,
      speed * 100 - 100,
      engine,
      plugin,
      pluginVoice,
      true
    );
    if (!audioPath) {
      toast.error(t("Audio loading failed, stopped playback"));
      return;
    }
    previewPlayerRef.current = new Howl({
      src: [audioPath],
      format: [getFormatFromAudioPath(audioPath)],
      onloaderror: () => {
        toast.error(t("Audio loading failed, stopped playback"));
      },
    });
    previewPlayerRef.current.play();
  };
  const renderVoicePreviewLabel = (
    label: string,
    voiceName: string,
    voiceEngine: string
  ) => {
    return (
      <span className="tts-preview-label">
        <Trans>{label}</Trans>
        <span
          className="tts-preview-btn"
          title={t("Test")}
          onClick={() => handlePreviewVoice(voiceName, voiceEngine)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M3 10v4h3l4 4V6L6 10H3zm11.5 2a3.5 3.5 0 0 0-2-3.15v6.29A3.5 3.5 0 0 0 14.5 12zm0-7.5v2.06A7.003 7.003 0 0 1 19 12a7.003 7.003 0 0 1-4.5 5.44v2.06c3.45-.9 6-4.03 6-7.5s-2.55-6.6-6-7.5z" />
          </svg>
        </span>
      </span>
    );
  };

  const handleStartAudio = async () => {
    // 每次开始朗读前刷新文本规则（replace / delete）
    TTSUtil.setTextRules(getTextRules(currentBook?.key));
    handleStartSpeech();
  };
  const handlePauseAudio = async () => {
    if (window.speechSynthesis) {
      if (window.speechSynthesis.speaking) {
        // 在句子中途暂停，保留 utterance 状态以便从暂停位置恢复
        window.speechSynthesis.pause();
      } else {
        window.speechSynthesis.cancel();
      }
    }
    await TTSUtil.pauseAudio();
    setState({ isPaused: true });
  };
  const handleStop = async () => {
    window.speechSynthesis && window.speechSynthesis.cancel();
    await TTSUtil.stopAudio();
    setState({ isAudioOn: false, isPaused: false, currentIndex: 0 });
    nodeListRef.current = [];
  };
  const handlePauseResume = () => {
    const currentNode = nodeListRef.current[stateRef.current.currentIndex];
    if (!currentNode) return;

    setState({ isPaused: false });
    if (currentNode.voiceEngine !== "system") {
      // 尝试从自定义音频暂停位置恢复，失败则从句首重新播放
      const resumed = TTSUtil.resumeAudio();
      if (!resumed) {
        handleCustomRead(stateRef.current.currentIndex);
      }
    } else {
      // 若 Web Speech API 处于暂停状态则从暂停位置恢复，否则从句首重新朗读
      if (window.speechSynthesis && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        handleSystemRead(stateRef.current.currentIndex);
      }
    }
  };
  const handlePrevSentence = async () => {
    if (!stateRef.current.isAudioOn || nodeListRef.current.length === 0) return;
    let prevIndex = Math.max(0, stateRef.current.currentIndex - 1);
    window.speechSynthesis && window.speechSynthesis.cancel();
    await TTSUtil.pauseAudio();
    TTSUtil.pausedMidSentence = false; // 跳转句子时不从暂停位置恢复
    setState({ currentIndex: prevIndex, isPaused: false });
    if (nodeListRef.current[prevIndex].voiceEngine !== "system") {
      handleCustomRead(prevIndex);
    } else {
      handleSystemRead(prevIndex);
    }
  };
  const handleNextSentence = async () => {
    if (!stateRef.current.isAudioOn || nodeListRef.current.length === 0) return;
    let nextIndex = stateRef.current.currentIndex + 1;
    window.speechSynthesis && window.speechSynthesis.cancel();
    await TTSUtil.pauseAudio();
    TTSUtil.pausedMidSentence = false; // 跳转句子时不从暂停位置恢复
    if (nextIndex >= nodeListRef.current.length) {
      // Move to next page
      setState({ currentIndex: 0, isPaused: false });
      nodeListRef.current = [];
      await handleAudio();
    } else {
      setState({ currentIndex: nextIndex, isPaused: false });
      if (nodeListRef.current[nextIndex].voiceEngine !== "system") {
        handleCustomRead(nextIndex);
      } else {
        handleSystemRead(nextIndex);
      }
    }
  };
  const handleVoiceSwitch = async (
    newVoiceName: string,
    newVoiceEngine: string,
    _previousEngine: string
  ) => {
    if (!stateRef.current.isAudioOn || nodeListRef.current.length === 0) return;
    if (!isElectron) {
      newVoiceEngine = "system";
    }

    const currentIndex = stateRef.current.currentIndex;

    // 停止系统语音
    window.speechSynthesis && window.speechSynthesis.cancel();

    // 停止自定义音频播放器
    const player = TTSUtil.getPlayer();
    if (player && player.stop) {
      player.stop();
    }
    TTSUtil.isPaused = true;
    TTSUtil.pausedMidSentence = false;

    // 重置内存中的音频路径缓存（适用于所有引擎切换；磁盘 tts 缓存按内容哈希命名，切换语音无需清除）
    TTSUtil.setAudioPaths();

    nodeListRef.current = nodeListRef.current.map((node) => ({
      ...node,
      voiceName: newVoiceName,
      voiceEngine: newVoiceEngine,
    }));

    // 先将 isPaused 置 true 终止旧循环，再置 false 从当前句子重新播放
    setState({ isPaused: true });
    setState({ isPaused: false });
    if (newVoiceEngine !== "system") {
      handleCustomRead(currentIndex);
    } else {
      handleSystemRead(currentIndex);
    }
  };
  const handleStartSpeech = () => {
    setState({ isAudioOn: true, isPaused: false, currentIndex: 0 });
    handleAudio();
  };
  const handleAudio = async () => {
    nodeListRef.current = await handleGetText();
    if (nodeListRef.current.length === 0) {
      return;
    }
    if (nodeListRef.current[0].voiceEngine !== "system") {
      toast.loading(t("Loading audio, please wait..."), {
        id: "tts-load",
      });

      await handleCustomRead(0);
    } else {
      await handleSystemRead(0);
    }
  };
  const handleGetText = async () => {
    if ((ConfigService.getReaderConfig("animation") || "none") !== "none") {
      await sleep(1000);
    }
    let nodeList = [];
    let nodeTextList = (await htmlBook.rendition.audioText()).filter(
      (item: string) => item && item.trim()
    );
    let rawNodeList: string[][] = [];

    rawNodeList = nodeTextList.map((text) => {
      return splitSentences(text);
    });

    nodeTextList = rawNodeList.flat();

    const speechStartIndex = getSpeechStartIndex(nodeTextList);
    if (speechStartIndex > -1) {
      nodeTextList = nodeTextList.slice(speechStartIndex);
    }
    clearSpeechStartState();
    nodeList = nodeTextList.map((text: string) => {
      const configuredVoiceName = ConfigService.getReaderConfig("voiceName");
      const nativeVoice = voicesRef.current.find(
        (item: any) => item.name === configuredVoiceName
      );
      return {
        text,
        voiceName:
          isElectron || nativeVoice
            ? configuredVoiceName
            : voicesRef.current[0]?.name || configuredVoiceName,
        voiceEngine: isElectron
          ? ConfigService.getReaderConfig("voiceEngine")
          : "system",
      };
    });

    if (nodeList.length === 0) {
      if (isReadingRawPDF(currentBook)) {
        let currentPosition = htmlBook.rendition.getPosition();
        await htmlBook.rendition.goToChapterIndex(
          parseInt(currentPosition.chapterDocIndex) +
            (readerMode === "double" ? 2 : 1)
        );
      } else {
        await htmlBook.rendition.next();
      }

      nodeList = await handleGetText();
    }
    return nodeList;
  };
  const handleCustomRead = async (nodeIndex: number) => {
    if (!isElectron) {
      await handleSystemRead(nodeIndex);
      return;
    }
    let speed = parseFloat(ConfigService.getReaderConfig("voiceSpeed")) || 1;
    if (!stateRef.current.isAudioOn) {
      TTSUtil.setAudioPaths();
    }

    for (let index = nodeIndex; index < nodeListRef.current.length; index++) {
      if (stateRef.current.isPaused || !stateRef.current.isAudioOn) return;
      setState({ currentIndex: index });
      let node = nodeListRef.current[index];
      let style = highlightUtilRef.current.buildTtsHighlightStyle(
        isReadingRawPDF(currentBook),
        ConfigService.getReaderConfig("textOrientation") === "vertical"
      );
      htmlBook.rendition.highlightAudioNode(node.text, style);
      if (index === nodeIndex) {
        let result = await TTSUtil.cacheAudio(
          index,
          speed * 100 - 100,
          plugins,
          nodeListRef.current,
          10,
          true,
          false
        );
        toast.dismiss("tts-load");
        if (result === "error") {
          toast.error(t("Audio loading failed, stopped playback"));
          setState({ isAudioOn: false });
          nodeListRef.current = [];
          return;
        }
      }
      if (nodeListRef.current[index].voiceEngine === "system") {
        await handleSystemRead(index);
        break;
      }

      TTSUtil.cacheAudio(
        index + 1,
        speed * 100 - 100,
        plugins,
        nodeListRef.current,
        20,
        false,
        false
      );
      let res = await handleSpeech(index);
      if (res === "error") {
        toast.error(t("Audio loading failed, stopped playback"));
        setState({ isAudioOn: false });
        nodeListRef.current = [];
        return;
      }
      if (stateRef.current.isPaused || !stateRef.current.isAudioOn) return;
      let visibleTextList = await htmlBook.rendition.visibleText();
      let lastVisibleTextList = visibleTextList;

      let rawNodeList = visibleTextList.map((text) => {
        return splitSentences(text);
      });

      lastVisibleTextList = rawNodeList.flat();

      let isReachPageEnd = checkReachPageEnd(
        index,
        nodeListRef.current,
        lastVisibleTextList,
        currentBook
      );
      if (index === nodeListRef.current.length - 1) {
        isReachPageEnd = true;
      }

      if (isReachPageEnd) {
        if (isReadingRawPDF(currentBook)) {
          let currentPosition = htmlBook.rendition.getPosition();
          await htmlBook.rendition.goToChapterIndex(
            parseInt(currentPosition.chapterDocIndex) +
              (readerMode === "double" ? 2 : 1)
          );
        } else {
          if (index === nodeListRef.current.length - 1) {
            await htmlBook.rendition.nextChapter();
          } else {
            await htmlBook.rendition.next();
          }
        }
      }
      if (res === "end") {
        break;
      }
    }
    if (stateRef.current.isAudioOn && isReading) {
      // 重置内存缓存；磁盘 tts 缓存按内容哈希命名，保留复用
      TTSUtil.setAudioPaths();
      let position = htmlBook.rendition.getPosition();
      ConfigService.setObjectConfig(
        currentBook.key,
        position,
        "recordLocation"
      );
      nodeListRef.current = [];
      await handleAudio();
    }
  }
  const handleSystemRead = async (index) => {
    if (stateRef.current.isPaused || !stateRef.current.isAudioOn) return;
    if (index >= nodeListRef.current.length) {
      nodeListRef.current = [];
      await handleAudio();
      return;
    }
    setState({ currentIndex: index });
    let node = nodeListRef.current[index];
    let style = highlightUtilRef.current.buildTtsHighlightStyle(
      isReadingRawPDF(currentBook),
      ConfigService.getReaderConfig("textOrientation") === "vertical"
    );
    htmlBook.rendition.highlightAudioNode(node.text, style);
    toast.dismiss("tts-load");
    let res = await handleSystemSpeech(
      index,
      node.voiceName || ConfigService.getReaderConfig("voiceName"),
      parseFloat(ConfigService.getReaderConfig("voiceSpeed")) || 1
    );

    if (res === "start") {
      let visibleTextList = await htmlBook.rendition.visibleText();

      let lastVisibleTextList = visibleTextList;

      let rawNodeList = visibleTextList.map((text) => {
        return splitSentences(text);
      });

      lastVisibleTextList = rawNodeList.flat();

      let isReachPageEnd = checkReachPageEnd(
        index,
        nodeListRef.current,
        lastVisibleTextList,
        currentBook
      );
      if (index === nodeListRef.current.length - 1) {
        isReachPageEnd = true;
      }
      if (isReachPageEnd) {
        if (isReadingRawPDF(currentBook)) {
          let currentPosition = htmlBook.rendition.getPosition();
          await htmlBook.rendition.goToChapterIndex(
            parseInt(currentPosition.chapterDocIndex) +
              (readerMode === "double" ? 2 : 1)
          );
        } else {
          if (index === nodeListRef.current.length - 1) {
            await htmlBook.rendition.nextChapter();
          } else {
            await htmlBook.rendition.next();
          }
        }
      }
      if (
        stateRef.current.isAudioOn &&
        isReading &&
        index === nodeListRef.current.length
      ) {
        let position = htmlBook.rendition.getPosition();
        ConfigService.setObjectConfig(
          currentBook.key,
          position,
          "recordLocation"
        );
        nodeListRef.current = [];
        await handleAudio();
        return;
      }
      index++;
      if (
        nodeListRef.current[index] &&
        nodeListRef.current[index].voiceEngine !== "system"
      ) {
        await handleCustomRead(index);
      } else {
        await handleSystemRead(index);
      }
    } else if (res === "end") {
      return;
    }
  }
  const handleSpeech = async (index: number) => {
    return new Promise<string>(async (resolve) => {
      let res = await TTSUtil.readAloud(index);
      if (res === "loaderror") {
        resolve("error");
      } else {
        let player = TTSUtil.getPlayer();
        player.on("end", async () => {
          if (!(stateRef.current.isAudioOn && isReading)) {
            resolve("end");
          }
          resolve("start");
        });
      }
    });
  };
  const handleSystemSpeech = async (
    index: number,
    voiceName: string,
    speed: number
  ) => {
    return new Promise<string>(async (resolve) => {
      var msg = new SpeechSynthesisUtterance();
      msg.text = TTSUtil.applyTextRules(
        nodeListRef.current[index].text
          .replace(/\s\s/g, "")
          .replace(/\r/g, "")
          .replace(/\n/g, "")
          .replace(/\t/g, "")
          .replace(/&/g, "")
          .replace(/\f/g, "")
      );
      if (!voiceName) {
        voiceName = nativeVoicesRef.current[0]?.name;
      }
      msg.voice = nativeVoicesRef.current.find(
        (voice: any) => voice.name === voiceName
      );
      msg.rate = speed;
      window.speechSynthesis && window.speechSynthesis.cancel();
      window.speechSynthesis.speak(msg);
      msg.onerror = (err) => {
        console.error(err);
        resolve("end");
      };

      msg.onend = async () => {
        if (!(stateRef.current.isAudioOn && isReading)) {
          resolve("end");
        }
        resolve("start");
      };
    });
  };
  const handleVoiceLocaleList = () => {
    let voiceList = {};
    let totalVoiceList = voicesRef.current;
    totalVoiceList.forEach((voice) => {
      if (!voiceList[voice.locale]) {
        voiceList[voice.locale] = [];
      }
      voiceList[voice.locale].push(voice);
    });
    let languageList: string[] = [];
    for (let voice of totalVoiceList) {
      if (!languageList.includes(voice.locale)) {
        languageList.push(voice.locale);
      }
    }
    languageList = languageList
      .map((lang, index) => ({ lang, index }))
      .sort((a, b) => {
        let lang = navigator.language || "en-US";
        let langCode = lang.split("-")[0];
        const aMatch = a.lang.startsWith(langCode);
        const bMatch = b.lang.startsWith(langCode);
        if (aMatch && bMatch) return a.index - b.index;
        if (aMatch) return -1;
        if (bMatch) return 1;
        return a.lang.localeCompare(b.lang);
      })
      .map((item) => item.lang);
    setState({ languageList, voiceList });
  };
  const render = () => {
    return (
      <>
        <div className="tts-player-container">
          <div className="tts-player-controls">
            <span
              className="tts-player-btn"
              title={t("Stop")}
              onClick={() => handleStop()}
              style={
                !stateRef.current.isAudioOn
                  ? { opacity: 0.3, cursor: "not-allowed" }
                  : {}
              }
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path d="M6 6h12v12H6z" />
              </svg>
            </span>
            <span
              className="tts-player-btn"
              title={t("Previous")}
              onClick={() => handlePrevSentence()}
              style={
                !stateRef.current.isAudioOn
                  ? { opacity: 0.3, cursor: "not-allowed" }
                  : {}
              }
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </span>
            <span
              className="tts-player-btn tts-player-btn-main"
              title={
                !stateRef.current.isAudioOn
                  ? t("Play")
                  : stateRef.current.isPaused
                    ? t("Resume")
                    : t("Pause")
              }
              onClick={() => {
                if (!stateRef.current.isAudioOn && !stateRef.current.isPaused) {
                  handleStartAudio();
                } else if (!stateRef.current.isPaused) {
                  handlePauseAudio();
                } else {
                  handlePauseResume();
                }
              }}
            >
              {!stateRef.current.isAudioOn || stateRef.current.isPaused ? (
                <svg
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                  fill="currentColor"
                >
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              )}
            </span>
            <span
              className="tts-player-btn"
              title={t("Next")}
              onClick={() => handleNextSentence()}
              style={
                !stateRef.current.isAudioOn
                  ? { opacity: 0.3, cursor: "not-allowed" }
                  : {}
              }
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </span>
            <span
              className="tts-player-btn"
              title={t("Stop")}
              onClick={() => handleStop()}
              style={
                !stateRef.current.isAudioOn
                  ? { opacity: 0.3, cursor: "not-allowed" }
                  : {}
              }
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
              >
                <path d="M6 6h12v12H6z" />
              </svg>
            </span>
          </div>
          {stateRef.current.isAudioOn && nodeListRef.current.length > 0 && (
            <div className="tts-player-info">
              {stateRef.current.currentIndex + 1} / {nodeListRef.current.length}
            </div>
          )}
        </div>
        <div
          className="setting-dialog-new-title"
          style={{
            marginLeft: "20px",
            width: "88%",
            marginTop: "20px",
            fontWeight: 500,
          }}
        >
          <Trans>Language</Trans>
          <select
            name=""
            className="lang-setting-dropdown"
            id="text-speech-locale"
            value={ConfigService.getReaderConfig("voiceLocale")}
            onChange={(event) => {
              ConfigService.setReaderConfig("voiceLocale", event.target.value);
              setState({ voiceLocale: event.target.value });
            }}
          >
            {stateRef.current.languageList.map((item) => {
              return (
                <option value={item} key={item} className="lang-setting-option">
                  {langToName(item)}
                </option>
              );
            })}
          </select>
        </div>
        <div
          className="setting-dialog-new-title"
          style={{
            marginLeft: "20px",
            width: "88%",
            fontWeight: 500,
          }}
        >
          {renderVoicePreviewLabel(
            "Voice",
            ConfigService.getReaderConfig("voiceName"),
            ConfigService.getReaderConfig("voiceEngine")
          )}
          <select
            name=""
            className="lang-setting-dropdown"
            id="text-speech-voice"
            value={[
              ConfigService.getReaderConfig("voiceName"),
              ConfigService.getReaderConfig("voiceEngine"),
            ].join("#")}
            onChange={(event) => {
              let selectedValue = event.target.value;
              let [voiceName, plugin] = selectedValue.split("#");
              const previousEngine =
                ConfigService.getReaderConfig("voiceEngine");
              let voice = voicesRef.current.find(
                (item) => item.name === voiceName && item.plugin === plugin
              );
              if (!voice) {
                return;
              }
              const newEngine = voice.plugin || "system";
              ConfigService.setReaderConfig("voiceName", voiceName);
              ConfigService.setReaderConfig("voiceEngine", newEngine);
              toast.success(t("Setup successful"));
              if (stateRef.current.isAudioOn) {
                handleVoiceSwitch(voiceName, newEngine, previousEngine);
              }
              forceUpdate();
            }}
          >
            {(stateRef.current.voiceList[stateRef.current.voiceLocale] || voicesRef.current).map(
              (item) => {
                return (
                  <option
                    value={[item.name, item.plugin].join("#")}
                    key={[item.name, item.plugin].join("#")}
                    className="lang-setting-option"
                  >
                    {t(item.displayName || item.name)}
                  </option>
                );
              }
            )}
          </select>
        </div>

        <div
          className="setting-dialog-new-title"
          style={{ marginLeft: "20px", width: "88%", fontWeight: 500 }}
        >
          <Trans>Speed</Trans>
          <select
            name=""
            id="text-speech-speed"
            className="lang-setting-dropdown"
            value={ConfigService.getReaderConfig("voiceSpeed") || "1"}
            onChange={(event) => {
              ConfigService.setReaderConfig("voiceSpeed", event.target.value);
              if (stateRef.current.isAudioOn) {
                toast(t("Take effect in a while"));
              }
              forceUpdate();
            }}
          >
            {speedList.option.map((item) => (
              <option
                value={item.value}
                className="lang-setting-option"
                key={item.value}
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: "20px", textAlign: "center" }}>
          {isElectron ? (
            <span
              style={{
                textDecoration: "underline",
                cursor: "pointer",
                textAlign: "center",
              }}
              onClick={() => {
                handlePluginSettingTab("voice");
                handleSetting(true);
                handleSettingMode("plugins");
              }}
            >
              <Trans>Add new voice</Trans>
            </span>
          ) : (
            <span style={{ opacity: 0.7 }}>
              <Trans>
                Custom voice plugins are available in the desktop app
              </Trans>
            </span>
          )}
        </div>
      </>
    );
  };

  return render();
};

export default TextToSpeech;
