import { useCallback, useEffect, useRef } from 'react';
import { AppStateProvider, useAppState } from './hooks/useAppState';
import { DropZone } from './components/DropZone';
import { LoadingOverlay } from './components/LoadingOverlay';
import { Header } from './components/Header';
import { GraphCanvas, GraphCanvasHandle } from './components/GraphCanvas';
import { RightPanel } from './components/RightPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { FileTreePanel } from './components/FileTreePanel';
import { CodeReferencesPanel } from './components/CodeReferencesPanel';
import { FileEntry } from './services/zip';
import { getActiveProviderConfig } from './core/llm/settings-service';
import { createKnowledgeGraph } from './core/graph/graph';
import { connectToServer, fetchRepos, normalizeServerUrl, type ConnectToServerResult } from './services/server-connection';
import { ERROR_RESET_DELAY_MS, getServerModeConfig } from './config/ui-constants';

const AppContent = () => {
  const {
    viewMode,
    setViewMode,
    setGraph,
    setFileContents,
    setProgress,
    setProjectName,
    progress,
    isRightPanelOpen,
    runPipeline,
    runPipelineFromFiles,
    isSettingsPanelOpen,
    setSettingsPanelOpen,
    refreshLLMSettings,
    initializeAgent,
    initializeBackendAgent,
    setServerConnection,
    startEmbeddingsWithFallback,
    embeddingStatus,
    codeReferences,
    selectedNode,
    isCodePanelOpen,
    serverBaseUrl,
    setServerBaseUrl,
    availableRepos,
    setAvailableRepos,
    currentRepoName,
    setCurrentRepoName,
    switchRepo,
    loadServerGraph,
    fileContents,
    projectName,
  } = useAppState();

  const graphCanvasRef = useRef<GraphCanvasHandle>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    const projectName = file.name.replace('.zip', '');
    setProjectName(projectName);
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to extract files' });
    setViewMode('loading');

    try {
      const result = await runPipeline(file, (progress) => {
        setProgress(progress);
      });

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      // Initialize (or re-initialize) the agent AFTER a repo loads so it captures
      // the current codebase context (file contents + graph tools) in the worker.
      if (getActiveProviderConfig()) {
        initializeAgent(projectName);
      }

      // Auto-start embeddings pipeline in background
      // Uses WebGPU if available, falls back to WASM
      startEmbeddingsWithFallback();
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing file',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, ERROR_RESET_DELAY_MS);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipeline, startEmbeddingsWithFallback, initializeAgent]);

  const handleGitClone = useCallback(async (files: FileEntry[], repoName?: string) => {
    let projectName = repoName;
    if (!projectName) {
      const firstPath = files[0]?.path || 'repository';
      projectName = firstPath.split('/')[0].replace(/-\d+$/, '') || 'repository';
    }

    setProjectName(projectName);
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to process files' });
    setViewMode('loading');

    try {
      const result = await runPipelineFromFiles(files, (progress) => {
        setProgress(progress);
      });

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      if (getActiveProviderConfig()) {
        initializeAgent(projectName);
      }

      startEmbeddingsWithFallback();
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing repository',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, ERROR_RESET_DELAY_MS);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipelineFromFiles, startEmbeddingsWithFallback, initializeAgent]);

  const handleServerConnect = useCallback((result: ConnectToServerResult, serverBaseUrl: string): Promise<void> => {
    // Extract project name from repoPath
    const repoPath = result.repoInfo.repoPath;
    const parts = repoPath.split('/').filter(p => p && !p.startsWith('.'));
    const projectName = parts[parts.length - 1] || parts[0] || 'server-project';
    setProjectName(projectName);
    setCurrentRepoName(result.repoInfo.name);

    // Build KnowledgeGraph from server data for visualization
    const graph = createKnowledgeGraph();
    for (const node of result.nodes) {
      graph.addNode(node);
    }
    for (const rel of result.relationships) {
      graph.addRelationship(rel);
    }
    setGraph(graph);

    // Set file contents from extracted File node content
    const fileMap = new Map<string, string>();
    for (const [path, content] of Object.entries(result.fileContents)) {
      fileMap.set(path, content);
    }
    setFileContents(fileMap);

    // Transition directly to exploring view
    setViewMode('exploring');

    // === 关键改造点 ===
    // 从 URL 参数或配置决定是否加载到本地 WASM
    const shouldLoadToLocalWasm = getServerModeConfig();

    let loadGraphPromise: Promise<void>;

    if (shouldLoadToLocalWasm) {
      // 兼容模式：加载图到本地 LadybugDB WASM，后续查询在本地执行
      // 适合小型项目（<1000 符号），无网络延迟
      loadGraphPromise = loadServerGraph(result.nodes, result.relationships, result.fileContents)
        .then(() => {
          if (getActiveProviderConfig()) {
            return initializeAgent(projectName);
          }
        })
        .then(() => {
          startEmbeddingsWithFallback();
        })
        .catch((err) => {
          console.warn('Failed to load graph into LadybugDB:', err);
          // Agent won't work but graph visualization still does
        });
    } else {
      // 纯服务器模式：所有查询通过 HTTP API 执行
      // 适合大型项目（>5000 符号），内存占用低，初始化快
      loadGraphPromise = Promise.resolve()
        .then(() => {
          // 首先设置服务器连接信息，确保查询可以路由到服务器
          return setServerConnection(serverBaseUrl, result.repoInfo.name);
        })
        .then(() => {
          // 如果有 LLM provider，初始化 AI agent
          const config = getActiveProviderConfig();
          if (config) {
            return initializeBackendAgent(
              serverBaseUrl,
              result.repoInfo.name,
              fileMap,
              projectName
            );
          } else {
            console.log('ℹ️ No LLM provider configured, AI features disabled (Cypher queries still work)');
          }
        })
        .then(() => {
          // 注意：服务器模式下不启动本地 embeddings（服务器端已有）
          if (import.meta.env.DEV) {
            console.log('✅ Server mode: Using HTTP-backed queries');
          }
        })
        .catch((err) => {
          console.error('Failed to initialize server mode:', err);
          // Agent won't work but graph visualization and queries still work
        });
    }

    return loadGraphPromise;
  }, [setViewMode, setGraph, setFileContents, setProjectName, setCurrentRepoName, loadServerGraph, initializeAgent, initializeBackendAgent, setServerConnection, startEmbeddingsWithFallback]);

  // Auto-connect when ?server query param is present (bookmarkable shortcut)
  const autoConnectRan = useRef(false);
  useEffect(() => {
    if (autoConnectRan.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('server')) return;
    autoConnectRan.current = true;

    // 保留 localWasm 参数（如果存在），其他参数清理
    // 这样用户刷新页面时可以保持相同的查询模式
    const localWasmParam = params.get('localWasm');
    const cleanUrl = window.location.pathname +
      (localWasmParam !== null ? `?localWasm=${localWasmParam}` : '') +
      window.location.hash;
    window.history.replaceState(null, '', cleanUrl);

    setProgress({ phase: 'extracting', percent: 0, message: 'Connecting to server...', detail: 'Validating server' });
    setViewMode('loading');

    const serverUrl = params.get('server') || window.location.origin;

    const baseUrl = normalizeServerUrl(serverUrl);

    connectToServer(serverUrl, (phase, downloaded, total) => {
      if (phase === 'validating') {
        setProgress({ phase: 'extracting', percent: 5, message: 'Connecting to server...', detail: 'Validating server' });
      } else if (phase === 'downloading') {
        const pct = total ? Math.round((downloaded / total) * 90) + 5 : 50;
        const mb = (downloaded / (1024 * 1024)).toFixed(1);
        setProgress({ phase: 'extracting', percent: pct, message: 'Downloading graph...', detail: `${mb} MB downloaded` });
      } else if (phase === 'extracting') {
        setProgress({ phase: 'extracting', percent: 97, message: 'Processing...', detail: 'Extracting file contents' });
      }
    }).then(async (result) => {
      await handleServerConnect(result, baseUrl);
      setProgress(null);
      setServerBaseUrl(baseUrl);
      fetchRepos(baseUrl)
        .then((repos) => setAvailableRepos(repos))
        .catch((e) => console.warn('Failed to fetch repo list:', e));
    }).catch((err) => {
      console.error('Auto-connect failed:', err);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Failed to connect to server',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, ERROR_RESET_DELAY_MS);
    });
  }, [handleServerConnect, setProgress, setViewMode, setServerBaseUrl, setAvailableRepos]);

  const handleFocusNode = useCallback((nodeId: string) => {
    graphCanvasRef.current?.focusNode(nodeId);
  }, []);

  // Handle settings saved - refresh and reinitialize agent
  // NOTE: Must be defined BEFORE any conditional returns (React hooks rule)
  const handleSettingsSaved = useCallback(() => {
    refreshLLMSettings();

    // Reinitialize agent based on current mode
    const isServerMode = getServerModeConfig();

    if (serverBaseUrl && !isServerMode) {
      // Server mode with localWasm=false - need to use backend agent
      if (currentRepoName && fileContents.size > 0) {
        initializeBackendAgent(serverBaseUrl, currentRepoName, fileContents, projectName);
      } else {
        console.log('⚠️ Cannot initialize backend agent: missing repo info or file contents');
      }
    } else {
      // Local mode or server with localWasm=true - use local agent
      initializeAgent();
    }
  }, [refreshLLMSettings, initializeAgent, initializeBackendAgent, serverBaseUrl, currentRepoName, fileContents, projectName]);

  // Render based on view mode
  if (viewMode === 'onboarding') {
    return (
      <DropZone
        onFileSelect={handleFileSelect}
        onGitClone={handleGitClone}
        onServerConnect={async (result, serverUrl) => {
          const baseUrl = normalizeServerUrl(serverUrl || window.location.origin);
          await handleServerConnect(result, baseUrl);
          setProgress(null);
          if (serverUrl) {
            setServerBaseUrl(baseUrl);
            fetchRepos(baseUrl)
              .then((repos) => setAvailableRepos(repos))
              .catch((e) => console.warn('Failed to fetch repo list:', e));
          }
        }}
      />
    );
  }

  if (viewMode === 'loading' && progress) {
    return <LoadingOverlay progress={progress} />;
  }

  // Exploring view
  return (
    <div className="flex flex-col h-screen bg-void overflow-hidden">
      <Header onFocusNode={handleFocusNode} availableRepos={availableRepos} onSwitchRepo={switchRepo} />

      <main className="flex-1 flex min-h-0">
        {/* Left Panel - File Tree */}
        <FileTreePanel onFocusNode={handleFocusNode} />

        {/* Graph area - takes remaining space */}
        <div className="flex-1 relative min-w-0">
          <GraphCanvas ref={graphCanvasRef} />

          {/* Code References Panel (overlay) - does NOT resize the graph, it overlaps on top */}
          {isCodePanelOpen && (codeReferences.length > 0 || !!selectedNode) && (
            <div className="absolute inset-y-0 left-0 z-30 pointer-events-auto">
              <CodeReferencesPanel onFocusNode={handleFocusNode} />
            </div>
          )}
        </div>

        {/* Right Panel - Code & Chat (tabbed) */}
        {isRightPanelOpen && <RightPanel />}
      </main>

      <StatusBar />

      {/* Settings Panel (modal) */}
      <SettingsPanel
        isOpen={isSettingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        onSettingsSaved={handleSettingsSaved}
      />

    </div>
  );
};

function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}

export default App;
