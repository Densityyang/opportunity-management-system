import { LockOutlined, MobileOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Typography } from "antd";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../auth/session";

export function LoginPage() {
  const { user, login } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  if (user)
    return (
      <Navigate
        to={user.mustChangePassword ? "/change-password" : "/"}
        replace
      />
    );
  async function submit(values: { phone: string; password: string }) {
    try {
      const next = await login(values.phone, values.password);
      navigate(
        next.mustChangePassword
          ? "/change-password"
          : ((location.state as { from?: string } | null)?.from ?? "/"),
        { replace: true },
      );
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "登录失败");
    }
  }
  return (
    <div className="login-shell">
      <section className="login-hero">
        <Typography.Title style={{ color: "#155eef", marginBottom: 8 }}>
          商机随手报
        </Typography.Title>
        <Typography.Title level={2}>
          让一线需求被看见、被承接、被闭环
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          一线快速上报，区县统一承接，个人侧与组织侧分类处理，关键节点全程可追溯。
        </Typography.Paragraph>
      </section>
      <section className="login-panel">
        <Form
          className="login-form"
          layout="vertical"
          size="large"
          onFinish={(values) => void submit(values)}
        >
          <Typography.Title level={3}>账号登录</Typography.Title>
          <Form.Item
            name="phone"
            label="手机号码"
            rules={[
              { required: true },
              { pattern: /^1[3-9]\d{9}$/, message: "请输入有效手机号码" },
            ]}
          >
            <Input
              prefix={<MobileOutlined />}
              inputMode="tel"
              maxLength={11}
              autoComplete="username"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            登录
          </Button>
          <Button type="link" block onClick={() => navigate("/privacy")}>
            隐私说明
          </Button>
        </Form>
      </section>
    </div>
  );
}
