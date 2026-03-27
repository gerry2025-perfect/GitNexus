// Centralized UI and provider defaults to reduce magic numbers and duplicated URLs.
export const ERROR_RESET_DELAY_MS = 3000;
export const BACKEND_URL_DEBOUNCE_MS = 500;

export const DEFAULT_BACKEND_URL = 'http://localhost:4747';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * 服务器模式配置
 *
 * 控制在连接 GitNexus 服务器时的查询模式：
 * - true: 兼容模式 - 将图加载到浏览器内 LadybugDB WASM，后续查询在本地执行
 *   适合：小型项目（<1000 符号），响应更快，无网络延迟
 * - false: 纯服务器模式 - 仅渲染图，所有查询通过 HTTP API 执行
 *   适合：大型项目（>5000 符号），内存占用低，初始化快
 *
 * 可通过 URL 参数覆盖：?localWasm=false
 */
export const SERVER_MODE_CONFIG = {
  ENABLE_LOCAL_WASM_IN_SERVER_MODE: true,
} as const;

/**
 * 全局缓存的服务器模式配置
 * 在应用初始化时设置，确保整个生命周期内配置一致
 */
let cachedServerModeConfig: boolean | null = null;

/**
 * 初始化服务器模式配置
 * 必须在应用启动时调用一次，之后配置不可变
 *
 * 优先级：URL 参数 > 默认配置
 */
export const initServerModeConfig = (): void => {
  if (cachedServerModeConfig !== null) {
    // 已初始化，避免重复
    console.log('⚠️ Server mode config already initialized:', cachedServerModeConfig);
    return;
  }

  // 从 URL 参数读取配置（如果存在）
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('localWasm');

  console.log('🔧 Initializing server mode config...', {
    urlParam,
    fullURL: window.location.href,
    search: window.location.search
  });

  if (urlParam !== null) {
    cachedServerModeConfig = urlParam === 'true';
  } else {
    // 否则使用默认配置
    cachedServerModeConfig = SERVER_MODE_CONFIG.ENABLE_LOCAL_WASM_IN_SERVER_MODE;
  }

  console.log('✅ Server mode initialized:', {
    mode: cachedServerModeConfig ? 'Local WASM' : 'Server API',
    source: urlParam !== null ? `URL param (${urlParam})` : 'default config',
  });
};

/**
 * 获取当前的服务器模式配置
 *
 * @returns true = 本地 WASM 模式, false = 纯服务器 HTTP 模式
 * @throws 如果配置未初始化
 */
export const getServerModeConfig = (): boolean => {
  if (cachedServerModeConfig === null) {
    throw new Error('Server mode config not initialized. Call initServerModeConfig() first.');
  }
  return cachedServerModeConfig;
};
