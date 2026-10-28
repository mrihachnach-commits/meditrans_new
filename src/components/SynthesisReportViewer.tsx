import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { cleanMarkdownLatexMath } from '../utils/textSanitizer';
import { 
  FileText, 
  Layers, 
  BookOpen, 
  Search, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronRight, 
  Sparkles, 
  ListFilter,
  Loader2,
  FileCode,
  Award
} from 'lucide-react';

interface GroupReportItem {
  id: string;
  title: string;
  groupIndex: number;
  tier: number;
  content: string;
}

interface ChunkSummaryItem {
  id: string;
  title: string;
  chunkNum: number;
  totalChunks: number;
  docName: string;
  pageRange: string;
  content: string;
}

interface ParsedSynthesisReport {
  statusHeader: string;
  masterReport: string;
  groupReports: GroupReportItem[];
  chunkSummaries: ChunkSummaryItem[];
}

export function parseSynthesisReport(summaryText: string): ParsedSynthesisReport {
  if (!summaryText || !summaryText.trim()) {
    return { statusHeader: '', masterReport: '', groupReports: [], chunkSummaries: [] };
  }

  let text = cleanMarkdownLatexMath(summaryText.trim());
  let statusHeader = '';

  // 1. Extract status header if present (starts with > ⚡)
  const statusMatch = text.match(/^>\s*⚡\s*\*\*([^*]+)\*\*(.*?)(?=\n\n|\n[#=]|$)/s);
  if (statusMatch) {
    statusHeader = statusMatch[0].trim();
    text = text.substring(statusMatch[0].length).trim();
  } else if (text.startsWith('> ')) {
    const firstDivider = text.indexOf('\n\n');
    if (firstDivider !== -1) {
      statusHeader = text.substring(0, firstDivider).trim();
      text = text.substring(firstDivider).trim();
    }
  }

  // 2. Separate Master Report from Detail Section
  let masterReport = '';
  let detailSection = text;

  if (text.includes('## 📋 CHI TIẾT CÁC PHÂN ĐOẠN TỔNG HỢP')) {
    const parts = text.split('## 📋 CHI TIẾT CÁC PHÂN ĐOẠN TỔNG HỢP');
    masterReport = parts[0].replace(/^[=\-\s]+|[=\-\s]+$/g, '').trim();
    detailSection = parts[1] || '';
  } else if (!text.includes('### 📌 Phân đoạn') && !text.includes('### 📑 Báo cáo Nhóm')) {
    masterReport = text;
    detailSection = '';
  }

  // 3. Parse Group Reports
  const groupReports: GroupReportItem[] = [];
  const groupBlocks = detailSection.split(/(?=### 📑 Báo cáo Nhóm)/g);

  groupBlocks.forEach((block, idx) => {
    const match = block.match(/^### 📑 (Báo cáo Nhóm (\d+)(?:\s*\(Phân tầng (\d+)\))?)([\s\S]*)/);
    if (match) {
      const title = match[1].trim();
      const groupIndex = parseInt(match[2] || '1', 10);
      const tier = parseInt(match[3] || '1', 10);
      let content = match[4].trim();

      const dividerIdx = content.indexOf('==============================');
      if (dividerIdx !== -1) {
        content = content.substring(0, dividerIdx).trim();
      }

      groupReports.push({
        id: `group_${tier}_${groupIndex}_${idx}`,
        title,
        groupIndex,
        tier,
        content
      });
    }
  });

  // 4. Parse Chunk Summaries
  const chunkSummaries: ChunkSummaryItem[] = [];
  const chunkBlocks = detailSection.split(/(?=### 📌 Phân đoạn)/g);

  chunkBlocks.forEach((block, idx) => {
    const match = block.match(/^### 📌 (Phân đoạn (\d+)\/(\d+)\s*\((.*?):\s*Trang\s*([^)]+)\))([\s\S]*)/);
    if (match) {
      const title = match[1].trim();
      const chunkNum = parseInt(match[2] || '1', 10);
      const totalChunks = parseInt(match[3] || '1', 10);
      const docName = match[4].trim();
      const pageRange = match[5].trim();
      let content = match[6].trim();

      const dividerIdx = content.indexOf('==============================');
      if (dividerIdx !== -1) {
        content = content.substring(0, dividerIdx).trim();
      }

      chunkSummaries.push({
        id: `chunk_${chunkNum}_${idx}`,
        title,
        chunkNum,
        totalChunks,
        docName,
        pageRange,
        content
      });
    }
  });

  return {
    statusHeader,
    masterReport,
    groupReports,
    chunkSummaries
  };
}

interface SynthesisReportViewerProps {
  summaryText: string;
  isSummarizing: boolean;
  fontSize: number;
  fontFamily: string;
  customMarkdownComponents: any;
  onSynthesize: (forceRestart: boolean) => void;
}

export function SynthesisReportViewer({
  summaryText,
  isSummarizing,
  fontSize,
  fontFamily,
  customMarkdownComponents,
  onSynthesize
}: SynthesisReportViewerProps) {
  const [activeTab, setActiveTab] = useState<'master' | 'groups' | 'chunks' | 'full'>('master');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | 'all'>(0);
  const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | 'all'>(0);
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>({});

  const parsed = useMemo(() => parseSynthesisReport(summaryText), [summaryText]);

  // Default tab fallback if master is empty
  const hasMaster = Boolean(parsed.masterReport && parsed.masterReport.trim().length > 50);
  const hasGroups = parsed.groupReports.length > 0;
  const hasChunks = parsed.chunkSummaries.length > 0;

  // Auto switch tab if master report not created yet
  const effectiveTab = useMemo(() => {
    if (activeTab === 'master' && !hasMaster) {
      if (hasGroups) return 'groups';
      if (hasChunks) return 'chunks';
      return 'full';
    }
    return activeTab;
  }, [activeTab, hasMaster, hasGroups, hasChunks]);

  const handleCopy = () => {
    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleAccordion = (id: string) => {
    setExpandedAccordions(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const fontStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    fontFamily: fontFamily === 'Inter' ? 'var(--font-sans)' : 
               fontFamily === 'JetBrains Mono' ? 'var(--font-mono)' : 
               fontFamily === 'Playfair Display' ? 'var(--font-display)' :
               fontFamily === 'Cormorant Garamond' ? 'var(--font-serif)' :
               fontFamily
  };

  // Filtered Chunks
  const filteredChunks = useMemo(() => {
    if (!searchQuery.trim()) return parsed.chunkSummaries;
    const q = searchQuery.toLowerCase();
    return parsed.chunkSummaries.filter(c => 
      c.title.toLowerCase().includes(q) || 
      c.content.toLowerCase().includes(q) ||
      c.pageRange.toLowerCase().includes(q)
    );
  }, [parsed.chunkSummaries, searchQuery]);

  // Filtered Groups
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return parsed.groupReports;
    const q = searchQuery.toLowerCase();
    return parsed.groupReports.filter(g => 
      g.title.toLowerCase().includes(q) || 
      g.content.toLowerCase().includes(q)
    );
  }, [parsed.groupReports, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-slate-50/50 rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs">
      {/* 1. STATUS HEADER BARS */}
      {isSummarizing && (
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-xs shadow-md shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-300" />
            <span className="font-semibold truncate">
              {parsed.statusHeader ? parsed.statusHeader.replace(/^>\s*⚡\s*/, '').replace(/\*\*/g, '') : "Notebook AI đang tổng hợp kiến thức y khoa..."}
            </span>
          </div>
          <span className="bg-indigo-800/80 text-amber-200 text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider shrink-0">
            Đang xử lý
          </span>
        </div>
      )}

      {/* 2. NAVIGATION BAR & ACTION CONTROLS */}
      <div className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 z-10 shadow-2xs">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar max-w-full">
          <button
            onClick={() => setActiveTab('master')}
            disabled={!hasMaster && isSummarizing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              effectiveTab === 'master'
                ? 'bg-white text-indigo-700 shadow-xs'
                : hasMaster 
                  ? 'text-slate-600 hover:text-indigo-600'
                  : 'text-slate-400 opacity-60'
            }`}
          >
            <Award className="w-3.5 h-3.5 text-amber-500" />
            <span>Báo cáo Cuối cùng</span>
            {hasMaster && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('groups')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              effectiveTab === 'groups'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-indigo-600'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            <span>Báo cáo Nhóm</span>
            {hasGroups && (
              <span className="px-1.5 py-0.2 bg-indigo-100 text-indigo-700 text-[10px] rounded-full font-black">
                {parsed.groupReports.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('chunks')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              effectiveTab === 'chunks'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-indigo-600'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-500" />
            <span>Phân đoạn</span>
            {hasChunks && (
              <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-700 text-[10px] rounded-full font-black">
                {parsed.chunkSummaries.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('full')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              effectiveTab === 'full'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-indigo-600'
            }`}
            title="Xem toàn văn bản dạng gộp"
          >
            <FileCode className="w-3.5 h-3.5 text-slate-400" />
            <span>Toàn văn (Gộp)</span>
          </button>
        </div>

        {/* Global Action Tools */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer"
            title="Sao chép toàn bộ báo cáo"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
            <span className="hidden sm:inline">{copied ? "Đã chép" : "Sao chép"}</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN CONTENT CONTAINER */}
      <div className="flex-1 overflow-auto p-4 select-text">
        {/* TAB 1: MASTER REPORT VIEW */}
        {effectiveTab === 'master' && (
          <div className="space-y-4 max-w-full">
            {hasMaster ? (
              <div className="bg-white p-6 rounded-2xl border border-indigo-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-50 rounded-xl">
                      <Sparkles className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">Báo cáo Tổng hợp Tri thức Y khoa (Master Brief)</h3>
                      <p className="text-[11px] text-slate-400">Tóm tắt toàn diện từ tất cả các phân đoạn tài liệu</p>
                    </div>
                  </div>
                </div>

                <div className="markdown-body max-w-full overflow-hidden" style={fontStyle}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={customMarkdownComponents}>
                    {cleanMarkdownLatexMath(parsed.masterReport)}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-2xl border border-dashed border-slate-300 text-center space-y-3">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-700">Đang tóm tắt các nhóm phân đoạn trước khi tạo Báo cáo Cuối cùng...</p>
                <p className="text-[11px] text-slate-400">Bạn có thể chuyển qua thẻ "Báo cáo Nhóm" hoặc "Phân đoạn" ở trên để xem từng phần đã hoàn thành.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: GROUP REPORTS VIEW */}
        {effectiveTab === 'groups' && (
          <div className="space-y-4">
            {/* Group Header Controls */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Tìm trong các báo cáo nhóm..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs w-full focus:outline-hidden text-slate-700 placeholder:text-slate-400"
                />
              </div>

              {parsed.groupReports.length > 1 && (
                <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
                  <button
                    onClick={() => setSelectedGroupIndex('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      selectedGroupIndex === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Tất cả nhóm
                  </button>
                  {parsed.groupReports.map((g, idx) => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGroupIndex(idx)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        selectedGroupIndex === idx ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Nhóm {g.groupIndex} (Tầng {g.tier})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Group Items Display */}
            {filteredGroups.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
                Chưa có báo cáo nhóm trung gian nào.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredGroups
                  .filter((_, idx) => selectedGroupIndex === 'all' || selectedGroupIndex === idx)
                  .map((group) => {
                    const isExpanded = expandedAccordions[group.id] ?? true;
                    return (
                      <div key={group.id} className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                        <button
                          onClick={() => toggleAccordion(group.id)}
                          className="w-full px-4 py-3 bg-slate-50/80 hover:bg-indigo-50/50 border-b border-slate-100 flex items-center justify-between transition-colors text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
                            <span className="text-xs font-bold text-slate-800">{group.title}</span>
                          </div>
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        </button>

                        {isExpanded && (
                          <div className="p-5 markdown-body" style={fontStyle}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={customMarkdownComponents}>
                              {cleanMarkdownLatexMath(group.content)}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CHUNK SUMMARIES VIEW */}
        {effectiveTab === 'chunks' && (
          <div className="space-y-4">
            {/* Chunk Filter & Selector */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Tìm trang hoặc nội dung phân đoạn..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs w-full focus:outline-hidden text-slate-700 placeholder:text-slate-400"
                />
              </div>

              {parsed.chunkSummaries.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 no-scrollbar">
                  <button
                    onClick={() => setSelectedChunkIndex('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                      selectedChunkIndex === 'all' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Xem tất cả ({parsed.chunkSummaries.length})
                  </button>
                  {parsed.chunkSummaries.map((c, idx) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedChunkIndex(idx)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                        selectedChunkIndex === idx ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                      }`}
                      title={`${c.docName} (Trang ${c.pageRange})`}
                    >
                      PĐ {c.chunkNum} (Trang {c.pageRange})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chunks List */}
            {filteredChunks.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400 text-xs">
                Chưa có phân đoạn tóm tắt nào.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredChunks
                  .filter((_, idx) => selectedChunkIndex === 'all' || selectedChunkIndex === idx)
                  .map((chunk) => {
                    const isExpanded = expandedAccordions[chunk.id] ?? true;
                    return (
                      <div key={chunk.id} className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                        <button
                          onClick={() => toggleAccordion(chunk.id)}
                          className="w-full px-4 py-3 bg-slate-50/80 hover:bg-emerald-50/50 border-b border-slate-100 flex items-center justify-between transition-colors text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-xs font-bold text-slate-800">{chunk.title}</span>
                          </div>
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        </button>

                        {isExpanded && (
                          <div className="p-5 markdown-body" style={fontStyle}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={customMarkdownComponents}>
                              {cleanMarkdownLatexMath(chunk.content)}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: FULL AGGREGATED REPORT VIEW */}
        {effectiveTab === 'full' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="markdown-body max-w-full overflow-hidden" style={fontStyle}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={customMarkdownComponents}>
                {cleanMarkdownLatexMath(summaryText)}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
