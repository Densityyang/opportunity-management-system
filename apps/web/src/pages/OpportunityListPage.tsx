import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  DistrictView,
  OpportunityState,
  OpportunitySummary,
  PageResult,
} from "@oms/contracts";
import {
  App,
  Button,
  Card,
  Empty,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import {
  customerTypeLabels,
  StateTag,
  stateLabels,
} from "../components/labels";

export function OpportunityListPage() {
  const { activeGrant } = useSession();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<PageResult<OpportunitySummary>>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const [districts, setDistricts] = useState<DistrictView[]>([]);
  const [state, setState] = useState<OpportunityState | undefined>();
  const [districtId, setDistrictId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function load(page = 1): Promise<void> {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (state) params.set("state", state);
    if (districtId) params.set("districtId", districtId);
    try {
      setData(
        await api<PageResult<OpportunitySummary>>(`/opportunities?${params}`),
      );
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(1);
    void api<DistrictView[]>("/reference/districts").then(setDistricts);
  }, [activeGrant?.id, state, districtId]);

  const columns: ColumnsType<OpportunitySummary> = [
    {
      title: "商机编号",
      dataIndex: "serialNumber",
      width: 190,
      render: (value: string, row) => (
        <Button
          type="link"
          onClick={() => navigate(`/opportunities/${row.id}`)}
        >
          {value}
        </Button>
      ),
    },
    {
      title: "状态",
      dataIndex: "state",
      width: 150,
      render: (value: OpportunityState) => <StateTag state={value} />,
    },
    { title: "区县", dataIndex: ["district", "name"], width: 110 },
    {
      title: "客户类型",
      dataIndex: "customerType",
      width: 110,
      render: (value: OpportunitySummary["customerType"]) =>
        customerTypeLabels[value],
    },
    {
      title: "一句话说明",
      dataIndex: "oneSentenceDescription",
      ellipsis: true,
      render: (value) => value || "—",
    },
    {
      title: "当前时限",
      dataIndex: "currentSlaDeadline",
      width: 190,
      render: (value: string | null, row) =>
        value ? (
          <span className={row.currentSlaOverdue ? "status-overdue" : ""}>
            {new Date(value).toLocaleString("zh-CN")}
            {row.currentSlaOverdue ? "（已超时）" : ""}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
  ];
  const title =
    activeGrant?.role === "FIELD_REPORTER"
      ? "我的商机"
      : activeGrant?.role === "DISTRICT_MANAGER"
        ? "区县商机与审核"
        : "承接任务";
  return (
    <Card className="page-card">
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Typography.Title level={2} className="page-title">
            {title}
          </Typography.Title>
          {activeGrant?.role === "FIELD_REPORTER" && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate("/report/new")}
            >
              上报商机
            </Button>
          )}
        </Space>
        <Space wrap>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 180 }}
            value={state}
            onChange={setState}
            options={Object.entries(stateLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部区县"
            style={{ width: 160 }}
            value={districtId}
            onChange={setDistrictId}
            options={districts.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void load(data.page)}
          >
            刷新
          </Button>
        </Space>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data.items}
          scroll={{ x: 1100 }}
          locale={{ emptyText: <Empty description="暂无符合条件的商机" /> }}
          pagination={{
            current: data.page,
            pageSize: data.pageSize,
            total: data.total,
            showSizeChanger: false,
            onChange: (page) => void load(page),
          }}
        />
      </Space>
    </Card>
  );
}
