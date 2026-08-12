import {
  AudioOutlined,
  DeleteOutlined,
  PauseOutlined,
} from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

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
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      void message.error(
        "当前浏览器不支持录音，请改用最新版微信、Chrome 或 Safari",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || preferred || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        if (blob.size > 5 * 1024 * 1024)
          void message.error("录音超过 5 MB，请缩短后重录");
        else onChange(blob);
        setRecording(false);
        recorderRef.current = null;
      };
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
      recorder.start(250);
      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          if (current >= 29) recorder.stop();
          return Math.min(30, current + 1);
        });
      }, 1000);
    } catch {
      void message.error("无法使用麦克风，请在浏览器设置中允许麦克风权限");
    }
  }

  function stop(): void {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return (
    <div className="audio-recorder">
      <Space direction="vertical" style={{ width: "100%" }}>
        <Typography.Text>
          可选语音录音（最多 30 秒、5 MB，仅保存原始录音，不进行语音识别）
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
        </Space>
      </Space>
    </div>
  );
}
