export interface TranslationOptions {
  imageBuffer: string;
  textContent?: string;
  pageNumber: number;
  signal?: AbortSignal;
  part?: 'top' | 'bottom' | 'full';
  model?: TranslationEngine;
}

export interface TranslationService {
  translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string>;
  translateMedicalPage(options: TranslationOptions): Promise<string>;
  hasApiKey(): Promise<boolean>;
  summarizeContent?(content: string, type: 'page' | 'document' | 'chapter', signal?: AbortSignal): AsyncGenerator<string>;
  testSingleKeyTranslation(apiKey: string, sampleText: string): Promise<{ success: boolean; resultText?: string; error?: string; latencyMs?: number }>;
}

export type TranslationEngine = 'gemini-3.6-flash' | 'gemini-3-flash-preview' | 'gemini-2.5-flash-lite';

export interface EngineConfig {
  apiKey?: string;
  modelName?: string;
}
