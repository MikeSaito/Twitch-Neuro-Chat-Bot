import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { VoiceActivityDetector } from './vad.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VirtualBrowser {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.screenshotsDir = path.join(__dirname, '../../screenshots');
    this.streamUrl = null; // Кэшируем URL стрима для непрерывного захвата
    this.ytdlpCommand = null; // Кэшируем команду yt-dlp
    this.streamUrlTimestamp = 0; // Время получения URL (для обновления при необходимости)
    this.vad = null; // Voice Activity Detector для умного захвата
    this.isCapturingSpeech = false; // Флаг активного захвата речи
    this.lastSpeechTime = 0; // Время последней обнаруженной речи
  }

  /**
   * Очистка старых скриншотов
   */
  async cleanupOldScreenshots() {
    try {
      const files = await fs.readdir(this.screenshotsDir).catch(() => []);
      
      const now = Date.now();
      // Максимальный возраст скриншотов (по умолчанию 60 минут = 1 час, можно настроить через SCREENSHOT_MAX_AGE в минутах)
      const maxAgeMinutes = parseInt(process.env.SCREENSHOT_MAX_AGE || '60', 10);
      const maxAge = maxAgeMinutes * 60 * 1000;
      let cleanedCount = 0;
      
      for (const file of files) {
        if (!file.startsWith('screenshot_') || !file.endsWith('.png')) {
          continue; // Пропускаем файлы, которые не являются скриншотами
        }
        
        const filePath = path.join(this.screenshotsDir, file);
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;
          
          // Удаляем скриншоты старше установленного времени
          if (age > maxAge) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
        } catch (error) {
          // Игнорируем ошибки удаления отдельных файлов
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[Browser] 🧹 Очищено ${cleanedCount} старых скриншотов (старше ${maxAgeMinutes} минут)`);
      }
    } catch (error) {
      // Игнорируем ошибки очистки
    }
  }

  /**
   * Очистка старых временных файлов (включая .part файлы)
   */
  async cleanupTempFiles() {
    try {
      const tempDir = path.join(os.tmpdir(), 'twitch_bot_audio');
      const files = await fs.readdir(tempDir).catch(() => []);
      
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 минут
      let cleanedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;
          
          // Удаляем файлы старше 5 минут или все .part файлы
          if (age > maxAge || file.endsWith('.part')) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
        } catch (error) {
          // Игнорируем ошибки удаления отдельных файлов
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[Browser] 🧹 Очищено ${cleanedCount} старых временных файлов`);
      }
    } catch (error) {
      // Игнорируем ошибки очистки
    }
  }

  async init() {
    try {
      // Создаем директорию для скриншотов
      await fs.mkdir(this.screenshotsDir, { recursive: true });
      
      // Очищаем старые временные файлы и скриншоты при инициализации
      await this.cleanupTempFiles();
      await this.cleanupOldScreenshots();

      // Оптимизация браузера для снижения нагрузки
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage', // Уменьшает использование памяти
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu', // Отключаем GPU для headless режима
          '--disable-software-rasterizer',
          '--disable-extensions', // Отключаем расширения
          '--disable-background-networking', // Отключаем фоновые запросы
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-ipc-flooding-protection',
        ],
      });

      this.page = await this.browser.newPage();
      
      // Устанавливаем размер окна для стрима с высоким разрешением для лучшего качества
      // Увеличиваем разрешение для более четких скриншотов
      await this.page.setViewportSize({ 
        width: 2560, 
        height: 1440,
        deviceScaleFactor: 2 // Увеличиваем масштаб для четкости (2x = Retina качество)
      });
      
      // Устанавливаем таймаут для навигации
      this.page.setDefaultNavigationTimeout(60000); // 60 секунд
      this.page.setDefaultTimeout(60000);
      
      // Открываем Twitch стрим
      const twitchUrl = `https://www.twitch.tv/${this.config.channel}`;
      console.log(`[Browser] Загрузка страницы: ${twitchUrl}`);
      
      try {
        // Пробуем загрузить с более мягким условием ожидания
        await this.page.goto(twitchUrl, { 
          waitUntil: 'domcontentloaded', // Более мягкое условие, чем networkidle
          timeout: 60000 
        });
        
        // Ожидание убрано - продолжаем сразу
        
        // Пробуем дождаться появления видео элемента (если есть)
        try {
          await this.page.waitForSelector('video', { timeout: 10000 }).catch(() => {
            console.log('[Browser] Видео элемент не найден, продолжаем...');
          });
          
          // Устанавливаем максимальное качество видео и разворачиваем на весь экран
          console.log('[Browser] 🎥 Установка максимального качества видео...');
          console.log('[Browser] 🖥️ Разворачивание трансляции на весь экран...');
          // Устанавливаем качество и разворачиваем с задержкой, чтобы плеер успел загрузиться
          setTimeout(async () => {
            await this.setMaxVideoQuality();
            await this.expandVideoToFullscreen();
          }, 5000); // 5 секунд после появления видео элемента
        } catch (e) {
          // Игнорируем, если видео нет
        }
      } catch (error) {
        console.warn(`[Browser] Предупреждение при загрузке: ${error.message}`);
        // Продолжаем работу даже если страница загрузилась не полностью
      }
      
      console.log(`[Browser] Подключен к стриму: ${twitchUrl}`);
      this.isRunning = true;
      
      // Получаем URL стрима один раз при инициализации (после загрузки)
      // Ждем немного, чтобы стрим точно загрузился
      setTimeout(async () => {
        try {
          await this.ensureStreamUrl();
        } catch (error) {
          console.warn('[Browser] Не удалось получить URL стрима при инициализации, попробуем позже:', error.message);
        }
      }, 10000); // 10 секунд после загрузки страницы
    } catch (error) {
      console.error('[Browser] Ошибка инициализации:', error);
      throw error;
    }
  }

  /**
   * Установка максимального качества видео в плеере Twitch
   */
  async setMaxVideoQuality() {
    try {
      // Ждем немного, чтобы плеер полностью загрузился
      await this.page.waitForTimeout(3000);
      
      // Сначала пробуем установить через localStorage (самый надежный способ)
      await this.page.evaluate(() => {
        try {
          // Twitch сохраняет настройки качества в localStorage
          localStorage.setItem('video-quality', 'chunked'); // chunked = Source (максимальное качество)
          localStorage.setItem('player-quality', 'chunked');
          localStorage.setItem('video-quality-preference', 'chunked');
          // Также пробуем установить для конкретного канала
          const channel = window.location.pathname.split('/').pop();
          if (channel) {
            localStorage.setItem(`video-quality-${channel}`, 'chunked');
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      });
      
      // Пробуем установить качество через JavaScript API плеера
      const qualitySet = await this.page.evaluate(() => {
        try {
          // Ищем видео элемент
          const video = document.querySelector('video');
          if (!video) return { success: false, reason: 'Video element not found' };
          
          // Пробуем найти плеер Twitch через различные способы
          // Twitch использует Player.js, который может быть доступен через разные пути
          let player = null;
          
          // Способ 1: через window.Player
          if (window.Player && typeof window.Player.setQuality === 'function') {
            player = window.Player;
          }
          // Способ 2: через window.Twitch.Player
          else if (window.Twitch && window.Twitch.Player) {
            const playerElements = document.querySelectorAll('[data-a-player]');
            for (const elem of playerElements) {
              const playerId = elem.getAttribute('data-a-player');
              if (playerId && window.Twitch.Player[playerId]) {
                player = window.Twitch.Player[playerId];
                break;
              }
            }
          }
          // Способ 3: через data-a-player атрибут
          else {
            const playerElem = document.querySelector('[data-a-player]');
            if (playerElem) {
              const playerId = playerElem.getAttribute('data-a-player');
              if (playerId && window[playerId]) {
                player = window[playerId];
              }
            }
          }
          
          if (player && typeof player.setQuality === 'function') {
            // Пробуем установить Source (самое высокое качество)
            // 'chunked' = Source quality в Twitch
            try {
              player.setQuality('chunked');
              return { success: true, quality: 'Source (chunked)', method: 'API' };
            } catch (e) {
              // Если chunked не работает, пробуем другие варианты
              const qualities = ['source', '1080p60', '1080p', '720p60', '720p'];
              for (const quality of qualities) {
                try {
                  player.setQuality(quality);
                  return { success: true, quality: quality, method: 'API' };
                } catch (e2) {
                  continue;
                }
              }
            }
          }
          
          // Если API не работает, пробуем через UI (клики)
          const playerContainer = document.querySelector('[data-a-target="player-container"]') ||
                                  document.querySelector('.video-player') ||
                                  document.querySelector('[data-a-player]');
          
          if (playerContainer) {
            // Ищем кнопку настроек
            const settingsButton = playerContainer.querySelector('button[data-a-target="player-settings-button"]') ||
                                   playerContainer.querySelector('button[aria-label*="Settings"]') ||
                                   playerContainer.querySelector('button[aria-label*="Настройки"]') ||
                                   playerContainer.querySelector('button[title*="Settings"]');
            
            if (settingsButton) {
              // Возвращаем информацию о кнопке для клика через Playwright
              const rect = settingsButton.getBoundingClientRect();
              return { 
                success: true, 
                quality: 'UI method', 
                method: 'UI',
                hasSettingsButton: true,
                buttonRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
              };
            }
          }
          
          return { success: false, reason: 'Player API and UI not found' };
        } catch (error) {
          return { success: false, reason: error.message };
        }
      });
      
      // Если нужно кликнуть через UI
      if (qualitySet.success && qualitySet.method === 'UI' && qualitySet.hasSettingsButton) {
        try {
          // Кликаем на кнопку настроек
          await this.page.click('button[data-a-target="player-settings-button"]', { timeout: 2000 }).catch(() => {
            // Пробуем другие селекторы
            return this.page.click('button[aria-label*="Settings"]', { timeout: 2000 }).catch(() => {
              return this.page.click('button[aria-label*="Настройки"]', { timeout: 2000 });
            });
          });
          
          // Ждем появления меню
          await this.page.waitForTimeout(500);
          
          // Ищем опцию качества "Source" или максимальное
          const qualitySelected = await this.page.evaluate(() => {
            const qualityMenu = document.querySelector('[data-a-target="player-settings-menu"]') ||
                               document.querySelector('[role="menu"]');
            if (qualityMenu) {
              const qualityOptions = qualityMenu.querySelectorAll('button, [role="menuitem"]');
              for (const option of qualityOptions) {
                const text = (option.textContent || option.innerText || '').trim();
                // Ищем "Source" или самое высокое качество
                if (text.includes('Source') || text.includes('Исходное') || 
                    text.match(/1080|1440|2160|4K/i) || text === 'chunked') {
                  option.click();
                  return { success: true, quality: text };
                }
              }
              // Если не нашли Source, кликаем на первое доступное (обычно самое высокое)
              if (qualityOptions.length > 0) {
                qualityOptions[0].click();
                return { success: true, quality: 'first available' };
              }
            }
            return { success: false };
          });
          
          if (qualitySelected.success) {
            console.log(`[Browser] ✅ Качество видео установлено через UI: ${qualitySelected.quality}`);
            return;
          }
        } catch (uiError) {
          console.warn('[Browser] ⚠️ Ошибка при установке качества через UI:', uiError.message);
        }
      }
      
      if (qualitySet.success && qualitySet.method === 'API') {
        console.log(`[Browser] ✅ Качество видео установлено через API: ${qualitySet.quality}`);
      } else {
        console.log(`[Browser] ⚠️ Не удалось установить качество автоматически: ${qualitySet.reason}`);
        console.log(`[Browser] 💡 Используется качество из localStorage или по умолчанию`);
      }
      
    } catch (error) {
      console.warn('[Browser] ⚠️ Ошибка при установке качества видео:', error.message);
      // Не критично, продолжаем работу
    }
  }

  /**
   * Разворачивание трансляции на весь экран (театральный режим или полноэкранный)
   */
  async expandVideoToFullscreen() {
    try {
      // Ждем немного, чтобы плеер полностью загрузился
      await this.page.waitForTimeout(2000);
      
      const result = await this.page.evaluate(() => {
        try {
          // Способ 1: Включаем театральный режим (theater mode) - лучше для скриншотов
          const theaterButton = document.querySelector('button[data-a-target="player-theatre-mode-button"]') ||
                               document.querySelector('button[aria-label*="Theater"]') ||
                               document.querySelector('button[aria-label*="Театр"]') ||
                               document.querySelector('button[title*="Theater"]');
          
          if (theaterButton) {
            theaterButton.click();
            return { success: true, method: 'theater', message: 'Театральный режим включен' };
          }
          
          // Способ 2: Пробуем полноэкранный режим
          const fullscreenButton = document.querySelector('button[data-a-target="player-fullscreen-button"]') ||
                                  document.querySelector('button[aria-label*="Fullscreen"]') ||
                                  document.querySelector('button[aria-label*="Полный экран"]');
          
          if (fullscreenButton) {
            fullscreenButton.click();
            return { success: true, method: 'fullscreen', message: 'Полноэкранный режим включен' };
          }
          
          // Способ 3: Прямое обращение к видео элементу для полноэкранного режима
          const video = document.querySelector('video');
          if (video && video.requestFullscreen) {
            video.requestFullscreen().catch(() => {
              // Если не получилось, пробуем другие методы
              if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
              else if (video.mozRequestFullScreen) video.mozRequestFullScreen();
              else if (video.msRequestFullscreen) video.msRequestFullscreen();
            });
            return { success: true, method: 'video-fullscreen', message: 'Видео в полноэкранном режиме' };
          }
          
          // Способ 4: Скрываем боковую панель и чат через CSS для максимального размера видео
          const sidePanel = document.querySelector('[data-a-target="right-column"]') ||
                           document.querySelector('.right-column') ||
                           document.querySelector('[class*="side"]');
          const chatPanel = document.querySelector('[data-a-target="chat-container"]') ||
                          document.querySelector('.chat-container') ||
                          document.querySelector('[class*="chat"]');
          
          if (sidePanel || chatPanel) {
            // Скрываем через CSS
            const style = document.createElement('style');
            style.textContent = `
              [data-a-target="right-column"],
              .right-column,
              [data-a-target="chat-container"],
              .chat-container,
              [class*="side"],
              [class*="chat"] {
                display: none !important;
              }
              [data-a-target="player-container"],
              .video-player,
              video {
                width: 100% !important;
                height: 100vh !important;
              }
            `;
            document.head.appendChild(style);
            return { success: true, method: 'css-hide', message: 'Боковые панели скрыты, видео расширено' };
          }
          
          return { success: false, reason: 'Не найдены элементы для разворачивания' };
        } catch (error) {
          return { success: false, reason: error.message };
        }
      });
      
      if (result.success) {
        console.log(`[Browser] ✅ ${result.message} (метод: ${result.method})`);
      } else {
        console.log(`[Browser] ⚠️ Не удалось развернуть видео: ${result.reason}`);
        console.log(`[Browser] 💡 Плеер может использовать стандартный размер`);
      }
      
    } catch (error) {
      console.warn('[Browser] ⚠️ Ошибка при разворачивании видео:', error.message);
      // Не критично, продолжаем работу
    }
  }

  async takeScreenshot() {
    if (!this.page || !this.isRunning) {
      throw new Error('Браузер не инициализирован');
    }

    try {
      const timestamp = Date.now();
      const screenshotPath = path.join(this.screenshotsDir, `screenshot_${timestamp}.png`);
      
      // Делаем скриншот с максимальным качеством
      const screenshot = await this.page.screenshot({
        path: screenshotPath,
        fullPage: false,
        type: 'png', // PNG для лучшего качества
      });

      // Оптимизируем изображение для отправки в API (сохраняем высокое качество)
      // Не уменьшаем размер - используем исходное разрешение для лучшего распознавания
      const optimizedBuffer = await sharp(screenshot)
        .png({ 
          compressionLevel: 6, // 0-9, 6 = баланс качества и размера
          quality: 100, // Максимальное качество для PNG
          effort: 6 // Скорость сжатия (0-10, 6 = баланс)
        })
        .toBuffer();

      return {
        buffer: optimizedBuffer,
        path: screenshotPath,
        timestamp,
      };
    } catch (error) {
      console.error('[Browser] Ошибка при создании скриншота:', error);
      throw error;
    }
  }

  async startScreenshotLoop(callback) {
    if (!this.isRunning) {
      await this.init();
    }

    // Флаг для блокировки параллельной обработки
    let isProcessing = false;

    // Запускаем асинхронный цикл скриншотов с блокировкой
    // Счетчик для периодической очистки скриншотов
    let screenshotCount = 0;
    
    const takeScreenshotAsync = async () => {
      if (!this.isRunning || isProcessing) {
        if (isProcessing) {
          console.log('[Browser] ⏳ Пропуск скриншота: предыдущий еще обрабатывается');
        }
        return;
      }

      isProcessing = true;
      try {
        const screenshot = await this.takeScreenshot();
        // Вызываем callback и ждем завершения перед следующим скриншотом
        await callback(screenshot);
        
        // Периодически очищаем старые скриншоты (каждые 20 скриншотов = примерно каждые 100 секунд)
        screenshotCount++;
        if (screenshotCount % 20 === 0) {
          await this.cleanupOldScreenshots();
        }
      } catch (error) {
        console.error('[Browser] Ошибка в callback скриншота:', error);
      } finally {
        isProcessing = false;
      }
    };

    // Первый скриншот сразу
    takeScreenshotAsync();

    // Затем по интервалу
    const interval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      takeScreenshotAsync();
    }, this.config.screenshotInterval);

    console.log(`[Browser] Цикл скриншотов запущен (интервал: ${this.config.screenshotInterval}ms)`);
    console.log(`[Browser] ⚡ Режим: последовательный (ждет завершения обработки)`);
    
    return interval;
  }

  async stop() {
    this.isRunning = false;
    if (this.browser) {
      await this.browser.close();
      console.log('[Browser] Браузер закрыт');
    }
  }

  /**
   * Захват аудио из браузера через CDP (Chrome DevTools Protocol)
   * Захватывает последние 5 секунд аудио из стрима
   * 
   * ВАЖНО: Захват аудио из браузера сложен. Рекомендуется использовать yt-dlp или streamlink
   */
  async captureAudio(durationSeconds = 5) {
    if (!this.page || !this.isRunning) {
      console.log('[Browser] 🎤 Браузер не готов для захвата аудио');
      return null;
    }

    console.log(`[Browser] 🎤 Попытка захвата аудио (${durationSeconds} секунд)...`);
    
    // Пробуем сначала через yt-dlp (более надежный способ)
    const ytdlpResult = await this.captureAudioWithYtDlp(durationSeconds);
    if (ytdlpResult && ytdlpResult.audio) {
      return ytdlpResult.audio;
    }
    
    // Если yt-dlp найден, но захват не удался - не пробуем браузерный метод
    if (ytdlpResult && ytdlpResult.ytdlpFound) {
      // yt-dlp найден, но захват не удался (возможно, стрим недоступен или другая ошибка)
      return null;
    }

    // Если yt-dlp не найден, пробуем через браузер (экспериментально)
    // Но это не должно происходить, так как yt-dlp уже найден при инициализации
    try {
      console.log('[Browser] 🎤 Пробую захват через браузер (экспериментально)...');
      
      // Пробуем получить аудио через CDP
      const client = await this.page.context().newCDPSession(this.page);
      await client.send('Page.enable');
      
      // Пока что возвращаем null - захват через браузер требует дополнительной настройки
      console.log('[Browser] ⚠️ Захват через браузер пока не реализован');
      
      return null;
    } catch (error) {
      console.error('[Browser] Ошибка захвата аудио через браузер:', error.message);
      return null;
    }
  }

  /**
   * Поиск доступного способа запуска yt-dlp
   * Пробует разные варианты: yt-dlp, yt-dlp.exe, python -m yt_dlp
   */
  async findYtDlpCommand() {
    const commands = [
      { cmd: 'yt-dlp', args: [] },
      { cmd: 'yt-dlp.exe', args: [] },
      { cmd: 'python', args: ['-m', 'yt_dlp'] },
      { cmd: 'python3', args: ['-m', 'yt_dlp'] },
    ];

    // Проверяем каждый вариант
    for (const { cmd, args } of commands) {
      try {
        const testArgs = [...args, '--version'];
        const testProcess = spawn(cmd, testArgs, { stdio: 'pipe' });
        
        const result = await new Promise((resolve, reject) => {
          let timeoutId = setTimeout(() => {
            testProcess.kill();
            reject(new Error('Timeout'));
          }, 3000);
          
          testProcess.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
              resolve({ cmd, args });
            } else {
              reject(new Error(`Exit code: ${code}`));
            }
          });
          
          testProcess.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(error);
          });
        });
        
        // Если дошли сюда - команда работает
        return result;
      } catch (error) {
        // Пробуем следующий вариант
        continue;
      }
    }
    
    return null;
  }

  /**
   * Проверка наличия ffmpeg (необходим для обработки потоков Twitch)
   */
  async checkFfmpeg() {
    const commands = ['ffmpeg', 'ffmpeg.exe'];
    
    // Стандартные пути установки FFmpeg на Windows
    const commonPaths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      process.env.FFMPEG_PATH, // Пользовательский путь из переменной окружения
    ].filter(Boolean);
    
    // Сначала пробуем команды из PATH
    for (const cmd of commands) {
      try {
        const testProcess = spawn(cmd, ['-version'], { stdio: 'pipe' });
        
        const result = await new Promise((resolve, reject) => {
          let timeoutId = setTimeout(() => {
            testProcess.kill();
            reject(new Error('Timeout'));
          }, 5000); // Увеличиваем таймаут до 5 секунд
          
          testProcess.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
              resolve(true);
            } else {
              reject(new Error(`Exit code: ${code}`));
            }
          });
          
          testProcess.on('error', (error) => {
            clearTimeout(timeoutId);
            // Игнорируем ошибки ENOENT здесь, пробуем дальше
            if (error.code !== 'ENOENT') {
              reject(error);
            } else {
              reject(new Error('ENOENT'));
            }
          });
        });
        
        if (result) {
          console.log(`[Browser] ✅ FFmpeg найден: ${cmd}`);
          return true;
        }
      } catch (error) {
        // Продолжаем проверку
        continue;
      }
    }
    
    // Если не нашли в PATH, пробуем стандартные пути
    for (const ffmpegPath of commonPaths) {
      try {
        const testProcess = spawn(ffmpegPath, ['-version'], { stdio: 'pipe' });
        
        const result = await new Promise((resolve, reject) => {
          let timeoutId = setTimeout(() => {
            testProcess.kill();
            reject(new Error('Timeout'));
          }, 5000);
          
          testProcess.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
              resolve(true);
            } else {
              reject(new Error(`Exit code: ${code}`));
            }
          });
          
          testProcess.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(error);
          });
        });
        
        if (result) {
          console.log(`[Browser] ✅ FFmpeg найден по пути: ${ffmpegPath}`);
          return true;
        }
      } catch (error) {
        // Продолжаем проверку
        continue;
      }
    }
    
    return false;
  }

  /**
   * Альтернативный способ: захват аудио через yt-dlp + ffmpeg
   * Сначала получаем URL стрима через yt-dlp, затем используем ffmpeg напрямую
   */
  /**
   * Очистка старых временных файлов (включая .part файлы)
   */
  async cleanupTempFiles() {
    try {
      const tempDir = path.join(os.tmpdir(), 'twitch_bot_audio');
      const files = await fs.readdir(tempDir).catch(() => []);
      
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 минут
      let cleanedCount = 0;
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;
          
          // Удаляем файлы старше 5 минут или все .part файлы
          if (age > maxAge || file.endsWith('.part')) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
        } catch (error) {
          // Игнорируем ошибки удаления отдельных файлов
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[Browser] 🧹 Очищено ${cleanedCount} старых временных файлов`);
      }
    } catch (error) {
      // Игнорируем ошибки очистки
    }
  }

  /**
   * Убедиться, что у нас есть URL стрима (получить или использовать кэшированный)
   */
  async ensureStreamUrl() {
    // Если URL уже есть и не слишком старый (менее 5 минут), используем его
    const urlMaxAge = 5 * 60 * 1000; // 5 минут
    if (this.streamUrl && (Date.now() - this.streamUrlTimestamp) < urlMaxAge) {
      return this.streamUrl;
    }
    
    // Получаем команду yt-dlp (кэшируем)
    if (!this.ytdlpCommand) {
      this.ytdlpCommand = await this.findYtDlpCommand();
      if (!this.ytdlpCommand) {
        console.log('[Browser] ⚠️ yt-dlp не найден в системе');
        return null;
      }
    }
    
    // Получаем новый URL
    console.log('[Browser] 📡 Получение URL стрима...');
    const streamUrl = await this.getStreamUrl(this.ytdlpCommand, this.config.channel);
    
    if (streamUrl) {
      this.streamUrl = streamUrl;
      this.streamUrlTimestamp = Date.now();
      console.log(`[Browser] ✅ URL стрима сохранен для непрерывного захвата`);
      return streamUrl;
    }
    
    return null;
  }

  async captureAudioWithYtDlp(durationSeconds = 5) {
    try {
      // Используем системную временную директорию (избегаем проблем с кириллицей в путях)
      const tempDir = path.join(os.tmpdir(), 'twitch_bot_audio');
      await fs.mkdir(tempDir, { recursive: true });
      
      // Периодически очищаем старые файлы (каждые 10 захватов)
      if (!this._cleanupCounter) this._cleanupCounter = 0;
      this._cleanupCounter++;
      if (this._cleanupCounter % 10 === 0) {
        await this.cleanupTempFiles();
      }
      
      const timestamp = Date.now();
      const outputPath = path.join(tempDir, `audio_${timestamp}.mp3`);
      
      console.log(`[Browser] 🎤 Захват фрагмента аудио (${durationSeconds} секунд)...`);
      
      // Проверяем наличие ffmpeg (необходим для Twitch потоков)
      const hasFfmpeg = await this.checkFfmpeg();
      if (!hasFfmpeg) {
        console.log('[Browser] ⚠️ ffmpeg не найден в системе');
        return { audio: null, ytdlpFound: false, ffmpegFound: false };
      }
      
      // Убеждаемся, что у нас есть URL стрима (используем кэшированный или получаем новый)
      const streamUrl = await this.ensureStreamUrl();
      
      if (!streamUrl) {
        console.log('[Browser] ❌ Не удалось получить URL стрима');
        return { audio: null, ytdlpFound: true, ffmpegFound: true };
      }
      
      console.log(`[Browser] ✅ Используем сохраненный URL стрима (непрерывный режим)`);
      console.log(`[Browser] 📁 Выходной файл: ${outputPath}`);
      
      // Захватываем фрагмент с текущего момента стрима (без пропуска начала)
      // Так как мы используем один URL и захватываем непрерывно, реклама уже прошла
      console.log(`[Browser] 🎵 Захват аудио через ffmpeg (${durationSeconds} секунд)...`);
      return await this.captureAudioWithFfmpeg(streamUrl, outputPath, durationSeconds);
      
    } catch (error) {
      console.error('[Browser] Ошибка захвата аудио:', error.message);
      // При ошибке сбрасываем URL, чтобы получить новый в следующий раз
      this.streamUrl = null;
      return { audio: null, ytdlpFound: true, ffmpegFound: true };
    }
  }

  /**
   * Получение URL стрима через yt-dlp
   */
  async getStreamUrl(ytdlpCommand, channel) {
    return new Promise((resolve) => {
      let ytdlp;
      let stdoutOutput = '';
      let errorOutput = '';

      try {
        // Пробуем получить аудио-только URL
        // Сначала пробуем аудио-только формат, если не получится - используем best
        const ytdlpArgs = [
          ...ytdlpCommand.args,
          `https://www.twitch.tv/${channel}`,
          '-g', // Получить URL без загрузки
          '-f', 'bestaudio/best', // Сначала аудио-только, если нет - лучшее качество
        ];
        
        console.log(`[Browser] 🔍 Команда получения URL: ${ytdlpCommand.cmd} ${ytdlpArgs.join(' ')}`);
        ytdlp = spawn(ytdlpCommand.cmd, ytdlpArgs);
      } catch (error) {
        console.error('[Browser] Ошибка запуска yt-dlp:', error.message);
        resolve(null);
        return;
      }

      ytdlp.stdout.on('data', (data) => {
        stdoutOutput += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code === 0 && stdoutOutput.trim()) {
          // URL стрима в stdout (может быть несколько строк, берем первую)
          const url = stdoutOutput.trim().split('\n')[0].trim();
          if (url && url.startsWith('http')) {
            console.log(`[Browser] ✅ URL получен: ${url.substring(0, 80)}...`);
            resolve(url);
          } else {
            console.log(`[Browser] ⚠️ Неверный формат URL: ${url}`);
            resolve(null);
          }
        } else {
          console.log(`[Browser] ❌ Не удалось получить URL (код: ${code})`);
          if (errorOutput) {
            const errorLines = errorOutput.split('\n').filter(l => l.trim()).slice(0, 3);
            errorLines.forEach(line => console.log(`[Browser]    ${line.substring(0, 150)}`));
          }
          resolve(null);
        }
      });

      ytdlp.on('error', (error) => {
        console.error('[Browser] Ошибка запуска yt-dlp:', error.message);
        resolve(null);
      });

      // Таймаут для получения URL
      setTimeout(() => {
        if (ytdlp && !ytdlp.killed) {
          ytdlp.kill();
          console.log('[Browser] ⏱️ Таймаут получения URL');
          resolve(null);
        }
      }, 10000);
    });
  }

  /**
   * Захват аудио напрямую через yt-dlp (более надежный способ)
   * Использует таймаут вместо параметра -t для ограничения времени
   */
  async captureAudioDirectlyWithYtDlp(ytdlpCommand, channel, outputPath, durationSeconds) {
    return new Promise((resolve) => {
      let ytdlp;
      let errorOutput = '';
      let stdoutOutput = '';
      let hasResolved = false;

      try {
        // Используем yt-dlp для прямого захвата аудио
        // НЕ используем -t (это preset alias), вместо этого используем таймаут процесса
        // НЕ пропускаем начало, так как используем один URL и захватываем непрерывно
        const ytdlpArgs = [
          ...ytdlpCommand.args,
          `https://www.twitch.tv/${channel}`,
          '--extract-audio',
          '--audio-format', 'mp3',
          '--audio-quality', '0',
          '-o', outputPath,
          '--no-playlist',
          '--max-downloads', '1',
          '--external-downloader', 'ffmpeg',
          '--external-downloader-args', `ffmpeg:-map 0:a -vn`, // Берем только аудио
          '--verbose',
        ];
        
        console.log(`[Browser] 📡 Захват с текущего момента стрима (непрерывный режим)`);
        
        console.log(`[Browser] 🎵 Запуск yt-dlp для прямого захвата аудио...`);
        ytdlp = spawn(ytdlpCommand.cmd, ytdlpArgs);
      } catch (error) {
        console.error('[Browser] Ошибка запуска yt-dlp:', error.message);
        resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
        return;
      }

      ytdlp.stdout.on('data', (data) => {
        stdoutOutput += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        // Выводим важные сообщения
        if (text.includes('ERROR') || text.includes('WARNING') || text.includes('Downloading') || text.includes('[download]')) {
          const lines = text.split('\n').filter(l => l.trim());
          lines.forEach(line => {
            if (line.length < 200) {
              console.log(`[yt-dlp] ${line.trim()}`);
            }
          });
        }
      });

      // Проверяем файл по мере создания и останавливаем через durationSeconds
      const checkInterval = setInterval(async () => {
        try {
          const stats = await fs.stat(outputPath).catch(() => null);
          if (stats && stats.size > 1000 && !hasResolved) {
            // Файл создан и имеет размер, но ждем нужное время
          }
        } catch (error) {
          // Игнорируем ошибки проверки
        }
      }, 500);

      // Останавливаем процесс через durationSeconds + небольшой запас для конвертации
      const timeoutId = setTimeout(() => {
        if (!hasResolved && ytdlp && !ytdlp.killed) {
          clearInterval(checkInterval);
          console.log(`[Browser] ⏱️ Останавливаем захват после ${durationSeconds} секунд...`);
          ytdlp.kill();
          
          // Даем время на завершение и конвертацию
          setTimeout(async () => {
            if (!hasResolved) {
              try {
                const stats = await fs.stat(outputPath).catch(() => null);
                if (stats && stats.size > 1000) {
                  const audioBuffer = await fs.readFile(outputPath);
                  console.log(`[Browser] ✅ Аудио захвачено: ${audioBuffer.length} байт`);
                  console.log(`[Browser] 💾 Файл сохранен для проверки: ${outputPath}`);
                  hasResolved = true;
                  resolve({ audio: audioBuffer, ytdlpFound: true, ffmpegFound: true });
                } else {
                  console.log(`[Browser] ❌ Файл слишком маленький: ${stats?.size || 0} байт`);
                  resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
                }
              } catch (error) {
                console.error('[Browser] ❌ Ошибка чтения файла:', error.message);
                resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
              }
            }
          }, 2000); // 2 секунды на конвертацию
        }
      }, durationSeconds * 1000 + 2000); // durationSeconds + 2 секунды запаса

      ytdlp.on('close', async (code) => {
        clearTimeout(timeoutId);
        clearInterval(checkInterval);
        console.log(`[Browser] 🔚 Процесс yt-dlp завершен с кодом: ${code}`);
        
        if (!hasResolved) {
          try {
            const stats = await fs.stat(outputPath).catch(() => null);
            if (stats && stats.size > 1000) {
              const audioBuffer = await fs.readFile(outputPath);
              console.log(`[Browser] ✅ Аудио захвачено: ${audioBuffer.length} байт`);
              console.log(`[Browser] 💾 Файл сохранен для проверки: ${outputPath}`);
              hasResolved = true;
              resolve({ audio: audioBuffer, ytdlpFound: true, ffmpegFound: true });
            } else {
              console.log(`[Browser] ❌ Файл не создан или слишком маленький`);
              if (errorOutput) {
                const errorLines = errorOutput.split('\n').filter(l => l.trim()).slice(0, 5);
                console.log(`[Browser] 📝 Ошибки yt-dlp:`);
                errorLines.forEach(line => console.log(`[Browser]    ${line.substring(0, 150)}`));
              }
              resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
            }
          } catch (error) {
            console.error('[Browser] ❌ Ошибка проверки файла:', error.message);
            resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
          }
        }
      });

      ytdlp.on('error', (error) => {
        clearTimeout(timeoutId);
        clearInterval(checkInterval);
        console.error('[Browser] Ошибка yt-dlp:', error.message);
        resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
      });
    });
  }

  /**
   * Захват аудио через ffmpeg напрямую с ограничением времени
   */
  async captureAudioWithFfmpeg(streamUrl, outputPath, durationSeconds) {
    return new Promise((resolve) => {
      let ffmpeg;
      let errorOutput = '';
      let hasResolved = false;
      let checkCount = 0;

      try {
        // Используем ffmpeg для захвата аудио с ограничением времени
        // Для HLS потоков Twitch важно явно указать аудио поток
        // НЕ пропускаем начало, так как используем один URL и захватываем непрерывно
        // URL уже указывает на текущий момент стрима, реклама уже прошла
        const ffmpegArgs = [
          '-i', streamUrl,
          '-t', `${durationSeconds}`, // Ограничение времени захвата
          '-map', '0:a', // Явно указываем аудио поток (0:a = первый вход, аудио)
          '-vn', // Без видео (дополнительная защита)
          '-acodec', 'libmp3lame', // Кодек MP3
          '-ab', '128k', // Битрейт аудио
          '-ar', '48000', // Улучшенная частота дискретизации (48kHz для лучшего качества)
          '-ac', '2', // Стерео (Whisper конвертирует в моно сам)
          '-ab', '192k', // Битрейт аудио (выше = лучше качество)
          '-f', 'mp3', // Формат вывода
          '-y', // Перезаписать файл
          outputPath
        ];
        
        console.log(`[Browser] 📡 Захват с текущего момента стрима (непрерывный режим)`);
        
        console.log(`[Browser] 🎵 Запуск ffmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);
        ffmpeg = spawn('ffmpeg', ffmpegArgs);
      } catch (error) {
        console.error('[Browser] Ошибка запуска ffmpeg:', error.message);
        resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
        return;
      }

      ffmpeg.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        // Выводим ВСЮ важную информацию из ffmpeg для диагностики
        const lines = text.split('\n').filter(l => l.trim());
        lines.forEach(line => {
          // Выводим информацию о потоках, аудио, ошибках, предупреждениях
          if (line.includes('Stream #') || 
              line.includes('Audio:') || 
              line.includes('Video:') ||
              line.includes('time=') || 
              line.includes('Duration:') ||
              line.includes('Input #') ||
              line.includes('Output #') ||
              line.includes('error') ||
              line.includes('ERROR') ||
              line.includes('WARNING') ||
              line.includes('No audio') ||
              line.includes('no audio') ||
              line.includes('Stream map') ||
              line.includes('size=')) {
            if (line.length < 250) {
              console.log(`[ffmpeg] ${line.trim()}`);
            }
          }
        });
      });

      // Таймаут (увеличиваем, так как ffmpeg может работать немного дольше)
      const timeout = durationSeconds * 1000 + 8000; // 8 секунд запаса
      let timeoutId = setTimeout(() => {
        if (!hasResolved) {
          clearInterval(checkInterval);
          if (ffmpeg && !ffmpeg.killed) {
            ffmpeg.kill();
            console.log(`[Browser] ⏱️ Таймаут захвата аудио через ffmpeg (${timeout}ms)`);
          }
          // Проверяем файл еще раз перед завершением
          fs.stat(outputPath).then(stats => {
            if (stats && stats.size > 1000) {
              console.log(`[Browser] ⚠️ Файл создан после таймаута: ${stats.size} байт`);
            }
          }).catch(() => {});
          hasResolved = true;
          resolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
        }
      }, timeout);
      
      // Обертка для resolve, которая отменяет таймаут
      const originalResolve = resolve;
      const safeResolve = (result) => {
        if (!hasResolved) {
          hasResolved = true;
          clearTimeout(timeoutId);
          clearInterval(checkInterval);
          originalResolve(result);
        }
      };
      
      // Проверяем файл по мере создания
      const checkInterval = setInterval(async () => {
        checkCount++;
        try {
          const stats = await fs.stat(outputPath).catch(() => null);
          if (stats && stats.size > 1000 && !hasResolved) {
            console.log(`[Browser] ✅ Файл готов: ${stats.size} байт`);
            
            try {
              const audioBuffer = await fs.readFile(outputPath);
              // НЕ удаляем файл - сохраняем для проверки
              console.log(`[Browser] ✅ Аудио захвачено: ${audioBuffer.length} байт`);
              console.log(`[Browser] 💾 Файл сохранен: ${outputPath}`);
              safeResolve({ audio: audioBuffer, ytdlpFound: true, ffmpegFound: true });
            } catch (error) {
              console.error('[Browser] ❌ Ошибка чтения файла:', error.message);
              safeResolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
            }
          }
        } catch (error) {
          // Игнорируем ошибки проверки
        }
      }, 500);
      
      // Обработчик завершения процесса
      ffmpeg.on('close', async (code) => {
        clearInterval(checkInterval);
        console.log(`[Browser] 🔚 Процесс ffmpeg завершен с кодом: ${code}`);
        
        if (!hasResolved) {
          try {
            const stats = await fs.stat(outputPath).catch(() => null);
            if (stats && stats.size > 1000) {
              const audioBuffer = await fs.readFile(outputPath);
              // НЕ удаляем файл - сохраняем для проверки звука
              console.log(`[Browser] ✅ Аудио захвачено: ${audioBuffer.length} байт`);
              console.log(`[Browser] 💾 Файл сохранен для проверки: ${outputPath}`);
              safeResolve({ audio: audioBuffer, ytdlpFound: true, ffmpegFound: true });
            } else {
              console.log(`[Browser] ❌ Файл не создан или слишком маленький`);
              if (errorOutput) {
                const errorLines = errorOutput.split('\n').filter(l => l.trim()).slice(0, 5);
                console.log(`[Browser] 📝 Ошибки ffmpeg:`);
                errorLines.forEach(line => console.log(`[Browser]    ${line.substring(0, 150)}`));
              }
              safeResolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
            }
          } catch (error) {
            console.error('[Browser] ❌ Ошибка проверки файла:', error.message);
            safeResolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
          }
        }
      });

      ffmpeg.on('error', (error) => {
        if (error.code === 'ENOENT') {
          console.log('[Browser] ❌ ffmpeg не найден');
          safeResolve({ audio: null, ytdlpFound: true, ffmpegFound: false });
        } else {
          console.error('[Browser] Ошибка ffmpeg:', error.message);
          safeResolve({ audio: null, ytdlpFound: true, ffmpegFound: true });
        }
      });
    });
  }

  /**
   * Умный захват речи с VAD - захватывает только когда человек говорит
   * и получает файл только когда мысль закончена
   */
  async captureSpeechWithVAD(callback) {
    if (!this.streamUrl) {
      await this.ensureStreamUrl();
    }

    if (!this.streamUrl) {
      console.log('[Browser] ❌ Не удалось получить URL стрима для VAD');
      return;
    }

    // Создаем VAD если еще не создан
    if (!this.vad) {
      this.vad = new VoiceActivityDetector({
        volumeThreshold: 0.005, // Смягчено: было 0.01, стало 0.005 (лучше улавливает тихую речь)
        minSpeechDuration: 0.3, // Смягчено: было 0.5, стало 0.3 (улавливает короткие фразы)
        silenceDuration: 0.5, // Смягчено: было 1.0, стало 0.5 (быстрее определяет конец речи)
      });

      this.vad.on('speechStart', () => {
        console.log('[Browser] 🎤 Начало речи - начинаем захват...');
        this.isCapturingSpeech = true;
      });

      this.vad.on('speechEnd', async ({ audioBuffer, duration }) => {
        console.log(`[Browser] ✅ Речь закончена (${duration.toFixed(2)}с) - передаем в распознавание`);
        this.isCapturingSpeech = false;
        
        if (audioBuffer && audioBuffer.length > 0) {
          try {
            await callback(audioBuffer);
          } catch (error) {
            console.error('[Browser] Ошибка в callback речи:', error);
          }
        }
      });
    }

    console.log('[Browser] 🧠 Запуск умного захвата речи с VAD...');
    this.startContinuousCaptureWithVAD();
  }

  /**
   * Непрерывный захват с VAD
   */
  async startContinuousCaptureWithVAD() {
    if (!this.streamUrl) return;

    const tempDir = path.join(os.tmpdir(), 'twitch_bot_audio');
    await fs.mkdir(tempDir, { recursive: true });

    let currentChunk = [];
    let chunkIndex = 0;
    const chunkDuration = 0.5;
    this.lastSpeechTime = Date.now();

    const captureLoop = async () => {
      if (!this.isRunning) return;

      try {
        const chunk = await this.captureAudioChunk(this.streamUrl, chunkDuration, chunkIndex * chunkDuration);
        if (!chunk) {
          setTimeout(captureLoop, 1000);
          return;
        }

        const hasSpeech = await this.analyzeChunkForSpeech(chunk);
        
        if (hasSpeech) {
          if (!this.isCapturingSpeech) {
            console.log('[Browser] 🎤 Начало речи обнаружено');
            this.isCapturingSpeech = true;
            currentChunk = [];
            this.vad?.emit('speechStart');
          }
          currentChunk.push(chunk);
          this.lastSpeechTime = Date.now();
        } else {
          if (this.isCapturingSpeech) {
            const silenceDuration = (Date.now() - this.lastSpeechTime) / 1000;
            if (silenceDuration >= 1.0 && currentChunk.length > 0) {
              const fullAudio = Buffer.concat(currentChunk);
              const duration = (currentChunk.length * chunkDuration);
              
              console.log(`[Browser] ✅ Речь закончена (${duration.toFixed(2)}с)`);
              this.isCapturingSpeech = false;
              
              this.vad?.emit('speechEnd', {
                timestamp: Date.now(),
                duration: duration,
                audioBuffer: fullAudio,
              });
              
              currentChunk = [];
            }
          }
        }

        chunkIndex++;
        setTimeout(captureLoop, 100);
      } catch (error) {
        console.error('[Browser] Ошибка в цикле захвата:', error.message);
        setTimeout(captureLoop, 1000);
      }
    };

    captureLoop();
  }

  /**
   * Захват небольшого чанка аудио
   */
  async captureAudioChunk(streamUrl, duration, offset = 0) {
    return new Promise((resolve) => {
      const tempDir = path.join(os.tmpdir(), 'twitch_bot_audio');
      const tempPath = path.join(tempDir, `chunk_${Date.now()}.wav`);
      
      const ffmpegArgs = [
        '-i', streamUrl,
        '-t', `${duration}`,
        '-vn',
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-y',
        tempPath
      ];

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      let errorOutput = '';

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code === 0) {
          try {
            const buffer = await fs.readFile(tempPath);
            await fs.unlink(tempPath).catch(() => {});
            resolve(buffer);
          } catch (error) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      ffmpeg.on('error', () => {
        resolve(null);
      });

      setTimeout(() => {
        if (ffmpeg && !ffmpeg.killed) {
          ffmpeg.kill();
          resolve(null);
        }
      }, duration * 1000 + 2000);
    });
  }

  /**
   * Анализ чанка на наличие речи
   */
  async analyzeChunkForSpeech(audioBuffer) {
    if (!audioBuffer || audioBuffer.length < 44) return false;
    
    const samples = [];
    for (let i = 44; i < audioBuffer.length; i += 2) {
      const sample = audioBuffer.readInt16LE(i);
      samples.push(Math.abs(sample) / 32768);
    }
    
    if (samples.length === 0) return false;
    
    const avgVolume = samples.reduce((a, b) => a + b, 0) / samples.length;
    return avgVolume > 0.01;
  }

  /**
   * Запуск цикла захвата и обработки аудио
   * Обычный периодический захват без VAD
   */
  async startAudioCaptureLoop(callback, intervalMs = 5000) {
    if (!this.isRunning) {
      await this.init();
    }

    console.log(`[Browser] 🎤 Запуск обычного захвата аудио (каждые ${intervalMs / 1000} секунд)`);
    console.log(`[Browser] ⚠️ VAD отключен - захват по таймеру`);
    
    // Обычный периодический захват без VAD
    const captureInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(captureInterval);
        return;
      }

      try {
        console.log(`[Browser] 🎤 Попытка захвата аудио (${intervalMs / 1000} секунд)...`);
        const audioBuffer = await this.captureAudio(intervalMs / 1000);
        
        if (audioBuffer && audioBuffer.length > 0) {
          console.log(`[Browser] ✅ Аудио захвачено: ${audioBuffer.length} байт`);
          await callback(audioBuffer);
        } else {
          console.log(`[Browser] ⚠️ Аудио не захвачено`);
        }
      } catch (error) {
        console.error(`[Browser] Ошибка захвата аудио:`, error.message);
      }
    }, intervalMs);

    return captureInterval;
  }
}
