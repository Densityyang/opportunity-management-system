import {
  AudioOutlined,
  DeleteOutlined,
  PauseOutlined,
} from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { inferAudioMimeType } from "../audio-file";

interface Props {
  value: Blob | null;
  onChange(value: Blob | null): void;
}

export function AudioRecorder({ value, onChange }: Props) {
  const { message } = App.useApp();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrl = useMemo(
    () => (value ? URL.createObjectURL(value) : null),
    [value],
  );

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );
  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function start(): Promise<void> {
    const recorderConstructor = getMediaRecorderConstructor();
    const getUserMedia = getGetUserMedia();
    const secureContext =
      typeof window.isSecureContext === "boolean"
        ? window.isSecureContext
        : location.protocol === "https:" || isLocalhost();
    if (!secureContext) {
      void message.info(
        "网页麦克风需要 HTTPS，正在尝试打开系统录音；如果没有打开，请点“系统录音/选择音频”。",
      );
      fileInputRef.current?.click();
      return;
    }
    if (!recorderConstructor || !getUserMedia) {
      void message.info("当前浏览器不支持网页直接录音，正在尝试打开系统录音。");
      fileInputRef.current?.click();
      return;
    }
    let stream: MediaStream | null = null;
    try {
      const mediaStream = await getUserMedia();
      stream = mediaStream;
      const preferred = getSupportedMimeType(recorderConstructor);
      const recorder = preferred
        ? new recorderConstructor(mediaStream, { mimeType: preferred })
        : new recorderConstructor(mediaStream);
      const chunks: BlobPart[] = [];
      let recordingFailed = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        recordingFailed = true;
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        stream?.getTracks().forEach((track) => track.stop());
        setRecording(false);
        recorderRef.current = null;
        void message.error("录音过程中出现错误，请改用系统录音或重试");
      };
      recorder.onstop = () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        if (recordingFailed) return;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || preferred || "",
        });
        mediaStream.getTracks().forEach((track) => track.stop());
        if (!blob.size)
          void message.error("没有录到音频，请检查麦克风权限后重试");
        else if (blob.size > 5 * 1024 * 1024)
          void message.error("录音超过 5 MB，请缩短后重录");
        else onChange(blob);
        setRecording(false);
        recorderRef.current = null;
      };
      recorderRef.current = recorder;
      elapsedRef.current = 0;
      setSeconds(0);
      recorder.start(250);
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        elapsedRef.current += 1;
        setSeconds(elapsedRef.current);
        if (elapsedRef.current >= 30 && recorder.state === "recording")
          recorder.stop();
      }, 1000);
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      recorderRef.current = null;
      void message.error(getMicrophoneErrorMessage(caught));
    }
  }

  function stop(): void {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function selectSystemAudio(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      void message.error("录音超过 5 MB，请缩短录音后重试");
      return;
    }

    const type = file.type || inferAudioMimeType(file.name) || "";
    onChange(
      typeof File === "undefined"
        ? file
        : new File([file], file.name, { type }),
    );
  }

  return (
    <div className="audio-recorder">
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text>
          可选语音（最多 30 秒、5
          MB，仅保存原始录音，不进行语音识别）。网页直接录音需要 HTTPS
          和麦克风授权；浏览器不支持时可用系统录音。
        </Typography.Text>
        {value && objectUrl ? (
          <audio controls src={objectUrl} style={{ width: "100%" }} />
        ) : null}
        <Space wrap>
          {!recording ? (
            <Button icon={<AudioOutlined />} onClick={() => void start()}>
              {value ? "重新录音" : "开始录音"}
            </Button>
          ) : (
            <Button danger icon={<PauseOutlined />} onClick={stop}>
              停止录音（{seconds}s）
            </Button>
          )}
          {value && (
            <Button icon={<DeleteOutlined />} onClick={() => onChange(null)}>
              删除录音
            </Button>
          )}
          <Button
            disabled={recording}
            onClick={() => fileInputRef.current?.click()}
          >
            系统录音/选择音频
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            capture="user"
            onChange={selectSystemAudio}
            style={{ display: "none" }}
          />
        </Space>
      </Space>
    </div>
  );
}

function getMediaRecorderConstructor(): typeof MediaRecorder | null {
  if (typeof MediaRecorder !== "undefined") return MediaRecorder;
  return (
    (window as Window & { webkitMediaRecorder?: typeof MediaRecorder })
      .webkitMediaRecorder ?? null
  );
}

function getGetUserMedia(): (() => Promise<MediaStream>) | null {
  if (navigator.mediaDevices?.getUserMedia)
    return () => navigator.mediaDevices.getUserMedia({ audio: true });

  type LegacyNavigator = Navigator & {
    getUserMedia?: (
      constraints: MediaStreamConstraints,
      success: (stream: MediaStream) => void,
      failure: (error: DOMException) => void,
    ) => void;
    webkitGetUserMedia?: LegacyNavigator["getUserMedia"];
    mozGetUserMedia?: LegacyNavigator["getUserMedia"];
  };
  const legacyNavigator = navigator as LegacyNavigator;
  const legacyGetUserMedia =
    legacyNavigator.getUserMedia ??
    legacyNavigator.webkitGetUserMedia ??
    legacyNavigator.mozGetUserMedia;
  if (!legacyGetUserMedia) return null;
  return () =>
    new Promise((resolve, reject) =>
      legacyGetUserMedia.call(
        legacyNavigator,
        { audio: true },
        resolve,
        reject,
      ),
    );
}

function getSupportedMimeType(
  recorderConstructor: typeof MediaRecorder,
): string | undefined {
  if (typeof recorderConstructor.isTypeSupported !== "function") return;
  return [
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/webm",
  ].find((type) => recorderConstructor.isTypeSupported(type));
}

function isLocalhost(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    location.hostname.replace(/^\[|\]$/g, ""),
  );
}

function getMicrophoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "麦克风权限未开放。请在浏览器或微信的网页权限设置中允许麦克风，再重试；也可使用系统录音。";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "没有检测到可用麦克风，请检查设备后重试。";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "麦克风正被其他应用占用，请关闭占用麦克风的应用后重试。";
  return "无法启动网页录音，请检查麦克风权限，或使用系统录音。";
}
