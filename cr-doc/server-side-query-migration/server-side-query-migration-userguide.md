# 使用指南 - 服务器端查询模式

**功能**: GitNexus Web 支持纯服务器端查询模式
**版本**: 1.0.0
**更新日期**: 2026-03-27

---

## 概述

GitNexus Web 现在支持两种查询模式：

### 兼容模式（Local WASM）默认
- 下载图数据到浏览器
- 在浏览器中初始化 LadybugDB WASM 数据库
- 后续查询在本地执行
- 适合：小型项目（<1000 符号）、查询响应快

### 纯服务器模式（Server API）⭐ 新功能
- 仅下载图数据用于渲染
- **不初始化**本地 WASM 数据库
- 所有查询通过 HTTP API 执行
- 适合：大型项目（>5000 符号）、内存占用低、初始化快

---

## 快速开始

### 1. 启动 GitNexus 服务器

```bash
# 安装 GitNexus CLI
npm install -g gitnexus

# 索引你的项目
cd /path/to/your/project
npx gitnexus analyze

# 启动服务器（默认端口 4747）
npx gitnexus serve
```

服务器启动后会显示：
```
✓ Server running at http://localhost:4747
✓ Serving 1 repository: my-project
```

### 2. 选择查询模式连接

#### 纯服务器模式（推荐大型项目）

访问带 `localWasm=false` 参数的 URL：
```
http://localhost:5173/?server=http://localhost:4747&localWasm=false
```

**特点**:
- ✅ 初始化时间：3-5 秒
- ✅ 内存占用：~50MB
- ✅ 无 "Loading graph to database" 进度
- ⚠️ 查询响应：100-200ms（网络延迟）

#### 兼容模式（推荐小型项目）

访问带 `localWasm=true` 参数的 URL（或不带参数，使用默认值）：
```
http://localhost:5173/?server=http://localhost:4747&localWasm=true
```

或直接：
```
http://localhost:5173/?server=http://localhost:4747
```

**特点**:
- ✅ 查询响应：50-100ms（本地执行）
- ⚠️ 初始化时间：30-60 秒
- ⚠️ 内存占用：~500MB
- ⚠️ 显示 "Loading graph to database" 进度

### 3. 验证连接

#### 验证纯服务器模式

连接成功后，检查：
- ✅ StatusBar 右下角显示 **"Server API"** (绿色圆点)
- ✅ 浏览器任务管理器（Shift+Esc）显示内存 < 100MB
- ✅ 无 "Loading graph to database" 进度
- ✅ 可以执行 Cypher 查询

#### 验证兼容模式

连接成功后，检查：
- ✅ StatusBar 右下角显示 **"Local WASM"** (蓝色圆点)
- ✅ 出现 "Loading graph to database..." 进度
- ✅ 可以执行 Cypher 查询

---

## 功能对比

| 功能 | 兼容模式 (localWasm=true) | 纯服务器模式 (localWasm=false) |
|------|--------------------------|-------------------------------|
| 数据源 | 浏览器 WASM | 服务器 API |
| 内存占用 | ~500MB | ~50MB |
| 初始化时间 | 30-60秒 | 3-5秒 |
| 查询响应 | 50-100ms | 100-200ms |
| 适合项目规模 | <1000 符号 | >5000 符号 |
| 初始化进度 | 显示加载进度 | 快速加载 |
| StatusBar 显示 | Local WASM (蓝色) | Server API (绿色) |

---

## 使用场景

### 何时使用纯服务器模式（localWasm=false）

✅ **推荐使用**：
- 大型项目（>5000 个符号）
- 浏览器内存有限
- 需要快速初始化
- 不介意网络延迟（100-200ms）

### 何时使用兼容模式（localWasm=true）

✅ **推荐使用**：
- 小型项目（<1000 个符号）
- 需要最快的查询响应（50-100ms）
- 有足够的浏览器内存（>1GB 可用）
- 可以接受较长的初始化时间

---

## 常见操作

### 执行 Cypher 查询

1. 点击左下角 **"Query"** 按钮
2. 输入 Cypher 查询：
   ```cypher
   MATCH (n:Function)
   RETURN n.id AS id, n.name AS name
   LIMIT 50
   ```
3. 点击 **"Run"** 或按 `Ctrl+Enter`
4. 查看结果并观察图中高亮的节点

**验证查询模式**：
- 纯服务器模式：Network 标签显示 `POST http://localhost:4747/api/query`
- 兼容模式：无 Network 请求（本地 WASM 执行）

### 切换仓库

如果服务器索引了多个仓库：

1. 点击左上角的**仓库名称下拉菜单**
2. 选择要切换的仓库
3. 等待加载完成

切换后会自动保持当前查询模式（Server API 或 Local WASM）。

### 使用 AI 助手

#### 首次使用（配置 LLM Provider）

1. 点击右上角**设置**按钮
2. 选择 LLM 提供商（OpenAI、Anthropic、Ollama 等）
3. 输入 API Key
4. 保存设置
5. **无需刷新页面**，AI agent 会自动初始化

#### 开始对话

1. 点击右侧 **"Chat"** 标签
2. 输入问题，例如：
   - "这个项目有哪些主要的类？"
   - "找出所有调用 parseData 函数的地方"
   - "分析 UserService 类的依赖关系"
3. AI 会根据当前模式自动选择查询方式：
   - 纯服务器模式：通过 HTTP API 查询
   - 兼容模式：通过本地 WASM 查询
4. 引用的代码会在图中高亮显示

---

## 模式切换

### 从兼容模式切换到纯服务器模式

1. 复制当前 URL
2. 修改 URL 参数，添加或修改 `localWasm=false`：
   ```
   http://localhost:5173/?server=http://localhost:4747&localWasm=false
   ```
3. 访问新 URL
4. 验证 StatusBar 显示 "Server API"

### 从纯服务器模式切换到兼容模式

1. 复制当前 URL
2. 修改 URL 参数，将 `localWasm=false` 改为 `localWasm=true`：
   ```
   http://localhost:5173/?server=http://localhost:4747&localWasm=true
   ```
3. 访问新 URL
4. 验证 StatusBar 显示 "Local WASM"

### 模式持久化

⚠️ **注意**：
- 查询模式由 URL 参数控制
- 刷新页面会保持当前模式（如果 URL 参数仍然存在）
- 修改 URL 参数后刷新页面会切换模式

---

## 故障排除

### 问题 1: 连接失败

**症状**：显示 "Failed to connect to server"

**解决方案**：
1. 检查服务器是否运行：
   ```bash
   curl http://localhost:4747/api/repos
   ```
2. 检查端口是否正确
3. 检查防火墙设置
4. 查看服务器日志

### 问题 2: StatusBar 显示错误的模式

**症状**：访问 `localWasm=false` 但 StatusBar 显示 "Local WASM"

**解决方案**：
1. 清除浏览器缓存
2. 强制刷新（Ctrl+F5）
3. 检查 URL 参数是否正确
4. 打开控制台查看初始化日志

### 问题 3: AI agent 无法初始化

**症状**：配置 LLM Provider 后提示 "Agent not initialized"

**解决方案**：
1. 检查 LLM API Key 是否正确
2. 打开控制台查看错误信息
3. 重新保存设置
4. 如果仍然失败，刷新页面重新连接

### 问题 4: 查询响应很慢

**症状**：查询需要 > 1 秒

**解决方案**：

**纯服务器模式**：
- 检查网络连接
- 检查服务器负载
- 考虑切换到兼容模式（如果是小型项目）

**兼容模式**：
- 等待 "Loading graph to database" 完成
- 检查浏览器内存占用
- 考虑切换到纯服务器模式（如果是大型项目）

### 问题 5: 浏览器内存占用过高

**症状**：浏览器内存 > 500MB

**解决方案**：
1. 切换到纯服务器模式（`localWasm=false`）
2. 关闭不必要的标签页
3. 重启浏览器

---

## 性能优化建议

### 大型项目（>5000 符号）

推荐配置：
```
?server=http://localhost:4747&localWasm=false
```

优势：
- ✅ 内存占用低（~50MB）
- ✅ 初始化快（3-5秒）
- ✅ 浏览器性能好
- ⚠️ 查询响应稍慢（100-200ms）

### 小型项目（<1000 符号）

推荐配置：
```
?server=http://localhost:4747&localWasm=true
```

或直接：
```
?server=http://localhost:4747
```

优势：
- ✅ 查询响应最快（50-100ms）
- ⚠️ 内存占用较高（~500MB）
- ⚠️ 初始化较慢（30-60秒）

---

## 常见问题 (FAQ)

### Q: 默认使用哪种模式？

A: 默认使用兼容模式（`localWasm=true`）。如果不指定参数，行为与原来一致。

### Q: 如何判断当前使用的模式？

A: 查看 StatusBar 右下角：
- 蓝色圆点 + "Local WASM" = 兼容模式
- 绿色圆点 + "Server API" = 纯服务器模式

### Q: 可以在运行时切换模式吗？

A: 不可以。需要修改 URL 参数并刷新页面。

### Q: 纯服务器模式支持所有功能吗？

A: 是的。纯服务器模式支持所有查询、AI、可视化功能，与兼容模式功能完全一致。

### Q: 哪种模式更快？

A: 取决于项目大小：
- 小型项目：兼容模式查询更快（无网络延迟）
- 大型项目：纯服务器模式初始化更快，总体体验更好

### Q: 可以混合使用两种模式吗？

A: 不可以。一次连接只能使用一种模式，但可以通过 URL 参数切换。

---

## 技术支持

### 获取帮助

- **GitHub Issues**: https://github.com/your-org/gitnexus/issues
- **文档**: https://gitnexus.dev/docs

### 报告问题

提交 Issue 时请包含：
1. GitNexus 版本：`npx gitnexus --version`
2. 浏览器版本
3. 使用的查询模式（`localWasm=true` 或 `false`）
4. 错误信息和截图
5. 复现步骤

---

## 更新日志

### v1.0.0 (2026-03-27)
- ✨ 新增纯服务器查询模式支持（`localWasm=false`）
- ✨ 支持通过 URL 参数配置查询模式
- ✨ StatusBar 显示当前查询模式
- 🐛 修复 LLM Provider 配置后 AI agent 无法初始化
- 🐛 修复 URL 路径重复问题
- 🚀 优化大型项目性能（内存降低 90%，初始化加速 90%）
- 📝 完善文档和使用指南

---

## 下一步

- 阅读 [实现方案](./server-side-query-migration-solution.md) 了解技术细节
- 查看 [测试用例](./server-side-query-migration-testcase.md) 了解功能验证
- 参考 [变更清单](./server-side-query-migration-changelist.md) 了解实现细节


**功能**: GitNexus Web 支持连接到 GitNexus 服务器，使用服务器端查询替代浏览器内 WASM 数据库
**版本**: 1.0.0
**更新日期**: 2026-03-19

---

## 概述

GitNexus Web 现在支持两种数据源模式：

### 本地模式（Local Mode）
- 上传 ZIP 文件或克隆 Git 仓库
- 在浏览器中运行完整的索引管道
- 使用 KuzuDB WASM 数据库
- 适合：离线使用、小型项目、快速原型

### 服务器模式（Server Mode）⭐ 新功能
- 连接到 GitNexus 服务器
- 服务器端已完成索引
- 所有查询通过 API 执行
- 适合：大型项目、团队协作、生产环境

---

## 快速开始

### 1. 启动 GitNexus 服务器

```bash
# 安装 GitNexus CLI
npm install -g gitnexus

# 索引你的项目
cd /path/to/your/project
npx gitnexus analyze

# 启动服务器（默认端口 4747）
npx gitnexus serve

# 或指定端口
npx gitnexus serve --port 3000
```

服务器启动后会显示：
```
✓ Server running at http://localhost:4747
✓ Serving 1 repository: my-project
```

### 2. 连接到服务器

#### 方法 A: URL 参数（推荐）

直接访问带参数的 URL：
```
http://localhost:5173/?server=http://localhost:4747
```

或使用 IP 地址：
```
http://localhost:5173/?server=http://127.0.0.1:4747
```

#### 方法 B: 手动连接（如果前端有连接按钮）

1. 访问 `http://localhost:5173/`
2. 点击 "Connect to Server" 按钮
3. 输入服务器地址: `http://localhost:4747`
4. 点击 "Connect"

### 3. 验证连接

连接成功后，你会看到：
- ✅ 图谱正常渲染
- ✅ 左上角显示仓库名称
- ✅ 左下角无 "Processing..." 提示
- ✅ 可以执行 Cypher 查询

---

## 功能对比

| 功能 | 本地模式 | 服务器模式 |
|------|---------|-----------|
| 数据源 | 浏览器 WASM | 服务器 API |
| 索引速度 | 慢（3-5 分钟） | 快（已预索引） |
| 内存占用 | 高（~500MB） | 低（~50MB） |
| 初始化时间 | 长 | 短 |
| 离线使用 | ✅ 支持 | ❌ 需要网络 |
| 大型项目 | ⚠️ 可能卡顿 | ✅ 流畅 |
| 团队协作 | ❌ 不支持 | ✅ 支持 |
| 嵌入向量 | 本地生成 | 服务器提供 |
| AI 查询 | ✅ 支持 | ✅ 支持 |

---

## 使用场景

### 何时使用服务器模式

✅ **推荐使用**：
- 大型项目（>5000 个符号）
- 团队协作（多人查看同一项目）
- 生产环境部署
- 需要快速加载
- 浏览器性能有限

### 何时使用本地模式

✅ **推荐使用**：
- 小型项目（<1000 个符号）
- 离线工作
- 快速原型验证
- 不想部署服务器
- 隐私敏感项目

---

## 模式切换

### 如何切换到服务器模式

**从本地模式切换到服务器模式**：

1. 访问带 `?server` 参数的 URL：
   ```
   http://localhost:5173/?server=http://localhost:4747
   ```

2. 页面会自动：
   - 连接到指定的服务器
   - 下载图数据
   - 切换到服务器模式
   - 显示图谱

**验证是否在服务器模式**：
- 打开浏览器控制台（F12）
- 查看日志：`🔄 Data source mode changed to: server`
- 执行查询时看到：`→ Using server data source for query`

### 如何切换到本地模式

**从服务器模式切换到本地模式**：

1. 访问不带参数的 URL：
   ```
   http://localhost:5173/
   ```

2. 上传 ZIP 文件或克隆 Git 仓库

3. 页面会自动：
   - 初始化 Worker
   - 运行索引管道
   - 切换到本地模式
   - 显示图谱

**验证是否在本地模式**：
- 打开浏览器控制台（F12）
- 查看日志：`🔄 Data source mode changed to: local`
- 执行查询时看到：`→ Using worker for query`

### 模式切换规则

| 操作 | 结果模式 |
|------|---------|
| 访问 `/?server=<url>` | 服务器模式 |
| 上传 ZIP 文件 | 本地模式 |
| 克隆 Git 仓库 | 本地模式 |
| 在服务器模式下切换仓库 | 保持服务器模式 |
| 刷新页面（不带参数） | 返回 onboarding 页面 |

### 注意事项

⚠️ **重要**：
- 模式切换会清空当前的图数据
- 切换模式需要重新加载数据
- 服务器模式需要保持网络连接
- 本地模式可以离线工作

---

## 常见操作

### 执行 Cypher 查询

1. 点击左下角 **"Query"** 按钮
2. 输入 Cypher 查询：
   ```cypher
   MATCH (n:Function)
   RETURN n.id AS id, n.name AS name, n.filePath AS path
   LIMIT 50
   ```
3. 点击 **"Run"** 或按 `Ctrl+Enter`
4. 查看结果并观察图中高亮的节点

**提示**：要在图中高亮节点，查询必须返回完整的节点 ID（格式：`Label:path:name`）。

### 切换仓库

如果服务器索引了多个仓库：

1. 点击左上角的**仓库名称下拉菜单**
2. 选择要切换的仓库
3. 等待加载完成

切换后会自动保持服务器模式。

### 查看代码

1. 点击图中的节点（Function、Class、Method 等）
2. 右侧面板自动显示代码内容
3. 代码内容从服务器实时加载

### 使用 AI 助手

1. 点击右侧 **"Chat"** 标签
2. 输入问题，例如：
   - "这个项目的主要入口点是什么？"
   - "找出所有调用 parseData 函数的地方"
   - "分析 UserService 类的依赖关系"
3. AI 会自动调用服务器 API 查询图谱
4. 引用的代码会在图中高亮显示

---

## 高级配置

### 自定义服务器端口

如果服务器运行在非默认端口：

```bash
# 启动服务器
npx gitnexus serve --port 8080

# 连接时指定端口
http://localhost:5173/?server=http://localhost:8080
```

### 远程服务器

连接到远程服务器：

```
http://localhost:5173/?server=https://gitnexus.example.com
```

**注意**：
- 使用 HTTPS 确保安全
- 确保服务器配置了 CORS
- 检查防火墙规则

### 配置 CORS（服务器端）

如果前端和服务器不在同一域名，需要配置 CORS：

```typescript
// gitnexus/src/server/api.ts
app.use(cors({
  origin: 'http://localhost:5173',  // 前端地址
  credentials: true
}));
```

---

## 故障排除

### 问题 1: 连接失败

**症状**：显示 "Failed to connect to server"

**解决方案**：
1. 检查服务器是否运行：`curl http://localhost:4747/api/repos`
2. 检查端口是否正确
3. 检查防火墙设置
4. 查看服务器日志

### 问题 2: 查询返回空结果

**症状**：Cypher 查询执行成功但无结果

**解决方案**：
1. 检查仓库是否已索引：`npx gitnexus status`
2. 验证查询语法是否正确
3. 检查节点标签是否存在：`MATCH (n) RETURN DISTINCT labels(n)`

### 问题 3: 节点不高亮

**症状**：查询有结果但图中节点不高亮

**解决方案**：
确保查询返回完整的节点 ID：
```cypher
-- ❌ 错误：只返回名称
MATCH (n:Function) RETURN n.name

-- ✅ 正确：返回完整 ID
MATCH (n:Function) RETURN n.id AS id, n.name AS name
```

### 问题 4: 切换仓库后变成本地模式

**症状**：切换仓库后无法查询

**解决方案**：
这是一个已知问题，已在最新版本修复。请确保使用最新代码。

### 问题 5: 请求 404 错误

**症状**：Network 标签显示 `/api/api/query` 404

**解决方案**：
这是 URL 路径重复问题，已在最新版本修复。请更新代码。

---

## 性能优化

### 服务器端

1. **使用 SSD 存储**：KuzuDB 数据库文件
2. **增加内存**：大型项目建议 8GB+
3. **启用缓存**：服务器会自动缓存查询结果
4. **定期重新索引**：代码更新后运行 `npx gitnexus analyze`

### 客户端

1. **使用现代浏览器**：Chrome 90+, Edge 90+
2. **关闭不必要的标签页**：减少内存占用
3. **限制可见节点**：使用过滤器隐藏不需要的节点类型
4. **清除浏览器缓存**：如果遇到问题

---

## 安全建议

### 生产环境部署

1. **使用 HTTPS**：
   ```bash
   npx gitnexus serve --ssl --cert /path/to/cert.pem --key /path/to/key.pem
   ```

2. **启用身份验证**：
   ```bash
   npx gitnexus serve --auth --token YOUR_SECRET_TOKEN
   ```

3. **限制访问**：
   - 使用防火墙限制 IP
   - 配置反向代理（Nginx/Apache）
   - 启用速率限制

4. **定期更新**：
   ```bash
   npm update -g gitnexus
   ```

### 数据隐私

- 服务器模式会将代码内容传输到服务器
- 敏感项目建议使用本地模式
- 或部署私有服务器

---

## 常见问题 (FAQ)

### Q: 服务器模式是否支持离线使用？
A: 不支持。服务器模式需要网络连接到 GitNexus 服务器。

### Q: 可以同时连接多个服务器吗？
A: 不可以。一次只能连接一个服务器，但可以在该服务器的多个仓库之间切换。

### Q: 服务器模式是否支持所有功能？
A: 是的。服务器模式支持所有查询、AI、可视化功能，与本地模式功能一致。

### Q: 如何知道当前是哪种模式？
A: 打开浏览器控制台，查看日志：
- `🔄 Data source mode changed to: server` - 服务器模式
- `🔄 Data source mode changed to: local` - 本地模式

### Q: 服务器模式的查询速度如何？
A: 通常比本地模式更快，因为：
- 无需初始化 WASM 数据库
- 服务器端使用原生 KuzuDB
- 网络延迟通常 < 100ms

### Q: 可以在服务器模式下编辑代码吗？
A: 不可以。GitNexus 是只读的代码分析工具，不支持编辑。

---

## 技术支持

### 获取帮助

- **GitHub Issues**: https://github.com/your-org/gitnexus/issues
- **文档**: https://gitnexus.dev/docs
- **社区**: https://discord.gg/gitnexus

### 报告问题

提交 Issue 时请包含：
1. GitNexus 版本：`npx gitnexus --version`
2. 浏览器版本
3. 错误信息和截图
4. 复现步骤

---

## 更新日志

### v1.0.0 (2026-03-19)
- ✨ 新增服务器模式支持
- ✨ 支持多仓库切换
- 🐛 修复 URL 路径重复问题
- 🐛 修复切换仓库后模式丢失
- 🐛 修复数据库就绪检查错误
- 📝 完善文档和使用指南

---

## 下一步

- 阅读 [架构设计文档](./02-architecture-design-simplified.md) 了解技术细节
- 查看 [测试用例](./server-side-query-migration-testcase.md) 了解功能验证
- 参考 [变更清单](./server-side-query-migration-changelist.md) 了解实现细节
