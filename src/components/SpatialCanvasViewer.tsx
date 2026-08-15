import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  SpatialTextBlock, 
  PageSpatialData, 
  extractSpatialBlocksFromPdfPage, 
  alignTranslationWithSpatialBlocks, 
  drawSpatialOverlayOnCanvas,
  savePageSpatialOverrides,
  loadPageSpatialOverrides,
  applySpatialAIResults,
  debugCoordinateAndFontScale
} from '../services/spatialLayoutService';
import { GeminiService } from '../services/geminiService';
import { 
  Eye, 
  EyeOff, 
  Layers, 
  Sliders, 
  Download, 
  Sparkles, 
  RefreshCw, 
  FileText,
  Type,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Move,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Check,
  X,
  Edit3,
  Bot,
  ALargeSmall,
  ChevronRight,
  HelpCircle,
  EyeClosed
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface SpatialCanvasViewerProps {
  pdfPage?: any;
  pdfDoc?: any;
  pageNum: number;
  translationMarkdown: string;
  zoom: number;
  onZoomChange?: (newZoom: number) => void;
  fontFamily?: string;
  className?: string;
  bookId?: string;
  translationService?: any;
  userKeys?: any[];
  engineKeys?: Record<string, string>;
  selectedEngine?: string;
  onOpenApiSettings?: () => void;
}

export const SpatialCanvasViewer: React.FC<SpatialCanvasViewerProps> = ({
  pdfPage: initialPdfPage,
  pdfDoc,
  pageNum,
  translationMarkdown,
  zoom,
  onZoomChange,
  fontFamily = "'Georgia', 'Times New Roman', 'Cambria', serif",
  className,
  bookId = 'current_doc',
  translationService,
  userKeys = [],
  engineKeys,
  selectedEngine = 'gemini-3.6-flash',
  onOpenApiSettings
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const basePdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseRenderTaskRef = useRef<any>(null);
  const [baseRenderCount, setBaseRenderCount] = useState<number>(0);

  const [activePdfPage, setActivePdfPage] = useState<any>(initialPdfPage || null);
  const [spatialData, setSpatialData] = useState<PageSpatialData | null>(null);
  const [blocks, setBlocks] = useState<SpatialTextBlock[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [autoSpatialEnabled, setAutoSpatialEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mediTrans_autoSpatial') !== 'false';
    } catch {
      return true;
    }
  });
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);

  // Sync / Resolve PDF Page
  useEffect(() => {
    let isCancelled = false;
    if (initialPdfPage) {
      setActivePdfPage(initialPdfPage);
    } else if (pdfDoc && pageNum) {
      pdfDoc.getPage(pageNum).then((p: any) => {
        if (!isCancelled) setActivePdfPage(p);
      }).catch((err: any) => {
        console.warn("[SpatialCanvas] Could not resolve pdfPage from pdfDoc:", err);
      });
    }
    return () => { isCancelled = true; };
  }, [initialPdfPage, pdfDoc, pageNum]);

  // Execute AI-Powered Spatial Translation & Layout Positioning
  const executeAISpatial = useCallback(async (
    targetSpatialBlocks: SpatialTextBlock[], 
    isAutoTrigger: boolean = false
  ) => {
    if (!targetSpatialBlocks || targetSpatialBlocks.length === 0) return;
    setIsAiProcessing(true);
    if (!isAutoTrigger) {
      setAiSuccessMessage(null);
      setAiErrorMessage(null);
    }

    try {
      // 1. Gather all potential keys across the entire app ecosystem
      const candidateKeys: string[] = [];

      // A. From userKeys prop (Firestore Vault keys, Shared keys, System ShopAI keys)
      if (Array.isArray(userKeys) && userKeys.length > 0) {
        userKeys.forEach(k => {
          if (k && typeof k.value === 'string' && k.value.trim() && k.status !== 'error') {
            candidateKeys.push(k.value.trim());
          }
        });
      }

      // B. From engineKeys prop
      if (engineKeys && typeof engineKeys === 'object') {
        Object.values(engineKeys).forEach(val => {
          if (typeof val === 'string' && val.trim()) {
            candidateKeys.push(val.trim());
          }
        });
      }

      // C. From localStorage
      try {
        const savedEngineKeys = localStorage.getItem('mediTrans_engineKeys');
        if (savedEngineKeys) {
          const parsed = JSON.parse(savedEngineKeys);
          Object.values(parsed).forEach((val: any) => {
            if (typeof val === 'string' && val.trim()) candidateKeys.push(val.trim());
          });
        }
      } catch {}

      const shopAiKey = localStorage.getItem('mediTrans_shopAiKey');
      if (shopAiKey && shopAiKey.trim()) {
        candidateKeys.push(shopAiKey.trim());
      }

      // D. From environment variables
      const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || (process as any).env?.GEMINI_API_KEY;
      if (envKey && typeof envKey === 'string' && envKey.trim()) {
        candidateKeys.push(envKey.trim());
      }

      // Filter and deduplicate
      const uniqueKeys = Array.from(new Set(candidateKeys.filter(k => k && k.length > 5)));

      const payloadBlocks = targetSpatialBlocks.map(b => ({
        id: b.id,
        originalText: b.originalText,
        blockType: b.blockType,
        fontSize: b.fontSize,
        isHeading: b.isHeading,
        y: b.y
      }));

      let aiResults: any[] = [];

      // Try using passed translationService first if it has valid keys
      if (translationService && typeof translationService.translateSpatialBlocksWithAI === 'function') {
        try {
          aiResults = await translationService.translateSpatialBlocksWithAI(payloadBlocks, { 
            pageNum,
            referenceMarkdown: translationMarkdown 
          });
        } catch (srvErr: any) {
          console.warn("[SpatialCanvas] Passed translationService failed, attempting with gathered keys:", srvErr);
        }
      }

      if (!aiResults || aiResults.length === 0) {
        if (uniqueKeys.length === 0) {
          if (!isAutoTrigger) {
            throw new Error("Chưa có API Key khả dụng. Vui lòng bấm 'Cài đặt API' để thêm Google Gemini API Key hoặc ShopAIKey.");
          }
          return;
        }

        const engineToUse = selectedEngine || 'gemini-3.6-flash';
        const dedicatedService = new GeminiService(uniqueKeys, engineToUse);
        aiResults = await dedicatedService.translateSpatialBlocksWithAI(payloadBlocks, { 
          pageNum,
          referenceMarkdown: translationMarkdown 
        });
      }

      if (aiResults && aiResults.length > 0) {
        setBlocks(currentBlocks => {
          const updated = applySpatialAIResults(currentBlocks.length > 0 ? currentBlocks : targetSpatialBlocks, aiResults);
          
          // Save to localStorage
          const overrides: Record<string, Partial<SpatialTextBlock>> = {};
          updated.forEach(b => {
            overrides[b.id] = {
              translatedText: b.translatedText,
              customFontStyle: b.customFontStyle,
              customFontSize: b.customFontSize,
              blockType: b.blockType,
              customAlign: b.customAlign
            };
          });
          savePageSpatialOverrides(bookId, pageNum, overrides);
          return updated;
        });

        if (isAutoTrigger) {
          setAiSuccessMessage(`✨ AI đã tự động định vị & dịch 100% tiếng Việt (${aiResults.length} khối)!`);
        } else {
          setAiSuccessMessage(`✨ Đã hoàn tất AI định vị & dịch chuẩn ${aiResults.length} khối văn bản!`);
        }
        setTimeout(() => setAiSuccessMessage(null), 4500);
      }
    } catch (err: any) {
      console.error("[SpatialCanvas] AI refinement failed:", err);
      if (!isAutoTrigger) {
        setAiErrorMessage(err.message || 'Lỗi kết nối khi gọi AI định vị.');
      }
    } finally {
      setIsAiProcessing(false);
    }
  }, [userKeys, engineKeys, selectedEngine, translationService, pageNum, translationMarkdown, bookId]);

  // 1. Extract Spatial Layout on PDF Page Change
  useEffect(() => {
    let isCancelled = false;
    if (!activePdfPage) return;

    const extract = async () => {
      setIsLoading(true);
      try {
        const data = await extractSpatialBlocksFromPdfPage(activePdfPage);
        if (!isCancelled) {
          setSpatialData(data);
          
          // Initial alignment
          let aligned = alignTranslationWithSpatialBlocks(data.blocks, translationMarkdown);
          
          // Check saved overrides
          const savedOverrides = loadPageSpatialOverrides(bookId, pageNum);
          const hasSavedOverrides = savedOverrides && Object.keys(savedOverrides).length > 0;
          
          if (hasSavedOverrides) {
            aligned = aligned.map(b => {
              const override = savedOverrides[b.id];
              return override ? { ...b, ...override } : b;
            });
            setBlocks(aligned);
            // Đã có dữ liệu định vị & dịch thuật -> Dừng tại đây, không gọi AI thêm
            return;
          }

          setBlocks(aligned);

          // Auto-trigger AI Spatial Layout ONLY if not translated yet
          if (autoSpatialEnabled && !hasSavedOverrides && translationMarkdown && translationMarkdown.trim().length > 0) {
            setTimeout(() => {
              if (!isCancelled) {
                executeAISpatial(aligned, true);
              }
            }, 100);
          }
        }
      } catch (err) {
        console.error("[SpatialCanvas] Error extracting spatial blocks:", err);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    extract();
    return () => { isCancelled = true; };
  }, [activePdfPage, pageNum, bookId, autoSpatialEnabled, translationMarkdown, executeAISpatial]);
  
  // Spatial View Options
  const [viewMode, setViewMode] = useState<'overlay' | 'original'>('overlay');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(1.0);
  const [isPeekingOriginal, setIsPeekingOriginal] = useState<boolean>(false);
  const [hoveredBlock, setHoveredBlock] = useState<SpatialTextBlock | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [showDebugBoxes, setShowDebugBoxes] = useState<boolean>(false);
  
  // Selected Block for Inspector Editing
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [globalFontSizeDelta, setGlobalFontSizeDelta] = useState<number>(0);
  const [activeFontFamily, setActiveFontFamily] = useState<string>(fontFamily);
  const [showDisplayOptionsPopover, setShowDisplayOptionsPopover] = useState<boolean>(false);

  // 2. Re-align if translation updates (Stops if already translated/positioned, updates if overrides modified)
  useEffect(() => {
    if (!spatialData || !spatialData.blocks) return;
    
    const savedOverrides = loadPageSpatialOverrides(bookId, pageNum);
    const hasSavedOverrides = savedOverrides && Object.keys(savedOverrides).length > 0;

    if (hasSavedOverrides) {
      setBlocks(spatialData.blocks.map(b => {
        const override = savedOverrides[b.id];
        return override ? { ...b, ...override } : b;
      }));
      return;
    }

    setBlocks(prevBlocks => {
      // If user already has custom edits, preserve them
      const hasCustomEdits = prevBlocks.some(b => b.customText !== undefined || b.customOffsetX !== undefined);
      if (hasCustomEdits) {
        return prevBlocks;
      }
      const aligned = alignTranslationWithSpatialBlocks(spatialData.blocks, translationMarkdown);
      return aligned;
    });
  }, [translationMarkdown, spatialData, bookId, pageNum]);

  // Listen to re-translation spatial overrides update events
  useEffect(() => {
    const handleOverridesUpdate = (e: any) => {
      const detail = e.detail;
      if (detail && (detail.pageNum === pageNum || detail.bookId === bookId)) {
        const savedOverrides = loadPageSpatialOverrides(bookId, pageNum);
        if (savedOverrides && Object.keys(savedOverrides).length > 0 && spatialData?.blocks) {
          setBlocks(spatialData.blocks.map(b => {
            const override = savedOverrides[b.id];
            return override ? { ...b, ...override } : b;
          }));
        }
      }
    };
    window.addEventListener('spatial-overrides-updated', handleOverridesUpdate);
    return () => {
      window.removeEventListener('spatial-overrides-updated', handleOverridesUpdate);
    };
  }, [bookId, pageNum, spatialData]);

  // 3. Stage 1: Render Base PDF to Offscreen Canvas Cache
  useEffect(() => {
    let isMounted = true;
    if (!activePdfPage) return;

    if (baseRenderTaskRef.current) {
      try {
        baseRenderTaskRef.current.cancel();
      } catch {}
      baseRenderTaskRef.current = null;
    }

    const renderBasePdf = async () => {
      try {
        const renderScale = (window.devicePixelRatio || 1) * zoom * 1.5;
        const viewport = activePdfPage.getViewport({ scale: renderScale });

        if (!basePdfCanvasRef.current) {
          basePdfCanvasRef.current = document.createElement('canvas');
        }
        const offCanvas = basePdfCanvasRef.current;
        offCanvas.width = viewport.width;
        offCanvas.height = viewport.height;

        const offCtx = offCanvas.getContext('2d', { alpha: false });
        if (!offCtx) return;

        const renderTask = activePdfPage.render({
          canvasContext: offCtx,
          viewport: viewport
        });
        baseRenderTaskRef.current = renderTask;

        await renderTask.promise;
        baseRenderTaskRef.current = null;

        if (isMounted) {
          setBaseRenderCount(c => c + 1);
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn("[SpatialCanvas] Base PDF render failed:", err);
        }
      }
    };

    renderBasePdf();

    return () => {
      isMounted = false;
      if (baseRenderTaskRef.current) {
        try {
          baseRenderTaskRef.current.cancel();
        } catch {}
        baseRenderTaskRef.current = null;
      }
    };
  }, [activePdfPage, pageNum, zoom]);

  // 4. Stage 2: Fast Composite Render
  const drawComposite = useCallback(() => {
    if (!canvasRef.current || !basePdfCanvasRef.current || !activePdfPage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseCanvas = basePdfCanvasRef.current;
    if (baseCanvas.width === 0 || baseCanvas.height === 0) return;

    const renderScale = (window.devicePixelRatio || 1) * zoom * 1.5;

    if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
      canvas.width = baseCanvas.width;
      canvas.height = baseCanvas.height;
    }
    canvas.style.width = `${baseCanvas.width / (renderScale / zoom)}px`;
    canvas.style.height = `${baseCanvas.height / (renderScale / zoom)}px`;

    // A. Draw cached Base PDF
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseCanvas, 0, 0);

    // B. Draw Dynamic Spatial Canvas Overlay
    if (viewMode === 'overlay' && !isPeekingOriginal && blocks.length > 0) {
      if (showDebugBoxes && activePdfPage) {
        debugCoordinateAndFontScale(activePdfPage, activePdfPage.getViewport({ scale: 1.0 }), canvas, renderScale);
      }

      drawSpatialOverlayOnCanvas(ctx, blocks, {
        scale: renderScale,
        opacity: overlayOpacity,
        hoveredBlockId: hoveredBlock?.id,
        selectedBlockId: selectedBlockId,
        fontFamily: activeFontFamily,
        globalFontSizeDelta,
        showDebugBoxes,
        pageCanvas: baseCanvas,
        pageNum: pageNum,
        pdfPage: activePdfPage
      });
    }
  }, [activePdfPage, zoom, viewMode, isPeekingOriginal, blocks, overlayOpacity, hoveredBlock, selectedBlockId, activeFontFamily, globalFontSizeDelta, showDebugBoxes, baseRenderCount]);

  useEffect(() => {
    drawComposite();
  }, [drawComposite]);

  // Keyboard shortcut: Spacebar to peek original
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        setIsPeekingOriginal(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsPeekingOriginal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Mouse hover & click detection on canvas
  const getBlockAtEvent = (e: React.MouseEvent<HTMLCanvasElement>): SpatialTextBlock | null => {
    if (!canvasRef.current || !spatialData) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleFactor = rect.width / spatialData.pageWidth;
    const pdfX = clientX / scaleFactor;
    const pdfY = clientY / scaleFactor;

    return blocks.find(b => {
      const bX = b.x + (b.customOffsetX || 0);
      const bY = b.y + (b.customOffsetY || 0);
      const bW = b.customWidth || b.width;
      const bH = b.height;
      return pdfX >= (bX - 4) && pdfX <= (bX + bW + 4) &&
             pdfY >= (bY - 4) && pdfY <= (bY + bH + 4);
    }) || null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewMode !== 'overlay') return;
    const found = getBlockAtEvent(e);
    if (found) {
      setHoveredBlock(found);
      setHoverPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredBlock(null);
      setHoverPos(null);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewMode !== 'overlay') return;
    const found = getBlockAtEvent(e);
    if (found) {
      setSelectedBlockId(found.id);
    } else {
      setSelectedBlockId(null);
    }
  };

  // Run AI-Powered Spatial Translation & Layout Positioning (Manual Trigger)
  const handleRunAISpatial = () => {
    if (!spatialData || spatialData.blocks.length === 0) return;
    executeAISpatial(blocks.length > 0 ? blocks : spatialData.blocks, false);
  };

  const toggleAutoSpatial = () => {
    setAutoSpatialEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem('mediTrans_autoSpatial', String(next));
      } catch {}
      if (next && spatialData && spatialData.blocks.length > 0) {
        executeAISpatial(blocks.length > 0 ? blocks : spatialData.blocks, true);
      }
      return next;
    });
  };

  // Block Inspector update helpers
  const selectedBlock = useMemo(() => {
    return blocks.find(b => b.id === selectedBlockId) || null;
  }, [blocks, selectedBlockId]);

  const updateSelectedBlock = (updates: Partial<SpatialTextBlock>) => {
    if (!selectedBlockId) return;
    setBlocks(prev => {
      const next = prev.map(b => {
        if (b.id === selectedBlockId) {
          return { ...b, ...updates };
        }
        return b;
      });

      // Persist updates
      const savedOverrides = loadPageSpatialOverrides(bookId, pageNum);
      savedOverrides[selectedBlockId] = {
        ...(savedOverrides[selectedBlockId] || {}),
        ...updates
      };
      savePageSpatialOverrides(bookId, pageNum, savedOverrides);

      return next;
    });
  };

  const handleResetBlock = () => {
    if (!selectedBlockId) return;
    updateSelectedBlock({
      customText: undefined,
      customOffsetX: 0,
      customOffsetY: 0,
      customFontSize: undefined,
      customFontStyle: undefined,
      customWidth: undefined,
      customColor: undefined,
      customAlign: undefined,
      isExcluded: false
    });
  };

  const handleExportCanvasImage = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png', 1.0);
    const link = document.createElement('a');
    link.download = `MediTrans_Spatial_Page_${pageNum}.png`;
    link.href = dataUrl;
    link.click();
  };

  return (
    <div className={cn("w-full h-full flex-1 flex flex-col bg-slate-100 relative overflow-hidden select-none min-h-0", className)}>
      {/* Top Floating Control Bar */}
      <div className="h-10 bg-white border-b border-slate-200 px-3 flex items-center justify-between z-20 shrink-0 shadow-2xs gap-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {/* Mode Switcher */}
          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200/60 shrink-0">
            <button
              onClick={() => setViewMode('overlay')}
              className={cn(
                "px-2 py-0.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1",
                viewMode === 'overlay' 
                  ? "bg-indigo-600 text-white shadow-xs" 
                  : "text-slate-600 hover:text-slate-900"
              )}
              title="Canvas Đè Vị Trí: Giữ nguyên sơ đồ, biểu đồ, bảng biểu y khoa"
            >
              <Layers className="w-3 h-3" />
              <span>Canvas</span>
            </button>

            <button
              onClick={() => setViewMode('original')}
              className={cn(
                "px-2 py-0.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1",
                viewMode === 'original' 
                  ? "bg-indigo-600 text-white shadow-xs" 
                  : "text-slate-600 hover:text-slate-900"
              )}
              title="Xem PDF gốc nguyên bản"
            >
              <FileText className="w-3 h-3" />
              <span>Gốc</span>
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 shrink-0" />

          {/* AI Spatial Refinement Button & Auto-Toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleRunAISpatial}
              disabled={isAiProcessing || isLoading}
              className={cn(
                "px-2.5 py-0.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs border",
                isAiProcessing
                  ? "bg-indigo-50 border-indigo-200 text-indigo-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-transparent hover:from-indigo-700 hover:to-violet-700 active:scale-95"
              )}
              title="Sử dụng AI để định vị từng khối, căn chỉnh cỡ chữ và dịch chuẩn xác"
            >
              {isAiProcessing ? (
                <RefreshCw className="w-3 h-3 animate-spin text-indigo-600" />
              ) : (
                <Sparkles className="w-3 h-3 text-amber-300" />
              )}
              <span>{isAiProcessing ? "AI Đang Định Vị..." : "✨ AI Layout"}</span>
            </button>

            <button
              onClick={toggleAutoSpatial}
              className={cn(
                "px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1",
                autoSpatialEnabled
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
              )}
              title={autoSpatialEnabled ? "Tự động AI định vị BẬT" : "Tự động AI định vị TẮT"}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", autoSpatialEnabled ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
              <span>Auto</span>
            </button>
          </div>
        </div>

        {/* Right Tools & Display Popover */}
        <div className="flex items-center gap-1.5 shrink-0 relative">
          {viewMode === 'overlay' && (
            <button
              onMouseDown={() => setIsPeekingOriginal(true)}
              onMouseUp={() => setIsPeekingOriginal(false)}
              onMouseLeave={() => setIsPeekingOriginal(false)}
              className={cn(
                "px-2 py-1 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1",
                isPeekingOriginal 
                  ? "bg-amber-500 text-white border-amber-600" 
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
              )}
              title="Giữ chuột hoặc Spacebar để xem nhanh PDF gốc"
            >
              {isPeekingOriginal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              <span className="hidden sm:inline">Xem gốc (Space)</span>
            </button>
          )}

          {/* Display Options Popover Trigger */}
          {viewMode === 'overlay' && (
            <div className="relative">
              <button
                onClick={() => setShowDisplayOptionsPopover(!showDisplayOptionsPopover)}
                className={cn(
                  "p-1.5 rounded-lg border text-xs transition-all flex items-center gap-1",
                  showDisplayOptionsPopover || globalFontSizeDelta !== 0 || overlayOpacity < 1 || showDebugBoxes
                    ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-xs" 
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
                title="Tùy chỉnh hiển thị (Cỡ chữ, độ mờ, khung vị trí)"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold hidden sm:inline">Tùy chỉnh</span>
              </button>

              {/* Popover Content */}
              {showDisplayOptionsPopover && (
                <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 p-3 z-50 flex flex-col gap-3 text-slate-700 text-xs animate-in fade-in zoom-in-95">
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                      Tùy Chỉnh Hiển Thị
                    </span>
                    <button 
                      onClick={() => setShowDisplayOptionsPopover(false)}
                      className="p-1 hover:bg-slate-100 rounded-md text-slate-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Font Size Delta */}
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-600 text-[11px]">Cỡ chữ toàn trang:</span>
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-lg">
                      <button
                        onClick={() => setGlobalFontSizeDelta(d => Math.max(-4, d - 0.5))}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 text-slate-700 font-bold"
                      >
                        -
                      </button>
                      <span className="text-xs font-mono font-bold w-6 text-center">
                        {globalFontSizeDelta > 0 ? `+${globalFontSizeDelta}` : globalFontSizeDelta}
                      </span>
                      <button
                        onClick={() => setGlobalFontSizeDelta(d => Math.min(6, d + 0.5))}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200 text-slate-700 font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Font Family Selector */}
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-slate-600 text-[11px]">Phông chữ dịch (Font):</span>
                    <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => setActiveFontFamily("'Georgia', 'Times New Roman', 'Cambria', serif")}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-semibold transition-all font-serif",
                          activeFontFamily.includes("Georgia") || activeFontFamily.includes("Times") || activeFontFamily.includes("serif")
                            ? "bg-white text-indigo-700 shadow-sm font-bold"
                            : "text-slate-600 hover:text-slate-900"
                        )}
                      >
                        Serif (Sách / Báo)
                      </button>
                      <button
                        onClick={() => setActiveFontFamily("'Plus Jakarta Sans', 'Inter', system-ui, sans-serif")}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-semibold transition-all font-sans",
                          activeFontFamily.includes("Jakarta") || activeFontFamily.includes("Inter") || activeFontFamily.includes("sans-serif")
                            ? "bg-white text-indigo-700 shadow-sm font-bold"
                            : "text-slate-600 hover:text-slate-900"
                        )}
                      >
                        Sans (Hiện đại)
                      </button>
                    </div>
                  </div>

                  {/* Opacity Slider */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-slate-600">Độ mờ Canvas dịch:</span>
                      <span className="font-mono font-bold text-indigo-600">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1.0" 
                      step="0.05"
                      value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {/* Debug Boxes Toggle */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <span className="font-medium text-slate-600 text-[11px]">Hiện Khung Tọa Độ:</span>
                    <button
                      onClick={() => setShowDebugBoxes(!showDebugBoxes)}
                      className={cn(
                        "px-2 py-1 rounded-md text-[10px] font-bold border transition-all",
                        showDebugBoxes 
                          ? "bg-indigo-600 text-white border-indigo-600" 
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      )}
                    >
                      {showDebugBoxes ? "HIỆN" : "ẨN"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleExportCanvasImage}
            className="p-1.5 sm:px-2.5 sm:py-1 bg-white border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/50 text-slate-700 hover:text-indigo-600 rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1"
            title="Tải ảnh Canvas đã dịch nét cao"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Xuất PNG</span>
          </button>
        </div>
      </div>

      {/* AI Success / Error Toast Message */}
      <AnimatePresence>
        {aiSuccessMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-emerald-600 text-white px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold border border-emerald-400"
          >
            <Check className="w-4 h-4" />
            <span>{aiSuccessMessage}</span>
          </motion.div>
        )}
        {aiErrorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-rose-600 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-3 text-xs font-semibold border border-rose-400 max-w-lg"
          >
            <X className="w-4 h-4 text-white shrink-0" />
            <span className="flex-1">{aiErrorMessage}</span>
            {onOpenApiSettings && (
              <button
                onClick={() => {
                  setAiErrorMessage(null);
                  onOpenApiSettings();
                }}
                className="px-2.5 py-1 bg-white text-rose-700 hover:bg-rose-50 rounded-lg text-xs font-bold shrink-0 transition-colors shadow-xs"
              >
                Cài đặt API
              </button>
            )}
            <button
              onClick={() => setAiErrorMessage(null)}
              className="p-1 hover:bg-rose-700/80 rounded-md text-white/80 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Canvas Scroll Area */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto p-4 md:p-8 flex justify-center items-start relative"
      >
        <div className="relative inline-block shadow-2xl bg-white rounded-lg overflow-hidden border border-slate-200 transition-all">
          {isLoading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex items-center justify-center z-30">
              <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs bg-white px-4 py-2 rounded-xl shadow-lg border border-indigo-100">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang phân tích tọa độ & cấu trúc trang...</span>
              </div>
            </div>
          )}

          <canvas 
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { setHoveredBlock(null); setHoverPos(null); }}
            onClick={handleCanvasClick}
            className="block cursor-pointer"
          />
        </div>

        {/* Selected Block Inspector / Typography Editor Drawer */}
        <AnimatePresence>
          {selectedBlock && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="fixed bottom-4 right-4 w-96 max-w-[calc(100vw-2rem)] bg-white/98 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-300 p-4 z-50 flex flex-col gap-3 text-slate-800 text-xs"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <Edit3 className="w-4 h-4 text-indigo-600" />
                  <span>Hiệu Chỉnh Khối #{selectedBlock.id}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 uppercase font-mono">
                    {selectedBlock.blockType}
                  </span>
                </div>
                <button 
                  onClick={() => setSelectedBlockId(null)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Original English Text */}
              <div className="bg-slate-50 p-2 rounded-xl border border-slate-200/80">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Tiếng Anh gốc:</p>
                <p className="text-xs text-slate-700 font-sans line-clamp-2 italic">
                  {selectedBlock.originalText}
                </p>
              </div>

              {/* Vietnamese Translation Edit */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 mb-1 flex items-center justify-between">
                  <span>Nội dung tiếng Việt:</span>
                  <span className="text-[10px] text-slate-400 font-normal">Tự động cập nhật tức thì</span>
                </label>
                <textarea
                  rows={3}
                  value={selectedBlock.customText !== undefined ? selectedBlock.customText : (selectedBlock.translatedText || selectedBlock.originalText)}
                  onChange={(e) => updateSelectedBlock({ customText: e.target.value })}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none resize-y leading-relaxed font-sans text-slate-900"
                  placeholder="Nhập nội dung tiếng Việt..."
                />
              </div>

              {/* Typography Controls: Font Size, Weight, Alignment */}
              <div className="grid grid-cols-2 gap-2">
                {/* Font Size */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-500">Cỡ chữ (pt):</span>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => {
                        const cur = selectedBlock.customFontSize || selectedBlock.fontSize || 11;
                        updateSelectedBlock({ customFontSize: Math.max(6, Math.round((cur - 0.5) * 10) / 10) });
                      }}
                      className="w-6 h-6 bg-white rounded-lg shadow-xs flex items-center justify-center font-bold text-slate-700 hover:bg-slate-50"
                    >
                      -
                    </button>
                    <span className="flex-1 text-center font-bold font-mono text-slate-800 text-xs">
                      {selectedBlock.customFontSize || selectedBlock.fontSize || 11}pt
                    </span>
                    <button
                      onClick={() => {
                        const cur = selectedBlock.customFontSize || selectedBlock.fontSize || 11;
                        updateSelectedBlock({ customFontSize: Math.min(32, Math.round((cur + 0.5) * 10) / 10) });
                      }}
                      className="w-6 h-6 bg-white rounded-lg shadow-xs flex items-center justify-center font-bold text-slate-700 hover:bg-slate-50"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Font Style & Align */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-slate-500">Kiểu & Căn lề:</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const isBold = selectedBlock.customFontStyle === 'bold';
                        updateSelectedBlock({ customFontStyle: isBold ? 'normal' : 'bold' });
                      }}
                      className={cn(
                        "flex-1 h-8 rounded-xl border text-xs font-bold flex items-center justify-center transition-all",
                        selectedBlock.customFontStyle === 'bold' 
                          ? "bg-indigo-600 text-white border-indigo-600" 
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      )}
                      title="In đậm (Bold)"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        const isItalic = selectedBlock.customFontStyle === 'italic';
                        updateSelectedBlock({ customFontStyle: isItalic ? 'normal' : 'italic' });
                      }}
                      className={cn(
                        "flex-1 h-8 rounded-xl border text-xs font-bold flex items-center justify-center transition-all",
                        selectedBlock.customFontStyle === 'italic' 
                          ? "bg-indigo-600 text-white border-indigo-600" 
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                      )}
                      title="In nghiêng (Italic)"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        const alignOrder: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];
                        const cur = selectedBlock.customAlign || 'left';
                        const next = alignOrder[(alignOrder.indexOf(cur as any) + 1) % 3];
                        updateSelectedBlock({ customAlign: next });
                      }}
                      className="flex-1 h-8 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center"
                      title="Đổi căn lề"
                    >
                      {selectedBlock.customAlign === 'center' ? (
                        <AlignCenter className="w-3.5 h-3.5" />
                      ) : selectedBlock.customAlign === 'right' ? (
                        <AlignRight className="w-3.5 h-3.5" />
                      ) : (
                        <AlignLeft className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Position Fine-Tuning D-Pad (Offset X, Y) */}
              <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
                    <Move className="w-3.5 h-3.5 text-indigo-600" />
                    Dịch vị trí (Nudge):
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    X: {selectedBlock.customOffsetX || 0}pt | Y: {selectedBlock.customOffsetY || 0}pt
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 w-24">
                  <div />
                  <button
                    onClick={() => updateSelectedBlock({ customOffsetY: (selectedBlock.customOffsetY || 0) - 2 })}
                    className="h-6 bg-white rounded border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center shadow-xs active:scale-90"
                    title="Dịch lên 2pt"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <div />

                  <button
                    onClick={() => updateSelectedBlock({ customOffsetX: (selectedBlock.customOffsetX || 0) - 2 })}
                    className="h-6 bg-white rounded border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center shadow-xs active:scale-90"
                    title="Dịch trái 2pt"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => updateSelectedBlock({ customOffsetX: 0, customOffsetY: 0 })}
                    className="h-6 bg-slate-100 rounded text-[9px] font-bold text-slate-500 hover:bg-slate-200 flex items-center justify-center"
                    title="Về giữa"
                  >
                    0
                  </button>
                  <button
                    onClick={() => updateSelectedBlock({ customOffsetX: (selectedBlock.customOffsetX || 0) + 2 })}
                    className="h-6 bg-white rounded border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center shadow-xs active:scale-90"
                    title="Dịch phải 2pt"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>

                  <div />
                  <button
                    onClick={() => updateSelectedBlock({ customOffsetY: (selectedBlock.customOffsetY || 0) + 2 })}
                    className="h-6 bg-white rounded border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 flex items-center justify-center shadow-xs active:scale-90"
                    title="Dịch xuống 2pt"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <div />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-200 gap-2">
                <button
                  onClick={handleResetBlock}
                  className="px-2.5 py-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all flex items-center gap-1 font-bold text-[11px]"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Đặt lại</span>
                </button>

                <button
                  onClick={() => setSelectedBlockId(null)}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-xs transition-all flex items-center gap-1 text-[11px]"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Lưu & Đóng</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Hover Tooltip: Side-by-Side Verification */}
      <AnimatePresence>
        {hoveredBlock && hoverPos && !selectedBlock && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            style={{ 
              position: 'fixed', 
              left: Math.min(window.innerWidth - 320, hoverPos.x + 15), 
              top: Math.min(window.innerHeight - 180, hoverPos.y + 15),
              zIndex: 9999
            }}
            className="w-72 bg-slate-900/95 text-white p-3 rounded-xl shadow-2xl border border-slate-700 pointer-events-none backdrop-blur-md"
          >
            <div className="flex items-center justify-between mb-1 pb-1 border-b border-slate-800 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              <span>Đối chiếu khối #{hoveredBlock.id} (Click để chỉnh sửa)</span>
              <span className="text-indigo-400 font-mono">
                {hoveredBlock.customFontSize || hoveredBlock.fontSize}pt
              </span>
            </div>
            
            <div className="mb-2">
              <p className="text-[10px] text-slate-400 font-semibold mb-0.5">Tiếng Anh gốc:</p>
              <p className="text-xs text-slate-200 line-clamp-3 leading-relaxed font-sans">
                {hoveredBlock.originalText}
              </p>
            </div>

            {hoveredBlock.translatedText && (
              <div>
                <p className="text-[10px] text-indigo-400 font-semibold mb-0.5">Tiếng Việt (Canvas):</p>
                <p className="text-xs text-emerald-300 line-clamp-3 leading-relaxed font-sans font-medium">
                  {hoveredBlock.customText || hoveredBlock.translatedText}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
