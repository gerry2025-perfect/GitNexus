# TFM Service 调用追踪 - 用户手册

## 快速开始

### 1. 单目录索引

```bash
cd /path/to/your-project
gitnexus analyze
```

### 2. 多层索引

```bash
# 命令行参数（推荐）
gitnexus analyze --common /path/to/common --product /path/to/product

# 环境变量（兼容旧版）
export GITNEXUS_EXTRA_ROOTS="/path/to/common:/path/to/product"
gitnexus analyze
```

### 3. 生成详细报告

```bash
gitnexus analyze --common /path/to/common --tfm-report
```

报告文件将生成在：`<项目根目录>/tfm-resolution-report.log`

## 查询 TFM 关系

### 基本查询

```bash
# 查看所有 TFM 关系
gitnexus cypher "
  MATCH (caller)-[r:CALLS {reason: 'tfm-service-resolution'}]->(target)
  RETURN caller.name, r.serviceName, target.name
  LIMIT 20
"
```

### 按服务名查询

```bash
# 查找特定服务的调用
gitnexus cypher "
  MATCH (c)-[r:CALLS {serviceName: 'WSSetVasForDubbo'}]->(t)
  RETURN c.name, t.name
"
```

### 统计信息

```bash
# TFM 关系总数
gitnexus cypher "
  MATCH ()-[r:CALLS {reason: 'tfm-service-resolution'}]->()
  RETURN count(r) AS tfmCallCount
"
```

## 故障排查

### 问题：TFM 调用未识别

**可能原因**：
1. serviceName 是动态拼接的
2. serviceName 在其他方法中设置
3. 使用了不标准的调用模式

**检查方法**：
```bash
# 查看报告文件中的失败案例
grep "Failed to extract serviceName" tfm-resolution-report.log
```

### 问题：XML 文件未找到

**可能原因**：
1. XML 文件不在 `tfm_service/` 目录
2. 文件名与 serviceName 不匹配
3. 未包含该层目录

**解决方法**：
```bash
# 检查 XML 文件是否存在
find . -name "YourServiceName.xml"

# 确保指定了正确的层目录
gitnexus analyze --common /correct/path/to/common
```

### 问题：目标类/方法不存在

**可能原因**：
1. XML 配置的类名错误
2. 类在依赖 jar 包中（未索引）
3. 方法名拼写错误

**解决方法**：
1. 检查 XML 配置：`cat tfm_service/ServiceName.xml`
2. 查看报告文件获取详细信息

## TFM 报告解读

### 报告结构

```
[TFM] ========== Resolution Summary ==========
[TFM] Total calls: 4692
[TFM] Resolved: 4004 (85.3%)
[TFM] Unresolved: 688 (14.7%)

[TFM] Failure breakdown:
[TFM]   1. No serviceName extracted: 84
[TFM]   2. No XML file found: 445
[TFM]   3. Target class not found: 77
[TFM]   4. Target method not found: 82
```

### 失败类型说明

| 类型 | 说明 | 处理建议 |
|-----|------|---------|
| No serviceName extracted | 无法从代码提取服务名 | 人工审查代码，可能需要重构 |
| No XML file found | 缺少 XML 配置文件 | 检查是否应该有配置，补充缺失的 XML |
| Target class not found | 目标类未在符号表中 | 可能在 jar 包中，或包名不匹配 |
| Target method not found | 目标方法不存在 | 检查 XML 的 method_def 节点 |

## 最佳实践

### 1. 定期重新索引

```bash
# 代码变更后重新索引
gitnexus analyze --force
```

### 2. 使用 --tfm-report 检查质量

```bash
# 定期生成报告，检查失败率
gitnexus analyze --tfm-report --force
grep "Resolved:" tfm-resolution-report.log
```

### 3. 修正配置错误

根据报告修正：
- 补充缺失的 XML 文件
- 更正类名/方法名
- 更新过时的配置

## 性能参考

| 规模 | 文件数 | 节点数 | 索引时间 |
|-----|--------|--------|---------|
| 小型（单层） | ~5k | ~15k | 10-20s |
| 中型（单层） | ~10k | ~30k | 30-40s |
| 大型（双层） | ~18k | ~320k | 150-200s |

## 获取帮助

- 技术问题：查看 [实现方案](./tfm-multi-layer-indexing-solution.md)
- 详细变更：查看 [变更清单](./tfm-multi-layer-indexing-changelist.md)
- 测试验证：查看 [测试用例](./tfm-multi-layer-indexing-testcase.md)

---

**文档版本**：1.0
**最后更新**：2026-03-24
