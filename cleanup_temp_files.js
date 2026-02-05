import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const tempDir = path.join(os.tmpdir(), 'twitch_bot_audio');

async function cleanupTempFiles() {
  try {
    console.log('🧹 Очистка временных файлов...');
    console.log(`📁 Папка: ${tempDir}\n`);
    
    const files = await fs.readdir(tempDir).catch(() => {
      console.log('⚠️  Папка не существует или пуста');
      return [];
    });
    
    if (files.length === 0) {
      console.log('✅ Папка пуста, нечего очищать');
      return;
    }
    
    console.log(`📊 Найдено файлов: ${files.length}`);
    
    const partFiles = files.filter(f => f.endsWith('.part'));
    const mp3Files = files.filter(f => f.endsWith('.mp3'));
    
    console.log(`   - .part файлов: ${partFiles.length}`);
    console.log(`   - .mp3 файлов: ${mp3Files.length}\n`);
    
    let cleanedCount = 0;
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 минут
    
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;
        const ageMinutes = Math.floor(age / 60000);
        
        // Удаляем все .part файлы или файлы старше 5 минут
        if (file.endsWith('.part') || age > maxAge) {
          await fs.unlink(filePath);
          cleanedCount++;
          const reason = file.endsWith('.part') ? '(.part файл)' : `(старше ${ageMinutes} минут)`;
          console.log(`   🗑️  Удален: ${file} ${reason}`);
        }
      } catch (error) {
        console.log(`   ⚠️  Ошибка при удалении ${file}: ${error.message}`);
      }
    }
    
    console.log(`\n✅ Очистка завершена. Удалено файлов: ${cleanedCount}`);
    
    // Показываем оставшиеся файлы
    const remainingFiles = await fs.readdir(tempDir).catch(() => []);
    if (remainingFiles.length > 0) {
      console.log(`\n📋 Оставшиеся файлы (${remainingFiles.length}):`);
      remainingFiles.slice(0, 10).forEach(file => {
        console.log(`   - ${file}`);
      });
      if (remainingFiles.length > 10) {
        console.log(`   ... и еще ${remainingFiles.length - 10} файлов`);
      }
    } else {
      console.log('\n✅ Папка полностью очищена');
    }
    
  } catch (error) {
    console.error('❌ Ошибка очистки:', error.message);
  }
}

// Запускаем очистку
cleanupTempFiles().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});
