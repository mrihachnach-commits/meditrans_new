import { useState, useCallback, useRef, useEffect } from 'react';
import { TranslationEngine } from '../services/translationService';

interface PageTranslation {
  content: string;
  status: 'idle' | 'loading' | 'success' | 'error';
}

export function useTranslation() {
  const [activePage, setActivePage] = useState<number | null>(null);
  const [streamedContent, setStreamedContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  
  const setStream = useCallback((page: number, content: string, streaming: boolean) => {
    setActivePage(page);
    setStreamedContent(content);
    setIsStreaming(streaming);
  }, []);

  const resetStream = useCallback(() => {
    setActivePage(null);
    setStreamedContent("");
    setIsStreaming(false);
  }, []);

  return {
    activePage,
    streamedContent,
    isStreaming,
    setStream,
    resetStream
  };
}
