import { Alert, Button, Spin } from "antd";
import { useEffect, useState } from "react";
import { fetchAudio } from "../api/client";

export function ProtectedAudio({ opportunityId }: { opportunityId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setUrl(URL.createObjectURL(await fetchAudio(opportunityId)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "录音加载失败");
    } finally {
      setLoading(false);
    }
  }
  if (error)
    return (
      <Alert
        type="warning"
        showIcon
        message={error}
        action={
          <Button size="small" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  if (!url)
    return (
      <Button loading={loading} onClick={() => void load()}>
        加载录音
      </Button>
    );
  return <audio controls src={url} style={{ width: "100%", maxWidth: 560 }} />;
}
