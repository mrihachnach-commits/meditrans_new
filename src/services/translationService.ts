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
  translateSpatialBlocksWithAI?(blocks: any[], options?: { pageNum?: number; referenceMarkdown?: string }): Promise<any[]>;
  generateSpatialBlockVariants?(context: {
    originalText: string;
    translatedText?: string;
    blockType: string;
    preferredLineCount?: number;
    targetWidth?: number;
  }): Promise<string[]>;
}

export type TranslationEngine = 'gemini-3.6-flash' | 'gemini-3-flash-preview' | 'gemini-flash-lite-latest';

export interface EngineConfig {
  apiKey?: string;
  modelName?: string;
}
