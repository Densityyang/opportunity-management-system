import { Card, Typography } from "antd";

export function PrivacyPage() {
  return (
    <Card className="page-card">
      <Typography.Title level={2} className="page-title">
        隐私与信息使用说明
      </Typography.Title>
      <Typography.Paragraph>
        本系统用于记录、分派和跟踪客户需求咨询。请仅填写完成本次咨询所必需的信息，并在上报前确认客户已同意。
      </Typography.Paragraph>
      <Typography.Title level={4}>请勿填写</Typography.Title>
      <Typography.Paragraph>
        客户身份证、银行卡、家庭成员等与本次需求咨询无关的信息。
      </Typography.Paragraph>
      <Typography.Title level={4}>可见范围</Typography.Title>
      <Typography.Paragraph>
        商机正文仅对上报人、本区县经理、当前承接人开放；市公司可只读查看已成功办结的商机。系统管理员默认不能查看商机正文。
      </Typography.Paragraph>
      <Typography.Title level={4}>录音</Typography.Title>
      <Typography.Paragraph>
        录音为可选项，仅保存原始音频，不进行语音识别。办结后按配置期限删除，默认
        90 天。
      </Typography.Paragraph>
      <Typography.Title level={4}>运营主体</Typography.Title>
      <Typography.Paragraph>
        正式部署前，运营方须在此处补充处理者名称、联系方式、处理目的、保存期限和权利请求渠道。
      </Typography.Paragraph>
    </Card>
  );
}
