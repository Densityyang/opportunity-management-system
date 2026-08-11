import {
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { DistrictView, RoleCode } from "@oms/contracts";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { roleLabels, stateLabels } from "../components/labels";

interface Grant {
  id: string;
  role: RoleCode;
  active: boolean;
  districtId: string | null;
  districtName: string | null;
}
interface UserRow {
  id: string;
  phone: string;
  displayName: string;
  active: boolean;
  mustChangePassword: boolean;
  grants: Grant[];
}
interface UserPage {
  items: UserRow[];
  total: number;
}
interface RouteRow {
  districtId: string;
  districtName: string;
  manager: { id: string };
  personalHandler: { id: string };
  organizationHandler: { id: string };
}
interface RetentionRow {
  id: string;
  eligibleAt: string;
  opportunity: {
    serialNumber: string;
    state: keyof typeof stateLabels;
    closedAt: string;
    district: { name: string };
  };
}

export function AdminPage() {
  const { message } = App.useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [districts, setDistricts] = useState<DistrictView[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [retention, setRetention] = useState<RetentionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [grantUser, setGrantUser] = useState<UserRow | null>(null);
  const [retentionItem, setRetentionItem] = useState<RetentionRow | null>(null);
  const [createForm] = Form.useForm();
  const [grantForm] = Form.useForm();
  const [retentionForm] = Form.useForm();

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [userPage, districtRows, routeRows, retentionPage] =
        await Promise.all([
          api<UserPage>("/admin/users?pageSize=100"),
          api<DistrictView[]>("/admin/districts"),
          api<RouteRow[]>("/admin/routing"),
          api<{ items: RetentionRow[] }>("/admin/retention?pageSize=100"),
        ]);
      setUsers(userPage.items);
      setDistricts(districtRows);
      setRoutes(routeRows);
      setRetention(retentionPage.items);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "配置加载失败",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => void load(), []);

  async function createUser(values: {
    phone: string;
    displayName: string;
    initialPassword: string;
  }) {
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setCreateOpen(false);
      createForm.resetFields();
      void message.success("账号已创建");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "创建失败");
    }
  }
  async function addGrant(values: { role: RoleCode; districtId?: string }) {
    if (!grantUser) return;
    try {
      await api(`/admin/users/${grantUser.id}/grants`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setGrantUser(null);
      grantForm.resetFields();
      void message.success("角色已添加");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "添加失败");
    }
  }
  async function toggleUser(row: UserRow) {
    try {
      await api(`/admin/users/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !row.active }),
      });
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "更新失败");
    }
  }
  async function deactivateGrant(grantId: string) {
    try {
      await api(`/admin/grants/${grantId}`, { method: "DELETE" });
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "停用失败");
    }
  }
  async function toggleDistrict(row: DistrictView, enabled: boolean) {
    try {
      await api(`/admin/districts/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "区县更新失败",
      );
    }
  }
  async function completeRetention(values: {
    action: "ANONYMIZE" | "DELETE";
    confirmationSerialNumber: string;
  }) {
    if (!retentionItem) return;
    try {
      await api(`/admin/retention/${retentionItem.id}/complete`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setRetentionItem(null);
      retentionForm.resetFields();
      void message.success("留存清理已完成");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "清理失败");
    }
  }

  const userColumns: ColumnsType<UserRow> = [
    { title: "姓名", dataIndex: "displayName" },
    { title: "手机号", dataIndex: "phone" },
    {
      title: "状态",
      dataIndex: "active",
      render: (value: boolean) => (
        <Tag color={value ? "success" : "default"}>
          {value ? "启用" : "停用"}
        </Tag>
      ),
    },
    {
      title: "首次改密",
      dataIndex: "mustChangePassword",
      render: (value: boolean) => (value ? "待修改" : "已完成"),
    },
    {
      title: "操作",
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setGrantUser(row)}>
            添加角色
          </Button>
          <Popconfirm
            title={row.active ? "停用账号并撤销会话与角色？" : "重新启用账号？"}
            onConfirm={() => void toggleUser(row)}
          >
            <Button size="small" danger={row.active}>
              {row.active ? "停用" : "启用"}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];
  const retentionColumns: ColumnsType<RetentionRow> = [
    { title: "商机编号", dataIndex: ["opportunity", "serialNumber"] },
    { title: "区县", dataIndex: ["opportunity", "district", "name"] },
    { title: "状态", render: (_, row) => stateLabels[row.opportunity.state] },
    {
      title: "可清理时间",
      dataIndex: "eligibleAt",
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      render: (_, row) => (
        <Button
          danger
          size="small"
          icon={<SafetyCertificateOutlined />}
          onClick={() => setRetentionItem(row)}
        >
          确认清理
        </Button>
      ),
    },
  ];

  return (
    <Card className="page-card">
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={2} className="page-title">
          系统配置
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
      </Space>
      <Tabs
        items={[
          {
            key: "users",
            label: "账号与角色",
            children: (
              <>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ marginBottom: 16 }}
                  onClick={() => setCreateOpen(true)}
                >
                  创建账号
                </Button>
                <Table
                  rowKey="id"
                  loading={loading}
                  columns={userColumns}
                  dataSource={users}
                  pagination={false}
                  expandable={{
                    expandedRowRender: (row) => (
                      <Space wrap>
                        {row.grants.map((grant) => (
                          <Tag
                            key={grant.id}
                            color={grant.active ? "blue" : "default"}
                            closable={grant.active}
                            onClose={(event) => {
                              event.preventDefault();
                              void deactivateGrant(grant.id);
                            }}
                          >
                            {roleLabels[grant.role]}
                            {grant.districtName
                              ? ` · ${grant.districtName}`
                              : ""}
                          </Tag>
                        ))}
                      </Space>
                    ),
                  }}
                />
              </>
            ),
          },
          {
            key: "routing",
            label: "区县与承接配置",
            children: (
              <RoutingTable
                districts={districts}
                routes={routes}
                users={users}
                onToggleDistrict={toggleDistrict}
                onSaved={load}
              />
            ),
          },
          {
            key: "retention",
            label: "留存清理",
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  仅显示已达到配置留存期限的办结商机。系统不会自动删除正文，必须逐条确认商机编号。
                </Typography.Paragraph>
                <Table
                  rowKey="id"
                  columns={retentionColumns}
                  dataSource={retention}
                  pagination={false}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        open={createOpen}
        title="创建账号"
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="创建"
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(values) => void createUser(values)}
        >
          <Form.Item
            name="phone"
            label="手机号码"
            rules={[{ required: true }, { pattern: /^1[3-9]\d{9}$/ }]}
          >
            <Input maxLength={11} />
          </Form.Item>
          <Form.Item
            name="displayName"
            label="姓名"
            rules={[{ required: true, whitespace: true }, { max: 80 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="initialPassword"
            label="初始密码"
            extra="至少12位，含大小写字母和数字；首次登录强制修改"
            rules={[
              { required: true },
              { min: 12 },
              { pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/ },
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(grantUser)}
        title={`为 ${grantUser?.displayName ?? ""} 添加角色`}
        onCancel={() => setGrantUser(null)}
        onOk={() => grantForm.submit()}
        okText="添加"
      >
        <Form
          form={grantForm}
          layout="vertical"
          onFinish={(values) => void addGrant(values)}
        >
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={Object.entries(roleLabels).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={() => grantForm.setFieldValue("districtId", undefined)}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) => previous.role !== current.role}
          >
            {({ getFieldValue }) =>
              [
                "DISTRICT_MANAGER",
                "PERSONAL_HANDLER",
                "ORGANIZATION_HANDLER",
              ].includes(getFieldValue("role")) ? (
                <Form.Item
                  name="districtId"
                  label="所属区县"
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={districts
                      .filter((item) => item.enabled)
                      .map((item) => ({ value: item.id, label: item.name }))}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(retentionItem)}
        title="确认留存清理"
        onCancel={() => setRetentionItem(null)}
        onOk={() => retentionForm.submit()}
        okText="确认执行"
        okButtonProps={{ danger: true }}
      >
        <Typography.Paragraph>
          请输入商机编号{" "}
          <Typography.Text code>
            {retentionItem?.opportunity.serialNumber}
          </Typography.Text>{" "}
          以确认目标。删除不可恢复；匿名化会移除客户与上报人关联信息并保留业务审计骨架。
        </Typography.Paragraph>
        <Form
          form={retentionForm}
          layout="vertical"
          onFinish={(values) => void completeRetention(values)}
        >
          <Form.Item
            name="action"
            label="清理方式"
            initialValue="ANONYMIZE"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "ANONYMIZE", label: "匿名化（建议）" },
                { value: "DELETE", label: "彻底删除" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="confirmationSerialNumber"
            label="确认商机编号"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

function RoutingTable({
  districts,
  routes,
  users,
  onToggleDistrict,
  onSaved,
}: {
  districts: DistrictView[];
  routes: RouteRow[];
  users: UserRow[];
  onToggleDistrict(row: DistrictView, enabled: boolean): Promise<void>;
  onSaved(): Promise<void>;
}) {
  const { message } = App.useApp();
  const grants = useMemo(
    () =>
      users.flatMap((user) =>
        user.grants
          .filter((grant) => grant.active && user.active)
          .map((grant) => ({ ...grant, userName: user.displayName })),
      ),
    [users],
  );
  async function save(
    districtId: string,
    values: {
      managerGrantId: string;
      personalHandlerGrantId: string;
      organizationHandlerGrantId: string;
    },
  ) {
    try {
      await api(`/admin/districts/${districtId}/routing`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      void message.success("承接配置已保存");
      await onSaved();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "保存失败");
    }
  }
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {districts.map((district) => {
        const route = routes.find((item) => item.districtId === district.id);
        const options = (role: RoleCode) =>
          grants
            .filter(
              (grant) =>
                grant.role === role && grant.districtId === district.id,
            )
            .map((grant) => ({ value: grant.id, label: grant.userName }));
        return (
          <Card
            key={district.id}
            size="small"
            title={
              <Space>
                <span>{district.name}</span>
                <Switch
                  size="small"
                  checked={district.enabled}
                  onChange={(enabled) =>
                    void onToggleDistrict(district, enabled)
                  }
                />
              </Space>
            }
          >
            <Form
              layout="inline"
              initialValues={{
                managerGrantId: route?.manager.id,
                personalHandlerGrantId: route?.personalHandler.id,
                organizationHandlerGrantId: route?.organizationHandler.id,
              }}
              onFinish={(values) => void save(district.id, values)}
            >
              <Form.Item
                name="managerGrantId"
                label="区县经理"
                rules={[{ required: true }]}
              >
                <Select
                  style={{ width: 150 }}
                  options={options("DISTRICT_MANAGER")}
                />
              </Form.Item>
              <Form.Item
                name="personalHandlerGrantId"
                label="个人侧"
                rules={[{ required: true }]}
              >
                <Select
                  style={{ width: 150 }}
                  options={options("PERSONAL_HANDLER")}
                />
              </Form.Item>
              <Form.Item
                name="organizationHandlerGrantId"
                label="组织侧"
                rules={[{ required: true }]}
              >
                <Select
                  style={{ width: 150 }}
                  options={options("ORGANIZATION_HANDLER")}
                />
              </Form.Item>
              <Button
                htmlType="submit"
                type="primary"
                disabled={!district.enabled}
              >
                保存
              </Button>
            </Form>
          </Card>
        );
      })}
    </Space>
  );
}
