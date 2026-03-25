# TFM Service 调用追踪 - 完整开发历程

**开发周期**：2026-03-17 ~ 2026-03-24  
**总工作量**：约 20 小时  
**最终状态**：✅ 完成并测试通过（85.3% 成功率，3,754 条关系）

---

## 开发阶段时间线

### Phase 1-10: 基础实现 (2026-03-17 ~ 2026-03-23)

#### 已完成的工作
- ✅ 数据类型定义（ExtractedTfmCall, ExtractedTfmServiceDef）
- ✅ 符号表扩展（findSymbolsByQualifiedName, findMethodInClass）
- ✅ TFM 提取逻辑（仅支持方法调用模式）
- ✅ TFM 处理器创建（XML 解析、关系生成）
- ✅ 多目录支持（CLI 参数）
- ✅ 管道集成（Phase 9.5）
- ✅ 单元测试

**代码量**：约 600 行新增

---

### Phase 11: 首次调试 - sourceId 标签错误 (2026-03-23 晚)

#### 问题：生成 0 条关系 ❌

**症状**：
```bash
gitnexus analyze --common /path/to/common
gitnexus cypher "MATCH ()-[r {reason:'tfm-service-resolution'}]->() RETURN count(r)"
# 结果：0
```

**排查过程**：
1. TFM 调用提取：4,692 个 ✅
2. XML 解析：1,250 个服务 ✅  
3. 关系生成：0 条 ❌

**根本原因**：
```typescript
// Bug: Java 方法使用 'Method:' 标签，代码中使用了 'Function:'
const sourceId = generateId('Function', `${filePath}:${methodName}`);  // ❌

// 符号表中的实际格式
Method:path/to/File.java:ClassName:methodName  // ✅
```

**修复**：
```typescript
const sourceId = currentFunction
  ? generateId('Method', `${filePath}:${currentFunction.childForFieldName('name')?.text}`)
  : generateId('File', filePath);
```

**结果**：生成了 81 条关系 ✅（但预期应该有 2000+）

---

### Phase 12: 多层文件读取修复 (2026-03-23 深夜)

#### 问题：只有 81 条关系，预期 2000+ ❌

**排查**：
- TFM 调用：4,692 ✅
- serviceName 提取成功：2,106 ✅
- XML 解析：1,250 ✅
- **目标类不存在**：1,950+ ❌

**根本原因**：多层索引时文件读取错误
```typescript
// Bug: 只从第一个根目录读取
export const readFileContents = async (
  repoPath: string,  // 只接受单个路径
  relativePaths: string[]
) => {
  for (const relPath of relativePaths) {
    const fullPath = path.join(repoPath, relPath);  // ❌ repoPath 是第一个根
    // common 层文件读取失败！
  }
};
```

**详细日志**：
```
Scanning: 17,468 Java files (customization + common) ✅
Parsing: 1,294 files  ⚠️ 只解析了 customization 层
Common layer: 16,174 files NOT read ❌
```

**修复**：
```typescript
export const readFileContents = async (
  repoPath: string | string[],  // 接受数组
  relativePaths: string[],
  scannedFiles?: ScannedFile[]  // 文件→根目录映射
) => {
  const roots = Array.isArray(repoPath) ? repoPath : [repoPath];
  const pathToRoot = new Map<string, string>();

  // 构建映射
  if (scannedFiles) {
    for (const file of scannedFiles) {
      pathToRoot.set(file.path, file.root);
    }
  }

  // 使用正确的根目录
  for (const relPath of relativePaths) {
    const root = pathToRoot.get(relPath) || roots[0];  // ✅
    const fullPath = path.join(root, relPath);
    contents.set(relPath, await fs.readFile(fullPath, 'utf-8'));
  }

  return contents;
};
```

**结果**：81 → 1,845 条关系（+2171%）✅

---

### Phase 13: 中间状态评估 (2026-03-24 上午)

#### 现状 📊
```
总调用数：4,692
成功解析：1,935 (41.2%)
生成关系：1,845 条
```

#### 失败原因
| 类型 | 数量 | 占比 |
|------|------|------|
| **serviceName 提取失败** | **2,586** | **55.1%** ⚠️ |
| XML 文件缺失 | 114 | 2.4% |
| 目标类不存在 | 43 | 0.9% |
| 目标方法不存在 | 14 | 0.3% |

**最大瓶颈**：serviceName 提取失败率高达 55%！

#### 用户反馈 💡
```java
// 用户提供的实际代码
DynamicDict dict = new DynamicDict();
dict.serviceName = "WSSetVasForDubbo";  // ⚠️ 字段赋值！
ServiceFlow.callService(dict, true);
```

**分析**：
- 原实现只支持 `param.setServiceName("XXX")`
- 实际代码大量使用 `dict.serviceName = "XXX"`
- 这是 55% 失败的根本原因

---

### Phase 14: 支持字段赋值模式 (2026-03-24 下午) ⭐

#### 实现
```typescript
function findServiceNameInScope(scopeNode: any, varName: string): string | null {
  function search(node: any): string | null {
    // Pattern 1: 方法调用 (原有)
    if (node.type === 'method_invocation') {
      if (object?.text === varName && name?.text === 'setServiceName') {
        return stringLiteral;
      }
    }

    // Pattern 2: 字段赋值 (新增) ✅
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

    for (const child of node.children || []) {
      const result = search(child);
      if (result) return result;
    }

    return null;
  }

  return search(scopeNode);
}
```

#### 效果对比 📊
| 指标 | Phase 13 | Phase 14 | 变化 |
|------|----------|----------|------|
| 成功解析 | 1,935 | 4,004 | +2,069 (+107%) |
| 生成关系 | 1,845 | 3,754 | +1,909 (+103%) |
| **成功率** | **41.2%** | **85.3%** | **+44.1%** 🎯 |
| serviceName 提取失败 | 2,586 | 84 | -2,502 (-96.8%) |

**关键洞察**：
- 字段赋值是主流模式（约 53% 的代码）
- XML/类/方法问题增加是因为更多 serviceName 被提取

---

### Phase 15: 添加 serviceName 字段 (2026-03-24 下午)

#### 问题
CALLS 关系中没有 serviceName 属性

#### 修复
- schema.ts: 添加 `serviceName STRING` 字段
- csv-generator.ts: 导出 serviceName 列
- tfm-call-processor.ts: 添加 serviceName 到关系

**验证**：
```cypher
MATCH ()-[r:CALLS {reason: 'tfm-service-resolution'}]->()
RETURN r.serviceName LIMIT 5
```
✅ 正常返回服务名

---

### Phase 16: 添加 --tfm-report 参数 (2026-03-24 晚)

#### 实现
- CLI 参数：`--tfm-report`
- 生成文件：`tfm-resolution-report.log`
- 内容：汇总统计 + 失败分类 + 详细列表

**使用**：
```bash
gitnexus analyze --common /path --tfm-report
cat tfm-resolution-report.log  # 195KB 详细报告
```

---

### Phase 17: 性能优化 (2026-03-24 晚)

#### 作用域缓存
```typescript
const scopeCache = new Map<any, Map<string, string>>();

// 一次扫描，缓存所有 serviceName 赋值
function buildScopeCache(scopeNode: any): Map<string, string> {
  // 遍历作用域，收集所有 serviceName 赋值
  // O(m) 一次性完成
}

// 后续查询 O(1)
function getServiceName(scopeNode: any, varName: string): string | null {
  let cache = scopeCache.get(scopeNode);
  if (!cache) {
    cache = buildScopeCache(scopeNode);
    scopeCache.set(scopeNode, cache);
  }
  return cache.get(varName) || null;
}
```

**效果**：
- 理论：O(n×m) → O(m+n)
- 实测：无显著差异（TFM 提取占比小）

#### 日志清理
删除每次解析都输出的详细日志（4000+ 行），保留汇总统计。

---

## 最终成果

### 代码统计
```
9 个文件修改，733 行新增：
  parse-worker.ts: +150
  tfm-call-processor.ts: +390 (新建)
  symbol-table.ts: +80
  pipeline.ts: +30
  filesystem-walker.ts: +50
  其他: +33
```

### 测试结果
```
18/18 测试通过 (100%)
  单元测试: 3/3
  集成测试: 8/8
  性能测试: 3/3
  边界测试: 3/3
  回归测试: 1/1
```

### 质量指标
```
TFM 识别：4,692 个
成功解析：4,004 个 (85.3%)
生成关系：3,754 条
serviceName 提取成功率：98.3%
```

### 性能基准
```
单层索引: 36 秒 (32k 节点, 72k 边)
双层索引: 175 秒 (320k 节点, 1014k 边)
```

---

## 关键里程碑

1. **Phase 11**: 首次生成关系（81 条）
2. **Phase 12**: 多层文件读取修复（1,845 条，+2171%）
3. **Phase 14**: 字段赋值支持（3,754 条，成功率 85.3%）⭐
4. **Phase 16**: --tfm-report 参数
5. **Phase 17**: 性能优化完成

---

## 遗留问题

### 当前失败分布 (688 个)
- XML 文件缺失: 445 (64.7%)
- 目标方法不存在: 82 (11.9%)
- 目标类不存在: 77 (11.2%)
- serviceName 提取失败: 84 (12.2%)

### 优化建议
**短期**：人工核查 XML 缺失，修正配置错误  
**中期**：支持常量池服务名，方法重载匹配  
**长期**：动态服务名追踪，跨方法传递支持

---

**文档版本**：2.0  
**最后更新**：2026-03-25  
**维护者**：Claude Code AI Assistant
