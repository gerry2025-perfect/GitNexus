# GitNexus CALLS 边优化 - 使用指南 v2.0

## 概述

本次优化改进了 GitNexus 中 CALLS 边的构造逻辑，主要包括：

1. ✅ **跨文件类型检查**：不同语言文件之间不会建立调用关系
2. ✅ **删除 fuzzy-global**：移除低置信度的全局匹配边
3. ✅ **Java 专用解析器**：针对 Java 实现 6 种精确的调用关系识别（**已完成**）
4. ✅ **性能优化**：从589秒优化至52秒（**91.2%提升**）

**当前状态**: ✅ 全部完成（2026-03-20）
**最终性能**: 大项目52秒，小项目10秒（相比初始589秒提升91.2%）
**功能**: 6种Java调用类型全部实现
**核心优化**: findEnclosingClass 从 O(E) 边遍历优化为 O(1) 直接ID查找

---

## 性能监控

### 查看Java处理性能

运行索引时会自动输出Java性能统计（需 `--verbose` 标志）：

```bash
npx gitnexus analyze --verbose
```

**最终性能统计输出**（基于真实大项目测试）：
```
[Java Call Resolver] 10226/10226 calls resolved (100.0%) | Unresolved: 0 (third-party/cross-module/reflection)
[Java Call Resolver] By type: this: 4909, methodInstance: 2790, static: 2218, classInstance: 234, super: 75, interface: 0

[Java Performance Breakdown]
  Total calls processed: 106869
  Total processing time: 3796ms
  Resolve function time: 3747ms (98.7%)
  Avg per call: 0.04ms

  Resolve Type Breakdown:
    this:           92ms (2.4%)
    static:         39ms (1.0%)
    methodInstance: 2060ms (54.3%)
    classInstance:  804ms (21.2%)
    super:          751ms (19.8%)
    interface:      0ms (0.0%)

  Helper Function Breakdown:
    extractLocals:  2020ms
    parseClassAST:  716ms
    findField:      726ms
```

### 性能基准

| 项目规模 | 节点数 | Java文件 | 调用次数 | 索引时间 | 状态 |
|---------|--------|----------|---------|---------|------|
| 小项目 | ~2000 | ~7 | ~16 | ~10秒 | ✅ 优秀 |
| 中项目 | ~10000 | ~100 | ~1000 | ~25秒 | ✅ 良好 |
| 大项目 | ~27000 | ~828 | ~107000 | **52秒** | ✅ 优秀 |

**性能优化成果**：从初始589秒优化至最终52秒，提升 **91.2%**

### 性能问题排查

如果索引时间异常长（> 预期2倍），检查：

1. **Java文件数量**:
   ```bash
   find . -name "*.java" | wc -l
   ```

2. **单文件大小**:
   ```bash
   find . -name "*.java" -size +512k
   ```
   （超过512KB的文件会被自动跳过）

3. **方法调用密度**:
   性能与方法调用数量成正比，复杂项目会更慢

---

## 功能说明

### 1. 跨文件类型检查

**功能描述**:
确保 CALLS 边的源节点和目标节点来自相同语言的文件。例如，`.js` 文件不能直接调用 `.java` 文件中的方法。

**实现原理**:
在解析调用关系时，检查源文件和目标文件的语言类型：
```typescript
const sourceLanguage = getLanguageFromFilename(currentFile);
const targetLanguage = getLanguageFromFilename(def.filePath);
if (sourceLanguage !== targetLanguage) {
  continue;  // 跳过跨语言调用
}
```

**适用场景**:
- 多语言混合项目（如 Java + JavaScript）
- 避免错误的跨语言调用边
- 提高调用图的准确性

**使用方法**:
无需额外配置，自动生效。重新运行索引即可：
```bash
npx gitnexus analyze
```

**验证方法**:
```bash
# 使用 MCP 工具查询 CALLS 边
gitnexus_cypher({
  query: "MATCH (a)-[r:CALLS]->(b) WHERE a.language <> b.language RETURN count(r)"
})
# 应该返回 0（无跨语言调用）
```

---

### 2. 删除 fuzzy-global 边

**功能描述**:
移除了全局模糊匹配策略（fuzzy-global），该策略会在无法通过导入或同文件查找时，进行全局符号匹配，准确度很低（0.3-0.5）。

**变更前**:
```typescript
// Strategy C: Fuzzy global (no import match found)
const confidence = allDefs.length === 1 ? 0.5 : 0.3;
return { nodeId: allDefs[0].nodeId, confidence, reason: 'fuzzy-global' };
```

**变更后**:
```typescript
// Strategy C: Fuzzy global - REMOVED
// This was generating too many false positives
return null;
```

**影响**:
- ✅ **优点**: 减少误报，提高边的准确性
- ⚠️ **缺点**: CALLS 边数量可能减少，某些动态调用可能无法识别

**保留的解析策略**:
1. **same-file** (confidence: 0.85) - 在同一文件中查找
2. **import-resolved** (confidence: 0.9) - 在导入的文件中查找
3. **Java 专用** (confidence: 0.85-0.95) - Java 5 种调用类型

**验证方法**:
```bash
# 查询所有 CALLS 边的 reason 类型
gitnexus_cypher({
  query: "MATCH ()-[r:CALLS]->() RETURN DISTINCT r.reason, count(*) as count"
})
# 应该不包含 'fuzzy-global'
```

---

### 3. Java 专用解析器（部分完成）

**功能描述**:
针对 Java 代码实现 5 种精确的调用关系识别，基于 Java 的实际调用方式构造边。

#### 3.1 已实现的调用类型

##### static - 静态方法调用
**识别规则**:
- 类名首字母大写
- 在 import 中查找类定义
- 支持完全限定名（如 `com.example.Utils.format()`）

**示例**:
```java
import com.example.Utils;

public class UserController {
    void process() {
        String result = Utils.format("test");  // static 调用
    }
}
```

**边属性**:
- reason: `'static'`
- confidence: 0.95

---

##### this - 当前类方法调用
**识别规则**:
- 无对象前缀的方法调用（如 `methodName()`）
- 在当前类中查找同名方法

**示例**:
```java
public class UserService {
    void process() {
        validate();  // this 调用（隐式）
    }

    void validate() {
        // ...
    }
}
```

**边属性**:
- reason: `'this'`
- confidence: 0.9

---

##### super - 父类方法调用
**识别规则**:
- 无对象前缀的方法调用
- 当前类中不存在该方法
- 在父类或祖宗类中查找

**示例**:
```java
public class UserController extends BaseController {
    void process() {
        init();  // super 调用（父类方法）
    }
}

public class BaseController {
    protected void init() {
        // ...
    }
}
```

**边属性**:
- reason: `'super'`
- confidence: 0.85

**特性**:
- 支持多级继承
- 自动循环检测

---

#### 3.2 待实现的调用类型

##### methodInstance - 方法内对象调用
**目标识别规则**:
- 调用局部变量的方法（如 `localVar.method()`）
- 解析局部变量的类型
- 在该类型中查找方法

**示例**:
```java
void process() {
    UserService service = new UserService();
    service.validateUser("alice");  // methodInstance
}
```

**实现状态**: ❌ 未完成（需要 AST 解析）

---

##### classInstance - 类属性调用
**目标识别规则**:
- 调用类字段的方法（如 `this.field.method()`）
- 解析字段的类型
- 支持继承链字段查找

**示例**:
```java
public class UserController {
    private UserService userService;

    void process() {
        userService.validateUser("alice");  // classInstance
    }
}
```

**实现状态**: ❌ 未完成（需要 AST 解析）

---

## 使用方法

### 方法 1: 重新索引（推荐）

删除现有索引，重新分析代码库：
```bash
# 删除旧索引
rm -rf .gitnexus/

# 重新索引
npx gitnexus analyze --verbose
```

### 方法 2: 增量更新

如果只想更新部分文件：
```bash
# 当前不支持增量更新
# 必须重新索引整个项目
```

---

## 验证和测试

### 1. 检查索引状态
```bash
npx gitnexus status
```

输出示例：
```
Repository: gitnexus
Path: /path/to/gitnexus
Indexed: 2026-03-19 17:30:00
Symbols: 1650
Relationships: 4320
Processes: 125
```

### 2. 查询 CALLS 边统计
```typescript
// 使用 MCP 工具
gitnexus_cypher({
  query: `
    MATCH ()-[r:CALLS]->()
    RETURN r.reason as reason,
           avg(r.confidence) as avg_confidence,
           count(*) as count
    ORDER BY count DESC
  `
})
```

预期输出：
```markdown
| reason          | avg_confidence | count |
|-----------------|----------------|-------|
| same-file       | 0.85           | 850   |
| import-resolved | 0.9            | 450   |
| static          | 0.95           | 80    |
| this            | 0.9            | 120   |
| super           | 0.85           | 40    |
```

### 3. 验证跨语言隔离
```typescript
gitnexus_cypher({
  query: `
    MATCH (a:File)-[:DEFINES]->(f1),
          (b:File)-[:DEFINES]->(f2),
          (f1)-[r:CALLS]->(f2)
    WHERE a.language <> b.language
    RETURN a.filePath, b.filePath, a.language, b.language
    LIMIT 10
  `
})
```

预期输出：应该为空（无跨语言调用）

---

## 性能影响

### 索引速度
- **跨文件类型检查**: 几乎无影响（仅增加一次字符串比较）
- **删除 fuzzy-global**: 略微加快（减少全局查找）
- **Java 解析器**: 暂无数据（未集成）

### 内存使用
- 无显著变化

### 图大小
- **CALLS 边数量**: 预计减少 10-20%（删除 fuzzy-global）
- **准确度**: 预计提升 15-25%

---

## 兼容性

### 支持的语言
✅ 所有语言（跨文件类型检查）
✅ 所有语言（fuzzy-global 删除）
🚧 Java（专用解析器，部分完成）

### 支持的 GitNexus 版本
- gitnexus >= 1.3.11

### 破坏性变更
⚠️ **警告**: 删除 fuzzy-global 会减少 CALLS 边数量

如果您的下游应用依赖低置信度边，可能需要调整。

---

## 故障排查

### 问题 1: 索引后 CALLS 边数量大幅减少
**原因**: fuzzy-global 被删除
**解决方案**:
- 检查是否有大量无 import 声明的调用
- 考虑补充缺失的 import 语句
- 如果需要恢复旧行为，回退到 v1.3.11 之前的版本

### 问题 2: Java 方法调用未被识别
**原因**: Java 解析器尚未完全集成
**解决方案**:
- 当前版本仅实现了 static/this/super 三种类型
- methodInstance 和 classInstance 需要等待后续版本
- 这些调用会回退到 same-file 或 import-resolved

### 问题 3: 跨语言调用消失
**原因**: 这是预期行为（跨语言调用被过滤）
**解决方案**:
- 检查代码是否真的是跨语言调用
- 如果是误报，提交 issue

---

## 下一步计划

### 短期（v0.3）
- 集成 Java 解析器到 call-processor
- 实现 methodInstance 和 classInstance
- 编写单元测试

### 中期（v0.4）
- 扩展到 Python 和 TypeScript
- 支持方法重载匹配
- 性能优化

### 长期（v1.0）
- 支持更多语言（Go, C++, C#）
- 类型推断和数据流分析
- 多态调用识别

---

## 反馈和支持

如果您在使用过程中遇到问题，或对功能有建议，请通过以下方式反馈：

- GitHub Issues: https://github.com/your-org/gitnexus/issues
- Email: support@gitnexus.io

---

**文档版本**: v2.0
**最后更新**: 2026-03-20
**作者**: GitNexus Team
**优化成果**: 589秒 → 52秒（91.2% 性能提升）
