import dotenv from 'dotenv';

dotenv.config();

export const config = {
  twitch: {
    username: process.env.TWITCH_USERNAME || '',
    oauthToken: process.env.TWITCH_OAUTH_TOKEN || '',
    channel: process.env.TWITCH_CHANNEL || '',
    streamerName: process.env.STREAMER_NAME || process.env.TWITCH_CHANNEL || 'стример',
  },
  browser: {
    headless: process.env.HEADLESS !== 'false',
    screenshotInterval: parseInt(process.env.SCREENSHOT_INTERVAL || '10000', 10), // 10 секунд по умолчанию
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },
  proxyapi: {
    // Использование ProxyAPI вместо прямого OpenAI
    enabled: process.env.USE_PROXYAPI === 'true',
    apiKey: process.env.PROXYAPI_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.PROXYAPI_URL || 'https://api.proxyapi.ru',
    provider: process.env.PROXYAPI_PROVIDER || 'google', // openai, google, anthropic (для Gemini используйте 'google')
    // Модели для разных задач
    chatModel: process.env.PROXYAPI_CHAT_MODEL || 'gpt-4', // gpt-4, gemini-3-pro-preview, и т.д.
    visionModel: process.env.PROXYAPI_VISION_MODEL || 'gemini-2.0-flash-exp', // gemini-2.0-flash-exp, gpt-4o, gpt-4o-2024-11-20, gpt-4o-2024-08-06
    whisperModel: process.env.PROXYAPI_WHISPER_MODEL || 'gpt-4o-transcribe', // gpt-4o-transcribe, gpt-4o-mini-transcribe
  },
  coordinator: {
    // Мозг сам решает когда и как часто отправлять сообщения
    // maxMessageLength и messageCooldown убраны - мозг управляет этим через time
    minConfidence: parseFloat(process.env.MIN_CONFIDENCE || '0.7'),
    silenceThreshold: parseFloat(process.env.SILENCE_THRESHOLD || '0.3'),
    // Режим работы мозга: 'normal' (основной) или 'training' (обучение)
    brainMode: process.env.BRAIN_MODE || 'normal',
  },
  debug: {
    consoleOnly: process.env.CONSOLE_ONLY === 'true', // Только консоль, не отправлять в чат
  },
  local: {
    // Использование локальных моделей вместо API
    useLocalWhisper: process.env.USE_LOCAL_WHISPER === 'true',
    useLocalLLM: process.env.USE_LOCAL_LLM === 'true',
    useLocalVision: process.env.USE_LOCAL_VISION === 'true',
    
    // Настройки локального Whisper
    whisperModel: process.env.LOCAL_WHISPER_MODEL || 'small', // base (быстро, но хуже), small (рекомендуется), medium (лучше, но медленнее), large (лучше всего, но очень медленно)
    whisperDevice: process.env.LOCAL_WHISPER_DEVICE || 'cpu', // cpu, cuda
    
    // Настройки локального LLM (Ollama)
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5', // qwen2.5, llama3.1, llama3, mistral, и т.д.
    ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || 'llava-phi3', // llava-phi3, llava-1.6, llava для анализа изображений
    
    // Провайдер локального LLM
    llmProvider: process.env.LOCAL_LLM_PROVIDER || 'ollama', // ollama, lmstudio
  },
};
