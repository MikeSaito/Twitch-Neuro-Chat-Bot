#!/usr/bin/env python3
import sys
import json
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model_size = sys.argv[2]
language = sys.argv[3]
device = sys.argv[4]

try:
    model = WhisperModel(model_size, device=device, compute_type="int8")
    # Отключаем VAD фильтр и используем auto-detect языка для лучшего распознавания
    # Если язык указан, используем его, иначе auto-detect
    transcribe_params = {
        "beam_size": 5,
        "vad_filter": False,  # Отключаем VAD фильтр для теста
        "vad_parameters": {"threshold": 0.3}  # Более мягкий порог VAD если нужен
    }
    if language and language != "auto":
        transcribe_params["language"] = language
    segments, info = model.transcribe(audio_path, **transcribe_params)
    
    text_parts = []
    all_segments = []
    total_confidence = 0
    count = 0
    has_speech = False
    
    for segment in segments:
        # Сохраняем все сегменты для диагностики, но фильтруем по no_speech_prob
        no_speech_prob = getattr(segment, 'no_speech_prob', 0)
        segment_text = segment.text.strip()
        
        # Сохраняем все сегменты (даже с тишиной) для диагностики
        all_segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment_text,
            "no_speech_prob": no_speech_prob
        })
        
        # Добавляем в результат все сегменты с текстом (убрали фильтр по no_speech_prob для теста)
        if segment_text:  # Добавляем все сегменты с текстом
            has_speech = True
            text_parts.append(segment_text)
            if hasattr(segment, 'avg_logprob'):
                total_confidence += segment.avg_logprob
                count += 1
    
    text = " ".join(text_parts).strip()
    
    # Если нет речи, возвращаем пустой текст
    if not has_speech or not text:
        result = {
            "text": "",
            "confidence": 0,
            "language": info.language if hasattr(info, 'language') else language,
            "segments": all_segments
        }
    else:
        confidence = 1.0 + (total_confidence / count if count > 0 else 0)
        confidence = max(0, min(1, confidence))
        
        result = {
            "text": text,
            "confidence": confidence,
            "language": info.language if hasattr(info, 'language') else language,
            "segments": all_segments
        }
    
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e), "text": "", "confidence": 0}))
    sys.exit(1)
