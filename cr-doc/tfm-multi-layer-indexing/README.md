# TFM Service 调用追踪功能 - 需求总体说明

## 概述

本需求为 GitNexus 添加了 TFM (Transaction Flow Management) 框架的调用追踪功能，实现了从 Java 代码到实际服务实现的自动化关系映射。

**核心价值**：
- 自动识别 `ServiceFlow.callService()` 调用
- 解析 XML 配置文件获取实际服务实现
- 在知识图谱中建立精确的调用关系
- 支持多层索引架构（定制层、公共层、产品层）

## 功能特性

### ✅ 已实现功能

1. **TFM 调用识别**
   - 自动识别 `ServiceFlow.callService(param)` 模式
   - 支持两种 serviceName 设置方式：
     - 方法调用：`param.setServiceName("ServiceName")`
     - 字段赋值：`dict.serviceName = "ServiceName"`
   - 智能作用域缓存，提升解析性能

2. **XML 配置解析**
   - 自动扫描 `tfm_service/` 目录
   - 递归查找所有 XML 配置文件
   - 提取 `<definition>` 和 `<method_def>` 节点
   - 支持 2-3 层嵌套结构

3. **多层索引架构**
   - 支持通过命令行参数指定多个目录
   - 层级优先级：定制层 > 公共层 > 产品层
   - 所有层的代码进入同一知识图谱
   - 自动应用优先级选择规则

4. **详细报告生成**
   - `--tfm-report` 参数生成详细失败报告
   - 分类统计：serviceName 提取失败、XML 缺失、类/方法不存在
   - 每个失败案例的详细定位信息

5. **高性能实现**
   - 作用域缓存机制，避免重复扫描
   - 并行文件处理
   - 高效的符号表查询

### 📊 性能指标

**测试数据（core92-atom + coc92-core）**：
- TFM 调用总数：4,692
- 成功解析：4,004 (85.3%)
- 生成关系：3,754 条 CALLS 边
- 索引时间：174.8 秒（双层索引，320k 节点，1014k 边）

**失败分类**：
- serviceName 提取失败：84 (1.8%)
- XML 文件缺失：445 (9.5%)
- 目标类不存在：77 (1.6%)
- 目标方法不存在：82 (1.7%)

## 使用方式

### 基本用法

```bash
# 单目录索引
cd /path/to/project
gitnexus analyze

# 多层索引（命令行参数）
gitnexus analyze --common /path/to/common --product /path/to/product

# 生成详细报告
gitnexus analyze --common /path/to/common --tfm-report

# 查询 TFM 关系
gitnexus cypher "
  MATCH (c)-[r:CALLS {reason: 'tfm-service-resolution'}]->(t)
  RETURN c.name, t.name, r.serviceName
  LIMIT 10
"
```

### 环境变量（兼容旧版）

```bash
# Unix/Linux
export GITNEXUS_EXTRA_ROOTS="/common:/product"
cd /customization
gitnexus analyze

# Windows
set GITNEXUS_EXTRA_ROOTS=E:\common;E:\product
cd E:\customization
gitnexus analyze
```

## 技术架构

### 数据流

```
Java 源代码
    ↓
[Tree-sitter 解析]
    ↓
提取 ServiceFlow.callService() 调用
    ↓
[作用域缓存查找 serviceName]
    ↓
扫描 tfm_service/ 目录
    ↓
[XML 解析获取目标类和方法]
    ↓
[符号表查询解析类和方法]
    ↓
[层级优先级选择]
    ↓
生成 CALLS 关系 → 知识图谱
```

### 关键文件

| 文件 | 作用 | 行数变更 |
|------|------|---------|
| `parse-worker.ts` | TFM 调用提取、作用域缓存 | +120 |
| `tfm-call-processor.ts` | XML 解析、关系生成 | +390 (新建) |
| `symbol-table.ts` | 限定名查询、方法查找 | +80 |
| `pipeline.ts` | 集成 TFM 处理阶段 | +30 |
| `filesystem-walker.ts` | 多目录文件读取 | +50 |
| `analyze.ts` | CLI 参数和选项 | +20 |
| `schema.ts` | 添加 serviceName 字段 | +1 |
| `csv-generator.ts` | 导出 serviceName | +2 |

## 已知限制

1. **动态服务名**：不支持运行时拼接的服务名
2. **跨方法传递**：serviceName 在不同方法间传递时无法追踪
3. **依赖包中的类**：未索引的依赖包中的类无法解析
4. **XML 配置不一致**：约 15% 的失败是配置层面问题

## 测试覆盖

- ✅ 单元测试：TFM 提取逻辑、作用域缓存
- ✅ 集成测试：多层索引、XML 解析、符号解析
- ✅ 端到端测试：实际项目（4,692 个调用）
- ✅ 性能测试：单层 vs 双层索引对比

## 相关文档

| 文档 | 说明 |
|------|------|
| [tfm-multi-layer-indexing-solution.md](./tfm-multi-layer-indexing-solution.md) | 详细的技术实现方案 |
| [tfm-multi-layer-indexing-userguide.md](./tfm-multi-layer-indexing-userguide.md) | 完整的使用手册 |
| [tfm-multi-layer-indexing-testcase.md](./tfm-multi-layer-indexing-testcase.md) | 测试用例和验证方法 |
| [tfm-multi-layer-indexing-changelist.md](./tfm-multi-layer-indexing-changelist.md) | 详细的代码变更记录 |

## 版本信息

- **实现日期**：2026-03-17 ~ 2026-03-24
- **GitNexus 版本**：1.4.8+
- **特性分支**：`feature/tfm-service-indexing`
- **状态**：✅ 已完成并测试通过

## 后续优化建议

### 短期（1-2 周）
1. 修正 XML 配置错误（366 个缺失、150 个类/方法不存在）
2. 优化方法匹配逻辑（支持重载、模糊匹配）

### 中期（1 个月）
1. 支持常量池中的服务名
2. 支持配置文件中的服务名映射
3. 批量配置一致性检查工具

### 长期（未来）
1. 支持动态服务名追踪（数据流分析）
2. 跨方法调用链分析
3. 自动生成缺失的 XML 配置模板

## 会话恢复

本需求实现跨越多个开发会话，主要会话 ID：

- **367c95e2-f22b-4b94-bf38-6ab86397c044**：Phase 11-14 实现和优化
  - Phase 11: 初次实现
  - Phase 12: 多层文件读取修复
  - Phase 13: serviceName 提取优化（方法调用模式）
  - Phase 14: 支持字段赋值模式（成功率提升至 85.3%）
  - 最终优化：--tfm-report 参数、性能优化、日志清理

如需继续开发或调试，在 Claude Code 中执行：
```bash
# 恢复会话上下文（如果需要）
claude --resume 367c95e2-f22b-4b94-bf38-6ab86397c044
# 所有实现已完成并合并到代码库中
```

---

**实现者**：Claude Code AI Assistant
**需求提供者**：用户
**最后更新**：2026-03-24
