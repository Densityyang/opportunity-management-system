import { App, Badge, Button, Card, Empty, List, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

interface NotificationItem {
  id: string;
  opportunityId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { message } = App.useApp();
  const navigate = useNavigate();
  async function load() {
    setLoading(true);
    try {
      setItems(await api<NotificationItem[]>("/notifications"));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => void load(), []);
  async function markAll() {
    await api("/notifications/read-all", { method: "PATCH" });
    await load();
  }
  async function open(item: NotificationItem) {
    if (!item.readAt)
      await api(`/notifications/${item.id}/read`, { method: "PATCH" });
    if (item.opportunityId) navigate(`/opportunities/${item.opportunityId}`);
    else await load();
  }
  return (
    <Card className="page-card">
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={2} className="page-title">
          通知
        </Typography.Title>
        <Button onClick={() => void markAll()}>全部已读</Button>
      </Space>
      <List
        loading={loading}
        dataSource={items}
        locale={{ emptyText: <Empty description="暂无通知" /> }}
        renderItem={(item) => (
          <List.Item
            onClick={() => void open(item)}
            style={{ cursor: "pointer" }}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Badge status={item.readAt ? "default" : "processing"} />
                  <span>{item.title}</span>
                </Space>
              }
              description={
                <>
                  <div>{item.body}</div>
                  <Typography.Text type="secondary">
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </Typography.Text>
                </>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
}
