# Java 调用解析 same-file 错误修复

> ⚠️ **重要提示**：本需求已作为 Bug 修复合并到主需求 `optimize-calls-edges-logic`（v0.7 版本）
>
> 请查看主需求文档获取完整信息：
> - `cr-doc/optimize-calls-edges-logic/README.md` - Bug 修复记录章节
> - `cr-doc/optimize-calls-edges-logic/optimize-calls-edges-logic-changelist.md` - v0.7 变更清单
> - `cr-doc/optimize-calls-edges-logic/optimize-calls-edges-logic-testcase.md` - Bug 修复测试用例

---

# Java 调用解析 same-file 错误修复（独立文档存档）

## 需求概述

### 问题描述
在多目录索引场景下（`--customization` + `--common`），GitNexus Java 代码调用解析存在两个问题：

1. **Java 跨文件调用被错误标记为 same-file**
   - 现象：1,447 个 Method→Method CALLS 边中，632+ 个跨文件调用的 reason 错误标记为 `same-file`
   - 影响：知识图谱调用关系不准确，影响 impact analysis 和代码理解

2. **common/product 目录 Method 节点 content 属性缺失**
   - 现象：customization 目录的 Method 有 content，common/product 目录的 Method content 为空
   - 影响：MCP 工具无法查看 common 目录方法的源代码

### 根本原因

**问题 1: 同名类消歧失败**
- 存在 4 个同名类 `CustQuery` 分布在不同包
- `findClassByTypeName('CustQuery')` 返回第一个匹配（错误的类）
- Java resolver 在错误类中找不到方法 → fallback 到 generic resolver → 错误的 same-file 边

**问题 2: 多 root 文件读取失败**
- `FileContentCache` 只接受单个 `repoPath`
- 读取 common 目录文件时路径拼接错误 → 文件读取失败 → content 为空

### 解决方案

**方案 1: Import 消歧**
- 修改 `findClassByTypeName` 使用 import 信息消歧同名类
- 优先返回被 import 的类
- 向后兼容：import 信息缺失时仍返回第一个匹配

**方案 2: 多 root 支持**
- `FileContentCache` 支持 `string | string[]` 参数
- 循环尝试所有 root 直到找到文件
- 向后兼容：单字符串自动转为单元素数组

---

## 需求状态

| 阶段 | 状态 | 完成时间 | 说明 |
|------|------|----------|------|
| 需求分析 | ✅ 完成 | 2026-03-26 | 根因定位 |
| 方案设计 | ✅ 完成 | 2026-03-26 | 技术方案确定 |
| 代码实现 | ✅ 完成 | 2026-03-26 | 所有修改完成 |
| 编译验证 | ✅ 完成 | 2026-03-26 | npm run build 成功 |
| 基线测试 | ✅ 完成 | 2026-03-26 | 修复前问题确认 |
| 完整测试 | ⏳ 待测试 | - | 需重新索引验证 |
| 文档编写 | ✅ 完成 | 2026-03-26 | 全部文档已输出 |
| 代码提交 | ⏳ 待提交 | - | 待人工确认 |

---

## 文档清单

### 核心文档
1. **[技术方案](./fix-java-call-resolution-same-file-solution.md)**
   - 问题背景和根因分析
   - 详细技术方案设计
   - 代码实现细节
   - 影响范围分析

2. **[变更清单](./fix-java-call-resolution-same-file-changelist.md)**
   - 修改文件列表（4 个文件）
   - 代码修改前后对比
   - 统计信息和审批状态

3. **[用户手册](./fix-java-call-resolution-same-file-userguide.md)**
   - 使用指南和最佳实践
   - 问题排查方法
   - 集成到工作流

4. **[测试用例](./fix-java-call-resolution-same-file-testcase.md)**
   - 12 个测试用例（6 个已通过）
   - 测试执行计划
   - 自动化测试脚本

5. **本文档 (README.md)**
   - 需求总体说明
   - 会话恢复脚本
   - 快速参考

### 诊断脚本
- `gitnexus/diagnose-same-file.js` - 诊断跨文件 same-file 边
- `gitnexus/diagnose-java-resolution.js` - Java 解析分布统计
- `gitnexus/test-content-fix.js` - Method content 验证
- `gitnexus/test-custquery-typeenv.js` - TypeEnv 提取验证
- `gitnexus/test-worker-call-extract.js` - Worker 调用提取验证
- `gitnexus/test-class-existence.js` - SymbolTable 类查找验证
- `gitnexus/test-cross-file-same-file.js` - 深度诊断跨文件边

---

## 修改文件

### 已修改文件 (4 个)
1. `src/core/lbug/csv-generator.ts`
   - FileContentCache 多 root 支持
   - 循环尝试文件读取

2. `src/core/lbug/lbug-adapter.ts`
   - loadGraphToLbug 函数签名更新

3. `src/cli/analyze.ts`
   - 传入完整 roots 数组

4. `src/core/ingestion/java-call-resolver.ts`
   - findClassByTypeName import 消歧
   - 5 个函数签名更新

### 待测试文件 (0 个)
无新增测试文件（使用现有诊断脚本）

---

## 快速开始

### 1. 验证代码已编译
```bash
cd /e/workspace/AI/gitnexus-gerry/gitnexus
npm run build
```

### 2. 重新索引（应用修复）
```bash
cd /e/workspace-iwc/9E-COC/core92-atom
npx gitnexus analyze \
  --customization . \
  --common ../coc92-core \
  --force
```

### 3. 验证修复效果
```bash
# 检查 same-file 边
node /e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/diagnose-same-file.js

# 检查 Java 解析分布
node /e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/diagnose-java-resolution.js

# 检查 content 属性
node /e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/test-content-fix.js
```

### 4. 预期结果
- ✅ 跨文件 same-file 边: 0（修复前 632+）
- ✅ methodInstance 边: 136,450+（修复前 135,818）
- ✅ Common 目录 Method content: 100%（修复前 0%）

---

## 技术亮点

### 1. 零破坏性修改
- 所有函数签名向后兼容
- `importMap` 参数可选
- 单目录索引不受影响

### 2. 高性能设计
- Import 查询为 O(1) 操作（Map + Set）
- 文件读取有 LRU 缓存
- 无额外数据库查询

### 3. 健壮性保证
- Import 消歧失败时有 fallback
- 文件读取失败不影响索引
- 多 root 查找自动重试

### 4. 可维护性
- 代码改动集中，逻辑清晰
- 诊断脚本完善，问题易定位
- 文档详细，易于后续维护

---

## 遗留问题

### 已知限制
1. **Wildcard import 未处理** (P3)
   ```java
   import com.example.*;  // 无法确定具体类
   CustQuery query = ...;
   ```

2. **Fully qualified name 未实现** (P2)
   ```java
   com.example.CustQuery query = ...;  // 完整类名查找未实现
   ```

### 后续优化方向
1. 支持 wildcard import 解析
2. 使用 fully qualified name 匹配
3. 添加缓存层减少 importMap 查询
4. 扩展到其他强类型语言（Kotlin, C#）

---

## 相关会话

### 当前会话
- **会话 ID**: 81eecc62-4fa2-463f-88bf-6b2f3e12d34d
- **开始时间**: 2026-03-26
- **状态**: 文档已输出，待人工确认

### 前置会话
- **会话 ID**: 5554d1b6-a4e6-4d37-8721-84d37dcbf855
- **关键成果**:
  - 定位 same-file 问题根因
  - 实现两阶段解析修复（Pipeline two-phase parsing）
  - 修复 Java resolver 优先级问题

---

## 会话恢复脚本

如需继续本需求的开发或调试，使用以下脚本恢复会话上下文：

```bash
# 1. 切换到项目目录
cd /e/workspace/AI/gitnexus-gerry/gitnexus

# 2. 确认分支状态
git status
git log --oneline -5

# 3. 查看修改文件
git diff src/core/lbug/csv-generator.ts
git diff src/core/lbug/lbug-adapter.ts
git diff src/cli/analyze.ts
git diff src/core/ingestion/java-call-resolver.ts

# 4. 阅读核心文档
cat cr-doc/fix-java-call-resolution-same-file/README.md
cat cr-doc/fix-java-call-resolution-same-file/fix-java-call-resolution-same-file-solution.md

# 5. 编译验证
npm run build

# 6. 如需测试，重新索引
cd /e/workspace-iwc/9E-COC/core92-atom
npx gitnexus analyze --customization . --common ../coc92-core --force

# 7. 运行诊断脚本
cd /e/workspace/AI/gitnexus-gerry/gitnexus
node gitnexus/diagnose-same-file.js
node gitnexus/diagnose-java-resolution.js
node gitnexus/test-content-fix.js

# 8. 查看测试结果
cat cr-doc/fix-java-call-resolution-same-file/fix-java-call-resolution-same-file-testcase.md
```

### 会话上下文关键信息

**问题定位路径**:
```
TypeEnv 提取 ✓
  ↓
Worker 提取 ✓
  ↓
Java resolver 调用 ✓
  ↓
findClassByTypeName ✗ (返回错误类)
  ↓
4 个同名类，返回第 1 个 ✗
  ↓
应该使用 import 消歧 ✓
  ↓
实现 import 消歧逻辑 ✓
```

**关键文件位置**:
- 调用者: `E:\workspace-iwc\9E-COC\coc92-core\COC\code\bc\bc-nocomponent\profile\src\com\ztesoft\zsmart\bss\profile\cust\services\CustQueryService.java`
- 被调用者: `E:\workspace-iwc\9E-COC\coc92-core\COC\code\bc\bc-nocomponent\profile\src\com\ztesoft\zsmart\bss\profile\cust\bs\CustQuery.java`

**关键数据**:
- 同名类数量: 4
- 修复前 same-file 边: 1,447
- 修复前跨文件错误边: 632+
- 预期修复后跨文件错误边: 0

---

## 下一步行动

### 待办事项
- [ ] 人工确认修复方案
- [ ] 重新索引验证修复效果
- [ ] 运行完整测试套件
- [ ] 提交代码到 Git
- [ ] 更新版本号和 CHANGELOG
- [ ] 发布新版本

### 风险提示
⚠️ **必须重新索引**: 本次修复只改变索引逻辑，已有数据库不会自动更新

⚠️ **向后兼容**: 修改完全向后兼容，但建议所有用户重新索引以获得最佳效果

⚠️ **性能影响**: 多 root 文件查找可能略微增加索引时间（预计 < 5%）

---

## 联系信息

### 技术支持
- 文档路径: `/e/workspace/AI/gitnexus-gerry/gitnexus/cr-doc/fix-java-call-resolution-same-file/`
- 诊断脚本: `/e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/diagnose-*.js`
- Git 仓库: `/e/workspace/AI/gitnexus-gerry/gitnexus`

### 相关资源
- GitNexus 官方文档: https://docs.gitnexus.com
- MCP 工具使用: `.claude/skills/gitnexus/`
- 测试数据: `E:\workspace-iwc\9E-COC\`

---

**最后更新**: 2026-03-26
**文档版本**: 1.0
**状态**: ✅ 文档完成，⏳ 待测试验证
