import {
  BellOutlined,
  FileDoneOutlined,
  FormOutlined,
  LogoutOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Drawer,
  Grid,
  Layout,
  Menu,
  Select,
  Space,
  Typography,
} from "antd";
import { useMemo, useState, type PropsWithChildren } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RoleCode } from "@oms/contracts";
import { useSession } from "../auth/session";

const { Header, Sider, Content } = Layout;

const roleLabels: Record<RoleCode, string> = {
  FIELD_REPORTER: "一线上报人",
  DISTRICT_MANAGER: "区县经理",
  PERSONAL_HANDLER: "个人侧管理员",
  ORGANIZATION_HANDLER: "组织侧管理员",
  MUNICIPAL: "市公司",
  SYSTEM_ADMIN: "系统管理员",
};

export function AppLayout({ children }: PropsWithChildren) {
  const { user, activeGrant, selectGrant, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const compact = !screens.lg;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = useMemo(() => {
    const role = activeGrant?.role;
    const base = [] as Array<{
      key: string;
      icon: React.ReactNode;
      label: string;
    }>;
    if (role === "FIELD_REPORTER") {
      base.push({
        key: "/report/new",
        icon: <FormOutlined />,
        label: "上报商机",
      });
      base.push({
        key: "/opportunities",
        icon: <UnorderedListOutlined />,
        label: "我的商机",
      });
    }
    if (
      ["DISTRICT_MANAGER", "PERSONAL_HANDLER", "ORGANIZATION_HANDLER"].includes(
        role ?? "",
      )
    ) {
      base.push({
        key: "/opportunities",
        icon: <UnorderedListOutlined />,
        label: "待办与商机",
      });
    }
    if (role === "MUNICIPAL")
      base.push({
        key: "/municipal/successes",
        icon: <FileDoneOutlined />,
        label: "成功商机库",
      });
    if (role === "SYSTEM_ADMIN")
      base.push({
        key: "/admin",
        icon: <SettingOutlined />,
        label: "系统配置",
      });
    base.push({ key: "/notifications", icon: <BellOutlined />, label: "通知" });
    base.push({
      key: "/privacy",
      icon: <SafetyCertificateOutlined />,
      label: "隐私说明",
    });
    return base;
  }, [activeGrant?.role]);

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={[
        items.find((item) => location.pathname.startsWith(item.key))?.key ?? "",
      ]}
      items={items}
      onClick={({ key }) => {
        navigate(key);
        setDrawerOpen(false);
      }}
      className="app-menu"
    />
  );

  return (
    <Layout className="app-shell">
      {!compact && (
        <Sider theme="light" width={224} className="app-sider">
          <div className="brand">商机随手报</div>
          {menu}
        </Sider>
      )}
      <Layout>
        <Header className="app-header">
          <Space size="middle">
            {compact && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setDrawerOpen(true)}
                aria-label="打开菜单"
              />
            )}
            <Typography.Text strong>
              {compact ? "商机随手报" : user?.displayName}
            </Typography.Text>
          </Space>
          <Space>
            <Select
              aria-label="当前角色"
              value={activeGrant?.id}
              style={{ minWidth: compact ? 138 : 210 }}
              options={user?.grants.map((grant) => ({
                value: grant.id,
                label: `${roleLabels[grant.role]}${grant.districtName ? ` · ${grant.districtName}` : ""}`,
              }))}
              onChange={(value) => {
                selectGrant(value);
                navigate("/");
              }}
            />
            {!compact && (
              <Button
                type="text"
                icon={<LogoutOutlined />}
                onClick={() => void logout()}
              >
                退出
              </Button>
            )}
          </Space>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
      <Drawer
        title="商机随手报"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        placement="left"
        width={280}
      >
        <div className="mobile-profile">
          <Avatar>{user?.displayName.slice(0, 1)}</Avatar>
          <span>{user?.displayName}</span>
        </div>
        {menu}
        <Button block icon={<LogoutOutlined />} onClick={() => void logout()}>
          退出登录
        </Button>
      </Drawer>
    </Layout>
  );
}
