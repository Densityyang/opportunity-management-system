import { App, Button, Card, Form, Input, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";

export function ChangePasswordPage() {
  const { refresh, logout } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  async function submit(values: {
    currentPassword: string;
    newPassword: string;
    confirm: string;
  }) {
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      await refresh();
      void message.success("密码已修改");
      navigate("/", { replace: true });
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "修改失败");
    }
  }
  return (
    <div className="center-screen" style={{ padding: 16 }}>
      <Card style={{ width: "min(100%, 460px)" }}>
        <Typography.Title level={3}>首次登录修改密码</Typography.Title>
        <Typography.Paragraph type="secondary">
          新密码限定为 6–12 位。
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={(values) => void submit(values)}>
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true }, { min: 6 }, { max: 12 }]}
          >
            <Input.Password maxLength={12} />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true }, { min: 6 }, { max: 12 }]}
          >
            <Input.Password maxLength={12} />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || value === getFieldValue("newPassword")
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入不一致"));
                },
              }),
            ]}
          >
            <Input.Password maxLength={12} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            保存新密码
          </Button>
          <Button type="link" block onClick={() => void logout()}>
            退出登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
