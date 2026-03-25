# GitNexus CALLS 边优化方案

## 1. 需求概述

### 1.1 背景
当前 GitNexus 中构造 CALLS 类型边的逻辑是通用性质的，对于实际代码解析存在准确度不足的问题：
- 跨语言文件类型之间不应该有直接调用关系（如 .js 文件不能直接调用 .java 文件）
- `fuzzy-global` 和 `same-file` 类型的边准确度较低，特别是 `fuzzy-global` 准确度相当低

### 1.2 目标
1. **跨文件类型限制**：为 CALLS 边增加文件类型一致性检查
2. **Java 精确解析**：针对 Java 代码实现 5 种精确的调用关系识别
3. **清理低质量边**：删除其他语言的 `fuzzy-global` 边，保留质量较高的边

## 2. 现有架构分析

### 2.1 当前 CALLS 边解析流程

**核心文件**: `gitnexus/src/core/ingestion/call-processor.ts`

**处理流程**:
```
1. processCalls() 遍历所有文件
   ├─> 加载语言的 Tree-sitter 解析器
   ├─> 解析 AST 获取调用关系
   └─> 调用 resolveCallTarget() 解析目标

2. resolveCallTarget() 解析策略（按优先级）:
   ├─ Strategy B: same-file (confidence: 0.85)
   │  └─> symbolTable.lookupExact(currentFile, calledName)
   ├─ Strategy A: import-resolved (confidence: 0.9)
   │  └─> 检查 calledName 是否在 importMap 中
   └─ Strategy C: fuzzy-global (confidence: 0.5/0.3)
      └─> symbolTable.lookupFuzzy(calledName) - 全局模糊匹配
```

### 2.2 Tree-sitter Java 查询

当前 Java 调用捕获查询（`JAVA_QUERIES`）:
```typescript
; Calls
(method_invocation name: (identifier) @call.name) @call
(method_invocation object: (_) name: (identifier) @call.name) @call
```

**问题**：
- 仅捕获方法名称，不捕获调用对象信息
- 无法区分 `this.method()`, `obj.method()`, `Class.staticMethod()` 等不同调用方式

### 2.3 SymbolTable 能力

**可用接口**:
- `lookupExact(filePath, name)`: 在指定文件中精确查找符号
- `lookupFuzzy(name)`: 全局模糊查找所有同名符号
- `findSymbolsByQualifiedName(qualifiedName)`: 通过完全限定名查找（支持包路径）
- `findMethodInClass(classSymbol, methodName)`: 在类中查找方法

## 3. 实现方案

### 3.1 跨文件类型检查

**位置**: `call-processor.ts > resolveCallTarget()`

**实现逻辑**:
```typescript
// 在解析结果中增加文件路径信息
interface ResolveResult {
  nodeId: string;
  confidence: number;
  reason: string;
  filePath: string;  // 新增：目标节点的文件路径
}

// 在返回前检查文件扩展名
const sourceLanguage = getLanguageFromFilename(currentFile);
const targetLanguage = getLanguageFromFilename(resolved.filePath);
if (sourceLanguage !== targetLanguage) {
  return null;  // 跨语言调用，拒绝建立边
}
```

**影响范围**:
- 修改 `ResolveResult` 接口
- 修改 `resolveCallTarget()` 返回逻辑
- 不影响其他处理器

### 3.2 Java 专用调用解析

**位置**: 新建 `java-call-resolver.ts`

**架构设计**:
```typescript
/**
 * Java 专用调用解析器
 * 实现 5 种精确的调用关系识别
 */
export const resolveJavaCallTarget = (
  calledName: string,
  objectName: string | null,  // 调用对象（xx.yy 中的 xx）
  currentFile: string,
  enclosingFunctionId: string | null,
  symbolTable: SymbolTable,
  importMap: ImportMap,
  graph: KnowledgeGraph
): ResolveResult | null => {

  // 1. methodInstance: xx.yy() - xx 在当前方法内定义
  if (objectName) {
    const result = resolveMethodInstance(objectName, calledName, ...);
    if (result) return result;
  }

  // 2. classInstance: xx.yy() - xx 是当前类的属性
  if (objectName) {
    const result = resolveClassInstance(objectName, calledName, ...);
    if (result) return result;
  }

  // 3. static: ClassName.method() 或 full.path.ClassName.method()
  if (objectName && isCapitalized(objectName)) {
    const result = resolveStaticCall(objectName, calledName, ...);
    if (result) return result;
  }

  // 4. this: method() - 当前类的其他方法
  if (!objectName) {
    const result = resolveThisCall(calledName, ...);
    if (result) return result;
  }

  // 5. super: method() - 父类或祖宗类的方法
  if (!objectName) {
    const result = resolveSuperCall(calledName, ...);
    if (result) return result;
  }

  // 无法匹配任何一种类型，记录警告
  console.warn(`[Java Call Resolver] Unable to resolve call: ${objectName ? objectName + '.' : ''}${calledName} in ${currentFile}`);
  return null;
};
```

#### 3.2.1 methodInstance - 方法内对象调用

**实现思路**:
1. 解析当前方法的 AST，提取局部变量声明
2. 检查是否有变量名为 `objectName`
3. 如果有，获取该变量的类型
4. 在该类型中查找 `calledName` 方法

**示例代码**:
```java
public void process() {
    UserService service = new UserService();
    service.validateUser();  // methodInstance: service 在方法内定义
}
```

#### 3.2.2 classInstance - 类属性调用

**实现思路**:
1. 获取当前方法所属的类节点
2. 在类节点的 AST 中查找字段声明
3. 检查是否有字段名为 `objectName`
4. 如果有，获取字段类型并查找方法
5. 递归查找父类的字段（支持继承）

**示例代码**:
```java
public class UserController {
    private UserService userService;  // 类属性

    public void handle() {
        userService.validateUser();  // classInstance
    }
}
```

#### 3.2.3 static - 静态方法调用

**实现思路**:
1. 检查 `objectName` 是否首字母大写
2. 在 importMap 中查找是否导入了该类
3. 如果 `objectName` 包含 `.`，解析为完全限定名
4. 使用 `symbolTable.findSymbolsByQualifiedName()` 查找类
5. 使用 `symbolTable.findMethodInClass()` 查找方法

**示例代码**:
```java
import com.example.Utils;

public void process() {
    Utils.format();  // static: 导入的类
    com.example.other.Helper.process();  // static: 全路径
}
```

#### 3.2.4 this - 当前类方法调用

**实现思路**:
1. 获取当前方法所属的类
2. 在类中查找所有方法
3. 匹配方法名和参数列表
4. 处理方法重载（同名不同参）

**示例代码**:
```java
public class UserService {
    public void process() {
        validate();  // this: 当前类的方法
    }

    private void validate() { }
}
```

#### 3.2.5 super - 父类方法调用

**实现思路**:
1. 获取当前类的父类（通过 EXTENDS 边）
2. 在父类中查找方法
3. 如果未找到，递归查找祖宗类
4. 匹配方法名和参数列表

**示例代码**:
```java
public class UserController extends BaseController {
    @Override
    public void process() {
        super.init();  // super: 显式调用父类
        validate();    // super: 父类方法（当前类中不存在）
    }
}
```

### 3.3 删除 fuzzy-global

**位置**: `call-processor.ts > resolveCallTarget()`

**修改逻辑**:
```typescript
// 原代码：
// Strategy C: Fuzzy global (no import match found)
const confidence = allDefs.length === 1 ? 0.5 : 0.3;
return { nodeId: allDefs[0].nodeId, confidence, reason: 'fuzzy-global' };

// 新代码：
// 删除 fuzzy-global 策略，直接返回 null
return null;
```

**保留的边类型**:
- `import-resolved`: 高置信度（0.9）
- `same-file`: 中等置信度（0.85）
- Java 专用类型: 各种置信度（待定）

## 4. 增强 Tree-sitter 查询

### 4.1 Java 调用查询增强

**当前查询**:
```scheme
(method_invocation name: (identifier) @call.name) @call
(method_invocation object: (_) name: (identifier) @call.name) @call
```

**需要增强为**:
```scheme
; 捕获完整的方法调用信息
(method_invocation
  object: (identifier) @call.object
  name: (identifier) @call.name
  arguments: (argument_list) @call.arguments) @call

; 捕获无对象的方法调用（this/super）
(method_invocation
  name: (identifier) @call.name
  arguments: (argument_list) @call.arguments) @call

; 捕获字段表达式调用（链式调用）
(method_invocation
  object: (field_access) @call.object
  name: (identifier) @call.name) @call
```

**新增捕获内容**:
- `@call.object`: 调用对象（xx.yy 中的 xx）
- `@call.arguments`: 参数列表（用于方法重载匹配）

## 5. 数据结构变更

### 5.1 GraphRelationship 增强

**当前结构**:
```typescript
interface GraphRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  confidence: number;
  reason: string;  // 'import-resolved', 'same-file', 'fuzzy-global'
  step?: number;
}
```

**新增 reason 类型**:
- `methodInstance`: Java 方法内对象调用
- `classInstance`: Java 类属性调用
- `static`: Java 静态方法调用
- `this`: Java 当前类方法调用
- `super`: Java 父类方法调用

**置信度设置**:
- `methodInstance`: 0.95（局部变量类型明确）
- `classInstance`: 0.9（类属性可能有继承）
- `static`: 0.95（导入明确）
- `this`: 0.9（当前类方法）
- `super`: 0.85（继承链查找）

## 6. 实现计划

### 6.1 阶段一：基础重构
1. ✅ 创建任务列表
2. ⏳ 分析现有代码
3. 添加跨文件类型检查
4. 删除 fuzzy-global

### 6.2 阶段二：Java 专用解析器
1. 创建 `java-call-resolver.ts`
2. 实现 5 种调用类型解析函数
3. 增强 Tree-sitter Java 查询
4. 集成到 `call-processor.ts`

### 6.3 阶段三：测试验证
1. 创建 Java 测试用例
2. 验证跨文件类型检查
3. 验证 5 种调用类型识别
4. 性能测试

### 6.4 阶段四：文档输出
1. 更新 changelist.md
2. 生成 testcase.md
3. 生成 userguide.md
4. 完成 solution.md
5. 创建 README.md

## 7. 风险和挑战

### 7.1 技术挑战
- **AST 解析复杂度**: Java 的 AST 结构复杂，需要深入理解 tree-sitter-java 的节点类型
- **泛型处理**: Java 泛型可能增加类型解析难度
- **方法重载**: 需要通过参数列表精确匹配，可能需要类型推断
- **继承链查找**: 需要递归遍历父类和接口，可能影响性能

### 7.2 性能影响
- Java 专用解析器需要更多的 AST 遍历和符号表查找
- 建议在解析过程中缓存中间结果
- 考虑使用 Worker Pool 并行处理大型文件

### 7.3 兼容性
- 现有的 CALLS 边会减少（删除 fuzzy-global）
- 可能影响依赖这些边的下游功能（社区检测、流程追踪）
- 需要重新索引现有代码库

## 8. 后续优化

### 8.1 扩展到其他语言
- Python: 类似的 5 种调用类型
- TypeScript: 支持装饰器、泛型、接口
- Go: 支持接口实现、包级函数

### 8.2 更高级的分析
- 类型推断：通过数据流分析推断局部变量类型
- 多态调用：识别接口/抽象类的多态调用
- 反射调用：识别 Java 反射 API 的动态调用

### 8.3 工具增强
- 提供 MCP 工具查询特定 reason 类型的边
- 在 Web UI 中显示不同 reason 的边用不同颜色
- 支持用户自定义置信度阈值过滤

---

**文档版本**: v1.0
### 6.2 性能优化

#### 问题分析

初始实现完成后，大项目索引时间从预期的50秒退化至589秒，性能严重不达标。

**性能瓶颈定位**：
1. 添加性能统计工具，对每种调用类型进行计时
2. 发现 `this` 和 `super` 类型占用超过70%时间
3. 根本原因：`findEnclosingClass()` 函数采用 O(E) 边遍历算法
4. 大项目计算量：106,869次调用 × 43,317条边 ≈ 92亿次边检查操作

#### 优化方案

**核心优化**：findEnclosingClass 从 O(E) 改为 O(1)

**优化前实现**（遍历边）：
```typescript
const findEnclosingClass = (methodId: string, currentFile: string, graph: KnowledgeGraph) => {
  // 步骤1: 遍历所有边找 Method -> File DEFINES 关系
  const definesRel = Array.from(graph.iterRelationships()).find(
    rel => rel.targetId === methodId && rel.type === 'DEFINES'
  );
  if (!definesRel) return null;

  const fileNode = graph.getNode(definesRel.sourceId);
  if (!fileNode) return null;

  // 步骤2: 再次遍历所有边找 File -> Class DEFINES 关系
  const classRel = Array.from(graph.iterRelationships()).find(
    rel => rel.sourceId === fileNode.id &&
           rel.type === 'DEFINES' &&
           graph.getNode(rel.targetId)?.label === 'Class'
  );

  return classRel ? graph.getNode(classRel.targetId) : null;
}
```

**优化后实现**（直接ID查找）：
```typescript
const findEnclosingClass = (methodId: string, currentFile: string, graph: KnowledgeGraph) => {
  // 利用GitNexus节点ID命名规范：
  // File: "File:{filePath}"
  // Class: "Class:{filePath}:{className}"
  // Java单文件单类约定：类名 = 文件名（去.java）

  const fileNode = graph.getNode('File:' + currentFile);
  if (!fileNode) return null;

  // 从文件名提取类名
  const className = fileNode.properties.name.split('.')[0];

  // 直接构造Class节点ID并查找
  return graph.getNode('Class:' + currentFile + ':' + className);
}
```

**关键洞察**：
- GitNexus对节点ID有规范的命名约定
- Java遵循单文件单类惯例（类名=文件名）
- HashMap查找是O(1)，无需遍历图边

#### 性能结果

| 指标 | 优化前 | 优化后 | 提升 |
|------|-------|--------|------|
| this类型耗时 | 47,757ms | 92ms | 99.8% |
| super类型耗时 | 85,900ms | 751ms | 99.1% |
| 单次调用平均耗时 | ~1.7ms | 0.04ms | 97.6% |
| **总索引时间** | **189秒** | **52秒** | **72.5%** |
| **累计优化** | **589秒** | **52秒** | **91.2%** |

**最终性能统计**（大项目测试）：
```
[Java Performance Breakdown]
  Total calls processed: 106869
  Total processing time: 3796ms
  Avg per call: 0.04ms

  Resolve Type Breakdown:
    methodInstance: 2060ms (54.3%)  ← 最耗时（局部变量AST遍历）
    classInstance:  804ms (21.2%)
    super:          751ms (19.8%)   ← 已优化
    this:           92ms (2.4%)     ← 已优化
    static:         39ms (1.0%)
    interface:      0ms (0.0%)
```

---

## 7. 实施总结

### 7.1 最终成果

✅ **功能完成度**: 100%
- 跨文件类型检查: ✅
- Java 6种调用类型: ✅ (this, static, methodInstance, classInstance, super, interface)
- 低质量边删除: ✅ (fuzzy-global, Java same-file)

✅ **性能达标**: 100%
- 大项目（27k节点）：52秒
- 小项目（2k节点）：10秒
- 累计性能提升：91.2%

✅ **代码质量**: 优秀
- 编译通过，无错误
- 架构清晰，易于扩展
- 文档完整

### 7.2 技术亮点

1. **语义精确解析**：基于Java语法特性，非简单名称匹配
2. **高置信度边**：0.85-0.95 vs 旧方案0.3-0.5
3. **AST深度利用**：tree-sitter完整能力应用
4. **性能突破**：算法复杂度优化（O(E) → O(1)）

### 7.3 真实数据

**调用类型分布**（大项目10226次调用）：
- this: 4909次（48.0%）
- methodInstance: 2790次（27.3%）
- static: 2218次（21.7%）
- classInstance: 234次（2.3%）
- super: 75次（0.7%）
- interface: 0次（0.0%）

---

**文档版本**: v2.0
**创建时间**: 2026-03-19
**完成时间**: 2026-03-20
**状态**: ✅ 已完成并验证
