import {
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type {
  AdminCapabilities,
  DistrictView,
  PageResult,
  RoleCode,
} from "@oms/contracts";
import {
  Alert,
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
import { useSession } from "../auth/session";
import { roleLabels, stateLabels } from "../components/labels";
import { PersonnelAdminPanel } from "../components/PersonnelAdminPanel";

interface GrantRow {
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
  createdAt: string;
  grants: GrantRow[];
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

const DISTRICT_ROLES = new Set<RoleCode>([
  "FIELD_REPORTER",
  "DISTRICT_MANAGER",
  "PERSONAL_HANDLER",
  "ORGANIZATION_HANDLER",
]);

export function AdminPage() {
  const { activeGrant } = useSession();
  const { message } = App.useApp();
  const [capabilities, setCapabilities] = useState<AdminCapabilities | null>(
    null,
  );
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [districts, setDistricts] = useState<DistrictView[]>([]);
  const [retention, setRetention] = useState<RetentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleCode>();
  const [districtFilter, setDistrictFilter] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [grantUser, setGrantUser] = useState<UserRow | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [retentionItem, setRetentionItem] = useState<RetentionRow | null>(null);
  const [createForm] = Form.useForm();
  const [grantForm] = Form.useForm();
  const [resetForm] = Form.useForm();
  const [retentionForm] = Form.useForm();
  const createRole = Form.useWatch<RoleCode>("role", createForm);
  const grantRole = Form.useWatch<RoleCode>("role", grantForm);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const nextCapabilities = await api<AdminCapabilities>(
        "/admin/capabilities",
      );
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      if (districtFilter) params.set("districtId", districtFilter);
      const requests: [
        Promise<PageResult<UserRow>>,
        Promise<DistrictView[]>,
        Promise<{ items: RetentionRow[] }> | null,
      ] = [
        api<PageResult<UserRow>>(`/admin/users?${params.toString()}`),
        api<DistrictView[]>("/admin/districts"),
        nextCapabilities.canManageRetention
          ? api<{ items: RetentionRow[] }>("/admin/retention?pageSize=100")
          : null,
      ];
      const [userPage, districtRows, retentionPage] = await Promise.all([
        requests[0],
        requests[1],
        requests[2] ?? Promise.resolve(null),
      ]);
      setCapabilities(nextCapabilities);
      setUsers(userPage.items);
      setTotal(userPage.total);
      setDistricts(districtRows);
      setRetention(retentionPage?.items ?? []);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "管理数据加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(
    () => void load(),
    [activeGrant?.id, page, search, roleFilter, districtFilter],
  );

  const configurableDistricts = useMemo(
    () => districts.filter((district) => district.sortOrder < 900),
    [districts],
  );
  const enabledDistricts = useMemo(
    () => configurableDistricts.filter((district) => district.enabled),
    [configurableDistricts],
  );
  const roleOptions = (capabilities?.manageableRoles ?? []).map((role) => ({
    value: role,
    label: roleLabels[role],
  }));

  async function createUser(values: {
    phone: string;
    displayName: string;
    initialPassword: string;
    role: RoleCode;
    districtId?: string;
  }): Promise<void> {
    try {
      await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          phone: values.phone,
          displayName: values.displayName,
          initialPassword: values.initialPassword,
          grants: [grantPayload(values.role, values.districtId)],
        }),
      });
      setCreateOpen(false);
      createForm.resetFields();
      void message.success("账号和首个角色已一次性创建");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function addGrant(values: {
    role: RoleCode;
    districtId?: string;
  }): Promise<void> {
    if (!grantUser) return;
    try {
      await api(`/admin/users/${grantUser.id}/grants`, {
        method: "POST",
        body: JSON.stringify(grantPayload(values.role, values.districtId)),
      });
      setGrantUser(null);
      grantForm.resetFields();
      void message.success("角色授权已添加，承接覆盖同步生效");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "添加失败");
    }
  }

  async function deactivateGrant(grantId: string): Promise<void> {
    try {
      await api(`/admin/grants/${grantId}`, { method: "DELETE" });
      void message.success("角色授权已停用");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "停用失败");
    }
  }

  async function toggleUser(row: UserRow): Promise<void> {
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

  async function resetPassword(values: {
    initialPassword: string;
  }): Promise<void> {
    if (!resetUser) return;
    try {
      await api(`/admin/users/${resetUser.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setResetUser(null);
      resetForm.resetFields();
      void message.success("密码已重置，用户下次登录必须修改");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "重置失败");
    }
  }

  async function toggleDistrict(
    district: DistrictView,
    enabled: boolean,
  ): Promise<void> {
    try {
      await api(`/admin/districts/${district.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "更新失败");
    }
  }

  async function completeRetention(values: {
    action: "ANONYMIZE" | "DELETE";
    confirmationSerialNumber: string;
  }): Promise<void> {
    if (!retentionItem) return;
    try {
      await api(`/admin/retention/${retentionItem.id}/complete`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setRetentionItem(null);
      retentionForm.resetFields();
      void message.success("留存处置已完成");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "处置失败");
    }
  }

  const userColumns: ColumnsType<UserRow> = [
    {
      title: "姓名 / 联系方式",
      key: "identity",
      width: 190,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.displayName}</Typography.Text>
          <Typography.Text type="secondary">{row.phone}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "账号状态",
      key: "status",
      width: 110,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Tag color={row.active ? "success" : "default"}>
            {row.active ? "启用" : "停用"}
          </Tag>
          {row.mustChangePassword && <Tag color="warning">待改密码</Tag>}
        </Space>
      ),
    },
    {
      title: "有效角色授权",
      key: "grants",
      render: (_, row) => (
        <Space wrap>
          {row.grants
            .filter((grant) => grant.active)
            .map((grant) => (
              <Popconfirm
                key={grant.id}
                title="停用此角色授权？"
                description="承接覆盖将随授权同步更新；有活动任务时系统会阻止停用。"
                onConfirm={() => void deactivateGrant(grant.id)}
              >
                <Tag closable onClose={(event) => event.preventDefault()}>
                  {roleLabels[grant.role]}
                  {grant.districtName ? ` · ${grant.districtName}` : ""}
                </Tag>
              </Popconfirm>
            ))}
          {!row.grants.some((grant) => grant.active) && <Tag>暂无角色</Tag>}
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => setGrantUser(row)}>
            添加角色
          </Button>
          {capabilities?.canManageGlobalUsers && (
            <>
              <Button size="small" onClick={() => setResetUser(row)}>
                重置密码
              </Button>
              <Popconfirm
                title={row.active ? "停用整个账号？" : "重新启用账号？"}
                description={
                  row.active ? "停用账号会同时撤销全部有效角色。" : undefined
                }
                onConfirm={() => void toggleUser(row)}
              >
                <Switch size="small" checked={row.active} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const districtColumns: ColumnsType<DistrictView> = [
    { title: "顺序", dataIndex: "sortOrder", width: 70 },
    { title: "区县", dataIndex: "name", width: 120 },
    {
      title: "区县经理",
      key: "managers",
      render: (_, row) => coverageTag(row.coverage?.managers),
    },
    {
      title: "个人侧",
      key: "personal",
      render: (_, row) => coverageTag(row.coverage?.personalHandlers),
    },
    {
      title: "组织侧",
      key: "organization",
      render: (_, row) => coverageTag(row.coverage?.organizationHandlers),
    },
    {
      title: "一线上报人",
      key: "reporters",
      render: (_, row) => <Tag>{row.coverage?.fieldReporters ?? 0} 人</Tag>,
    },
    {
      title: "状态",
      key: "enabled",
      render: (_, row) =>
        capabilities?.canManageDistricts ? (
          <Switch
            checked={row.enabled}
            checkedChildren="启用"
            unCheckedChildren="停用"
            onChange={(enabled) => void toggleDistrict(row, enabled)}
          />
        ) : (
          <Tag color={row.enabled ? "success" : "default"}>
            {row.enabled ? "启用" : "停用"}
          </Tag>
        ),
    },
  ];

  const accountPanel = (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="权限按当前角色自动收敛"
        description="区县经理只能搜索和配置本区县下级角色，不能查看其他区县、同级经理或上级权限；高级市公司管理员可管理全区域业务角色，系统管理员可管理全局。"
      />
      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按姓名搜索；手机号需完整输入"
            value={searchDraft}
            style={{ width: 300 }}
            onChange={(event) => setSearchDraft(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              setSearch(searchDraft.trim());
            }}
          />
          <Button
            type="primary"
            onClick={() => {
              setPage(1);
              setSearch(searchDraft.trim());
            }}
          >
            搜索
          </Button>
          <Select<RoleCode>
            allowClear
            placeholder="筛选角色"
            value={roleFilter}
            options={roleOptions}
            style={{ width: 180 }}
            onChange={(value) => {
              setPage(1);
              setRoleFilter(value);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="筛选区县"
            value={districtFilter}
            options={enabledDistricts.map((district) => ({
              value: district.id,
              label: district.name,
            }))}
            style={{ width: 160 }}
            onChange={(value) => {
              setPage(1);
              setDistrictFilter(value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            新建账号并授权
          </Button>
        </Space>
      </Card>
      <Table<UserRow>
        rowKey="id"
        loading={loading}
        columns={userColumns}
        dataSource={users}
        scroll={{ x: 920 }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showTotal: (value) => `共 ${value} 个账号`,
          onChange: setPage,
        }}
      />
    </Space>
  );

  const tabs = [
    { key: "accounts", label: "账号与角色", children: accountPanel },
    {
      key: "districts",
      label: "区县承接覆盖",
      children: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="success"
            showIcon
            message="无需重复配置承接关系"
            description="本表直接汇总账号与角色授权。初审时区县经理从对应个人侧或组织侧有效人员中选择本次承接人。"
          />
          <Table<DistrictView>
            rowKey="id"
            loading={loading}
            columns={districtColumns}
            dataSource={configurableDistricts}
            pagination={false}
            scroll={{ x: 760 }}
          />
        </Space>
      ),
    },
    ...(capabilities?.canViewPersonnel
      ? [
          {
            key: "personnel",
            label: "人员与职务",
            children: (
              <PersonnelAdminPanel
                capabilities={capabilities}
                districts={enabledDistricts}
              />
            ),
          },
        ]
      : []),
    ...(capabilities?.canManageRetention
      ? [
          {
            key: "retention",
            label: "留存清理",
            children: (
              <Table<RetentionRow>
                rowKey="id"
                dataSource={retention}
                pagination={false}
                columns={[
                  {
                    title: "商机编号",
                    dataIndex: ["opportunity", "serialNumber"],
                  },
                  {
                    title: "区县",
                    dataIndex: ["opportunity", "district", "name"],
                  },
                  {
                    title: "状态",
                    render: (_, row) => stateLabels[row.opportunity.state],
                  },
                  {
                    title: "可处置时间",
                    render: (_, row) =>
                      new Date(row.eligibleAt).toLocaleString("zh-CN"),
                  },
                  {
                    title: "操作",
                    render: (_, row) => (
                      <Button
                        danger
                        icon={<SafetyCertificateOutlined />}
                        onClick={() => setRetentionItem(row)}
                      >
                        审核处置
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} className="page-title">
          账号、角色与承接管理
        </Typography.Title>
        <Typography.Text type="secondary">
          所有承接能力均由有效角色授权直接计算，避免重复维护。
        </Typography.Text>
      </div>
      <Card className="page-card">
        <Tabs items={tabs} />
      </Card>

      <Modal
        open={createOpen}
        title="新建账号并配置首个角色"
        okText="创建"
        cancelText="取消"
        onOk={() => createForm.submit()}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(values) => void createUser(values)}
        >
          <Form.Item
            name="phone"
            label="手机号码"
            rules={[
              { required: true },
              { pattern: /^1[3-9]\d{9}$/, message: "请输入有效手机号码" },
            ]}
          >
            <Input inputMode="tel" maxLength={11} />
          </Form.Item>
          <Form.Item
            name="displayName"
            label="姓名"
            rules={[{ required: true, whitespace: true }, { max: 80 }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="initialPassword"
            label="初始密码"
            extra="仅限定 6 至 12 位；首次登录必须修改。"
            rules={[{ required: true }, { min: 6 }, { max: 12 }]}
          >
            <Input.Password maxLength={12} />
          </Form.Item>
          <GrantFields
            roleOptions={roleOptions}
            districts={enabledDistricts}
            role={createRole}
          />
        </Form>
      </Modal>

      <Modal
        open={Boolean(grantUser)}
        title={`为 ${grantUser?.displayName ?? "账号"} 添加角色`}
        okText="添加"
        cancelText="取消"
        onOk={() => grantForm.submit()}
        onCancel={() => {
          setGrantUser(null);
          grantForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={grantForm}
          layout="vertical"
          onFinish={(values) => void addGrant(values)}
        >
          <GrantFields
            roleOptions={roleOptions}
            districts={enabledDistricts}
            role={grantRole}
          />
        </Form>
      </Modal>

      <Modal
        open={Boolean(resetUser)}
        title={`重置 ${resetUser?.displayName ?? "账号"} 的密码`}
        okText="确认重置"
        cancelText="取消"
        onOk={() => resetForm.submit()}
        onCancel={() => {
          setResetUser(null);
          resetForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={resetForm}
          layout="vertical"
          onFinish={(values) => void resetPassword(values)}
        >
          <Form.Item
            name="initialPassword"
            label="新初始密码"
            rules={[{ required: true }, { min: 6 }, { max: 12 }]}
          >
            <Input.Password maxLength={12} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(retentionItem)}
        title="审核留存处置"
        okText="执行"
        cancelText="取消"
        onOk={() => retentionForm.submit()}
        onCancel={() => {
          setRetentionItem(null);
          retentionForm.resetFields();
        }}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="该操作不可逆"
          description="匿名化将清除个人信息，删除将移除整条商机。请输入商机编号确认。"
          style={{ marginBottom: 16 }}
        />
        <Form
          form={retentionForm}
          layout="vertical"
          onFinish={(values) => void completeRetention(values)}
        >
          <Form.Item
            name="action"
            label="处置方式"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "ANONYMIZE", label: "匿名化" },
                { value: "DELETE", label: "删除" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="confirmationSerialNumber"
            label={`输入商机编号：${retentionItem?.opportunity.serialNumber ?? ""}`}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function GrantFields({
  roleOptions,
  districts,
  role,
}: {
  roleOptions: Array<{ value: RoleCode; label: string }>;
  districts: DistrictView[];
  role?: RoleCode;
}) {
  const scoped = role ? DISTRICT_ROLES.has(role) : false;
  return (
    <>
      <Form.Item name="role" label="角色" rules={[{ required: true }]}>
        <Select options={roleOptions} />
      </Form.Item>
      {scoped && (
        <Form.Item
          name="districtId"
          label="所属区县"
          rules={[{ required: true }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={districts.map((district) => ({
              value: district.id,
              label: district.name,
            }))}
          />
        </Form.Item>
      )}
    </>
  );
}

function grantPayload(role: RoleCode, districtId?: string) {
  return DISTRICT_ROLES.has(role) ? { role, districtId } : { role };
}

function coverageTag(count = 0) {
  return (
    <Tag color={count > 0 ? "success" : "error"}>
      {count > 0 ? `${count} 人` : "未配置"}
    </Tag>
  );
}
