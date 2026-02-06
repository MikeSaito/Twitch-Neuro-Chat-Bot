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
    visionModel: process.env.PROXYAPI_VISION_MODEL || 'gemini-2.5-flash-lite', // gemini-2.5-flash-lite, gemini-2.0-flash-exp, gpt-4o, gpt-4o-2024-11-20, gpt-4o-2024-08-06
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
    // useLocalLLM и useLocalVision удалены - используется только Gemini через ProxyAPI
    
    // Настройки локального Whisper
    whisperModel: process.env.LOCAL_WHISPER_MODEL || 'small', // base (быстро, но хуже), small (рекомендуется для баланса), medium (лучше, но медленнее), large (лучше всего, но очень медленно)
    whisperDevice: (process.env.LOCAL_WHISPER_DEVICE || 'cpu').toLowerCase(), // cpu, cuda (всегда строчными)
    whisperComputeType: process.env.LOCAL_WHISPER_COMPUTE_TYPE || 'int8', // int8 (быстро, баланс), int8_float16 (CUDA), float16, float32 (медленнее, но лучше)
    whisperBeamSize: parseInt(process.env.LOCAL_WHISPER_BEAM_SIZE || '2', 10), // 1 = greedy (быстро), 2-3 = баланс, 5 = beam search (медленнее, но лучше)
  },
};
