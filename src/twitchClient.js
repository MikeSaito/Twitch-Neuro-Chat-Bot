import tmi from 'tmi.js';
import { config } from './config.js';

export class TwitchClient {
  constructor(coordinator, dataCollector = null, brainTrainer = null) {
    this.coordinator = coordinator;
    this.dataCollector = dataCollector;
    this.brainTrainer = brainTrainer; // Модуль обучения для режима обучения
    this.client = null;
  }

  async connect() {
    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        reconnect: true,
        secure: true,
      },
      identity: {
        username: config.twitch.username,
        password: config.twitch.oauthToken,
      },
      channels: [config.twitch.channel],
    });

    // Обработчики событий
    this.client.on('connected', (addr, port) => {
      console.log(`[Twitch] Подключен к ${addr}:${port}`);
    });

    this.client.on('join', (channel, username, self) => {
      if (self) {
        console.log(`[Twitch] Присоединился к каналу: ${channel}`);
      }
    });

    this.client.on('message', async (channel, tags, message, self) => {
      if (self) return; // Игнорируем свои сообщения

      const chatMessage = {
        username: tags.username,
        message: message,
        timestamp: Date.now(),
      };

      // Обновляем историю чата в координаторе
      this.coordinator.updateChatHistory(chatMessage);

      // В режиме обучения передаем сообщения напрямую в brainTrainer
      if (this.brainTrainer) {
        const context = {
          imageAnalysis: this.coordinator.contextBuffer.recentImageAnalysis[this.coordinator.contextBuffer.recentImageAnalysis.length - 1],
          speechText: this.coordinator.contextBuffer.recentSpeechText[this.coordinator.contextBuffer.recentSpeechText.length - 1],
          chatHistory: this.coordinator.contextBuffer.chatHistory,
          time: Date.now(),
        };
        
        this.brainTrainer.processChatMessage(chatMessage, context).catch(error => {
          console.error('[TwitchClient] Ошибка обработки сообщения в режиме обучения:', error);
        });
      }

      // Сохраняем сообщение для обучения (асинхронно, не блокируя)
      if (this.dataCollector && this.dataCollector.enabled) {
        this.dataCollector.saveChatMessage(
          chatMessage.username,
          chatMessage.message,
          chatMessage.timestamp
        ).catch(error => {
          console.error('[TwitchClient] Ошибка сохранения сообщения:', error);
        });
      }

      // Можно добавить специальные команды для управления ботом
      if (message.startsWith('!bot')) {
        await this.handleBotCommand(channel, tags, message);
      }
    });

    this.client.on('disconnected', (reason) => {
      console.log(`[Twitch] Отключен: ${reason}`);
    });

    await this.client.connect();
  }

  async sendMessage(message) {
    // Режим только консоли - выводим в консоль вместо отправки в чат
    if (config.debug.consoleOnly) {
      console.log(`\n💬 [БОТ ХОЧЕТ ОТПРАВИТЬ]: ${message}\n`);
      return true;
    }

    if (!this.client || this.client.readyState() !== 'OPEN') {
      console.warn('[Twitch] Клиент не подключен');
      return false;
    }

    try {
      await this.client.say(config.twitch.channel, message);
      console.log(`[Twitch] Отправлено: ${message}`);
      return true;
    } catch (error) {
      console.error('[Twitch] Ошибка отправки сообщения:', error);
      return false;
    }
  }

  async handleBotCommand(channel, tags, message) {
    const parts = message.split(' ');
    const command = parts[1];

    switch (command) {
      case 'silence':
        this.coordinator.setSilenceMode(true);
        await this.sendMessage('Режим молчания включен');
        break;
      case 'unsilence':
        this.coordinator.setSilenceMode(false);
        await this.sendMessage('Режим молчания выключен');
        break;
      case 'stats':
        const stats = this.coordinator.getStats();
        await this.sendMessage(
          `Статистика: сообщений отправлено ${stats.totalMessages}, пропущено ${stats.skippedMessages}`
        );
        break;
      case 'mode':
        // Переключение режима работы мозга
        if (this.coordinator.modules && this.coordinator.modules.brainCoordinator) {
          const currentMode = this.coordinator.modules.brainCoordinator.mode;
          const newMode = currentMode === 'training' ? 'normal' : 'training';
          this.coordinator.modules.brainCoordinator.setMode(newMode);
          await this.sendMessage(`Режим работы мозга: ${newMode === 'training' ? 'ОБУЧЕНИЕ' : 'ОСНОВНОЙ'}`);
        }
        break;
      case 'training':
        // Включить режим обучения
        if (this.coordinator.modules && this.coordinator.modules.brainCoordinator) {
          this.coordinator.modules.brainCoordinator.setMode('training');
          await this.sendMessage('Режим обучения включен');
        }
        break;
      case 'normal':
        // Включить основной режим
        if (this.coordinator.modules && this.coordinator.modules.brainCoordinator) {
          this.coordinator.modules.brainCoordinator.setMode('normal');
          await this.sendMessage('Основной режим включен');
        }
        break;
      case 'memory':
        // Показать статистику памяти
        if (this.coordinator.modules && this.coordinator.modules.brainCoordinator && this.coordinator.modules.brainCoordinator.memory) {
          const stats = this.coordinator.modules.brainCoordinator.memory.getStats();
          await this.sendMessage(
            `Память: ${stats.totalEntries} записей, средняя важность: ${stats.averageImportance}`
          );
        }
        break;
      case 'forget':
        // Очистить память
        if (this.coordinator.modules && this.coordinator.modules.brainCoordinator && this.coordinator.modules.brainCoordinator.memory) {
          await this.coordinator.modules.brainCoordinator.memory.clear();
          await this.sendMessage('Память очищена');
        }
        break;
      default:
        break;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      console.log('[Twitch] Отключен от чата');
    }
  }
}
