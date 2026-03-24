# TFM Service 调用追踪 - 变更清单

## 变更概述

本次需求为 GitNexus 添加了完整的 TFM (Transaction Flow Management) 框架调用追踪功能，经历了 14 个阶段的迭代和优化。

**开发周期**：2026-03-17 ~ 2026-03-24
**总工作量**：约 20 小时
**代码变更**：8 个文件修改，1 个新文件，共 733 行新增

## 核心实现阶段

### Phase 14: 支持字段赋值模式 (最关键)

**问题**：2,586 个 serviceName 提取失败 (成功率仅 41.2%)

**原因分析**：
实际代码中大量使用字段赋值模式，原实现只支持方法调用模式。

**解决方案**：
在 parse-worker.ts 的 findServiceNameInScope 中新增 Pattern 2:

```typescript
// Pattern 2: 字段赋值 - varName.serviceName = "ServiceName"
if (node.type === 'assignment_expression') {
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');

  if (left?.type === 'field_access') {
    const object = left.childForFieldName('object');
    const field = left.childForFieldName('field');

    if (object?.text === varName && field?.text === 'serviceName') {
      if (right?.type === 'string_literal') {
        return right.text.replace(/^["']|["']$/g, '');
      }
    }
  }
}
```

**效果**：
- serviceName 提取失败：2,586 → 84 (-97.6%)
- 成功率：41.2% → 85.3% (+44.1%)
- 生成关系：1,845 → 3,754 (+103%)

### 最终优化

1. **--tfm-report 参数**：生成详细失败报告
2. **性能优化**：实现作用域缓存机制
3. **日志清理**：删除调试输出

## 主要文件变更

### 1. parse-worker.ts (+150 行)
- 添加 ExtractedTfmCall 和 ExtractedTfmServiceDef 接口
- 实现 extractTfmCalls() 函数
- 支持两种 serviceName 设置模式
- 实现作用域缓存优化

### 2. tfm-call-processor.ts (+390 行, 新建)
- 实现 processTfmCalls() 主处理函数
- XML 文件扫描和解析
- 符号表查询和关系生成
- 失败分类和报告生成

### 3. symbol-table.ts (+80 行)
- findSymbolsByQualifiedName(): 按完全限定名查找类
- findMethodInClass(): 在类中查找方法

### 4. pipeline.ts (+30 行)
- 添加 Phase 9.5: TFM Service Call Resolution
- 添加 PipelineOptions.tfmReport 选项

### 5. filesystem-walker.ts (+50 行)
- 支持多根目录扫描
- 支持多根目录文件读取

### 6. CLI 相关 (+30 行)
- index.ts: 添加 --common, --product, --tfm-report 选项
- analyze.ts: 构建 roots 数组，传递选项到管道

### 7. 数据库相关 (+3 行)
- schema.ts: 添加 serviceName 字段
- csv-generator.ts: 导出 serviceName

## 性能数据

### 单层 vs 双层索引
| 场景 | 文件数 | 节点数 | 边数 | 时间 |
|-----|--------|--------|------|------|
| 单层 | 11.5k | 32k | 72k | 36s |
| 双层 | ~18k | 320k | 1014k | 175s |

时间增长 4.8x 符合数据量增长 10x 的预期。

### TFM 识别效果
- 总调用数：4,692
- 成功解析：4,004 (85.3%)
- 生成关系：3,754 条

## 测试验证

全部 18 个测试用例通过，详见 [测试用例文档](./tfm-multi-layer-indexing-testcase.md)。

---

**文档版本**：1.0
**最后更新**：2026-03-24
